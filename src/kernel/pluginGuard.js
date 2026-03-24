/**
 * pluginGuard.js
 *
 * Executa um plugin com segurança.
 * Se o plugin lançar um erro:
 *   - Loga o erro com contexto
 *   - Marca o plugin como "error" no registry
 *   - Nunca derruba o bot
 *
 * Plugins desativados ou com erro são ignorados silenciosamente.
 */

import { logger }         from "../logger/logger.js";
import { pluginRegistry } from "./pluginLoader.js";

/**
 * @param {object} plugin   — entrada do pluginRegistry
 * @param {object} context  — { msg, chat, api }
 */
export async function runPlugin(plugin, context) {
  if (plugin.status !== "active") return;

  try {
    await plugin.run(context);
  } catch (err) {
    // Desativa o plugin para não continuar quebrando
    plugin.status = "error";
    plugin.error  = err;
    pluginRegistry.set(plugin.name, plugin);

    logger.error(
      `Plugin "${plugin.name}" desativado após erro: ${err.message}`,
      `\n             Stack: ${err.stack?.split("\n")[1]?.trim() ?? ""}`
    );
  }
}