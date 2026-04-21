/**
 * scheduler.js
 *
 * Allows plugins to register scheduled tasks via cron.
 * Uses node-cron underneath, but plugins never import node-cron directly —
 * they only call api.schedule(cron, fn).
 *
 * Usage in plugin:
 *   import { schedule } from "many";
 *   schedule("0 9 * * 1", async () => { await api.send("Good morning!"); });
 */

import cron   from "node-cron";
import { logger } from "../logger/logger.js";
import { t }      from "../i18n/index.js";

/** List of active tasks (for eventual teardown) */
const tasks = [];

/**
 * Register a cron task.
 * @param {string}   expression  — cron expression e.g., "0 9 * * 1"
 * @param {Function} fn          — async function to execute
 * @param {string}   pluginName  — plugin name (for logging)
 */
export function schedule(expression, fn, pluginName = "unknown") {
  if (!cron.validate(expression)) {
    logger.warn(t("system.schedulerInvalidCron", { name: pluginName, expression }));
    return;
  }

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(t("system.schedulerError", { name: pluginName, message: err.message }));
    }
  });

  tasks.push({ pluginName, expression, task });
  logger.info(t("system.schedulerRegistered", { name: pluginName, expression }));
}

/** Stop all schedules (useful for shutdown) */
export function stopAll() {
  tasks.forEach(({ task }) => task.stop());
  tasks.length = 0;
}