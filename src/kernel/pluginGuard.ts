/**
 * pluginGuard.ts
 *
 * Runs a plugin safely.
 *
 * Protections:
 *   - Hard timeout per plugin run (prevents infinite hangs from locking the queue).
 *     Only catches an async hang — a plugin stuck in a 100% synchronous loop
 *     blocks the event loop before this timer can even fire. That case isn't
 *     handled here; see MANYBOT-6-STATUS.md for the planned worker_threads work.
 *   - Catches and logs all errors with structured context (which plugin, where)
 *   - Classifies failures by severity instead of one-size-fits-all disabling:
 *       exception (caught throw/rejection) — proves the run finished rather
 *         than hanging, so it's just logged + reloaded, never auto-disabled.
 *       timeout (hard-aborted run)         — the real hang signal. A few in a
 *         row pause the plugin for a cooldown instead of disabling it; only a
 *         renewed timeout right after a cooldown ends — proof the pause
 *         didn't help — disables the plugin, as a last resort.
 *     See recordException()/recordTimeout() below for the exact thresholds.
 *   - Never crashes the bot — including errors a plugin raises outside its
 *     own await chain (fire-and-forget promises), attributed via
 *     pluginContext.ts and handled by main.ts's global error listeners
 *   - Tracks each run's state (runState.ts) and, when the run answers a
 *     user's command, tells that chat it failed (crashNotice.ts)
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
import { beginRun, type RunOrigin } from "#kernel/runState.js";
import { noticeRunFailure } from "#kernel/crashNotice.js";

/** Max ms a single plugin run is allowed to take before it's force-aborted. */
const PLUGIN_TIMEOUT_MS = 120_000;

/** If a plugin runs this long without a new failure, its strike count resets. */
const FAILURE_RESET_MS = 5 * 60_000;

/** Consecutive timeouts before a plugin is paused instead of just reloaded. */
export const TIMEOUT_STRIKES_FOR_COOLDOWN = 3;

/** How long a plugin stays paused before it's automatically tried again. */
export const COOLDOWN_MS = 10 * 60_000;

/** Consecutive cooldown cycles that fail again before the plugin is disabled. */
export const MAX_COOLDOWN_FAILURES = 2;

/**
 * Marks an error as coming from withTimeout()'s hard-abort, so callers can
 * tell a real timeout apart from a plugin that merely threw an error whose
 * message happens to mention "timed out". Previously this was done by
 * string-matching `error.message.startsWith("timed out")` against a message
 * shaped `[pluginName] timed out after Nms` — which never actually matched
 * (it starts with "[", not "timed out"), so every timeout was silently
 * misclassified as a plain exception. An explicit flag on the error object
 * replaces that fragile check.
 */
interface PluginTimeoutError extends Error {
  isPluginTimeout?: true;
}

export function isPluginTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error as PluginTimeoutError).isPluginTimeout === true;
}

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
      () => {
        const err: PluginTimeoutError = new Error(`[${pluginName}] timed out after ${ms}ms`);
        err.isPluginTimeout = true;
        reject(err);
      },
      ms
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Dynamic import to avoid a circular dependency with pluginLoader.ts. */
function triggerReload(name: string): void {
  import("#kernel/pluginLoader.js").then(({ reloadPlugin }) => {
    reloadPlugin(name).catch(err => {
      logger.error(`[pluginGuard] Failed to reload plugin "${name}": ${err.message}`);
    });
  });
}

/**
 * Resumes a plugin once its cooldown window elapses. Re-fetches the entry
 * by name (not by closure) so a reload/removal that replaced the registry
 * entry in the meantime doesn't get silently resurrected by a stale timer.
 */
function endCooldown(name: string): void {
  const plugin = pluginRegistry.get(name);
  if (!plugin || plugin.status !== "cooldown") return;

  plugin.status = "active";
  plugin.recoveringFromCooldown = true;
  plugin.timeoutStrikes = 0;
  pluginRegistry.set(name, plugin);
  logger.info(`[pluginGuard] Cooldown over for "${name}" — resuming.`);
}

function enterCooldown(plugin: PluginEntry): void {
  plugin.status = "cooldown";
  plugin.timeoutStrikes = 0;
  pluginRegistry.set(plugin.name, plugin);
  logger.warn(
    `[pluginGuard] Plugin "${plugin.name}" timed out ${TIMEOUT_STRIKES_FOR_COOLDOWN}x in a row. ` +
    `Pausing for ${COOLDOWN_MS / 60_000}min instead of disabling it outright.`
  );
  setTimeout(() => endCooldown(plugin.name), COOLDOWN_MS).unref?.();
}

interface FailureResult {
  disabled: boolean;
  cooldown: boolean;
  cooldownFailures: number;
}

/**
 * A plugin threw/rejected and the error was actually caught (sync throw,
 * rejected promise). This is the "light" severity: it proves the plugin
 * run finished rather than hanging, so it only ever gets reloaded — it is
 * never auto-disabled. `errorCount` is kept purely for visibility/alerting.
 */
function recordException(plugin: PluginEntry, error: Error, frame: string): FailureResult {
  // This run finished (by throwing) rather than hanging, so whatever
  // cooldown recovery was in progress is proven over.
  plugin.recoveringFromCooldown = false;

  const now = Date.now();
  const stale = plugin.lastFailureAt !== undefined && (now - plugin.lastFailureAt) > FAILURE_RESET_MS;
  const errorCount = (stale ? 0 : (plugin.errorCount ?? 0)) + 1;
  plugin.errorCount = errorCount;
  plugin.lastFailureAt = now;
  pluginRegistry.set(plugin.name, plugin);

  logger.warn(`[pluginGuard] Plugin "${plugin.name}" threw an error (${errorCount}x in a row). Reloading...`);
  logger.warn(`  message : ${error.message}`);
  logger.warn(`  at      : ${frame}`);

  triggerReload(plugin.name);
  return { disabled: false, cooldown: false, cooldownFailures: plugin.cooldownFailures ?? 0 };
}

/**
 * A plugin run was force-aborted by the hard timeout — the strongest
 * signal we have of a stuck/looping plugin (a sync infinite loop still
 * escapes this; see pluginGuard.ts header). Light strikes just reload,
 * like an exception; repeated strikes pause the plugin for a cooldown;
 * only a renewed timeout right after a cooldown — proof the pause didn't
 * help — disables the plugin, as a last resort.
 */
function recordTimeout(plugin: PluginEntry, error: Error): FailureResult {
  const wasRecovering = plugin.recoveringFromCooldown === true;
  plugin.recoveringFromCooldown = false;

  if (wasRecovering) {
    const cooldownFailures = (plugin.cooldownFailures ?? 0) + 1;
    plugin.cooldownFailures = cooldownFailures;

    if (cooldownFailures >= MAX_COOLDOWN_FAILURES) {
      plugin.status = "error";
      pluginRegistry.set(plugin.name, plugin);
      logger.error(
        `[pluginGuard] Plugin "${plugin.name}" timed out again right after cooldown ` +
        `(${cooldownFailures}x). Disabling as a last resort.`
      );
      logger.error(`  message : ${error.message}`);
      return { disabled: true, cooldown: false, cooldownFailures };
    }

    enterCooldown(plugin);
    return { disabled: false, cooldown: true, cooldownFailures };
  }

  const now = Date.now();
  const stale = plugin.lastTimeoutAt !== undefined && (now - plugin.lastTimeoutAt) > FAILURE_RESET_MS;
  const strikes = (stale ? 0 : (plugin.timeoutStrikes ?? 0)) + 1;
  plugin.timeoutStrikes = strikes;
  plugin.lastTimeoutAt = now;

  if (strikes >= TIMEOUT_STRIKES_FOR_COOLDOWN) {
    logger.warn(`[pluginGuard] Plugin "${plugin.name}" timed out ${strikes}x in a row.`);
    logger.warn(`  message : ${error.message}`);
    enterCooldown(plugin);
    return { disabled: false, cooldown: true, cooldownFailures: plugin.cooldownFailures ?? 0 };
  }

  logger.warn(`[pluginGuard] Plugin "${plugin.name}" timed out (${strikes}/${TIMEOUT_STRIKES_FOR_COOLDOWN}). Reloading...`);
  logger.warn(`  message : ${error.message}`);
  pluginRegistry.set(plugin.name, plugin);
  triggerReload(plugin.name);
  return { disabled: false, cooldown: false, cooldownFailures: plugin.cooldownFailures ?? 0 };
}

/**
 * Single source of truth for "a plugin failed" bookkeeping: classifies the
 * failure (exception vs. timeout — see recordException()/recordTimeout()
 * above), updates the registry entry accordingly, and fires the owner
 * alert when appropriate.
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

  plugin.error = error;
  const frame = error.stack?.split("\n")[1]?.trim() ?? "(no stack)";

  const result = opts.isTimeout
    ? recordTimeout(plugin, error)
    : recordException(plugin, error, frame);

  if (!opts.rethrow) {
    fireAlert("plugin_crash", {
      plugin: plugin.name,
      kind: opts.isTimeout ? "timeout" : "exception",
      message: error.message,
      errorCount: plugin.errorCount,
      cooldownFailures: result.cooldownFailures,
      cooldownMinutes: COOLDOWN_MS / 60_000,
      maxCooldownFailures: MAX_COOLDOWN_FAILURES,
      disabled: result.disabled,
      cooldown: result.cooldown,
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
   * Re-throw after the usual bookkeeping (errorCount/timeoutStrikes,
   * cooldown/disable classification, logging) instead of swallowing the
   * error. Default `false` — the legacy per-message `run(ctx)` loop relies on
   * runPlugin() never throwing ("never crashes the bot"). Callers
   * that need to react to the failure themselves (e.g. `runCommand.ts`'s
   * Phase-8 crash-alert hook) opt in explicitly.
   */
  rethrow?: boolean;
  /**
   * Set when this run answers a user's command. A failure is then reported
   * back to that chat (see crashNotice.ts) and the run is journaled so a
   * process death mid-run can be reported after the restart (runState.ts).
   */
  origin?: RunOrigin;
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
  const run = beginRun(plugin.name, options?.origin ?? null);

  try {
    const result = await runWithPlugin(plugin.name, () => {
      if (handler) {
        const run = handler(context, input);
        return useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run;
      } else {
        if (!plugin.run) return undefined;
        const run = plugin.run(context);
        return useTimeout ? withTimeout(run, PLUGIN_TIMEOUT_MS, plugin.name) : run;
      }
    });

    // Finished without hanging — proves any cooldown recovery in progress
    // actually worked, so the next timeout (if any) starts a fresh strike
    // count instead of counting as a repeated cooldown failure.
    if (plugin.recoveringFromCooldown) {
      plugin.recoveringFromCooldown = false;
      pluginRegistry.set(plugin.name, plugin);
    }

    return result;
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const isTimeout = useTimeout && isPluginTimeoutError(error);

    recordPluginFailure(plugin.name, error, { isTimeout, rethrow: options?.rethrow });
    void noticeRunFailure(run);
    if (options?.rethrow) throw error;
    return undefined;
  } finally {
    run.finish();
  }
}

