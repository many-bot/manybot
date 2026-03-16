import client              from "./client/whatsappClient.js";
import { handleMessage }  from "./handlers/messageHandler.js";
import { logger }         from "./logger/logger.js";

logger.info("Iniciando ManyBot...");

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
logger.info("Cliente inicializado. Aguardando conexão com WhatsApp...");