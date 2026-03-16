import { parseCommand }    from "./parser.js";
import { commandRegistry } from "./registry.js";
import { logger }          from "../logger/logger.js";
import { botMsg }          from "../utils/botMsg.js";

/**
 * Roteia a mensagem para o handler correto.
 * Não conhece nenhum comando — apenas delega.
 */
export async function processarComando(msg, chat, chatId) {
  const { cmd, args, valid } = parseCommand(msg.body);

  if (!valid) return;

  const handler = commandRegistry.get(cmd);

  if (!handler) {
    logger.warn(`Comando desconhecido: ${cmd}`);
    return;
  }

  logger.cmd(cmd);

  try {
    await handler(msg, chat, chatId, args);
  } catch (err) {
    logger.error(`Falha em ${cmd} — ${err.message}`);
    await chat.sendMessage(botMsg(
      "❌ Algo deu errado ao executar esse comando.\n" +
      "Tente novamente em instantes."
    ));
  }
}