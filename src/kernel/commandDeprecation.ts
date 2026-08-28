/**
 * commandDeprecation.ts
 *
 * Tracks command cmd/alias rename and removal across registry rebuilds.
 * Persists state in the same SQLite database used by settingsDb.ts (separate
 * file-scope DatabaseSync handle — same DB_PATH is fine).
 *
 * Two tables:
 *   command_cmd_history      — current known (id → cmd). Populated on every
 *                              syncCommandHistory() call; first-time inserts
 *                              are silent (no deprecation triggered).
 *   command_deprecations     — old_cmd → deprecation row. Created on rename
 *                              or removal; expires by `notify_until`.
 *
 * Lookup is by old_cmd text — expired rows are treated as absent (lazy
 * filtering, no cleanup sweep here).
 */

import { DatabaseSync } from "node:sqlite";
import path             from "path";
import { mkdirSync }    from "fs";
import { logger }       from "#logger";
import { t }            from "#i18n";
import { CONFIG_DIR }   from "#config";
import type { CommandEntry }     from "./commandRegistry.js";
import type { CommandDefaults,
              CommandSpec }      from "./commandsConfig.js";

const DB_PATH = process.env.NODE_ENV === "test" ? ":memory:" : path.join(CONFIG_DIR, "settings.db");
if (DB_PATH !== ":memory:") {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS command_cmd_history (
    id         TEXT PRIMARY KEY,
    cmd        TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS command_deprecations (
    old_cmd     TEXT PRIMARY KEY,
    id          TEXT NOT NULL,
    new_cmd     TEXT,
    notify_until INTEGER NOT NULL,
    message     TEXT
  );
`);

const stmts = {
  getHistoryCmd: db.prepare("SELECT cmd FROM command_cmd_history WHERE id = ?"),
  insertHistory: db.prepare(`
    INSERT INTO command_cmd_history (id, cmd, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT (id)
    DO UPDATE SET cmd = excluded.cmd, updated_at = excluded.updated_at
  `),
  deleteHistory: db.prepare("DELETE FROM command_cmd_history WHERE id = ?"),
  allHistoryIds: db.prepare("SELECT id FROM command_cmd_history"),

  getDeprecation: db.prepare(
    "SELECT old_cmd, id, new_cmd, notify_until, message FROM command_deprecations WHERE old_cmd = ?"
  ),
  upsertDeprecation: db.prepare(`
    INSERT INTO command_deprecations (old_cmd, id, new_cmd, notify_until, message)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (old_cmd)
    DO UPDATE SET id = excluded.id,
                  new_cmd = excluded.new_cmd,
                  notify_until = excluded.notify_until,
                  message = excluded.message
  `),
};

export interface DeprecationRow {
  old_cmd: string;
  id: string;
  new_cmd: string | null;
  notify_until: number;
  message: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Reconcile the current registry `byId` against the persisted history.
 *
 * Per id:
 *   - not in history → INSERT silently (first sighting, no notice).
 *   - in history, same cmd → no-op.
 *   - in history, different cmd → INSERT into command_deprecations with the
 *     OLD cmd, new_cmd = new cmd, notify_until = now + period.
 *
 * Ids that vanished from byId → INSERT into command_deprecations with
 * new_cmd = null, and DELETE the history row (the deprecation IS the record
 * that the id is gone).
 *
 * `spec.notifyChanges ?? defaults.notifyChanges` controls whether any row
 * is written for that id. When false, the history is still updated silently
 * and no deprecation is recorded (admin-opt-out).
 */
export function syncCommandHistory(
  byId: Map<string, CommandEntry>,
  defaults: CommandDefaults,
  specs: CommandSpec[]
): void {
  const specById = new Map<string, CommandSpec>(specs.map(s => [s.id, s]));

  const now = Date.now();

  for (const [id, entry] of byId) {
    const spec = specById.get(id);
    const notify = spec?.notifyChanges ?? defaults.notifyChanges;

    const existing = stmts.getHistoryCmd.get(id) as { cmd: string } | undefined;
    const prevCmd  = existing?.cmd ?? null;

    if (prevCmd === null) {
      stmts.insertHistory.run(id, entry.cmd);
      continue;
    }

    if (prevCmd === entry.cmd) continue;

    if (notify) {
      const periodMs = defaults.notifyPeriodDays * MS_PER_DAY;
      stmts.upsertDeprecation.run(
        prevCmd,
        id,
        entry.cmd,
        now + periodMs,
        spec?.deprecatedMessage ?? null
      );
      logger.warn(
        t("system.commandDeprecationRenamed", {
          id,
          old: prevCmd,
          new: entry.cmd,
          days: String(defaults.notifyPeriodDays)
        })
      );
    }

    stmts.insertHistory.run(id, entry.cmd);
  }

  const currentIds = new Set(byId.keys());
  const persistedIds = (stmts.allHistoryIds.all() as { id: string }[]).map(r => r.id);

  for (const id of persistedIds) {
    if (currentIds.has(id)) continue;

    const existing = stmts.getHistoryCmd.get(id) as { cmd: string } | undefined;
    if (!existing) continue;

    const spec = specById.get(id);
    const notify = spec?.notifyChanges ?? defaults.notifyChanges;

    if (notify) {
      const periodMs = defaults.notifyPeriodDays * MS_PER_DAY;
      stmts.upsertDeprecation.run(
        existing.cmd,
        id,
        null,
        now + periodMs,
        spec?.deprecatedMessage ?? null
      );
      logger.warn(
        t("system.commandDeprecationRemoved", {
          id,
          old: existing.cmd,
          days: String(defaults.notifyPeriodDays)
        })
      );
    }

    stmts.deleteHistory.run(id);
  }
}

/**
 * Returns the active deprecation row for `cmdText`, or null if there is no
 * deprecation or it has already expired.
 */
export function getActiveDeprecation(cmdText: string): DeprecationRow | null {
  const row = stmts.getDeprecation.get(cmdText) as DeprecationRow | undefined;
  if (!row) return null;
  if (row.notify_until <= Date.now()) return null;
  return row;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : `{{${name}}}`
  );
}

/**
 * Resolve the final user-facing message:
 *   1. row.message (per-command override from yaml `deprecatedMessage`)
 *   2. defaults.notifyMessage (global override)
 *   3. built-in fallback ("Command \"{old}\" was renamed to \"{new}\"..." or
 *      "Command \"{old}\" has been removed" for removals)
 */
export function formatDeprecationMessage(row: DeprecationRow, defaults: CommandDefaults): string {
  const vars = {
    old:  row.old_cmd,
    new:  row.new_cmd ?? "",
    days: String(Math.max(0, Math.ceil((row.notify_until - Date.now()) / MS_PER_DAY))),
  };

  if (row.message && row.message.trim().length > 0) {
    return interpolate(row.message, vars);
  }
  if (defaults.notifyMessage && defaults.notifyMessage.trim().length > 0) {
    return interpolate(defaults.notifyMessage, vars);
  }

  const fallbackKey = row.new_cmd === null
    ? "system.commandDeprecationFallbackRemoved"
    : "system.commandDeprecationFallbackRenamed";

  return interpolate(t(fallbackKey) as string, vars);
}

