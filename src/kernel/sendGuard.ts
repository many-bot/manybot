/**
 * sendGuard.ts
 *
 * Anti-detection throttle layer for all outbound sends.
 *
 * Protections applied before every message:
 *   1. Global token bucket   — hard cap on messages/second across all chats
 *   2. Per-chat cooldown     — minimum gap between sends to the same chat
 *   3. Human jitter          — random delay to break robotic timing patterns
 *   4. Chat-concurrency gate — caps how many different chats the bot can be
 *                              actively answering at the same time
 *   5. Edit throttle         — jittered minimum gap + cap on edits per
 *                              message, so things like loading animations
 *                              don't edit on a fixed, bot-like cadence
 *
 * All of the above scale with SECURITY_LEVEL ("low" | "medium" | "high").
 * Higher levels are slower and more conservative — lower risk of WhatsApp's
 * automation detection, at the cost of response speed.
 *
 * Text sends simulate the typing/recording presence indicator before
 * the message arrives, so the chat shows "typing..." realistically.
 */

import type { PresenceCapable } from "#core/adapter.js";
import { CONFIG } from "#config";
import { logger } from "#logger";

// ── Per-level profiles ───────────────────────────────────────────────────────

interface SecurityProfile {
  globalMsgPerSec:     number;
  chatCooldownMs:      number;
  jitterMs:            { min: number; max: number };
  concurrency:         number; // max chats answered at the same time, globally
  editIntervalMs:      { min: number; max: number };
  maxEditsPerMessage:  number;
  typingMaxMs:         number; // cap on the "typing..." indicator, regardless of text length
}

const PROFILES: Record<"low" | "medium" | "high", SecurityProfile> = {
  low: {
    globalMsgPerSec:    8,
    chatCooldownMs:     100,
    jitterMs:           { min: 30, max: 120 },
    concurrency:        Infinity,
    editIntervalMs:     { min: 800, max: 2000 },
    maxEditsPerMessage: 20,
    typingMaxMs:        2000,
  },
  medium: {
    globalMsgPerSec:    5,
    chatCooldownMs:     150,
    jitterMs:           { min: 50, max: 200 },
    concurrency:        2,
    editIntervalMs:     { min: 1200, max: 3000 },
    maxEditsPerMessage: 12,
    typingMaxMs:        4000,
  },
  high: {
    globalMsgPerSec:    2,
    chatCooldownMs:     400,
    jitterMs:           { min: 150, max: 500 },
    concurrency:        1,
    editIntervalMs:     { min: 2000, max: 5000 },
    maxEditsPerMessage: 6,
    typingMaxMs:        8000,
  },
};

function currentProfile(): SecurityProfile {
  const level = CONFIG.SECURITY_LEVEL as keyof typeof PROFILES;
  return PROFILES[level] ?? PROFILES.medium;
}

const TYPING_CPS          = 90;
const MEDIA_INDICATOR_MS  = { min: 400, max: 1000 };

// ── Global token bucket ───────────────────────────────────────────────────────
// Refill rate follows the active profile, re-read on every call so a
// SECURITY_LEVEL change via reloadConfig() takes effect immediately.

let tokens     = PROFILES.medium.globalMsgPerSec;
let lastRefill = Date.now();

function consumeGlobalToken(): number {
  const rate       = currentProfile().globalMsgPerSec;
  const msPerToken = 1000 / rate;
  const now        = Date.now();
  const elapsed    = now - lastRefill;
  tokens        = Math.min(rate, tokens + elapsed / msPerToken);
  lastRefill    = now;
  if (tokens >= 1) { tokens -= 1; return 0; }
  return Math.ceil((1 - tokens) * msPerToken);
}

// ── Per-chat cooldown ─────────────────────────────────────────────────────────

const lastSentAt = new Map<string, number>();

function chatCooldownMs(jid: string): number {
  const wait = (lastSentAt.get(jid) ?? 0) + currentProfile().chatCooldownMs - Date.now();
  return wait > 0 ? wait : 0;
}

function recordSend(jid: string): void {
  lastSentAt.set(jid, Date.now());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function randomBetween(range: { min: number; max: number }): number {
  return range.min + Math.random() * (range.max - range.min);
}

/**
 * How long the typing indicator should appear before sending text.
 * Capped by the active profile's `typingMaxMs` — higher SECURITY_LEVELs
 * tolerate a longer "typing..." for long messages instead of flatlining.
 * @param {string} text
 * @returns {number} ms
 */
export function typingDuration(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.min((text.length / TYPING_CPS) * 1000, currentProfile().typingMaxMs);
}

/**
 * A human-feeling duration for media "processing" indicator. If a caption
 * is given, adds its own typing time on top (same per-profile cap as
 * typingDuration) so a media message with a long caption doesn't look
 * instant.
 * @param {string} [caption]
 * @returns {number} ms
 */
export function mediaDuration(caption?: string): number {
  const base = randomBetween(MEDIA_INDICATOR_MS);
  return caption ? base + typingDuration(caption) : base;
}

// ── Chat-concurrency gate ─────────────────────────────────────────────────────
// Caps how many DIFFERENT chats can be actively answered at once, globally
// (not per-chat — messageHandler.ts already serializes a single chat's own
// messages). high=1 effectively locks the bot to one chat at a time,
// medium=2, low=unlimited. FIFO queue for anything past the cap.

let activeSlots = 0;
const slotWaiters: Array<() => void> = [];

function releaseChatSlot(): void {
  activeSlots--;
  const next = slotWaiters.shift();
  if (next) next();
}

/**
 * Acquire a global chat-concurrency slot before processing a message for
 * `jid`. Resolves once a slot is free. Always call the returned release
 * function (e.g. in a `finally`) or the pool leaks.
 * @param {string} jid — kept for logging/debugging, not used for scoping
 * @returns {Promise<() => void>} release function
 */
export async function acquireChatSlot(jid: string): Promise<() => void> {
  const max = currentProfile().concurrency;

  if (activeSlots < max) {
    activeSlots++;
    return releaseChatSlot;
  }

  logger.debug(`[sendGuard] chat-concurrency gate full — queuing ${jid}`);
  return new Promise<() => void>(resolve => {
    slotWaiters.push(() => {
      activeSlots++;
      resolve(releaseChatSlot);
    });
  });
}

// ── Edit throttle ─────────────────────────────────────────────────────────────
// Jittered minimum gap between edits of the same message, plus a hard cap
// on total edits — prevents fixed-interval edit loops (e.g. loading
// animations) from producing a uniform-timing signature.

interface EditState {
  lastEditAt: number;
  count:      number;
}

const editState = new Map<string, EditState>();
const EDIT_STATE_STALE_MS = 10 * 60 * 1000;

function cleanupEditState(now: number): void {
  for (const [id, s] of editState) {
    if (now - s.lastEditAt > EDIT_STATE_STALE_MS) editState.delete(id);
  }
}

/**
 * Waits for a safe edit slot for `messageId`, applying a jittered minimum
 * gap since its last edit. Returns false once the message has hit its
 * per-level edit cap — callers should skip the edit silently in that case.
 * @param {string} messageId
 * @returns {Promise<boolean>} true if the edit may proceed
 */
export async function waitForEditSlot(messageId: string): Promise<boolean> {
  const now = Date.now();
  cleanupEditState(now);

  const profile = currentProfile();
  const s = editState.get(messageId) ?? { lastEditAt: 0, count: 0 };

  if (s.count >= profile.maxEditsPerMessage) {
    editState.set(messageId, s);
    logger.debug(`[sendGuard] edit cap reached for ${messageId}`);
    return false;
  }

  const minGap = randomBetween(profile.editIntervalMs);
  const wait   = s.lastEditAt + minGap - Date.now();
  if (wait > 0) await sleep(wait);

  s.lastEditAt = Date.now();
  s.count += 1;
  editState.set(messageId, s);
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wait for a safe send slot: global rate → per-chat cooldown → jitter.
 * Must be called before every outbound message.
 *
 * @param {string}  jid
 * @param {object}  [opts]
 * @param {boolean} [opts.cooldown=true]
 * @param {boolean} [opts.jitter=true]
 */
export async function waitForSendSlot(jid: string, { cooldown = true, jitter = true } = {}): Promise<void> {
  const tokenWait = consumeGlobalToken();
  if (tokenWait > 0) {
    logger.debug(`[sendGuard] global rate hit — queuing ${tokenWait}ms`);
    await sleep(tokenWait);
  }

  if (cooldown) {
    const coolWait = chatCooldownMs(jid);
    if (coolWait > 0) {
      logger.debug(`[sendGuard] chat cooldown (${jid}) — waiting ${coolWait}ms`);
      await sleep(coolWait);
    }
  }

  if (jitter) await sleep(randomBetween(currentProfile().jitterMs));

  recordSend(jid);
}

/**
 * Show a presence indicator for `ms` milliseconds, then clear it.
 * No-op on drivers without the "presence" capability. Best-effort —
 * errors are swallowed.
 *
 * @param {PresenceCapable|null}   adapter
 * @param {string|null}            chatId
 * @param {number}                 ms
 * @param {"typing"|"recording"}   [state="typing"]
 */
export async function simulateState(
  adapter: PresenceCapable | null,
  chatId:  string | null,
  ms:      number,
  state:   "typing" | "recording" = "typing"
): Promise<void> {
  if (!adapter || !chatId || ms <= 0) return;
  if (!adapter.capabilities.has("presence") || !adapter.setPresence) return;
  try {
    // Adapter contract only knows "composing" — recording is a WhatsApp nuance
    // collapsed here until a driver needs to distinguish it.
    await adapter.setPresence(chatId, "composing");
    await sleep(ms);
    await adapter.setPresence(chatId, "paused");
  } catch (e) {
    logger.debug(`[sendGuard] presence simulation failed (non-fatal): ${(e as Error).message}`);
  }
}
