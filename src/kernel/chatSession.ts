/**
 * chatSession.ts
 *
 * Phase 7 of MANYBOT-6.md — exclusive chat session, kernel primitive.
 *
 * Prevents two plugins from running an interactive flow (a game, the
 * figurinha timeout session, a music-download prompt, etc.) in the same
 * chat at the same time. The kernel only owns the lock itself — WHO holds
 * it and for how long. Everything about the session's own state (timeout,
 * collected media, turn tracking, ...) stays entirely inside the owning
 * plugin; `commands.yaml` only ever registers commands, never internal
 * flow state.
 *
 * Deliberately NOT persisted (no settingsDb / SQLite): a session lock only
 * makes sense for the lifetime of the running process — restarting the
 * bot should never leave a chat stuck "locked" by a plugin that no longer
 * remembers it opened one.
 *
 * many-ai's passive continuation window (its own multi-turn follow-up
 * mechanism) is a separate category by design and never touches this
 * lock — see the Phase 7 note in MANYBOT-6.md. This module does not
 * special-case many-ai; it simply never gets called by it.
 */

export interface ChatSessionHolder {
  pluginName: string;
  acquiredAt: number;
}

const sessions = new Map<string, ChatSessionHolder>();

/**
 * Attempts to open an exclusive session for `pluginName` in `chatId`.
 * Returns `true` if the session is now held by `pluginName` — either it
 * was free, or `pluginName` already held it (idempotent re-acquire, e.g.
 * a plugin calling acquire() again on a later message of its own flow).
 * Returns `false` if another plugin already holds the session.
 */
export function acquireSession(chatId: string, pluginName: string): boolean {
  const current = sessions.get(chatId);
  if (current && current.pluginName !== pluginName) {
    return false;
  }
  sessions.set(chatId, { pluginName, acquiredAt: current?.acquiredAt ?? Date.now() });
  return true;
}

/**
 * Releases the session in `chatId`, but only if it is currently held by
 * `pluginName` — a plugin can never release a lock it doesn't own. No-op
 * (returns `false`) if the chat has no session, or it's held by someone
 * else.
 */
export function releaseSession(chatId: string, pluginName: string): boolean {
  const current = sessions.get(chatId);
  if (!current || current.pluginName !== pluginName) {
    return false;
  }
  sessions.delete(chatId);
  return true;
}

/** Whether `chatId` currently has an open exclusive session (by anyone). */
export function isSessionLocked(chatId: string): boolean {
  return sessions.has(chatId);
}

/** Which plugin currently holds the session in `chatId`, if any. */
export function getSessionHolder(chatId: string): string | null {
  return sessions.get(chatId)?.pluginName ?? null;
}

/** Test-only: wipe all session state between tests. */
export function __resetSessionsForTests(): void {
  sessions.clear();
}
