/**
 * pluginGuard.ts
 *
 * Runs a plugin safely.
 *
 * Protections:
 *   - Hard timeout per plugin run (prevents infinite hangs from locking the queue)
 *   - Catches and logs all errors with structured context (which plugin, where)
 *   - Marks errored plugins so they are silently skipped from then on
 *   - Never crashes the bot — including errors a plugin raises outside its
 *     own await chain (fire-and-forget promises), attributed via
 *     pluginContext.ts and handled by main.ts's global error listeners
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
import { pluginRegistry, type PluginEntry } from "#kernel/pluginLoader.js";
import type { CommandHandler } from "#kernel/commandRegistry.js";
import { runWithPlugin } from "#kernel/pluginContext.js";
import { fireAlert } from "#kernel/alerts.js";

/** Max ms a single plugin run is allowed to take before it's force-aborted. */
const PLUGIN_TIMEOUT_MS = 120_000;

/** If a plugin runs this long without a new failure, its strike count resets. */
const FAILURE_RESET_MS = 5 * 60_000;

/**
 * Races `promise` against a timeout rejection.
 * @param {Promise}  promise
 * @param {number}   ms
 * @param {string}   pluginName
 */
function withTimeout(promise: Promise<unknown>, ms: number, pluginName: string): Promise<unknown> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[${pluginName}] timed out after ${ms}ms`)),
      ms
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Single source of truth for "a plugin threw" bookkeeping: bumps
 * errorCount, disables the plugin past 3 strikes, logs with the plugin
 * name attached, and triggers a reload attempt otherwise.
 *
 * Called from two places:
 *   - runPlugin()'s own catch block (the normal, awaited-error path)
 *   - main.ts's uncaughtException/unhandledRejection listeners, for
 *     errors a plugin raised without awaiting/catching them itself
 *
 * Alerting: this function is also where the WhatsApp/email owner alert
 * (`fireAlert("plugin_crash", ...)`) gets fired for every path EXCEPT
 * the command-dispatch one. `runCommand.ts`'s own catch block already
 * fires a richer alert (it knows the exact command name) once the error
 * has been rethrown back up to it — so when the caller here is about to
 * rethrow (`opts.rethrow`), this function stays silent and leaves the
 * alert to that outer catch, to avoid double-alerting the owner for the
 * same crash. Every other caller (legacy `run(ctx)` plugins, and
 * detached/global-context errors caught by main.ts) has no such
 * downstream catch of its own, so without this the owner would never
 * be told about those crashes at all — only the local log would know.
 *
 * @returns `true` if `pluginName` matched a known registry entry and was
 *          handled here (bot should keep running); `false` if it did not
 *          match anything, meaning the error is NOT plugin-attributable
 *          and the caller must fall back to its own handling.
 */
export function recordPluginFailure(
  pluginName: string,
  error: Error,
  opts: { isTimeout?: boolean; rethrow?: boolean } = {}
): boolean {
  const plugin = pluginRegistry.get(pluginName);
  if (!plugin) return false;

  const now = Date.now();
  const staleFailure = plugin.lastFailureAt !== undefined && (now - plugin.lastFailureAt) > FAILURE_RESET_MS;
  const baseCount = staleFailure ? 0 : (plugin.errorCount ?? 0);

  const errorCount = baseCount + 1;
  plugin.errorCount = errorCount;
  plugin.lastFailureAt = now;
  plugin.error = error;

  const frame = error.stack?.split("\n")[1]?.trim() ?? "(no stack)";
  const disabled = errorCount >= 3;

  if (disabled) {
    plugin.status = "error";
    pluginRegistry.set(plugin.name, plugin);
    logger.error(`[pluginGuard] Plugin "${plugin.name}" threw an error and has failed 3 times. Disabling plugin.`);
    logger.error(`  message : ${error.message}`);
    if (!opts.isTimeout) logger.error(`  at      : ${frame}`);
  } else {
    pluginRegistry.set(plugin.name, plugin);
    logger.warn(`[pluginGuard] Plugin "${plugin.name}" threw an error (attempt ${errorCount}/3). Reloading...`);
    logger.warn(`  message : ${error.message}`);
    if (!opts.isTimeout) logger.warn(`  at      : ${frame}`);

    // Reload the plugin dynamically to avoid circular dependency
    import("#kernel/pluginLoader.js").then(({ reloadPlugin }) => {
      reloadPlugin(plugin.name).catch(err => {
        logger.error(`[pluginGuard] Failed to reload plugin "${plugin.name}": ${err.message}`);
      });
    });
  }

  if (!opts.rethrow) {
    fireAlert("plugin_crash", {
      plugin: plugin.name,
      kind: opts.isTimeout ? "timeout" : "exception",
      message: error.message,
      errorCount,
      disabled,
      source: "global",
    });
  }

  return true;
}

/**
 * @param {object} plugin   — pluginRegistry entry
 * @param {object} context  — buildApi ctx
 *
 * plugin.guardOptions (optional, read from plugin's own export):
 *   @param {boolean} [plugin.guardOptions.timeout=true]
 */
export interface RunPluginOptions {
  /**
   * Re-throw after the usual bookkeeping (errorCount, disabling past
   * 3 strikes, logging) instead of swallowing the error. Default
   * `false` — the legacy per-message `run(ctx)` loop relies on
   * runPlugin() never throwing ("never crashes the bot"). Callers
   * that need to react to the failure themselves (e.g. `runCommand.ts`'s
   * Phase-8 crash-alert hook) opt in explicitly.
   */
  rethrow?: boolean;
}

export async function runPlugin(
  plugin: PluginEntry,
  context: unknown,
  handler?: CommandHandler,
  input?: unknown,
  options?: RunPluginOptions
): Promise<unknown> {
  if (plugin.status !== "active") return undefined;

  const useTimeout = plugin.guardOptions?.timeout !== false;

  try {
    return await runWithPlugin(plugin.name, () => {
      if (handler) {
        const run = handler(context, input);
        return useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run;
      } else {
        if (!plugin.run) return undefined;
        const run = plugin.run(context);
        return useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run;
      }
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const isTimeout = useTimeout && error.message?.startsWith("timed out");

    recordPluginFailure(plugin.name, error, { isTimeout, rethrow: options?.rethrow });
    if (options?.rethrow) throw error;
    return undefined;
  }
}

