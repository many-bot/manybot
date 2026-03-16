import { CHATS, BOT_PREFIX }    from "../config.js";
import { getChatId }            from "../utils/getChatId.js";
import { processarComando }     from "../commands/index.js";
import { coletarMidia }         from "../commands/logic/figurinha.js";
import { processarJogo }        from "../commands/logic/games/adivinhacao.js";
import { buildMessageContext }  from "../logger/messageContext.js";
import { logger }               from "../logger/logger.js";

/**
 * Pipeline de processamento de uma mensagem recebida.
 * Ordem: filtro de chat → log → mídia → comando → jogo.
 *
 * @param {import("whatsapp-web.js").Message} msg
 */
export async function handleMessage(msg) {
  const chat   = await msg.getChat();
  const chatId = getChatId(chat);

  if (!CHATS.includes(chatId)) return;

  const ctx = await buildMessageContext(msg, chat, BOT_PREFIX);
  logger.msg(ctx);

  await coletarMidia(msg);
  await processarComando(msg, chat, chatId);
  await processarJogo(msg, chat);

  logger.done("message_create", `de +${ctx.senderNumber}`);
}