/**
 * pluginGuard.js
 *
 * Runs a plugin safely.
 * If plugin throws an error:
 *   - Logs error with context
 *   - Marks plugin as "error" in registry
 *   - Never crashes the bot
 *
 * Disabled or errored plugins are silently ignored.
 */

import { logger }         from "#logger";
import { t }              from "#i18";
import { pluginRegistry } from "#kernel/pluginLoader.js";

/**
 * @param {object} plugin   — pluginRegistry entry
 * @param {object} context  — { msg, chat, api }
 */
export async function runPlugin(plugin, context) {
  if (plugin.status !== "active") return;

  try {
    await plugin.run(context);
  } catch (err) {
    // Disable plugin to prevent further breakage
    plugin.status = "error";
    plugin.error  = err;
    pluginRegistry.set(plugin.name, plugin);

    logger.error(
      t("system.pluginDisabledAfterError", { name: plugin.name, message: err.message }),
      `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`
    );
  }
}
