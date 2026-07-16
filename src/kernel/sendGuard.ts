/**
 * sendGuard.ts
 *
 * Anti-detection throttle layer for all outbound sends.
 *
 * Three protections applied before every message:
 *   1. Global token bucket  — hard cap on messages/second across all chats
 *   2. Per-chat cooldown    — minimum gap between sends to the same chat
 *   3. Human jitter         — random delay to break robotic timing patterns
 *
 * Text sends simulate the typing/recording presence indicator before
 * the message arrives, so the chat shows "typing..." realistically.
 */

import type { PresenceCapable } from "#core/adapter.js";
import { logger } from "#logger";

// ── Tunables ──────────────────────────────────────────────────────────────────

const GLOBAL_MSG_PER_SEC = 5;
const CHAT_COOLDOWN_MS   = 150;
const JITTER_MS          = { min: 50, max: 200 };
const TYPING_CPS          = 90;
const TYPING_MAX_MS       = 2000;
const MEDIA_INDICATOR_MS  = { min: 400, max: 1000 };

// ── Global token bucket ───────────────────────────────────────────────────────

const MS_PER_TOKEN = 1000 / GLOBAL_MSG_PER_SEC;
let tokens         = GLOBAL_MSG_PER_SEC;
let lastRefill     = Date.now();

function consumeGlobalToken(): number {
  const now     = Date.now();
  const elapsed = now - lastRefill;
  tokens        = Math.min(GLOBAL_MSG_PER_SEC, tokens + elapsed / MS_PER_TOKEN);
  lastRefill    = now;
  if (tokens >= 1) { tokens -= 1; return 0; }
  return Math.ceil((1 - tokens) * MS_PER_TOKEN);
}

// ── Per-chat cooldown ─────────────────────────────────────────────────────────

const lastSentAt = new Map<string, number>();

function chatCooldownMs(jid: string): number {
  const wait = (lastSentAt.get(jid) ?? 0) + CHAT_COOLDOWN_MS - Date.now();
  return wait > 0 ? wait : 0;
}

function recordSend(jid: string): void {
  lastSentAt.set(jid, Date.now());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function randomJitter(): number {
  return JITTER_MS.min + Math.random() * (JITTER_MS.max - JITTER_MS.min);
}

/**
 * How long the typing indicator should appear before sending text.
 * @param {string} text
 * @returns {number} ms
 */
export function typingDuration(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.min((text.length / TYPING_CPS) * 1000, TYPING_MAX_MS);
}

/**
 * A human-feeling duration for media "processing" indicator.
 * @returns {number} ms
 */
export function mediaDuration(): number {
  return MEDIA_INDICATOR_MS.min
    + Math.random() * (MEDIA_INDICATOR_MS.max - MEDIA_INDICATOR_MS.min);
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

  if (jitter) await sleep(randomJitter());

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
