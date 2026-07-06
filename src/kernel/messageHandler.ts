/**
 * messageHandler.ts
 *
 * Central pipeline for received messages.
 *
 * Order:
 *   1. Filter allowed chats (CHATS from config)
 *      — if CHATS is empty, accepts all chats
 *   2. Per-chat incoming debounce (prevents command spam from
 *      saturating the outbound send queue)
 *   3. Pass context to all active plugins
 *
 * Kernel knows no commands — only distributes.
 * Each plugin decides on its own whether to act or ignore.
 *
 * Per-plugin overrides (via plugin.guardOptions):
 *   typing {boolean}  — set to `false` to skip presence simulation
 */

import type { WAProtoMsg, WASocket, WAStore, WAChat } from "#types";
import { CHATS }              from "#config";
import { buildApi,
         buildChatFromMsg }  from "#manyapi";
import { pluginRegistry }     from "#kernel/pluginLoader";
import { runPlugin }          from "#kernel/pluginGuard";
import { logger }             from "#logger";
import { normalizeJid, toPresenceCapable } from "#client/baileysSock";
import { simulateState,
         typingDuration }     from "#sendguard";

const INCOMING_DEBOUNCE_MS = 300;
const lastProcessedAt = new Map<string, number>();

/**
 * @param {WAProtoMsg} msg    — raw Baileys message
 * @param {WASocket}   sock
 * @param {WAStore}    store
 */
export async function handleMessage(msg: WAProtoMsg, sock: WASocket, store: WAStore): Promise<void> {
  const rawJid = msg.key.remoteJid ?? "";
  const jid    = normalizeJid(rawJid);

  if (CHATS.length > 0 && !CHATS.includes(jid)) return;

  // Debounce rapid bursts per chat
  if (INCOMING_DEBOUNCE_MS > 0) {
    const now  = Date.now();
    const last = lastProcessedAt.get(jid) ?? 0;
    const gap  = now - last;
    if (gap < INCOMING_DEBOUNCE_MS) {
      const wait = INCOMING_DEBOUNCE_MS - gap;
      logger.debug(`[messageHandler] ${jid} delayed ${wait}ms`);
      await new Promise<void>(r => setTimeout(r, wait));
    }
    lastProcessedAt.set(jid, Date.now());
  }

  // Build a WAChat adapter from the message metadata
  const chat: WAChat = buildChatFromMsg(msg, store);

  for (const plugin of pluginRegistry.values()) {
    const ctx = buildApi({
      msg,
      chat,
      sock,
      store,
      pluginRegistry,
      pluginName:   plugin.name,
      guardOptions: plugin.guardOptions,
    });

    const useTyping = plugin.guardOptions?.typing !== false;
    let typingInterval: ReturnType<typeof setInterval> | undefined;

    if (useTyping) {
      // Refresh presence every 4s so WhatsApp doesn't auto-clear it
      typingInterval = setInterval(() => {
        toPresenceCapable(sock).setPresence!(rawJid, "composing").catch(() => {});
      }, 4000);
    }

    try {
      await runPlugin(plugin, ctx);
    } finally {
      if (useTyping) {
        clearInterval(typingInterval);
        toPresenceCapable(sock).setPresence!(rawJid, "paused").catch(() => {});
      }
    }
  }
}
