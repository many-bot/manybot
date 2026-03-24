/**
 * pluginLoader.js
 *
 * Responsável por:
 *   1. Ler quais plugins estão ativos no manybot.conf (PLUGINS=[...])
 *   2. Carregar cada plugin da pasta /plugins
 *   3. Registrar no pluginRegistry com status e exports públicos
 *   4. Expor o pluginRegistry para o kernel e para a pluginApi
 */

import fs   from "fs";
import path from "path";
import { logger } from "../logger/logger.js";

const PLUGINS_DIR = path.resolve("src/plugins");

/**
 * Cada entrada no registry:
 * {
 *   name:    string,
 *   status:  "active" | "disabled" | "error",
 *   run:     async function({ msg, chat, api }) — a função default do plugin
 *   exports: any — o que o plugin expôs via `export const api = { ... }`
 *   error:   Error | null
 * }
 *
 * @type {Map<string, object>}
 */
export const pluginRegistry = new Map();

/**
 * Carrega todos os plugins ativos listados em `activePlugins`.
 * Chamado uma vez na inicialização do bot.
 *
 * @param {string[]} activePlugins — nomes dos plugins ativos (do .conf)
 */
export async function loadPlugins(activePlugins) {
  if (!fs.existsSync(PLUGINS_DIR)) {
    logger.warn("Pasta /plugins não encontrada. Nenhum plugin carregado.");
    return;
  }

  for (const name of activePlugins) {
    await loadPlugin(name);
  }

  const total   = pluginRegistry.size;
  const ativos  = [...pluginRegistry.values()].filter(p => p.status === "active").length;
  const erros   = total - ativos;

  logger.success(`Plugins carregados: ${ativos} ativos${erros ? `, ${erros} com erro` : ""}`);
}

/**
 * Carrega um único plugin pelo nome.
 * @param {string} name
 */
async function loadPlugin(name) {
  const pluginPath = path.join(PLUGINS_DIR, name, "index.js");

  if (!fs.existsSync(pluginPath)) {
    logger.warn(`Plugin "${name}" não encontrado em ${pluginPath}`);
    pluginRegistry.set(name, { name, status: "disabled", run: null, exports: null, error: null });
    return;
  }

  try {
    const mod = await import(pluginPath);

    // O plugin deve exportar uma função default — essa é a função chamada a cada mensagem
    if (typeof mod.default !== "function") {
      throw new Error(`Plugin "${name}" não exporta uma função default`);
    }

    pluginRegistry.set(name, {
      name,
      status:  "active",
      run:     mod.default,
      exports: mod.api ?? null,   // exports públicos opcionais (api de outros plugins)
      error:   null,
    });

    logger.info(`Plugin carregado: ${name}`);
  } catch (err) {
    logger.error(`Falha ao carregar plugin "${name}": ${err.message}`);
    pluginRegistry.set(name, { name, status: "error", run: null, exports: null, error: err });
  }
}