/**
 * floodGuard.ts
 *
 * Incoming-message flood protection. Independent from sendGuard (which
 * throttles what the bot sends) — this protects the bot itself from being
 * driven into abusive send patterns, or having its compute/concurrency
 * slots monopolized, by someone hammering it with messages.
 *
 * Keyed per (chat, sender) so one troublemaker in a group only gets
 * themselves muted, not the whole group.
 *
 * Tripped senders are muted for a cooldown: their messages are dropped
 * before ever reaching the plugin pipeline (never enqueued, never
 * counted against the chat-concurrency gate).
 */

import { logger } from "#logger";

const WINDOW_MS  = 10_000; // sliding window to count incoming messages
const MAX_IN_WINDOW = 8;   // more than this in the window trips the guard
export const MUTE_MS = 5 * 60 * 1000; // how long a tripped sender stays muted
const STALE_ENTRY_MS = 30 * 60 * 1000; // lazy cleanup horizon

export type FloodStatus = "allow" | "tripped" | "muted";

interface FloodState {
  timestamps: number[];
  mutedUntil: number;
}

const state = new Map<string, FloodState>();

function lastActivity(s: FloodState): number {
  return Math.max(s.mutedUntil, ...s.timestamps, 0);
}

function cleanup(now: number): void {
  for (const [key, s] of state) {
    if (now - lastActivity(s) > STALE_ENTRY_MS) state.delete(key);
  }
}

/**
 * Builds the dedup key for a message: chat + sender, so muting is scoped
 * to one person inside one chat rather than the whole chat.
 * @param {string} chatJid
 * @param {string} [senderJid] — omit for 1:1 chats (falls back to chatJid)
 */
export function floodKey(chatJid: string, senderJid?: string): string {
  return `${chatJid}::${senderJid || chatJid}`;
}

/**
 * Registers an incoming message and reports its flood status:
 *   "allow"   — under the limit, process normally
 *   "tripped" — this message just crossed the limit; this is the one call
 *               where the caller should react/notify, since it's the edge
 *               that starts the mute window
 *   "muted"   — already muted from an earlier trip, drop silently
 *
 * A message should be dropped (not enqueued/processed) for both
 * "tripped" and "muted".
 *
 * @param {string} key — from floodKey()
 */
export function registerIncoming(key: string): FloodStatus {
  const now = Date.now();
  cleanup(now);

  const s = state.get(key) ?? { timestamps: [], mutedUntil: 0 };

  if (now < s.mutedUntil) {
    state.set(key, s);
    return "muted";
  }

  s.timestamps = s.timestamps.filter(t => now - t < WINDOW_MS);
  s.timestamps.push(now);

  if (s.timestamps.length > MAX_IN_WINDOW) {
    s.mutedUntil = now + MUTE_MS;
    s.timestamps = [];
    state.set(key, s);
    logger.warn(`[floodGuard] "${key}" tripped the flood guard — muted for ${MUTE_MS / 1000}s`);
    return "tripped";
  }

  state.set(key, s);
  return "allow";
}
