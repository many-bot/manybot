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
 *
 * PR1 of the whatsmeow-fallback refactor (see AUDIT_BAILEYS_LEAK.md):
 * this module no longer imports from `@whiskeysockets/baileys`. The
 * Baileys-specific shapes (WAMessage, Chat, Contact) are re-exported
 * from src/drivers/baileys/sdk/baileysSock.ts as the driver-local
 * aliases RawMessage, RawChat, RawContact — the rest of the codebase
 * (this module included) sees only those neutral names, so the
 * @whiskeysockets/baileys import line never leaks past the driver
 * boundary.
 */

import type {
  RawMessage, RawChat, RawContact, RawStoreContact,
  RawEventEmitter,
} from "#drivers/baileys/sdk/baileysSock.js";
import { normalizeJid } from "#drivers/jid.js";

// ── Store types ───────────────────────────────────────────────────────────────

export interface StoreChat {
  id:                    string;
  name:                  string;
  /**
   * Disappearing-message timer (seconds) for this chat. `0` means the
   * timer was explicitly cleared (or never set). Kept on StoreChat so
   * the Baileys adapter can pick the right `ephemeralExpiration` option
   * for every outgoing send without having to look it up again, and so
   * the value survives a snapshot round-trip (see `toJSON` / `hydrate`).
   */
  ephemeralExpiration:   number;
}

/**
 * Plain-data snapshot of the store (chats, contacts, learned @lid↔PN
 * mappings) — no live messages, those aren't cached. Used to persist to
 * disk (client/cache.ts) and to hydrate a fresh store from that cache.
 */
export interface StoreSnapshot {
  chats:    StoreChat[];
  contacts: Record<string, RawStoreContact>;
  lidMap:   [string, string][];
  /**
   * Reverse-direction mapping (PN → LID). Newer snapshots include this
   * directly; older snapshots are reconstructed from `lidMap` during
   * `hydrate()` so saved data stays valid across this change.
   */
  pnMap?:   [string, string][];
}

export interface BotStore {
  /** Map of JID → StoreChat */
  readonly chats: {
    get(id: string): StoreChat | null;
    all(): StoreChat[];
  };
  /** Plain record of JID → contact metadata */
  readonly contacts: Record<string, RawStoreContact>;
  /**
   * Messages stored per JID.
   * Access: `store.messages.get(jid)?.get(msgId)`
   */
  readonly messages: Map<string, Map<string, RawMessage>>;
  /**
   * Resolve a `@lid` JID to the traditional `@s.whatsapp.net` JID when a
   * mapping has been learned (from contacts or message keys). Returns the
   * input unchanged if it's not a `@lid` JID or no mapping is known yet.
   */
  resolveJid(jid: string): string;
  /**
   * Record (or overwrite) a `@lid` → phone-based JID mapping from a source
   * external to the store's own event listeners — e.g. a live
   * `groupMetadata()` lookup, which carries WhatsApp's own current
   * `phoneNumber` for a participant and is more trustworthy than a mapping
   * heuristically learned from a past, possibly unrelated message. No-op if
   * `lid` isn't a `@lid` JID or `pn` is empty/also a `@lid`.
   */
  learnLid(lid?: string | null, pn?: string | null): void;
  /**
   * Discard a previously-learned `@lid` → phone-based JID mapping.
   * Use when a resolution is later proven wrong (e.g. a `@lid` that got
   * reassigned to a different WhatsApp account than the one the store
   * learned it as) — removing the stale entry lets it be relearned
   * correctly instead of permanently serving the wrong contact. No-op if
   * `lid` isn't currently mapped.
   */
  forgetLid(lid: string): void;
  /**
   * Resolve a traditional `@s.whatsapp.net` JID to its `@lid` JID when a
   * mapping has been learned. Returns the input unchanged if it's not a known
   * `@s.whatsapp.net` JID or no mapping is known yet.
   */
  resolvePn(pn: string): string | null;
  /**
   * Record the disappearing-message timer for a chat learned from a
   * source outside the store's own event listeners — e.g. a live
   * `groupMetadata()` lookup, which carries WhatsApp's own current
   * `ephemeralDuration` for a group and is more trustworthy than a
   * timer heuristically learned from a past, possibly unrelated message.
   * `seconds` of `0` clears the timer.
   */
  setChatEphemeralExpiration(jid: string, seconds: number): void;
  /**
   * Bind the store to a driver's event emitter.
   * Must be called immediately after socket creation.
   */
  bind(ev: RawEventEmitter): void;
  /** Plain-data snapshot for persisting to disk (client/cache.ts). */
  toJSON(): StoreSnapshot;
  /** Merge a previously-saved snapshot into this store. */
  hydrate(snapshot: StoreSnapshot): void;
}

// Re-export driver-local shapes so consumers (including src/types.ts)
// don't have to import from src/drivers/baileys/ directly.
export type { RawMessage, RawChat, RawContact, RawStoreContact, RawEventEmitter };

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new BotStore instance.
 * One store is shared across reconnects — bind it to each new socket.
 */
export function createStore(): BotStore {
  const chatsMap    = new Map<string, StoreChat>();
  const contacts: Record<string, RawStoreContact> = {};
  const messages    = new Map<string, Map<string, RawMessage>>();
  // @lid JID → traditional @s.whatsapp.net JID, learned from contact and
  // message-key pairs (Baileys exposes both forms during the LID rollout).
  const lidMap      = new Map<string, string>();
  // traditional @s.whatsapp.net JID → @lid JID, reverse mapping for lookups.
  const pnMap       = new Map<string, string>();

  function learnLid(lid?: string | null, pn?: string | null) {
    if (lid && pn && lid.endsWith("@lid") && !pn.endsWith("@lid")) {
      // lidMap keeps the wire-format value as given — resolveJid()
      // consumers (e.g. adapter.ts building self/participant candidates
      // via jidNormalizedUser) expect the raw "@s.whatsapp.net" shape.
      lidMap.set(lid, pn);
      // pnMap's key is canonicalized to ManyBot's internal "@c.us" form
      // so a lookup matches regardless of which format the caller has on
      // hand — callers deep in the driver (adapter.ts) query it with raw
      // wire JIDs, while callers in the plugin-facing API (index.ts) query
      // it with already-normalized JIDs. Without this, pn entries learned
      // in one format silently never matched a resolvePn() call made in
      // the other.
      pnMap.set(normalizeJid(pn), lid);
    }
  }

  function resolveJid(jid: string): string {
    if (!jid || !jid.endsWith("@lid")) return jid;
    return lidMap.get(jid) ?? jid;
  }

  function forgetLid(lid: string): void {
    const pn = lidMap.get(lid);
    if (pn) pnMap.delete(normalizeJid(pn));
    lidMap.delete(lid);
  }

  function resolvePn(pn: string): string | null {
    if (!pn) return null;
    return pnMap.get(normalizeJid(pn)) ?? null;
  }

  // Coerce the various shapes Baileys delivers `ephemeralExpiration` in
  // (string-numbered from the wire, `null` when the timer was cleared,
  // or absent entirely) into a plain finite number. Anything we can't
  // parse becomes 0 — the wire convention for "no disappearing timer".
  function normalizeExpiration(raw: unknown): number {
    if (raw === null || raw === undefined) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function setChatEphemeralExpiration(jid: string, seconds: number): void {
    if (!jid) return;
    const existing = chatsMap.get(jid);
    const next     = normalizeExpiration(seconds);
    if (existing) {
      existing.ephemeralExpiration = next;
    } else {
      chatsMap.set(jid, { id: jid, name: jid.split("@")[0], ephemeralExpiration: next });
    }
  }

  // Max messages kept per chat (prevents unbounded memory growth)
  const MAX_MSGS_PER_CHAT = 200;

  function upsertChat(chat: RawChat) {
    if (!chat.id) return;
    const name = (chat as unknown as { name?: string }).name ?? chat.id.split("@")[0];
    const rawExp = (chat as unknown as { ephemeralExpiration?: unknown }).ephemeralExpiration;
    const existing = chatsMap.get(chat.id);
    chatsMap.set(chat.id, {
      id:                  chat.id,
      name,
      // Preserve a previously-learned timer if this upsert doesn't carry
      // one (chats.upsert often ships without ephemeralExpiration — the
      // value arrives later via chats.update or an ephemeralMessage).
      ephemeralExpiration: rawExp !== undefined ? normalizeExpiration(rawExp) : (existing?.ephemeralExpiration ?? 0),
    });
  }

  function upsertContact(contact: RawContact) {
    // Don't let a later, poorer sync round (e.g. a bare history-sync stub)
    // blank out a name/notify/verifiedName we already learned from an
    // earlier, richer one (e.g. a live message's pushName) — only accept
    // a field when this contact object actually carries it.
    const existing = contacts[contact.id];
    contacts[contact.id] = {
      id:           contact.id,
      name:         contact.name ?? existing?.name,
      notify:       contact.notify ?? existing?.notify,
      verifiedName: contact.verifiedName ?? existing?.verifiedName,
    };
    // Baileys' Contact carries both the traditional JID (id) and the LID
    // (lid) once known — learn the mapping either direction.
    const lidField = (contact as unknown as { lid?: string }).lid;
    learnLid(lidField, contact.id);
    learnLid(contact.id, lidField);
  }

  function storeMessage(msg: RawMessage) {
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

  // pushName only ever arrives on a message stanza (live or synced history)
  // — contact/history-contact sync alone won't give us a name for someone
  // who never messaged and isn't a saved contact. Shared by both
  // "messages.upsert" (live) and "messaging-history.set" (backfill on
  // connect), since history-sync messages carry the same field.
  function capturePushNames(msgs: RawMessage[]) {
    for (const msg of msgs) {
      const key = msg.key as unknown as { participant?: string; participantAlt?: string; remoteJid?: string; remoteJidAlt?: string };
      learnLid(key.participantAlt, key.participant);
      learnLid(key.remoteJidAlt, key.remoteJid);

      const pushName = (msg as unknown as { pushName?: string }).pushName;
      const senderId  = key.participant ?? msg.key.remoteJid;
      if (pushName && senderId && !msg.key.fromMe && !senderId.endsWith("@g.us")) {
        const existing = contacts[senderId];
        if (existing?.notify !== pushName) {
          contacts[senderId] = { ...existing, id: senderId, notify: pushName };
        }
      }
    }
  }

  function bind(ev: RawEventEmitter) {
    ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
      for (const chat of chats) upsertChat(chat);
      for (const contact of contacts) upsertContact(contact);
      // Backfilled messages carry pushName too — was previously dropped,
      // leaving contacts unresolved until they next messaged live.
      if (messages?.length) capturePushNames(messages as unknown as RawMessage[]);
    });

    ev.on("chats.upsert", (newChats) => {
      for (const chat of newChats) upsertChat(chat);
    });

    ev.on("chats.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = chatsMap.get(update.id);
        if (!existing) continue;
        const u = update as unknown as { name?: string; ephemeralExpiration?: unknown };
        if (u.name) existing.name = u.name;
        // Baileys sends `ephemeralExpiration: null` to signal the timer
        // was cleared — store 0 in that case so a later `chats.update`
        // carrying a positive value can take over again.
        if ("ephemeralExpiration" in u) {
          existing.ephemeralExpiration = normalizeExpiration(u.ephemeralExpiration);
        }
      }
    });

    ev.on("contacts.upsert", (newContacts) => {
      for (const contact of newContacts) upsertContact(contact);
    });

    ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        contacts[update.id] = { ...contacts[update.id], ...update };
        const lidField = (update as unknown as { lid?: string }).lid;
        learnLid(lidField, update.id);
        learnLid(update.id, lidField);
      }
    });

    ev.on("messages.upsert", ({ messages: msgs }) => {
      for (const msg of msgs) {
        storeMessage(msg);
        // Disappearing-message timer: when a message arrives wrapped in
        // an `ephemeralMessage`, the inner contextInfo carries the
        // per-message timer WhatsApp negotiated for the chat. Promote
        // it to the chat-level entry so subsequent sends can pick it up
        // without re-scanning every message.
        const m = msg.message as
          | { ephemeralMessage?: { message?: { extendedTextMessage?: { contextInfo?: { expiration?: unknown } } } } }
          | undefined;
        const expiration = m?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo?.expiration;
        if (expiration !== undefined && msg.key.remoteJid) {
          setChatEphemeralExpiration(msg.key.remoteJid, normalizeExpiration(expiration));
        }
      }
      capturePushNames(msgs);
    });

    ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.remoteJid || !key.id) continue;
        const existing = messages.get(key.remoteJid)?.get(key.id);
        if (!existing) continue;

        // Poll votes: pollUpdates on this event are only the NEW entries,
        // not the full history — must be accumulated, never overwritten,
        // or getAggregateVotesInPollMessage() only ever sees the latest vote.
        const incoming = (update as unknown as { pollUpdates?: unknown[] }).pollUpdates;
        const merged = { ...existing, ...update } as unknown as { pollUpdates?: unknown[] };
        if (incoming?.length) {
          const prior = (existing as unknown as { pollUpdates?: unknown[] }).pollUpdates ?? [];
          merged.pollUpdates = [...prior, ...incoming];
        }

        messages.get(key.remoteJid)!.set(key.id, merged as unknown as RawMessage);
      }
    });
  }

  function toJSON(): StoreSnapshot {
    return {
      chats:    [...chatsMap.values()],
      contacts: { ...contacts },
      lidMap:   [...lidMap.entries()],
      pnMap:    [...pnMap.entries()],
    };
  }

  function hydrate(snapshot: StoreSnapshot) {
    for (const chat of snapshot.chats ?? []) chatsMap.set(chat.id, chat);
    for (const [id, contact] of Object.entries(snapshot.contacts ?? {})) {
      contacts[id] = { ...contacts[id], ...contact };
    }
    // learnLid() always mirrors into both lidMap and pnMap, so replaying
    // snapshot.lidMap alone fully reconstructs pnMap too — every pnMap
    // entry has a corresponding lidMap entry, they're never written
    // independently. snapshot.pnMap itself is redundant to replay here:
    // it exists only so `toJSON()`'s output is self-describing/inspectable,
    // and re-learning from it a second time would re-derive pnMap's key
    // (already-canonicalized "@c.us" form) as if it were lidMap's raw
    // wire-format value, corrupting the wire-format invariant lidMap's
    // consumers (e.g. adapter.ts) depend on.
    for (const [lid, pn] of snapshot.lidMap ?? []) learnLid(lid, pn);
  }

  return {
    chats: {
      get:  (id) => chatsMap.get(id) ?? null,
      all:  ()   => [...chatsMap.values()],
    },
    contacts,
    messages,
    resolveJid,
    learnLid,
    forgetLid,
    resolvePn,
    setChatEphemeralExpiration,
    bind,
    toJSON,
    hydrate,
  };
}

