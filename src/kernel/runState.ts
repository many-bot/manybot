/**
 * kernel/runState.ts
 *
 * Per-plugin run state ("running" / "idle") plus a small SQLite journal of
 * the runs that are answering a user's command.
 *
 * State is keyed by plugin name and lives here, NOT on the PluginEntry: a
 * reload replaces the entry object, which would reset a flag stored on it at
 * exactly the moment a crash makes it matter.
 *
 * The journal is what survives a hard process death. A row exists only while
 * its run is in flight, so any row left over from a previous boot is a run
 * that never finished. Consumers: crashNotice.ts.
 *
 * Which runs get journaled is the false-positive filter:
 *   - "command": dispatched through the command registry, so the plugin is
 *     known to own the command. Counted from the start.
 *   - "legacy": per-message `run(ctx)` of a plugin that may simply be ignoring
 *     the message (they all get every message). Only counted once it has been
 *     running for LEGACY_ENGAGED_AFTER_MS — a plugin that ignores a message
 *     returns almost immediately.
 * Runs without an origin (passive traffic) only feed the in-memory state.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID }   from "node:crypto";
import path             from "path";
import { mkdirSync }    from "fs";
import { CONFIG, CONFIG_DIR } from "#config";
import { logger }       from "#logger";
import type { BotQuotedRef } from "#kernel/waContract.js";

export const LEGACY_ENGAGED_AFTER_MS = 1000;
const NOTICE_RETENTION_MS = 24 * 60 * 60 * 1000;

export type RunKind  = "command" | "legacy";
export type RunState = "running" | "idle";

/** Where to report a run's outcome. */
export interface RunTarget {
  /** Raw chat id (`msg.chatId`) — the notice is sent here. */
  chatId:  string;
  /** Key of the triggering message, used to quote it while it is still cached. */
  key?:    BotQuotedRef;
  /** The command as the user typed it, prefix included. */
  command: string;
}

export interface RunOrigin extends RunTarget {
  kind: RunKind;
}

export interface RunHandle {
  readonly id:        string;
  readonly plugin:    string;
  readonly origin:    RunOrigin | null;
  readonly startedAt: number;
  finish(): void;
}

export interface InterruptedRun extends RunTarget {
  plugin:    string;
  startedAt: number;
}

const DB_PATH = process.env.NODE_ENV === "test" ? ":memory:" : path.join(CONFIG_DIR, "settings.db");
if (DB_PATH !== ":memory:") {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS plugin_runs (
    id          TEXT PRIMARY KEY,
    boot_id     TEXT NOT NULL,
    plugin      TEXT NOT NULL,
    chat_id     TEXT NOT NULL,
    msg_id      TEXT,
    participant TEXT,
    from_me     INTEGER NOT NULL DEFAULT 0,
    command     TEXT NOT NULL,
    started_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crash_notices (
    chat_id     TEXT NOT NULL,
    msg_id      TEXT NOT NULL,
    notified_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, msg_id)
  );
`);

const stmts = {
  insertRun: db.prepare(`
    INSERT INTO plugin_runs (id, boot_id, plugin, chat_id, msg_id, participant, from_me, command, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  deleteRun:    db.prepare("DELETE FROM plugin_runs WHERE id = ?"),
  staleRuns:    db.prepare(`
    SELECT plugin, chat_id, msg_id, participant, from_me, command, started_at
    FROM plugin_runs WHERE boot_id != ? ORDER BY started_at
  `),
  deleteStale:  db.prepare("DELETE FROM plugin_runs WHERE boot_id != ?"),
  claimNotice:  db.prepare("INSERT OR IGNORE INTO crash_notices (chat_id, msg_id, notified_at) VALUES (?, ?, ?)"),
  pruneNotices: db.prepare("DELETE FROM crash_notices WHERE notified_at < ?"),
};

interface RunRow {
  plugin:      string;
  chat_id:     string;
  msg_id:      string | null;
  participant: string | null;
  from_me:     number;
  command:     string;
  started_at:  number;
}

let bootId = randomUUID();
const active = new Map<string, number>();

export function pluginState(plugin: string): RunState {
  return active.has(plugin) ? "running" : "idle";
}

export function beginRun(plugin: string, origin: RunOrigin | null = null): RunHandle {
  const id        = randomUUID();
  const startedAt = Date.now();
  active.set(plugin, (active.get(plugin) ?? 0) + 1);

  let journaled = false;
  const journal = () => {
    if (journaled || !origin || !CONFIG.CRASH_NOTICE_ENABLED) return;
    journaled = true;
    try {
      stmts.insertRun.run(
        id, bootId, plugin, origin.chatId,
        origin.key?.id ?? null, origin.key?.participant ?? null, origin.key?.fromMe ? 1 : 0,
        origin.command, startedAt,
      );
    } catch (e) {
      logger.warn(`[runState] failed to journal a run of "${plugin}": ${(e as Error).message}`);
    }
  };

  let timer: NodeJS.Timeout | undefined;
  if (origin?.kind === "command") {
    journal();
  } else if (origin) {
    timer = setTimeout(journal, LEGACY_ENGAGED_AFTER_MS);
    timer.unref();
  }

  let finished = false;
  return {
    id, plugin, origin, startedAt,
    finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (journaled) {
        try {
          stmts.deleteRun.run(id);
        } catch (e) {
          logger.warn(`[runState] failed to clear a run of "${plugin}": ${(e as Error).message}`);
        }
      }

      const left = (active.get(plugin) ?? 1) - 1;
      if (left <= 0) active.delete(plugin);
      else active.set(plugin, left);
    },
  };
}

/** Whether a failing run was doing real work for its user, rather than ignoring the message. */
export function isEngaged(run: RunHandle, now = Date.now()): boolean {
  if (!run.origin) return false;
  return run.origin.kind === "command" || now - run.startedAt >= LEGACY_ENGAGED_AFTER_MS;
}

/** Runs a previous process left unfinished. Returned once — the rows are deleted. */
export function takeInterruptedRuns(): InterruptedRun[] {
  const rows = stmts.staleRuns.all(bootId) as unknown as RunRow[];
  stmts.deleteStale.run(bootId);

  return rows.map((r) => ({
    plugin:    r.plugin,
    chatId:    r.chat_id,
    command:   r.command,
    startedAt: r.started_at,
    key: r.msg_id
      ? { id: r.msg_id, remoteJid: r.chat_id, fromMe: r.from_me === 1, participant: r.participant }
      : undefined,
  }));
}

/**
 * At-most-once guard per (chat, message): true the first time it is called
 * for a pair, false afterwards — across restarts. Stops one message from
 * producing several notices (multiple plugins, or a crash loop replaying it).
 */
export function claimNotice(chatId: string, msgId: string): boolean {
  return Number(stmts.claimNotice.run(chatId, msgId, Date.now()).changes) > 0;
}

export function pruneNotices(): void {
  stmts.pruneNotices.run(Date.now() - NOTICE_RETENTION_MS);
}

/** Simulates a process restart: in-memory state is lost, journal rows stay. */
export function _startNewBootForTests(): void {
  bootId = randomUUID();
  active.clear();
}
