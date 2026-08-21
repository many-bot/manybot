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
 *                              message. Only active at SECURITY_LEVEL
 *                              "high"; low/medium leave edit timing to the
 *                              caller.
 *
 * All of the above scale with SECURITY_LEVEL ("low" | "medium" | "high").
 * Higher levels are slower and more conservative — lower risk of WhatsApp's
 * automation detection, at the cost of response speed.
 *
 * Text sends simulate the typing/recording presence indicator before
 * the message arrives, so the chat shows "typing..." realistically.
 */

import type { WaContract } from "#kernel/waContract.js";
import { CONFIG } from "#config";
import { logger } from "#logger";

// ── Per-level profiles ───────────────────────────────────────────────────────

interface SecurityProfile {
  globalMsgPerSec:     number;
  chatCooldownMs:      number;
  jitterMs:            { min: number; max: number };
  concurrency:         number; // max chats answered at the same time, globally
  typingMaxMs:         number; // cap on the "typing..." indicator, regardless of text length
  /** Edit throttle. Only set on the "high" profile — low/medium have no edit throttle. */
  editThrottle?: {
    minGapMs:           { min: number; max: number };
    maxEditsPerMessage: number;
  };
}

const PROFILES: Record<"low" | "medium" | "high", SecurityProfile> = {
  low: {
    globalMsgPerSec:    8,
    chatCooldownMs:     100,
    jitterMs:           { min: 30, max: 120 },
    concurrency:        Infinity,
    typingMaxMs:        2000,
  },
  medium: {
    globalMsgPerSec:    5,
    chatCooldownMs:     150,
    jitterMs:           { min: 50, max: 200 },
    concurrency:        2,
    typingMaxMs:        4000,
  },
  high: {
    globalMsgPerSec:    2,
    chatCooldownMs:     400,
    jitterMs:           { min: 150, max: 500 },
    concurrency:        1,
    typingMaxMs:        8000,
    editThrottle: {
      minGapMs:           { min: 800, max: 2000 },
      maxEditsPerMessage: 5,
    },
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

// ── Edit throttle ─────────────────────────────────────────────────────────────
// Only enforced when the active profile defines `editThrottle` (currently
// just "high"). low/medium always allow immediately.

const editState = new Map<string, { count: number; lastEditAt: number }>();

/**
 * Wait for a safe edit slot for `messageId`, then record the edit.
 * Returns `false` if the per-message edit cap has been reached — the
 * caller should drop the edit instead of sending it.
 *
 * @param {string} messageId
 * @returns {Promise<boolean>} whether the edit is allowed to proceed
 */
export async function waitForEditSlot(messageId: string): Promise<boolean> {
  const throttle = currentProfile().editThrottle;
  if (!throttle) return true;

  const state = editState.get(messageId) ?? { count: 0, lastEditAt: 0 };

  if (state.count >= throttle.maxEditsPerMessage) {
    logger.debug(`[sendGuard] edit cap (${throttle.maxEditsPerMessage}) reached for message ${messageId} — dropping edit`);
    return false;
  }

  const gap     = randomBetween(throttle.minGapMs);
  const elapsed = Date.now() - state.lastEditAt;
  if (state.lastEditAt > 0 && elapsed < gap) {
    await sleep(gap - elapsed);
  }

  state.count++;
  state.lastEditAt = Date.now();
  editState.set(messageId, state);
  return true;
}

/**
 * Show a presence indicator for `ms` milliseconds, then clear it.
 * Best-effort — errors are swallowed.
 *
 * @param {WaContract|null}        contract
 * @param {string|null}            chatId
 * @param {number}                 ms
 * @param {"typing"|"recording"}   [state="typing"]
 */
export async function simulateState(
  contract: WaContract | null,
  chatId:   string | null,
  ms:       number,
  state:    "typing" | "recording" = "typing"
): Promise<void> {
  if (!contract || !chatId || ms <= 0) return;
  try {
    await contract.sendPresenceUpdate(state === "recording" ? "recording" : "composing", chatId);
    await sleep(ms);
    await contract.sendPresenceUpdate("paused", chatId);
  } catch (e) {
    logger.debug(`[sendGuard] presence simulation failed (non-fatal): ${(e as Error).message}`);
  }
}

