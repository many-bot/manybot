/**
 * messageHandler.js
 *
 * Pipeline central de uma mensagem recebida.
 *
 * Ordem:
 *   1. Filtra chats não permitidos (CHATS do .conf)
 *      — se CHATS estiver vazio, aceita todos os chats
 *   2. Loga a mensagem
 *   3. Passa o contexto para todos os plugins ativos
 *
 * O kernel não conhece nenhum comando — só distribui.
 * Cada plugin decide por conta própria se age ou ignora.
 */

import { CHATS }  from "../config.js";
import { getChatId }           from "../utils/getChatId.js";
import { buildApi }            from "./pluginApi.js";
import { pluginRegistry }      from "./pluginLoader.js";
import { runPlugin }           from "./pluginGuard.js";
import { buildMessageContext } from "../logger/messageContext.js";
import { logger }              from "../logger/logger.js";
import client                  from "../client/whatsappClient.js";

export async function handleMessage(msg) {
  const chat   = await msg.getChat();
  const chatId = getChatId(chat);

  // CHATS vazio = aceita todos os chats
  if (CHATS.length > 0 && !CHATS.includes(chatId)) return;

  const ctx = await buildMessageContext(msg, chat);
  logger.msg(ctx);

  const api     = buildApi({ msg, chat, client, pluginRegistry });
  const context = { msg: api.msg, chat: api.chat, api };

  for (const plugin of pluginRegistry.values()) {
    await runPlugin(plugin, context);
  }

  logger.done("message_create", `de +${ctx.senderNumber}`);
}