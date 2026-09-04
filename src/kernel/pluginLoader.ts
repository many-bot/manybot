/**
 * pluginLoader.ts
 *
 * Responsible for:
 *   1. Reading active plugins (config.ts imports this module and give the list)
 *   2. Loading each plugin from ~/.manybot/plugins folder
 *   3. Registering in pluginRegistry with status and public exports
 *   4. Exposing pluginRegistry to kernel and pluginApi
 *   5. Watching plugin files, config files and commands.yaml for hot reloading
 */

import fs                from "fs";
import path              from "path";
import { logger }        from "#logger";
import { t }             from "#i18n";
import { pathToFileURL } from "url";
import { PATHS }         from "#config";
import { buildSetupApi, cleanupPluginEvents } from "#manyapi";
import { initCommandRegistry } from "#kernel/commandRegistry.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";

import type { CommandPermissions, LocalizedString } from "./commandsConfig.js";

export type PluginCommandHandler = (ctx: unknown, input?: unknown) => Promise<unknown>;

/**
 * Full-shape plugin command default — a plugin MAY ship its own `cmd`/
 * `aliases`/etc. as a convenience so it auto-registers even without a
 * commands.yaml entry. Optional now: a "pure function" plugin (identity
 * lives entirely in commands.yaml) omits all of this and just exports
 * the handler — see {@link PluginCommandExport}.
 */
export interface PluginCommandDefault {
  cmd?: string;
  aliases?: string[];
  desc?: LocalizedString;
  category?: string;
  manual?: LocalizedString;
  permissions?: CommandPermissions;
  handler: PluginCommandHandler;
}

/**
 * What a plugin may put under `export const commands = { fnName: ... }`.
 * Either the bare async handler (pure-function style — commands.yaml is
 * the sole source of `cmd`/aliases/etc.) or the fuller
 * `PluginCommandDefault` object (handler + optional built-in identity).
 */
export type PluginCommandExport = PluginCommandHandler | PluginCommandDefault;

/**
 * Resolves the actual handler function out of either shape a plugin may
 * export under `commands[fnName]`. Shared by the registry build step
 * (commandRegistry.ts) and the dispatch step (runCommand.ts) so both
 * agree on what counts as "this function is callable".
 */
export function resolvePluginCommandHandler(def: PluginCommandExport | undefined | null): PluginCommandHandler | null {
  if (typeof def === "function") return def;
  if (def && typeof def === "object" && typeof def.handler === "function") return def.handler;
  return null;
}

export interface PluginEntry {
  name: string;
  status: "active" | "disabled" | "error";
  run: ((ctx: unknown) => Promise<void>) | null;
  setup: ((ctx: unknown) => Promise<void>) | null;
  commands: Record<string, PluginCommandExport> | null;
  exports: unknown;
  error: Error | null;
  guardOptions: Record<string, unknown>;
  errorCount?: number;
}

const PLUGINS_DIR = path.join(PATHS.HOME, "plugins");

export const pluginRegistry = new Map<string, PluginEntry>();

let globalContract: WaContract | null = null;
let globalStore: BotStore | null = null;

/**
 * Live WaContract + BotStore the kernel most-recently wired through
 * `setupPlugins()`. Exposed for the integration-test harness only
 * (see `src/plugins/__manybot_integration__/` and the
 * `*.integration.test.ts` suite under the project root): production
 * code paths go through `ctx.wa.contract` / `ctx.store`, not through
 * this module-scoped singleton.
 *
 * Returns `null` when the bot hasn't connected yet (or after a
 * disconnect). The integration suite waits for a non-null value
 * before issuing any real round-trip.
 */
export function getGlobalKernelRefs(): { contract: WaContract; store: BotStore } | null {
  if (!globalContract || !globalStore) return null;
  return { contract: globalContract, store: globalStore };
}

const pluginWatchers = new Map<string, fs.FSWatcher[]>();

// fs.watch's `recursive: true` emulates recursion on Linux by opening one
// inotify watch per subdirectory — a plugin shipping its own node_modules
// can blow past the OS's fs.inotify.max_user_watches (ENOSPC). Walk the
// tree ourselves and skip directories that don't need watching.
const IGNORED_WATCH_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

function watchDirRecursive(rootDir: string, onChange: fs.WatchListener<string>): fs.FSWatcher[] {
  const watchers: fs.FSWatcher[] = [];

  function walk(dir: string) {
    try {
      watchers.push(fs.watch(dir, onChange));
    } catch {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_WATCH_DIRS.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
    }
  }

  walk(rootDir);
  return watchers;
}
let configWatcher: fs.FSWatcher | null = null;
let configReloadTimeout: NodeJS.Timeout | null = null;
let yamlReloadTimeout: NodeJS.Timeout | null = null;

/**
 * Load all active plugins listed in `activePlugins`.
 * Called once during bot initialization.
 *
 * @param {string[]} activePlugins — active plugin names
 */
export async function loadPlugins(activePlugins: string[]): Promise<void> {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  for (const name of activePlugins) {
    await loadPlugin(name);
  }

  startConfigWatcher();

  await initCommandRegistry();

  const total   = pluginRegistry.size;
  const active  = [...pluginRegistry.values()].filter(p => p.status === "active").length;
  const errors  = total - active;

  logger.success(t("system.pluginsLoaded", {
    count: active,
    errors: errors ? t("system.pluginsLoadedWithErrors", { count: errors }) : ""
  }));
}

/**
 * Call setup(api) on all plugins that export it.
 * Executed once after bot connects.
 */
export async function setupPlugins(contract: WaContract, store: BotStore): Promise<void> {
  globalContract = contract;
  globalStore = store;

  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active" || !plugin.setup)
      continue;

    try {
      const api = buildSetupApi(
        contract,
        store,
        pluginRegistry,
        plugin.name
      );

      await plugin.setup(api);

    } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
      logger.error(
        t("system.pluginSetupFailed", {
          name: plugin.name,
          message: err.message
        })
      );
    }
  }
}

async function findPluginPath(name: string): Promise<string | null> {
  const dir = path.join(PLUGINS_DIR, name);
  const manifest = path.join(dir, "manyplug.json");

  if (!fs.existsSync(manifest))
    return null;

  const data = JSON.parse(
    await fs.promises.readFile(
      manifest,
      "utf8"
    )
  ) as {
    main?: string;
  };

  const candidates = [
    data.main,
    "index.js",
    "index.ts"
  ].filter(
    (v): v is string =>
      typeof v === "string" &&
      v.trim().length > 0
  );

  for (const file of candidates) {
    const entry = path.join(dir, file);

    if (fs.existsSync(entry))
      return entry;
  }

  return null;
}

/**
 * Load a single plugin by name.
 * @param {string} name
 * @param {boolean} isReload
 */
export async function loadPlugin(name: string, isReload = false): Promise<void> {
  const pluginPath = await findPluginPath(name);
  const existing = pluginRegistry.get(name);
  const errorCount = existing ? (existing.errorCount ?? 0) : 0;

  if (!pluginPath) {
    logger.warn(t("system.pluginNotFound", { name, path: path.join(PLUGINS_DIR, name) as unknown as string }));
    pluginRegistry.set(name, {
      name,
      status: "disabled",
      run: null,
      setup: null,
      commands: null,
      exports: null,
      error: null,
      guardOptions: {},
      errorCount: 0
    });
    unwatchPlugin(name);
    return;
  }

  if (!fs.existsSync(pluginPath)) {
    logger.warn(t("system.pluginNotFound", { name, path: pluginPath }));
    pluginRegistry.set(name, {
      name,
      status: "disabled",
      run: null,
      setup: null,
      commands: null,
      exports: null,
      error: null,
      guardOptions: {},
      errorCount: 0
    });
    unwatchPlugin(name);
    return;
  }

  try {
    const importUrl = pathToFileURL(pluginPath).href + (isReload ? `?update=${Date.now()}` : "");
    const mod = await import(importUrl);

    // Plugin must export a default function — this is called on every message
    if (typeof mod.default !== "function") {
      throw new Error(`Plugin "${name}" does not export a default function`);
    }

    pluginRegistry.set(name, {
      name,
      status:  "active",
      run:     mod.default,
      setup:   mod.setup ?? null,
      commands: (mod.commands as Record<string, PluginCommandExport> | undefined) ?? null,
      exports: mod.api ?? null,
      error:   null,
      guardOptions: mod.guardOptions ?? {},
      errorCount: 0,
    });

    // Phase 9: a plugin is a library of ready-to-use functions invoked as
    // commands, not something that loads all its logic at boot — a line
    // per plugin no longer earns its place in default startup output.
    // Still available with --debug.
    logger.debug(t(isReload ? "system.pluginReloaded" : "system.pluginLoaded", { name }));

    if (isReload) {
      await initCommandRegistry();
    }

    watchPluginDirectory(name);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error(t("system.pluginLoadFailed", { name, message: err.message }));

    const newErrorCount = isReload ? (errorCount + 1) : 3;
    pluginRegistry.set(name, {
      name,
      status:  newErrorCount >= 3 ? "error" : "active",
      run: null,
      setup: null,
      commands: null,
      exports: null,
      error: err,
      guardOptions: {},
      errorCount: newErrorCount,
    });

    if (isReload) {
      await initCommandRegistry();
    }
  }
}

/**
 * Run a plugin's own `api.events.cleanup()` export, if it has one.
 *
 * This is the plugin's chance to release anything it opened itself
 * that the kernel has no knowledge of — most commonly a local HTTP/TCP
 * server started from `setup()`. `cleanupPluginEvents()` (WA-side
 * listeners) is a separate concern and does NOT cover this.
 *
 * Must be awaited and run to completion BEFORE the plugin module is
 * re-imported (reload) or the plugin is torn down (disable/shutdown) —
 * otherwise a plugin that binds a port in `setup()` will still be
 * holding it when the new instance tries to bind the same port,
 * producing `EADDRINUSE` and crashing the process.
 */
async function cleanupPluginExports(plugin: PluginEntry): Promise<void> {
  try {
    const evts = (plugin.exports as Record<string, unknown> | null)?.["events"] as Record<string, unknown> | undefined;
    await (evts?.["cleanup"] as (() => Promise<void>) | undefined)?.();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error(
      t("system.pluginCleanupFailed", {
        name: plugin.name,
        message: err.message
      })
    );
  }
}

/**
 * Reload a single plugin dynamically.
 */
export async function reloadPlugin(name: string): Promise<void> {
  const plugin = pluginRegistry.get(name);
  if (!plugin) return;

  if (globalContract) {
    cleanupPluginEvents(name, globalContract);
  }

  // Close whatever the CURRENT instance opened (e.g. a local server)
  // before importing a fresh copy of the module — otherwise the new
  // setup() call fights the old one for the same port.
  await cleanupPluginExports(plugin);

  await loadPlugin(name, true);

  const updatedPlugin = pluginRegistry.get(name);
  if (updatedPlugin && updatedPlugin.status === "active" && updatedPlugin.setup && globalContract && globalStore) {
    try {
      const api = buildSetupApi(globalContract, globalStore, pluginRegistry, name);
      await updatedPlugin.setup(api);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error(`[pluginLoader] Setup failed during reload for "${name}": ${err.message}`);

      const newErrorCount = (updatedPlugin.errorCount ?? 0) + 1;
      updatedPlugin.errorCount = newErrorCount;
      updatedPlugin.error = err;

      if (newErrorCount >= 3) {
        updatedPlugin.status = "error";
        logger.error(`[pluginLoader] Plugin "${name}" failed setup 3 times and was disabled.`);
      } else {
        logger.warn(`[pluginLoader] Retrying reload for "${name}" (setup error, attempt ${newErrorCount}/3)`);
        reloadPlugin(name).catch(() => {});
      }
    }
  }
}

/**
 * Sync active plugins based on config file updates.
 */
export async function syncPlugins(): Promise<void> {
  const oldActive = new Set([...pluginRegistry.entries()]
    .filter(([_, p]) => p.status === "active")
    .map(([name]) => name));

  const { reloadConfig, PLUGINS } = await import("#config");
  await reloadConfig();

  const newActive = new Set(PLUGINS);

  // Disable plugins that were removed from config
  for (const name of oldActive) {
    if (!newActive.has(name)) {
      logger.info(`[pluginLoader] Disabling plugin "${name}"`);
      const plugin = pluginRegistry.get(name);
      if (plugin) {
        if (globalContract) {
          cleanupPluginEvents(name, globalContract);
        }
        // Same reasoning as reloadPlugin(): a disabled plugin must
        // release anything it opened itself (e.g. a local server)
        // or it keeps holding the port even though it's no longer active.
        await cleanupPluginExports(plugin);
        plugin.status = "disabled";
        unwatchPlugin(name);
      }
    }
  }

  // Enable/load plugins that were added to config
  for (const name of newActive) {
    if (!oldActive.has(name)) {
      logger.info(`[pluginLoader] Enabling plugin "${name}"`);
      await loadPlugin(name);
      const plugin = pluginRegistry.get(name);
      if (plugin && plugin.status === "active" && plugin.setup && globalContract && globalStore) {
        try {
          const api = buildSetupApi(globalContract, globalStore, pluginRegistry, name);
          await plugin.setup(api);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          logger.error(`[pluginLoader] Setup failed for newly enabled plugin "${name}": ${err.message}`);
        }
      }
    }
  }

  await initCommandRegistry();
}

/**
 * Watch a plugin's directory for changes.
 */
export function watchPluginDirectory(name: string) {
  if (pluginWatchers.has(name)) return;

  const dir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(dir)) return;

  try {
    let watchTimeout: NodeJS.Timeout | null = null;
    const watchers = watchDirRecursive(dir, (eventType, filename) => {
      if (watchTimeout) clearTimeout(watchTimeout);
      watchTimeout = setTimeout(async () => {
        logger.info(`[watcher] Plugin "${name}" file change detected (${filename}). Reloading...`);
        await reloadPlugin(name);
      }, 500);
    });
    pluginWatchers.set(name, watchers);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn(`[watcher] Failed to watch plugin "${name}" directory: ${err.message}`);
  }
}

/**
 * Stop watching a plugin's directory.
 */
export function unwatchPlugin(name: string) {
  const watchers = pluginWatchers.get(name);
  if (watchers) {
    for (const w of watchers) w.close();
    pluginWatchers.delete(name);
  }
}

/**
 * Reload the command registry from disk (commands.yaml + imports).
 *
 * Mirrors `reloadPlugin()`: callable on its own and safe to invoke from
 * a watcher. Unlike `reloadPlugin()` there's no setup retry / disable
 * state to track — `initCommandRegistry()` either builds a fresh
 * `CommandRegistry` from the current file content or leaves the
 * previous one in place via `commandsConfig.ts`'s own error handling
 * (a malformed YAML logs an error and returns null; `initCommandRegistry`
 * then falls back to the empty defaults).
 */
export async function reloadCommandRegistry(): Promise<void> {
  try {
    await initCommandRegistry();
    logger.info(`[watcher] Command registry reloaded from commands.yaml.`);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error(`[watcher] Failed to reload command registry: ${err.message}`);
  }
}

/**
 * Watch the config directory for changes to manyplug.toml / manybot.toml
 * (plugin list sync) or to commands.yaml and its .yaml/.yml imports
 * (command registry reload). Both paths share the same 500ms debounce
 * so a save that emits several inotify events only fires once.
 */
function startConfigWatcher() {
  if (configWatcher) return;

  const isTomlChange = (filename: string | null): boolean =>
    filename === "manyplug.toml" || filename === "manybot.toml";

  const isYamlChange = (filename: string | null): boolean => {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    return lower.endsWith(".yaml") || lower.endsWith(".yml");
  };

  try {
    const scheduleTomlReload = (filename: string | null) => {
      if (!isTomlChange(filename)) return;
      if (configReloadTimeout) clearTimeout(configReloadTimeout);
      configReloadTimeout = setTimeout(async () => {
        configReloadTimeout = null;
        logger.info(`[watcher] Config file change detected: ${filename}. Syncing plugins...`);
        await syncPlugins();
      }, 500);
    };

    const scheduleYamlReload = (filename: string | null) => {
      if (!isYamlChange(filename)) return;
      if (yamlReloadTimeout) clearTimeout(yamlReloadTimeout);
      yamlReloadTimeout = setTimeout(async () => {
        yamlReloadTimeout = null;
        logger.info(`[watcher] commands.yaml change detected (${filename}). Reloading command registry...`);
        await reloadCommandRegistry();
      }, 500);
    };

    configWatcher = fs.watch(PATHS.HOME, (eventType, filename) => {
      scheduleTomlReload(filename);
      scheduleYamlReload(filename);
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn(`[watcher] Failed to start config directory watcher: ${err.message}`);
  }
}

/**
 * Tear down everything `loadPlugins()` started — config watcher, per-plugin
 * directory watchers, and each plugin's exported `cleanup()` handler.
 *
 * Used by the process-shutdown path in main.ts and by tests that need a
 * clean registry between cases. Idempotent: safe to call multiple times
 * and safe to call before any plugin has been loaded.
 */
export async function cleanupPlugins(): Promise<void> {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
  if (configReloadTimeout) {
    clearTimeout(configReloadTimeout);
    configReloadTimeout = null;
  }
  if (yamlReloadTimeout) {
    clearTimeout(yamlReloadTimeout);
    yamlReloadTimeout = null;
  }
  for (const watchers of pluginWatchers.values()) {
    for (const w of watchers) w.close();
  }
  pluginWatchers.clear();

  for (const plugin of pluginRegistry.values()) {
    await cleanupPluginExports(plugin);
  }
}

export async function loadIntegrationPlugin(): Promise<PluginEntry> {
  // Integration mode is opt-in: the bot never loads this plugin in
  // production. The check has to happen before any filesystem work so
  // a forgotten opt-in fails fast with a clear message, not a stack
  // trace from a missing file or a permission error. We only enforce
  // the explicit opt-in flag here — `TEST_CHAT` is consulted by the
  // plugin itself at runtime, not by the loader.
  if (process.env.MANYBOT_RUN_WHATSAPP_TESTS !== "1") {
    throw new Error(
      `[pluginLoader] cannot load the integration plugin: ` +
      `MANYBOT_RUN_WHATSAPP_TESTS=1 is required to opt in to the integration test harness.`
    );
  }
  const { INTEGRATION_PLUGIN_NAME, getIntegrationPluginDir } =
    await import("#kernel/integrationMode.js");

  // Idempotent: if a previous load already registered the integration
  // plugin, hand the same entry back rather than re-importing and
  // duplicating the registry (and the in-process event listeners that
  // would otherwise attach twice).
  const existing = pluginRegistry.get(INTEGRATION_PLUGIN_NAME);
  if (existing) return existing;

  const dir = getIntegrationPluginDir();
  const pluginPath = `${dir}/index.ts`;
  try {
    const mod = await import(pathToFileURL(pluginPath).href);
    if (typeof mod.default !== "function") {
      throw new Error(`Integration plugin "${INTEGRATION_PLUGIN_NAME}" does not export a default function`);
    }
    const entry: PluginEntry = {
      name: INTEGRATION_PLUGIN_NAME,
      status: "active",
      run: mod.default,
      setup: mod.setup ?? null,
      commands: null,
      exports: (mod as any).api ?? null,
      error: null,
      guardOptions: {},
      errorCount: 0,
    };
    pluginRegistry.set(INTEGRATION_PLUGIN_NAME, entry);
    return entry;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const entry: PluginEntry = {
      name: INTEGRATION_PLUGIN_NAME,
      status: "error",
      run: null,
      setup: null,
      commands: null,
      exports: null,
      error: err,
      guardOptions: {},
      errorCount: 1,
    };
    pluginRegistry.set(INTEGRATION_PLUGIN_NAME, entry);
    throw err;
  }
}

