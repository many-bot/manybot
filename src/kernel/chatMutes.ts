/**
 * kernel/chatMutes.ts
 *
 * Per-chat LID mutes, exposed to plugins as `ctx.chat.mute()` /
 * `ctx.chat.unmute()` and enforced in the dispatch pipeline
 * (`drivers/baileys/messageHandler.ts`): a muted LID is treated as if
 * its messages never arrived in that chat — no plugin, no command, no
 * telemetry, no read receipt.
 *
 * Storage lives in `settingsDb.ts` (`chat_mutes` table). This module is
 * the thin domain layer on top — same split as `chatOverrides.ts` — and
 * owns the one rule that matters here: the 1-month duration cap.
 *
 * Kept as a standalone leaf module (only jid utils + settingsDb as deps)
 * so it can be imported from both the dispatch pipeline and the
 * ctx.chat builder without risking an import cycle.
 */

import { muteLid as dbMuteLid, unmuteLid as dbUnmuteLid, isLidMuted as dbIsLidMuted } from "./settingsDb.js";
import { normalizeJid } from "#drivers/jid.js";

/** 1 month, in milliseconds (30 days) — the hard cap enforced by {@link muteLid}. */
export const MAX_MUTE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Mutes `lid` in `chatId` for `durationMs`. The LID is fully ignored by
 * the message pipeline in that chat until the mute expires or
 * {@link unmuteLid} is called.
 *
 * @param chatId - the *raw* chat id; normalized internally, same as
 *   {@link getChatPrefix} in `chatOverrides.ts`.
 * @param lid - the `@lid` JID to mute. Not normalized (LIDs already
 *   compare equal as plain strings — unlike phone-number JIDs, there's
 *   no `:device` suffix or `@s.whatsapp.net`/`@c.us` split to collapse).
 * @throws {RangeError} if `durationMs` is not positive or exceeds
 *   {@link MAX_MUTE_DURATION_MS} (1 month).
 */
export function muteLid(chatId: string, lid: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`Invalid mute duration (${durationMs}ms) — must be a positive number of milliseconds.`);
  }
  if (durationMs > MAX_MUTE_DURATION_MS) {
    throw new RangeError(
      `Mute duration (${durationMs}ms) exceeds the 1-month maximum (${MAX_MUTE_DURATION_MS}ms).`
    );
  }
  dbMuteLid(normalizeJid(chatId), lid, Date.now() + durationMs);
}

/** Removes the mute for `lid` in `chatId`, if any. Safe to call when not muted. */
export function unmuteLid(chatId: string, lid: string): void {
  dbUnmuteLid(normalizeJid(chatId), lid);
}

/**
 * Whether `lid` is currently muted in `chatId`. Used by the message
 * pipeline to decide whether to ignore an incoming message entirely.
 */
export function isLidMuted(chatId: string, lid: string): boolean {
  return dbIsLidMuted(normalizeJid(chatId), lid);
}
