/**
 * main.js
 *
 * Ponto de entrada do ManyBot.
 * Inicializa o cliente WhatsApp e carrega os plugins.
 */

import client               from "./client/whatsappClient.js";
import { handleMessage }    from "./kernel/messageHandler.js";
import { loadPlugins }      from "./kernel/pluginLoader.js";
import { logger }           from "./logger/logger.js";
import { PLUGINS }          from "./config.js";

logger.info("Iniciando ManyBot...\n");

// Rede de segurança global — nenhum erro deve derrubar o bot
process.on("uncaughtException", (err) => {
  logger.error(`uncaughtException — ${err.message}`, `\n             Stack: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`unhandledRejection — ${msg}`);
});

// Carrega plugins antes de conectar
await loadPlugins(PLUGINS);

client.on("message_create", async (msg) => {
  try {
    await handleMessage(msg);
  } catch (err) {
    logger.error(
      `Falha ao processar — ${err.message}`,
      `\n             Stack: ${err.stack?.split("\n")[1]?.trim() ?? ""}`
    );
  }
});

client.initialize();
console.log("\n");
logger.info("Cliente inicializado. Aguardando conexão com WhatsApp...");