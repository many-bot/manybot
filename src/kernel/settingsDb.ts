/**
 * settingsDb.ts
 *
 * Persistent per-chat settings backed by SQLite.
 * Exposed to plugins via ctx.settings.
 *
 * Two concerns live here:
 *   1. Plugin settings  — arbitrary key/value per (plugin, chat)
 *   2. Community links  — grouping chats under a shared community ID
 *
 * Plugins never touch the DB directly — only through buildSettingsApi().
 */

import { DatabaseSync } from "node:sqlite";
import path      from "path";
import { mkdirSync } from "fs";
import { CONFIG_DIR } from "#config";

export interface ScopedAccessor {
  get<T = unknown>(key: string, defaultValue?: T): T;
  getAll(): Record<string, unknown>;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  deleteAll(): void;
}

export interface SettingsApi extends ScopedAccessor {
  global: ScopedAccessor;
  forChat(targetChatId: string): ScopedAccessor;
  link(communityId: string): void;
  unlink(): void;
  getCommunityId(): string | null;
  getCommunityChats(): string[];
}

const DB_PATH = process.env.NODE_ENV === "test" ? ":memory:" : path.join(CONFIG_DIR, "settings.db");
if (DB_PATH !== ":memory:") {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS plugin_settings (
    plugin_name  TEXT NOT NULL,
    chat_id      TEXT NOT NULL,
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY  (plugin_name, chat_id, key)
  );

  CREATE TABLE IF NOT EXISTS community_links (
    chat_id      TEXT PRIMARY KEY,
    community_id TEXT NOT NULL,
    linked_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_community
    ON community_links (community_id);
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
  get: db.prepare(
    "SELECT value FROM plugin_settings WHERE plugin_name = ? AND chat_id = ? AND key = ?"
  ),

  getAll: db.prepare(
    "SELECT key, value FROM plugin_settings WHERE plugin_name = ? AND chat_id = ?"
  ),

  set: db.prepare(`
    INSERT INTO plugin_settings (plugin_name, chat_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT (plugin_name, chat_id, key)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),

  delete: db.prepare(
    "DELETE FROM plugin_settings WHERE plugin_name = ? AND chat_id = ? AND key = ?"
  ),

  deleteAll: db.prepare(
    "DELETE FROM plugin_settings WHERE plugin_name = ? AND chat_id = ?"
  ),

  getCommunityId: db.prepare(
    "SELECT community_id FROM community_links WHERE chat_id = ?"
  ),

  getCommunityChats: db.prepare(
    "SELECT chat_id FROM community_links WHERE community_id = ?"
  ),

  link: db.prepare(`
    INSERT INTO community_links (chat_id, community_id, linked_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT (chat_id)
    DO UPDATE SET community_id = excluded.community_id, linked_at = excluded.linked_at
  `),

  unlink: db.prepare(
    "DELETE FROM community_links WHERE chat_id = ?"
  ),
};

// ── Core helpers ──────────────────────────────────────────────────────────────

function dbGet(pluginName: string, chatId: string, key: string): unknown {
  const row = stmts.get.get(pluginName, chatId, key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function dbGetAll(pluginName: string, chatId: string): Record<string, unknown> {
  const rows = stmts.getAll.all(pluginName, chatId) as { key: string; value: string }[];
  return Object.fromEntries(
    rows.map(({ key, value }: { key: string; value: string }) => {
      try { return [key, JSON.parse(value)]; } catch { return [key, value]; }
    })
  );
}

function dbSet(pluginName: string, chatId: string, key: string, value: unknown): void {
  stmts.set.run(pluginName, chatId, key, JSON.stringify(value));
}

function dbDelete(pluginName: string, chatId: string, key: string): void {
  stmts.delete.run(pluginName, chatId, key);
}

function dbDeleteAll(pluginName: string, chatId: string): void {
  stmts.deleteAll.run(pluginName, chatId);
}

/**
 * Direct read of a single (plugin, chat, key) setting, bypassing the
 * `ctx.settings` scoped-accessor pattern. For call sites that need a
 * value before a `PluginContext` exists yet — e.g. resolving the
 * per-chat command prefix while still parsing the incoming message,
 * or resolving the per-chat language from outside the "core" plugin's
 * own context. See `kernel/chatOverrides.ts`.
 */
export function getPluginSetting(pluginName: string, chatId: string, key: string): unknown {
  return dbGet(pluginName, chatId, key);
}

// ── Scoped accessor factory ───────────────────────────────────────────────────

/**
 * Returns a settings accessor for a specific (pluginName, chatId) pair.
 * Used both for the current chat and for forChat(id) cross-chat reads.
 */
function scopedAccessor(pluginName: string, chatId: string): ScopedAccessor {
  return {
    /**
     * Get a setting value. Returns `defaultValue` (default: undefined) if not set.
     * @param {string} key
     * @param {*}      [defaultValue]
     */
    get(key: string, defaultValue?: unknown) {
      const val = dbGet(pluginName, chatId, key);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- `get<T>` is a
      // type-level convenience for callers; the store itself is untyped JSON.
      return (val !== undefined ? val : defaultValue) as any;
    },

    /**
     * Get all settings for this chat as a plain object.
     * @returns {Record<string, *>}
     */
    getAll() {
      return dbGetAll(pluginName, chatId);
    },

    /**
     * Set a setting value. Any JSON-serializable value is accepted.
     * @param {string} key
     * @param {*}      value
     */
    set(key, value) {
      dbSet(pluginName, chatId, key, value);
    },

    /**
     * Delete a single setting key.
     * @param {string} key
     */
    delete(key) {
      dbDelete(pluginName, chatId, key);
    },

    /**
     * Delete all settings for this chat under this plugin.
     */
    deleteAll() {
      dbDeleteAll(pluginName, chatId);
    },
  };
}

// ── Public API builder ────────────────────────────────────────────────────────

/**
 * Builds ctx.settings for a given runtime context.
 *
 * ctx.settings          — scoped to current chat
 * ctx.settings.global   — scoped to a synthetic "_global" chat ID
 * ctx.settings.forChat  — cross-chat read (any chatId)
 * ctx.settings.link     — community membership
 *
 * @param {string} pluginName
 * @param {string} chatId       — current chat's serialized ID
 */
export function buildSettingsApi(pluginName: string, chatId: string): SettingsApi {
  const current = scopedAccessor(pluginName, chatId);

  return {
    ...current,

    /**
     * Bot-wide settings, not tied to any specific chat.
     * Stored under the synthetic key "_global".
     */
    global: scopedAccessor(pluginName, "_global"),

    /**
     * Access settings of any other chat by ID.
     * Useful for cross-chat features like community-wide XP.
     * @param {string} targetChatId
     */
    forChat(targetChatId) {
      return scopedAccessor(pluginName, targetChatId);
    },

    /**
     * Link the current chat to a community by ID.
     * The community ID is any string you choose — typically a name or UUID.
     * Replaces any existing link for this chat.
     * @param {string} communityId
     */
    link(communityId) {
      stmts.link.run(chatId, communityId);
    },

    /**
     * Unlink the current chat from its community.
     */
    unlink() {
      stmts.unlink.run(chatId);
    },

    /**
     * Returns the community ID this chat belongs to, or null.
     * @returns {string | null}
     */
    getCommunityId() {
      return (stmts.getCommunityId.get(chatId) as { community_id: string } | undefined)?.community_id ?? null;
    },

    /**
     * Returns all chat IDs that belong to the same community as the current chat.
     * Returns [] if this chat has no community link.
     * @returns {string[]}
     */
    getCommunityChats() {
      const row = stmts.getCommunityId.get(chatId) as { community_id: string } | undefined;
      if (!row) return [];
      return stmts.getCommunityChats.all(row.community_id).map((r) => (r as { chat_id: string }).chat_id);
    },
  };
}

