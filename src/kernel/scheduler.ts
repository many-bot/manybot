/**
 * scheduler.ts
 *
 * Allows plugins to register scheduled tasks via cron.
 * Uses node-cron underneath, but plugins never import node-cron directly —
 * they only call ctx.scheduler.schedule(cron, fn).
 *
 * Registrations are deduped per (pluginName, expression) and persisted to
 * disk so a hot-reload never stacks duplicate crons, and a restart doesn't
 * silently lose track of what each plugin previously scheduled. Plugins
 * still need to call schedule() again on boot/setup — functions can't be
 * serialized — but doing so now replaces the old entry instead of adding
 * a new one, and getPersisted() lets the kernel/log confirm what survived.
 *
 * Usage in plugin:
 *   export default async function (ctx) {
 *     ctx.scheduler.schedule("0 9 * * 1", async () => {
 *       await ctx.send.text("Good morning!");
 *     });
 *   }
 */

import cron     from "node-cron";
import { DatabaseSync } from "node:sqlite";
import path     from "path";
import { mkdirSync } from "fs";
import { logger }    from "#logger";
import { t }          from "#i18n";
import { CONFIG_DIR } from "#config";

export interface ScheduleHandle {
  /** Stop this specific task. Safe to call multiple times. */
  stop(): void;
}

interface TaskEntry {
  pluginName: string;
  expression: string;
  task: ReturnType<typeof cron.schedule>;
}

// key = `${pluginName}::${expression}`
const tasks = new Map<string, TaskEntry>();

// ── Persistence (metadata only — fn can't be serialized) ────────────────────
//
// Opened lazily — only the first real `ctx.scheduler.schedule()` call (or
// `getPersisted()`) touches disk. Importing this module used to open the
// WAL-mode DB unconditionally at boot, even on bots with no scheduled
// plugin, leaving an idle connection that never got checkpointed and let
// scheduler.db-wal grow unbounded.

type SchedulerStmts = {
  upsert: ReturnType<DatabaseSync["prepare"]>;
  deleteOne: ReturnType<DatabaseSync["prepare"]>;
  deletePlugin: ReturnType<DatabaseSync["prepare"]>;
  all: ReturnType<DatabaseSync["prepare"]>;
};

// SQLite only auto-checkpoints (PASSIVE) once the WAL crosses ~1000 pages
// (~4MB), and can silently keep missing that mark under steady small
// writes. So once the DB is actually opened, also force a TRUNCATE
// checkpoint on a timer and on shutdown (via stopAll), instead of relying
// on autocheckpoint alone.
const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

let dbInstance: DatabaseSync | null = null;
let stmts: SchedulerStmts | null = null;
let checkpointTimer: NodeJS.Timeout | null = null;

function checkpoint(): void {
  if (!dbInstance) return;
  try {
    dbInstance.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    logger.warn(`[scheduler] wal checkpoint failed: ${(err as Error).message}`);
  }
}

function getStmts(): SchedulerStmts {
  if (stmts) return stmts;

  mkdirSync(CONFIG_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(CONFIG_DIR, "scheduler.db"));
  dbInstance = db;
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      plugin_name  TEXT NOT NULL,
      expression   TEXT NOT NULL,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY  (plugin_name, expression)
    );
  `);

  stmts = {
    upsert: db.prepare(
      `INSERT INTO scheduled_tasks (plugin_name, expression) VALUES (?, ?)
       ON CONFLICT(plugin_name, expression) DO UPDATE SET updated_at = unixepoch()`
    ),
    deleteOne: db.prepare(`DELETE FROM scheduled_tasks WHERE plugin_name = ? AND expression = ?`),
    deletePlugin: db.prepare(`DELETE FROM scheduled_tasks WHERE plugin_name = ?`),
    all: db.prepare(`SELECT plugin_name, expression FROM scheduled_tasks`),
  };

  checkpointTimer = setInterval(checkpoint, CHECKPOINT_INTERVAL_MS);
  checkpointTimer.unref();

  return stmts;
}

/** Rows persisted from previous runs — for diagnostics/logging on boot. */
export function getPersisted(): Array<{ pluginName: string; expression: string }> {
  return (getStmts().all.all() as Array<{ plugin_name: string; expression: string }>).map(r => ({
    pluginName: r.plugin_name,
    expression: r.expression,
  }));
}

// ── Scheduling ────────────────────────────────────────────────────────────

/**
 * Register a cron task.
 * Calling this again with the same (pluginName, expression) replaces the
 * previous task instead of stacking a new one — this is what fixed the
 * unbounded leak on plugin reload.
 *
 * @param {string}   expression  — cron expression e.g., "0 9 * * 1"
 * @param {Function} fn          — async function to execute
 * @param {string}   pluginName  — plugin name (for logging/scoping)
 */
export function schedule(expression: string, fn: () => Promise<void>, pluginName = "unknown"): ScheduleHandle {
  if (!cron.validate(expression)) {
    logger.warn(t("system.schedulerInvalidCron", { name: pluginName, expression }));
    return { stop() {} };
  }

  const key = `${pluginName}::${expression}`;
  tasks.get(key)?.task.stop();

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
      logger.error(t("system.schedulerError", { name: pluginName, message: err.message }));
    }
  });

  tasks.set(key, { pluginName, expression, task });
  getStmts().upsert.run(pluginName, expression);
  logger.info(t("system.schedulerRegistered", { name: pluginName, expression }));

  return {
    stop() {
      if (tasks.get(key)?.task !== task) return; // already replaced/stopped
      task.stop();
      tasks.delete(key);
      getStmts().deleteOne.run(pluginName, expression);
    },
  };
}

/** Stop and forget every task registered by one plugin (reload/unload). */
export function cancelPlugin(pluginName: string): void {
  for (const [key, entry] of tasks) {
    if (entry.pluginName !== pluginName) continue;
    entry.task.stop();
    tasks.delete(key);
  }
  getStmts().deletePlugin.run(pluginName);
}

/** Stop all schedules in memory (process shutdown) — keeps persisted rows. */
export function stopAll(): void {
  for (const { task } of tasks.values()) task.stop();
  tasks.clear();

  if (checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
  checkpoint();
}
