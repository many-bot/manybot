/**
 * pluginGuard.ts
 *
 * Runs a plugin safely.
 *
 * Protections:
 *   - Hard timeout per plugin run (prevents infinite hangs from locking the queue)
 *   - Catches and logs all errors with structured context
 *   - Marks errored plugins so they are silently skipped from then on
 *   - Never crashes the bot
 *
 * Per-plugin overrides:
 *   Plugins may export a `guardOptions` object to opt out of specific
 *   protections. The pluginLoader is responsible for reading this export
 *   and storing it as `plugin.guardOptions` in the registry entry.
 *
 *   Supported keys:
 *     timeout {boolean}  — set to `false` to disable the hard timeout.
 *                          Use only for plugins that intentionally block
 *                          (e.g. heavy media processing, sticker generation).
 */
import { logger } from "#logger";
import { pluginRegistry } from "#kernel/pluginLoader.js";
/** Max ms a single plugin run is allowed to take before it's force-aborted. */
const PLUGIN_TIMEOUT_MS = 120_000;
/**
 * Races `promise` against a timeout rejection.
 * @param {Promise}  promise
 * @param {number}   ms
 * @param {string}   pluginName
 */
function withTimeout(promise, ms, pluginName) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[${pluginName}] timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
/**
 * @param {object} plugin   — pluginRegistry entry
 * @param {object} context  — buildApi ctx
 *
 * plugin.guardOptions (optional, read from plugin's own export):
 *   @param {boolean} [plugin.guardOptions.timeout=true]
 */
export async function runPlugin(plugin, context) {
    if (plugin.status !== "active")
        return;
    const useTimeout = plugin.guardOptions?.timeout !== false;
    try {
        if (!plugin.run)
            return;
        const run = plugin.run(context);
        await (useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run);
    }
    catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        const errorCount = (plugin.errorCount ?? 0) + 1;
        plugin.errorCount = errorCount;
        plugin.error = error;
        const isTimeout = useTimeout && error.message?.startsWith("timed out");
        if (errorCount >= 3) {
            plugin.status = "error";
            pluginRegistry.set(plugin.name, plugin);
            logger.error(`[pluginGuard] Plugin "${plugin.name}" threw an error and has failed 3 times. Disabling plugin.`);
            logger.error(`  message : ${error.message}`);
            if (!isTimeout) {
                const frame = error.stack?.split("\n")[1]?.trim() ?? "(no stack)";
                logger.error(`  at      : ${frame}`);
            }
        }
        else {
            pluginRegistry.set(plugin.name, plugin);
            logger.warn(`[pluginGuard] Plugin "${plugin.name}" threw an error (attempt ${errorCount}/3). Reloading...`);
            logger.warn(`  message : ${error.message}`);
            if (!isTimeout) {
                const frame = error.stack?.split("\n")[1]?.trim() ?? "(no stack)";
                logger.warn(`  at      : ${frame}`);
            }
            // Reload the plugin dynamically to avoid circular dependency
            import("#kernel/pluginLoader.js").then(({ reloadPlugin }) => {
                reloadPlugin(plugin.name).catch(err => {
                    logger.error(`[pluginGuard] Failed to reload plugin "${plugin.name}": ${err.message}`);
                });
            });
        }
    }
}
