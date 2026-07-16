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
import cron from "node-cron";
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync } from "fs";
import { logger } from "#logger";
import { t } from "#i18n";
import { CONFIG_DIR } from "#config";
// key = `${pluginName}::${expression}`
const tasks = new Map();
// ── Persistence (metadata only — fn can't be serialized) ────────────────────
mkdirSync(CONFIG_DIR, { recursive: true });
const db = new Database(path.join(CONFIG_DIR, "scheduler.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    plugin_name  TEXT NOT NULL,
    expression   TEXT NOT NULL,
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY  (plugin_name, expression)
  );
`);
const stmtUpsert = db.prepare(`INSERT INTO scheduled_tasks (plugin_name, expression) VALUES (?, ?)
   ON CONFLICT(plugin_name, expression) DO UPDATE SET updated_at = unixepoch()`);
const stmtDeleteOne = db.prepare(`DELETE FROM scheduled_tasks WHERE plugin_name = ? AND expression = ?`);
const stmtDeletePlugin = db.prepare(`DELETE FROM scheduled_tasks WHERE plugin_name = ?`);
const stmtAll = db.prepare(`SELECT plugin_name, expression FROM scheduled_tasks`);
/** Rows persisted from previous runs — for diagnostics/logging on boot. */
export function getPersisted() {
    return stmtAll.all().map(r => ({
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
export function schedule(expression, fn, pluginName = "unknown") {
    if (!cron.validate(expression)) {
        logger.warn(t("system.schedulerInvalidCron", { name: pluginName, expression }));
        return { stop() { } };
    }
    const key = `${pluginName}::${expression}`;
    tasks.get(key)?.task.stop();
    const task = cron.schedule(expression, async () => {
        try {
            await fn();
        }
        catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            logger.error(t("system.schedulerError", { name: pluginName, message: err.message }));
        }
    });
    tasks.set(key, { pluginName, expression, task });
    stmtUpsert.run(pluginName, expression);
    logger.info(t("system.schedulerRegistered", { name: pluginName, expression }));
    return {
        stop() {
            if (tasks.get(key)?.task !== task)
                return; // already replaced/stopped
            task.stop();
            tasks.delete(key);
            stmtDeleteOne.run(pluginName, expression);
        },
    };
}
/** Stop and forget every task registered by one plugin (reload/unload). */
export function cancelPlugin(pluginName) {
    for (const [key, entry] of tasks) {
        if (entry.pluginName !== pluginName)
            continue;
        entry.task.stop();
        tasks.delete(key);
    }
    stmtDeletePlugin.run(pluginName);
}
/** Stop all schedules in memory (process shutdown) — keeps persisted rows. */
export function stopAll() {
    for (const { task } of tasks.values())
        task.stop();
    tasks.clear();
}
