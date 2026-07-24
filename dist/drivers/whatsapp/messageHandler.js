/**
 * drivers/whatsapp/messageHandler.ts
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
import { CHATS } from "#config";
import { buildApi, buildChatFromMsg } from "./api/index.js";
import { pluginRegistry } from "#kernel/pluginLoader.js";
import { runPlugin } from "#kernel/pluginGuard.js";
import { normalizeJid, toPresenceCapable } from "./sdk/baileysSock.js";
const INCOMING_DEBOUNCE_MS = 0;
const lastProcessedAt = new Map();
// ── Dedup of already-processed messages ────────────────────────────────────
// WhatsApp resends messages without a delivery/read confirmation (the
// protocol's own retry, usually up to 3 times) when the socket reconnects.
// Without this, the same msg.key.id would arrive again as "notify" and be
// reprocessed.
const SEEN_TTL_MS = 10 * 60 * 1000; // 10 min is enough for WA's retries
const seenMessageIds = new Map();
function alreadyProcessed(id) {
    if (!id)
        return false;
    const now = Date.now();
    // lazy cleanup of expired entries
    for (const [key, ts] of seenMessageIds) {
        if (now - ts > SEEN_TTL_MS)
            seenMessageIds.delete(key);
    }
    if (seenMessageIds.has(id))
        return true;
    seenMessageIds.set(id, now);
    return false;
}
/**
 * @param {WAProtoMsg} msg   - raw Baileys message
 * @param {WASocket}   sock
 * @param {WAStore}    store
 */
export async function handleMessage(msg, sock, store) {
    const rawJid = msg.key.remoteJid ?? "";
    const jid = normalizeJid(rawJid);
    if (CHATS.length > 0 && !CHATS.includes(jid)) {
        return;
    }
    if (alreadyProcessed(msg.key.id)) {
        return;
    }
    // Mark as read/delivered to reduce the chance WhatsApp resends it
    sock.readMessages?.([msg.key]).catch(() => { });
    // Debounce rapid bursts per chat
    if (INCOMING_DEBOUNCE_MS > 0) {
        const now = Date.now();
        const last = lastProcessedAt.get(jid) ?? 0;
        const gap = now - last;
        if (gap < INCOMING_DEBOUNCE_MS) {
            const wait = INCOMING_DEBOUNCE_MS - gap;
            await new Promise(r => setTimeout(r, wait));
        }
        lastProcessedAt.set(jid, Date.now());
    }
    // Build a WAChat adapter from the message metadata
    const chat = await buildChatFromMsg(msg, store, sock);
    for (const plugin of pluginRegistry.values()) {
        const ctx = buildApi({
            msg,
            chat,
            sock,
            store,
            pluginRegistry,
            pluginName: plugin.name,
            guardOptions: plugin.guardOptions,
        });
        const useTyping = plugin.guardOptions?.typing !== false;
        let typingInterval;
        if (useTyping) {
            // Refresh presence every 4s so WhatsApp doesn't auto-clear it
            typingInterval = setInterval(() => {
                toPresenceCapable(sock).setPresence(rawJid, "composing").catch(() => { });
            }, 4000);
        }
        try {
            await runPlugin(plugin, ctx);
        }
        finally {
            if (useTyping) {
                clearInterval(typingInterval);
                toPresenceCapable(sock).setPresence(rawJid, "paused").catch(() => { });
            }
        }
    }
}
