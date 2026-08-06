/**
 * drivers/baileys/messageHandler.ts
 *
 * WhatsApp message pipeline.
 * Moved from kernel/messageHandler.ts to keep all WhatsApp logic together.
 *
 * Order:
 *   1. Filter allowed chats (CHATS from config)
 *   2. Per-chat incoming debounce (prevents command spam)
 *   3. Pass context to all active plugins
 *
 * Each plugin decides whether to act or ignore.
 */

import type { BotMessage } from "#drivers/types.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import { CHATS, EXCLUDE_CHATS } from "#config";
import { buildApi,
         buildChatFromMsg,
         buildMessageContext } from "./api/index.js";
import { pluginRegistry }     from "#kernel/pluginLoader.js";
import { runPlugin }          from "#kernel/pluginGuard.js";
import { acquireChatSlot }    from "#sendguard";
import { trackIncomingForContactSave } from "#kernel/contactAutoSave.js";
import { normalizeJid } from "#drivers/jid.js";

const INCOMING_DEBOUNCE_MS = 0;
const lastProcessedAt = new Map<string, number>();

// ── Dedup of already-processed messages ────────────────────────────────────
// WhatsApp resends messages without a delivery/read confirmation (the
// protocol's own retry, usually up to 3 times) when the socket reconnects.
// Without this, the same msg.key.id would arrive again as "notify" and be
// reprocessed.
const SEEN_TTL_MS = 10 * 60 * 1000; // 10 min is enough for WA's retries
const seenMessageIds = new Map<string, number>();


function alreadyProcessed(id: string | null | undefined): boolean {
  if (!id) return false;

  const now = Date.now();

  // lazy cleanup of expired entries
  for (const [key, ts] of seenMessageIds) {
    if (now - ts > SEEN_TTL_MS) seenMessageIds.delete(key);
  }

  if (seenMessageIds.has(id)) return true;

  seenMessageIds.set(id, now);
  return false;
}

/**
 * @param {BotMessage}   msg       - driver-neutral incoming message envelope
 * @param {WaContract}   contract  - driver-neutral contract (replaces WASocket)
 * @param {BotStore}     store     - in-memory store
 */
export async function handleMessage(msg: BotMessage, contract: WaContract, store: BotStore): Promise<void> {
  const rawJid = msg.chatId;
  const jid    = normalizeJid(store.resolveJid(rawJid));

  if (CHATS.length > 0 && !CHATS.includes(jid)) {
    return;
  }

  if (EXCLUDE_CHATS.includes(jid)) {
    return;
  }

  if (alreadyProcessed(msg.id)) {
    return;
  }

  // Mark as read/delivered to reduce the chance WhatsApp resends it
  // (`msg.quotedKey`/`fromLid`/`fromPn` carry the LID/PN parts so the
  // contract can reconstruct a proper key on each driver).
  const rawKey: BotMessage["quotedKey"] = msg.id ? {
    id:        msg.id,
    remoteJid: msg.chatId,
    fromMe:    false,
    participant: msg.fromPn ?? msg.fromLid ?? undefined,
  } : undefined;
  if (rawKey) {
    contract.readMessages([rawKey]).catch(() => {});
  }

  // Debounce rapid bursts per chat
  if (INCOMING_DEBOUNCE_MS > 0) {
    const now  = Date.now();
    const last = lastProcessedAt.get(jid) ?? 0;
    const gap  = now - last;
    if (gap < INCOMING_DEBOUNCE_MS) {
      const wait = INCOMING_DEBOUNCE_MS - gap;
      await new Promise<void>(r => setTimeout(r, wait));
    }
    lastProcessedAt.set(jid, Date.now());
  }

  // Build a WAChat adapter from the message metadata
  const chat = await buildChatFromMsg(msg, store, contract);

  // Gradual contact-saving (best-effort, never blocks message handling)
  const msgCtx = buildMessageContext(msg, contract, store);
  const isGroup = jid.endsWith("@g.us");
  trackIncomingForContactSave(contract, msg, msgCtx.sender, isGroup, msgCtx.hasPrefix)
    .catch(() => {});

  // Caps how many chats get answered at the same time — see SECURITY_LEVEL.
  const releaseChatSlot = await acquireChatSlot(jid);

  try {
    await runPluginsForMessage(msg, chat, contract, store, rawJid);
  } finally {
    releaseChatSlot();
  }
}

async function runPluginsForMessage(
  msg: BotMessage,
  chat: Awaited<ReturnType<typeof buildChatFromMsg>>,
  contract: WaContract,
  store: BotStore,
  rawJid: string
): Promise<void> {
  for (const plugin of pluginRegistry.values()) {
    const ctx = buildApi({
      msg,
      chat,
      contract,
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
        contract.sendPresenceUpdate("composing", rawJid).catch(() => {});
      }, 4000);
    }

    try {
      await runPlugin(plugin, ctx);
    } finally {
      if (useTyping) {
        clearInterval(typingInterval);
        contract.sendPresenceUpdate("paused", rawJid).catch(() => {});
      }
    }
  }
}
