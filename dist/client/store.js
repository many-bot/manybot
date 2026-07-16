/**
 * store.ts
 *
 * Minimal in-memory store for chats, contacts, and messages.
 * Replaces the removed makeInMemoryStore from Baileys 6.7+.
 *
 * Only tracks what the ManyBot kernel actually needs:
 *   - chat names (for display and for building WAChat adapters)
 *   - contact names / notify (pushname) (for ctx.contacts)
 *   - messages by JID + ID (for poll vote decryption)
 */
// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * Create a new BotStore instance.
 * One store is shared across reconnects — bind it to each new socket.
 */
export function createStore() {
    const chatsMap = new Map();
    const contacts = {};
    const messages = new Map();
    // @lid JID → traditional @s.whatsapp.net JID, learned from contact and
    // message-key pairs (Baileys exposes both forms during the LID rollout).
    const lidMap = new Map();
    function learnLid(lid, pn) {
        if (lid && pn && lid.endsWith("@lid") && !pn.endsWith("@lid"))
            lidMap.set(lid, pn);
    }
    function resolveJid(jid) {
        if (!jid || !jid.endsWith("@lid"))
            return jid;
        return lidMap.get(jid) ?? jid;
    }
    // Max messages kept per chat (prevents unbounded memory growth)
    const MAX_MSGS_PER_CHAT = 200;
    function upsertChat(chat) {
        const name = chat.name ?? chat.id.split("@")[0];
        chatsMap.set(chat.id, { id: chat.id, name });
    }
    function upsertContact(contact) {
        contacts[contact.id] = {
            id: contact.id,
            name: contact.name,
            notify: contact.notify,
            verifiedName: contact.verifiedName,
        };
        // Baileys' Contact carries both the traditional JID (id) and the LID
        // (lid) once known — learn the mapping either direction.
        const lidField = contact.lid;
        learnLid(lidField, contact.id);
        learnLid(contact.id, lidField);
    }
    function storeMessage(msg) {
        const jid = msg.key.remoteJid;
        const id = msg.key.id;
        if (!jid || !id)
            return;
        if (!messages.has(jid))
            messages.set(jid, new Map());
        const chatMsgs = messages.get(jid);
        chatMsgs.set(id, msg);
        // Evict oldest entries if over limit
        if (chatMsgs.size > MAX_MSGS_PER_CHAT) {
            const oldest = chatMsgs.keys().next().value;
            if (typeof oldest === "string")
                chatMsgs.delete(oldest);
        }
    }
    function bind(ev) {
        ev.on("chats.upsert", (newChats) => {
            for (const chat of newChats)
                upsertChat(chat);
        });
        ev.on("chats.update", (updates) => {
            for (const update of updates) {
                if (!update.id)
                    continue;
                const existing = chatsMap.get(update.id);
                const name = update.name;
                if (existing && name)
                    existing.name = name;
            }
        });
        ev.on("contacts.upsert", (newContacts) => {
            for (const contact of newContacts)
                upsertContact(contact);
        });
        ev.on("contacts.update", (updates) => {
            for (const update of updates) {
                if (!update.id)
                    continue;
                contacts[update.id] = { ...contacts[update.id], ...update };
                const lidField = update.lid;
                learnLid(lidField, update.id);
                learnLid(update.id, lidField);
            }
        });
        ev.on("messages.upsert", ({ messages: msgs }) => {
            for (const msg of msgs) {
                storeMessage(msg);
                const key = msg.key;
                learnLid(key.participantAlt, key.participant);
                learnLid(key.remoteJidAlt, key.remoteJid);
            }
        });
        ev.on("messages.update", (updates) => {
            for (const { key, update } of updates) {
                if (!key.remoteJid || !key.id)
                    continue;
                const existing = messages.get(key.remoteJid)?.get(key.id);
                if (!existing)
                    continue;
                // Poll votes: pollUpdates on this event are only the NEW entries,
                // not the full history — must be accumulated, never overwritten,
                // or getAggregateVotesInPollMessage() only ever sees the latest vote.
                const incoming = update.pollUpdates;
                const merged = { ...existing, ...update };
                if (incoming?.length) {
                    const prior = existing.pollUpdates ?? [];
                    merged.pollUpdates = [...prior, ...incoming];
                }
                messages.get(key.remoteJid).set(key.id, merged);
            }
        });
    }
    return {
        chats: {
            get: (id) => chatsMap.get(id) ?? null,
            all: () => [...chatsMap.values()],
        },
        contacts,
        messages,
        resolveJid,
        bind,
    };
}
