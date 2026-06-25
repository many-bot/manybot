/**
 * sendGuard.js
 *
 * Anti-detection throttle layer for all outbound sends.
 *
 * Three protections applied before every message:
 *   1. Global token bucket  — hard cap on messages/second across all chats
 *   2. Per-chat cooldown    — minimum gap between sends to the same chat
 *   3. Human jitter         — random delay to break robotic timing patterns
 *
 * Text sends also simulate the typing indicator so the chat shows
 * "typing…" for a realistic duration before the message arrives.
 */

import { logger } from "#logger";

// ── Tunables ──────────────────────────────────────────────────────────────────
// Adjust conservatively — WhatsApp is more sensitive to burst than average rate.

/** Hard cap: max messages per second, globally (across all chats). */
const GLOBAL_MSG_PER_SEC = 3;

/** Minimum ms between two sends to the same chat. */
const CHAT_COOLDOWN_MS = 900;

/** Random jitter window added before every send (ms). */
const JITTER_MS = { min: 400, max: 1400 };

/** Typing speed used to calculate indicator duration (chars/sec). */
const TYPING_CPS = 55;

/** Upper cap on typing simulation, regardless of message length. */
const TYPING_MAX_MS = 4500;

/** Fixed indicator duration for media sends (ms), before jitter. */
const MEDIA_INDICATOR_MS = { min: 800, max: 2000 };

// ── Global token bucket ───────────────────────────────────────────────────────

const MS_PER_TOKEN = 1000 / GLOBAL_MSG_PER_SEC;

let tokens     = GLOBAL_MSG_PER_SEC;
let lastRefill = Date.now();

/**
 * Consume one send token.
 * Returns the number of ms to wait if no token is available (0 = proceed now).
 */
function consumeGlobalToken() {
  const now     = Date.now();
  const elapsed = now - lastRefill;

  tokens     = Math.min(GLOBAL_MSG_PER_SEC, tokens + elapsed / MS_PER_TOKEN);
  lastRefill = now;

  if (tokens >= 1) {
    tokens -= 1;
    return 0;
  }

  return Math.ceil((1 - tokens) * MS_PER_TOKEN);
}

// ── Per-chat cooldown ─────────────────────────────────────────────────────────

/** chatId → timestamp of the last outbound send */
const lastSentAt = new Map();

function chatCooldownMs(chatId) {
  const last = lastSentAt.get(chatId) ?? 0;
  const wait = last + CHAT_COOLDOWN_MS - Date.now();
  return wait > 0 ? wait : 0;
}

function recordSend(chatId) {
  lastSentAt.set(chatId, Date.now());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomJitter() {
  return JITTER_MS.min + Math.random() * (JITTER_MS.max - JITTER_MS.min);
}


/**
 * How long the typing indicator should appear before sending text.
 * Based on simulated typing speed, capped at TYPING_MAX_MS.
 * @param {string} text
 * @returns {number} ms
 */
export function typingDuration(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.min((text.length / TYPING_CPS) * 1000, TYPING_MAX_MS);
}

/**
 * A human-feeling duration for media "processing" indicator.
 * Randomized so repeated sends don't have identical pauses.
 * @returns {number} ms
 */
export function mediaDuration() {
  return MEDIA_INDICATOR_MS.min
    + Math.random() * (MEDIA_INDICATOR_MS.max - MEDIA_INDICATOR_MS.min);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wait for a safe send slot: global rate → per-chat cooldown → jitter.
 * Must be called before every outbound message.
 *
 * @param {string} chatId
 * @param {object} [opts]
 * @param {boolean} [opts.cooldown=true]  — set to `false` to skip per-chat cooldown.
 *                                          Use for plugins that reply instantly and
 *                                          don't benefit from anti-detection pacing
 *                                          (e.g. sticker). Global rate limit is kept.
 * @param {boolean} [opts.jitter=true]    — set to `false` to skip random jitter delay.
 */
export async function waitForSendSlot(chatId, { cooldown = true, jitter = true } = {}) {
  const tokenWait = consumeGlobalToken();
  if (tokenWait > 0) {
    logger.debug(`[sendGuard] global rate hit — queuing ${tokenWait}ms`);
    await sleep(tokenWait);
  }

  if (cooldown) {
    const coolWait = chatCooldownMs(chatId);
    if (coolWait > 0) {
      logger.debug(`[sendGuard] chat cooldown (${chatId}) — waiting ${coolWait}ms`);
      await sleep(coolWait);
    }
  }

  if (jitter) {
    await sleep(randomJitter());
  }

  recordSend(chatId);
}

/**
 * Show a WhatsApp presence indicator for `ms` milliseconds, then clear it.
 * Best-effort — errors are swallowed so they never break a send.
 *
 * @param {import("whatsapp-web.js").Chat} chat
 * @param {number}                         ms
 * @param {"typing"|"recording"}           [state="typing"]
 */
export async function simulateState(chat, ms, state = "typing") {
  if (!chat || ms <= 0) return;
  try {
    if (state === "recording") {
      await chat.sendStateRecording();
    } else {
      await chat.sendStateTyping();
    }
    await sleep(ms);
    await chat.clearState();
  } catch (err) {
    logger.debug(`[sendGuard] state simulation failed (non-fatal): ${err.message}`);
  }
}
