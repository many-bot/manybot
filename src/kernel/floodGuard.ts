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
 *
 * Messages don't all count the same: callers can pass a `weight` below 1
 * (e.g. media/stickers in groups, which arrive in bursts as a normal
 * usage pattern) so those bursts are less likely to trip the guard on
 * their own.
 *
 * A chat can also be temporarily disabled via disableFloodGuard() —
 * e.g. from an admin command — to ride out a known false-positive
 * without touching config.
 */

import { logger } from "#logger";

const WINDOW_MS  = 10_000; // sliding window to count incoming messages
const MAX_IN_WINDOW = 8;   // more than this (weighted) in the window trips the guard
export const MUTE_MS = 5 * 60 * 1000; // how long a tripped sender stays muted
const STALE_ENTRY_MS = 30 * 60 * 1000; // lazy cleanup horizon

export type FloodStatus = "allow" | "tripped" | "muted";

interface FloodEntry {
  t: number; // timestamp
  w: number; // weight this message counted for
}

interface FloodState {
  entries:    FloodEntry[];
  mutedUntil: number;
}

const state = new Map<string, FloodState>();

// Separate from per-(chat,sender) state above: this tracks trips globally,
// used to detect "many different people/chats tripping at once" — a
// pattern one muted sender alone can't produce, since they stop counting
// once muted.
const tripTimestamps: number[] = [];

/**
 * How many flood-guard trips (any sender, any chat) happened in the last
 * `windowMs`. Used to decide whether to fire a "possible attack" alert.
 * @param {number} windowMs
 */
export function recentTripCount(windowMs: number): number {
  const now = Date.now();
  while (tripTimestamps.length && now - tripTimestamps[0] > windowMs) {
    tripTimestamps.shift();
  }
  return tripTimestamps.length;
}

// ── Temporary per-chat disable ───────────────────────────────────────────────
// Skips the flood check entirely for a chat — messages still flow through
// normally, just uncounted. Meant for riding out a known false-positive
// (e.g. from an admin-only bot command) without editing config.

const disabledChats = new Map<string, number>(); // chatJid -> disabledUntil (Infinity = until re-enabled)

/**
 * Temporarily disables the flood guard for one chat.
 * @param {string} chatJid
 * @param {number} [durationMs] — omit to disable until enableFloodGuard() is called
 */
export function disableFloodGuard(chatJid: string, durationMs?: number): void {
  const until = durationMs && durationMs > 0 ? Date.now() + durationMs : Infinity;
  disabledChats.set(chatJid, until);
  logger.info(
    `[floodGuard] disabled for "${chatJid}"` +
    (durationMs ? ` for ${Math.round(durationMs / 1000)}s` : " until re-enabled")
  );
}

/**
 * Re-enables a chat previously disabled via disableFloodGuard().
 * @param {string} chatJid
 */
export function enableFloodGuard(chatJid: string): void {
  disabledChats.delete(chatJid);
  logger.info(`[floodGuard] re-enabled for "${chatJid}"`);
}

/**
 * Whether the flood guard is currently disabled for a chat.
 * @param {string} chatJid
 */
export function isFloodGuardDisabled(chatJid: string): boolean {
  const until = disabledChats.get(chatJid);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  disabledChats.delete(chatJid); // expired — lazy cleanup
  return false;
}

function lastActivity(s: FloodState): number {
  return Math.max(s.mutedUntil, ...s.entries.map(e => e.t), 0);
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
 * @param {number} [weight=1] — how much this message counts toward the
 *   window limit. Pass below 1 for message types more prone to false
 *   positives (e.g. media/stickers in groups).
 */
export function registerIncoming(key: string, weight = 1): FloodStatus {
  const now = Date.now();
  cleanup(now);

  const s = state.get(key) ?? { entries: [], mutedUntil: 0 };

  if (now < s.mutedUntil) {
    state.set(key, s);
    return "muted";
  }

  s.entries = s.entries.filter(e => now - e.t < WINDOW_MS);
  s.entries.push({ t: now, w: weight });

  const total = s.entries.reduce((sum, e) => sum + e.w, 0);

  logger.debug(`[floodGuard] "${key}" +${weight} → ${total.toFixed(1)}/${MAX_IN_WINDOW} in window (${s.entries.length} entries)`);

  if (total > MAX_IN_WINDOW) {
    s.mutedUntil = now + MUTE_MS;
    s.entries = [];
    state.set(key, s);
    tripTimestamps.push(now);
    logger.warn(`[floodGuard] "${key}" tripped the flood guard — muted for ${MUTE_MS / 1000}s`);
    return "tripped";
  }

  state.set(key, s);
  return "allow";
}
