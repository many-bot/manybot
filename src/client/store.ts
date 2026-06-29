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

import type { WASocket, WAProtoMsg, WAStoreContact } from "#types";
import type { Chat, Contact } from "@whiskeysockets/baileys";

// ── Store types ───────────────────────────────────────────────────────────────

export interface StoreChat {
  id:   string;
  name: string;
}

export interface BotStore {
  /** Map of JID → StoreChat */
  readonly chats: {
    get(id: string): StoreChat | null;
    all(): StoreChat[];
  };
  /** Plain record of JID → contact metadata */
  readonly contacts: Record<string, WAStoreContact>;
  /**
   * Messages stored per JID.
   * Access: `store.messages.get(jid)?.get(msgId)`
   */
  readonly messages: Map<string, Map<string, WAProtoMsg>>;
  /**
   * Bind the store to a socket event emitter.
   * Must be called immediately after socket creation.
   */
  bind(ev: WASocket["ev"]): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new BotStore instance.
 * One store is shared across reconnects — bind it to each new socket.
 */
export function createStore(): BotStore {
  const chatsMap    = new Map<string, StoreChat>();
  const contacts: Record<string, WAStoreContact> = {};
  const messages    = new Map<string, Map<string, WAProtoMsg>>();

  // Max messages kept per chat (prevents unbounded memory growth)
  const MAX_MSGS_PER_CHAT = 200;

  function upsertChat(chat: Chat) {
    const name = (chat as unknown as { name?: string }).name ?? chat.id.split("@")[0];
    chatsMap.set(chat.id, { id: chat.id, name });
  }

  function upsertContact(contact: Contact) {
    contacts[contact.id] = {
      id:           contact.id,
      name:         contact.name,
      notify:       contact.notify,
      verifiedName: contact.verifiedName,
    };
  }

  function storeMessage(msg: WAProtoMsg) {
    const jid = msg.key.remoteJid;
    const id  = msg.key.id;
    if (!jid || !id) return;

    if (!messages.has(jid)) messages.set(jid, new Map());
    const chatMsgs = messages.get(jid)!;

    chatMsgs.set(id, msg);

    // Evict oldest entries if over limit
    if (chatMsgs.size > MAX_MSGS_PER_CHAT) {
      const oldest = chatMsgs.keys().next().value;
      if (typeof oldest === "string") chatMsgs.delete(oldest);
    }
  }

  function bind(ev: WASocket["ev"]) {
    ev.on("chats.upsert", (newChats) => {
      for (const chat of newChats) upsertChat(chat);
    });

    ev.on("chats.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = chatsMap.get(update.id);
        const name = (update as unknown as { name?: string }).name;
        if (existing && name) existing.name = name;
      }
    });

    ev.on("contacts.upsert", (newContacts) => {
      for (const contact of newContacts) upsertContact(contact);
    });

    ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        contacts[update.id] = { ...contacts[update.id], ...update };
      }
    });

    ev.on("messages.upsert", ({ messages: msgs }) => {
      for (const msg of msgs) storeMessage(msg);
    });

    ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.remoteJid || !key.id) continue;
        const existing = messages.get(key.remoteJid)?.get(key.id);
        if (existing) {
          messages.get(key.remoteJid)!.set(key.id, { ...existing, ...update });
        }
      }
    });
  }

  return {
    chats: {
      get:  (id) => chatsMap.get(id) ?? null,
      all:  ()   => [...chatsMap.values()],
    },
    contacts,
    messages,
    bind,
  };
}
