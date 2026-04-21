/**
 * pluginLoader.js
 *
 * Responsible for:
 *   1. Reading active plugins from manybot.conf (PLUGINS=[...])
 *   2. Loading each plugin from /plugins folder
 *   3. Registering in pluginRegistry with status and public exports
 *   4. Exposing pluginRegistry to kernel and pluginApi
 *
 */

import fs   from "fs";
import path from "path";
import { logger } from "../logger/logger.js";
import { t }      from "../i18n/index.js";

const PLUGINS_DIR = path.resolve("src/plugins");

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
 * @type {Map<string, object>}
 */
export const pluginRegistry = new Map();

/**
 * Load all active plugins listed in `activePlugins`.
 * Called once during bot initialization.
 *
 * @param {string[]} activePlugins — active plugin names (from .conf)
 */
export async function loadPlugins(activePlugins) {
  if (!fs.existsSync(PLUGINS_DIR)) {
    logger.warn(t("system.pluginsFolderNotFound"));
    return;
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
export async function setupPlugins(api) {
  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active" || !plugin.setup) continue;
    try {
      await plugin.setup(api);
    } catch (err) {
      logger.error(t("system.pluginSetupFailed", { name: plugin.name, message: err.message }));
    }
  }
}

/**
 * Carrega um único plugin pelo nome.
 * @param {string} name
 */
async function loadPlugin(name) {
  const pluginPath = path.join(PLUGINS_DIR, name, "index.js");

  if (!fs.existsSync(pluginPath)) {
    logger.warn(t("system.pluginNotFound", { name, path: pluginPath }));
    pluginRegistry.set(name, { name, status: "disabled", run: null, exports: null, error: null });
    return;
  }

  try {
    const mod = await import(pluginPath);

    // Plugin must export a default function — this is called on every message
    if (typeof mod.default !== "function") {
      throw new Error(`Plugin "${name}" does not export a default function`);
    }

    pluginRegistry.set(name, {
      name,
      status:  "active",
      run:     mod.default,
      setup:   mod.setup ?? null,     // opcional — chamado uma vez na inicialização
      exports: mod.api ?? null,
      error:   null,
    });

    logger.info(t("system.pluginLoaded", { name }));
  } catch (err) {
    logger.error(t("system.pluginLoadFailed", { name, message: err.message }));
    pluginRegistry.set(name, { name, status: "error", run: null, exports: null, error: err });
  }
}