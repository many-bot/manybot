/**
 * pluginLoader.ts
 *
 * Responsible for:
 *   1. Reading active plugins (config.ts imports this module and give the list)
 *   2. Loading each plugin from ~/.manybot/plugins folder
 *   3. Registering in pluginRegistry with status and public exports
 *   4. Exposing pluginRegistry to kernel and pluginApi
 *   5. Watching plugin files and config file for hot reloading
 */

import fs                from "fs";
import path              from "path";
import { logger }        from "#logger";
import { t }             from "#i18n";
import { pathToFileURL } from "url";
import { PATHS }         from "#config";
import { buildSetupApi, cleanupPluginEvents } from "#manyapi";
import type { WASocket, WAStore } from "#types";

export interface PluginEntry {
  name: string;
  status: "active" | "disabled" | "error";
  run: ((ctx: unknown) => Promise<void>) | null;
  setup: ((ctx: unknown) => Promise<void>) | null;
  exports: unknown;
  error: Error | null;
  guardOptions: Record<string, unknown>;
  errorCount?: number;
}

const PLUGINS_DIR = path.join(PATHS.HOME, "plugins");

export const pluginRegistry = new Map<string, PluginEntry>();

let globalSock: WASocket | null = null;
let globalStore: WAStore | null = null;

const pluginWatchers = new Map<string, fs.FSWatcher>();
let configWatcher: fs.FSWatcher | null = null;

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
export async function setupPlugins(sock: WASocket, store: WAStore): Promise<void> {
  globalSock = sock;
  globalStore = store;

  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active" || !plugin.setup)
      continue;

    try {
      const api = buildSetupApi(
        sock,
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
      exports: mod.api ?? null,
      error:   null,
      guardOptions: mod.guardOptions ?? {},
      errorCount: 0,
    });

    logger.info(t(isReload ? "system.pluginReloaded" : "system.pluginLoaded", { name }));

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
      exports: null,
      error: err,
      guardOptions: {},
      errorCount: newErrorCount,
    });
  }
}

/**
 * Reload a single plugin dynamically.
 */
export async function reloadPlugin(name: string): Promise<void> {
  const plugin = pluginRegistry.get(name);
  if (!plugin) return;

  if (globalSock) {
    cleanupPluginEvents(name, globalSock);
  }

  await loadPlugin(name, true);

  const updatedPlugin = pluginRegistry.get(name);
  if (updatedPlugin && updatedPlugin.status === "active" && updatedPlugin.setup && globalSock && globalStore) {
    try {
      const api = buildSetupApi(globalSock, globalStore, pluginRegistry, name);
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
        if (globalSock) {
          cleanupPluginEvents(name, globalSock);
        }
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
      if (plugin && plugin.status === "active" && plugin.setup && globalSock && globalStore) {
        try {
          const api = buildSetupApi(globalSock, globalStore, pluginRegistry, name);
          await plugin.setup(api);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          logger.error(`[pluginLoader] Setup failed for newly enabled plugin "${name}": ${err.message}`);
        }
      }
    }
  }
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
    const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (watchTimeout) clearTimeout(watchTimeout);
      watchTimeout = setTimeout(async () => {
        logger.info(`[watcher] Plugin "${name}" file change detected (${filename}). Reloading...`);
        await reloadPlugin(name);
      }, 500);
    });
    pluginWatchers.set(name, watcher);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn(`[watcher] Failed to watch plugin "${name}" directory: ${err.message}`);
  }
}

/**
 * Stop watching a plugin's directory.
 */
export function unwatchPlugin(name: string) {
  const watcher = pluginWatchers.get(name);
  if (watcher) {
    watcher.close();
    pluginWatchers.delete(name);
  }
}

/**
 * Watch the config directory for manyplug.toml or manybot.toml changes.
 */
function startConfigWatcher() {
  if (configWatcher) return;

  try {
    let configTimeout: NodeJS.Timeout | null = null;
    configWatcher = fs.watch(PATHS.HOME, (eventType, filename) => {
      if (filename === "manyplug.toml" || filename === "manybot.toml") {
        if (configTimeout) clearTimeout(configTimeout);
        configTimeout = setTimeout(async () => {
          logger.info(`[watcher] Config file change detected: ${filename}. Syncing plugins...`);
          await syncPlugins();
        }, 500);
      }
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn(`[watcher] Failed to start config directory watcher: ${err.message}`);
  }
}

export async function cleanupPlugins(): Promise<void> {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
  for (const [name, watcher] of pluginWatchers.entries()) {
    watcher.close();
  }
  pluginWatchers.clear();

  for (const plugin of pluginRegistry.values()) {
    try {
      const evts = (plugin.exports as Record<string, unknown> | null)?.["events"] as Record<string, unknown> | undefined;
      await (evts?.["cleanup"] as (() => Promise<void>) | undefined)?.();

    } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
      logger.error(
        t("system.pluginCleanupFailed", {
          name: plugin.name,
          message: err.message
        })
      );
    }
  }
}
