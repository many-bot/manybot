/**
 * pluginGuard.js
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
import { logger }         from "#logger";
import { pluginRegistry } from "#kernel/pluginLoader";

/** Max ms a single plugin run is allowed to take before it's force-aborted. */
const PLUGIN_TIMEOUT_MS = 120_000;

/**
 * Races `promise` against a timeout rejection.
 * @param {Promise}  promise
 * @param {number}   ms
 * @param {string}   pluginName
 */
function withTimeout(promise, ms, pluginName) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/**
 * @param {object} plugin   — pluginRegistry entry
 * @param {object} context  — buildApi ctx
 *
 * plugin.guardOptions (optional, read from plugin's own export):
 *   @param {boolean} [plugin.guardOptions.timeout=true]
 */
export async function runPlugin(plugin, context) {
  if (plugin.status !== "active") return;

  const useTimeout = plugin.guardOptions?.timeout !== false;

  try {
    const run = plugin.run(context);
    await (useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run);
  } catch (err) {
    plugin.status = "error";
    plugin.error  = err;
    pluginRegistry.set(plugin.name, plugin);

    const isTimeout = useTimeout && err.message?.startsWith("timed out");
    const headline  = isTimeout
      ? `[pluginGuard] Plugin "${plugin.name}" forcibly stopped: ${err.message}`
      : `[pluginGuard] Plugin "${plugin.name}" threw an unhandled error and was disabled`;

    logger.error(headline);
    logger.error(`  message : ${err.message}`);
    if (!isTimeout) {
      const frame = err.stack?.split("\n")[1]?.trim() ?? "(no stack)";
      logger.error(`  at      : ${frame}`);
    }
  }
}
