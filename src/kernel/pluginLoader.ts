/**
 * pluginLoader.ts
 *
 * Responsible for:
 *   1. Reading active plugins (config.ts imports this module and give the list)
 *   2. Loading each plugin from ~/.manybot/plugins folder
 *   3. Registering in pluginRegistry with status and public exports
 *   4. Exposing pluginRegistry to kernel and pluginApi
 *
 */

import fs                from "fs";
import path              from "path";
import { logger }        from "#logger";
import { t }             from "#i18n";
import { pathToFileURL } from "url";
import { PATHS }         from "#config";
import { buildSetupApi } from "#manyapi";
import type { Client }   from "#wwjs";

export interface PluginEntry {
  name: string;
  status: "active" | "disabled" | "error";
  run: ((ctx: unknown) => Promise<void>) | null;
  setup: ((ctx: unknown) => Promise<void>) | null;
  exports: unknown;
  error: Error | null;
  guardOptions: Record<string, unknown>;
}

const PLUGINS_DIR = path.join(PATHS.HOME, "plugins");

/**
 * Each entry in registry:
 * {
 *   name:    string,
 *   status:  "active" | "disabled" | "error",
 *   run:     async function({ msg, chat, api }) — plugin default function
 *   exports: any — what plugin exposed via `export const api = { ... }`
 *   error:   Error | null
 * }
 *
 */
export const pluginRegistry = new Map<string, PluginEntry>();

/**
 * Load all active plugins listed in `activePlugins`.
 * Called once during bot initialization.
 *
 * @param {string[]} activePlugins — active plugin names (from .conf)
 */
export async function loadPlugins(activePlugins: string[]): Promise<void> {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  for (const name of activePlugins) {
    await loadPlugin(name);
  }

  const total   = pluginRegistry.size;
  const ativos  = [...pluginRegistry.values()].filter(p => p.status === "active").length;
  const erros   = total - ativos;

  logger.success(t("system.pluginsLoaded", {
    count: ativos,
    errors: erros ? t("system.pluginsLoadedWithErrors", { count: erros }) : ""
  }));
}

/**
 * Call setup(api) on all plugins that export it.
 * Executed once after bot connects to WhatsApp.
 *
 * @param {object} api — api without message context (only sendTo, log, schedule...)
 */
export async function setupPlugins(client: Client): Promise<void> {
  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active" || !plugin.setup)
      continue;
  
    try {
      const api = buildSetupApi(
        client,
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
  ]
    .filter(
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
 * Carrega um único plugin pelo nome.
 * @param {string} name
 */
async function loadPlugin(name: string): Promise<void> {
  const pluginPath = await findPluginPath(name);
  if (!pluginPath) {
    logger.warn(t("system.pluginNotFound", { name, path: path.join(PLUGINS_DIR, name) as unknown as string }));
    pluginRegistry.set(name, { name, status: "disabled", run: null, setup: null, exports: null, error: null, guardOptions: {} });
    return;
  }

  if (!fs.existsSync(pluginPath)) {
    logger.warn(t("system.pluginNotFound", { name, path: pluginPath }));
    pluginRegistry.set(name, { name, status: "disabled", run: null, setup: null, exports: null, error: null, guardOptions: {} });
    return;
  }

  try {
    const mod = await import(pathToFileURL(pluginPath).href);

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
    });

    logger.info(t("system.pluginLoaded", { name }));
  } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
    logger.error(t("system.pluginLoadFailed", { name, message: err.message }));
    pluginRegistry.set(name, { name, status: "error", run: null, setup: null, exports: null, error: err, guardOptions: {} });
  }
}

export async function cleanupPlugins(): Promise<void> {
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
