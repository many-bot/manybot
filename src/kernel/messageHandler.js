/**
 * messageHandler.js
 *
 * Central pipeline for received messages.
 *
 * Order:
 *   1. Filter allowed chats (CHATS from .conf)
 *      — if CHATS is empty, accepts all chats
 *   2. Log the message
 *   3. Pass context to all active plugins
 *
 * Kernel knows no commands — only distributes.
 * Each plugin decides on its own whether to act or ignore.
 */

import { CHATS }  from "#config";
import { getChatId }           from "#utils/getChatId";
import { buildApi }            from "#manyapi";
import { pluginRegistry }      from "#kernel/pluginLoader";
import { runPlugin }           from "#kernel/pluginGuard";
import client                  from "#client/whatsappClient";

export async function handleMessage(msg) {
  const chat = await msg.getChat();
  const chatId = getChatId(chat);

  if (CHATS.length > 0 && !CHATS.includes(chatId)) return;

  const baseCtx = buildApi({ msg, chat, client, pluginRegistry });

  for (const plugin of pluginRegistry.values()) {
    const ctx = { ...baseCtx, storage: buildStorageApi(plugin.name) };
    await runPlugin(plugin, ctx);
  }
}
