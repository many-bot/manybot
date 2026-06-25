/**
 * messageHandler.js
 *
 * Central pipeline for received messages.
 *
 * Order:
 *   1. Filter allowed chats (CHATS from .conf)
 *      — if CHATS is empty, accepts all chats
 *   2. Per-chat incoming debounce (prevents command spam from
 *      saturating the outbound send queue)
 *   3. Log the message
 *   4. Pass context to all active plugins
 *
 * Kernel knows no commands — only distributes.
 * Each plugin decides on its own whether to act or ignore.
 *
 * Per-plugin overrides (via plugin.guardOptions):
 *   typing {boolean}  — set to `false` to skip the typing indicator
 *                       and clearState for this plugin. Useful for
 *                       plugins that reply instantly (e.g. sticker)
 *                       where the typing state only adds latency.
 */
import { CHATS }           from "#config";
import { getChatId }       from "#utils/getChatId";
import { buildApi }        from "#manyapi";
import { pluginRegistry }  from "#kernel/pluginLoader";
import { runPlugin }       from "#kernel/pluginGuard";
import client              from "#client/whatsappClient";
import { logger }          from "#logger";

/**
 * Minimum ms between processing two messages from the same chat.
 * Does NOT drop messages — debounces rapid bursts so plugins
 * aren't invoked faster than the send guard can pace their replies.
 * Set to 0 to disable.
 */
const INCOMING_DEBOUNCE_MS = 300;

/** chatId → timestamp of last processed message */
const lastProcessedAt = new Map();

export async function handleMessage(msg) {
  const chat = await msg.getChat();
  const chatId = getChatId(chat);

  if (CHATS.length > 0 && !CHATS.includes(chatId))
    return;

  if (INCOMING_DEBOUNCE_MS > 0) {
    const now = Date.now();
    const last = lastProcessedAt.get(chatId) ?? 0;
    const gap = now - last;
    if (gap < INCOMING_DEBOUNCE_MS) {
      const wait = INCOMING_DEBOUNCE_MS - gap;
      logger.debug(`[messageHandler] ${chatId} delayed ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
    lastProcessedAt.set(chatId, Date.now());
  }

  for (const plugin of pluginRegistry.values()) {
    const ctx = buildApi({
      msg,
      chat,
      client,
      pluginRegistry,
      pluginName: plugin.name,
    });

    const useTyping = plugin.guardOptions?.typing !== false;
    let typing;

    if (useTyping) {
      typing = setInterval(() => chat.sendStateTyping(), 4000);
    }

    try {
      await runPlugin(plugin, ctx);
    } finally {
      if (useTyping) {
        clearInterval(typing);
        try {
          await chat.clearState();
        } catch {}
      }
    }
  }
}
