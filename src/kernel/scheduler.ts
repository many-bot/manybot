/**
 * scheduler.ts
 *
 * Allows plugins to register scheduled tasks via cron.
 * Uses node-cron underneath, but plugins never import node-cron directly —
 * they only call ctx.scheduler.schedule(cron, fn).
 *
 * Usage in plugin:
 *   export default async function (ctx) {
 *     ctx.scheduler.schedule("0 9 * * 1", async () => {
 *       await ctx.send.text("Good morning!");
 *     });
 *   }
 */

import cron   from "node-cron";
import { logger } from "#logger";
import { t }      from "#i18n";

interface TaskEntry {
  pluginName: string;
  expression: string;
  task: ReturnType<typeof cron.schedule>;
}

const tasks: TaskEntry[] = [];

/**
 * Register a cron task.
 * @param {string}   expression  — cron expression e.g., "0 9 * * 1"
 * @param {Function} fn          — async function to execute
 * @param {string}   pluginName  — plugin name (for logging)
 */
export function schedule(expression: string, fn: () => Promise<void>, pluginName = "unknown"): void {
  if (!cron.validate(expression)) {
    logger.warn(t("system.schedulerInvalidCron", { name: pluginName, expression }));
    return;
  }

  const task = cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
      logger.error(t("system.schedulerError", { name: pluginName, message: err.message }));
    }
  });

  tasks.push({ pluginName, expression, task });
  logger.info(t("system.schedulerRegistered", { name: pluginName, expression }));
}

/** Stop all schedules (useful for shutdown) */
export function stopAll(): void {
  tasks.forEach(({ task }) => task.stop());
  tasks.length = 0;
}
