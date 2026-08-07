/**
 * drivers/baileys/adapter.ts
 *
 * Adapter that wraps a Baileys `WASocket` (the raw, driver-specific socket)
 * and the in-memory store behind the driver-neutral `WaContract` declared
 * in src/kernel/waContract.ts.
 *
 * This is the ONLY file outside `drivers/baileys/sdk/baileysSock.ts` that
 * imports from `@whiskeysockets/baileys`. Every other module in the
 * codebase (kernel, pluginApi, pluginLoader, sendGuard, contactAutoSave,
 * messageHandler, api/index.ts) talks to the driver through this contract
 * — never imports Baileys directly.
 *
 * Responsibilities:
 *   - Convert Baileys event payloads (WAMessage, Chat, Contact) into the
 *     neutral event payloads the contract declares.
 *   - Convert BotQuotedRef / BotGroupMetadata / etc. back into the
 *     Baileys-shaped arguments each Baileys method expects.
 *   - Implement every method WaContract mandates, by delegating to the
 *     matching Baileys WASocket method.
 *
 * Returns/dispatches are pure adapters — error semantics, retries, fallbacks
 * all live elsewhere (sendFallbackGuard, sendGuard, pluginGuard).
 */

import type {
  BotMessage, BotQuotedRef,
} from "#drivers/types.js";
import type {
  WaContract, WaEventName, WaEventPayload,
  BotContactSummary, BotChatSummary,
  SentMessageRef,
} from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import type {
  RawSocket, RawMessage, RawStoreContact,
} from "./sdk/baileysSock.js";

import {
  normalizeMessageContent,
  downloadMediaMessage,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createHash } from "node:crypto";

import { logger } from "#logger";

// ── Baileys event-emitter shape ─────────────────────────────────────────────
//
// `sock.ev` is a Baileys-flavored EventEmitter wrapper (NOT a vanilla Node
// EE). It exposes `.on(string, handler)` and `.off(string, handler)` — enough
// for the adapters fan-out. Adapters never deal in WAMessage on the way out:
// they translate to the neutral payload declared in waContract.ts.

interface RawEmitter {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  off(event: string, handler: (...args: unknown[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

// ── Arg shape expected by `sock.sendMessage(jid, content, opts)` ─────────────
//
// Baileys' AnyMessageContent is a discriminated union keyed on the media
// field name; building it dynamically is the supported pattern (the same
// pattern api/index.ts already uses). The adapter's `any` is the same one
// api/index.ts already used; keeping the rest of the adapter type-clean while
// crossing this boundary is more trouble than it's worth.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMessageContent = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SendOpts = any;

// ── Adapter factory ─────────────────────────────────────────────────────────

export interface BaileysAdapterDeps {
  sock:   RawSocket;
  store:  BotStore;
}

/**
 * Build a `WaContract` that delegates to a Baileys `WASocket`. Also rebinds
 * the store's event subscriptions to the new socket — that wiring lives here
 * rather than in the store so the store stays driver-shape-neutral.
 */
export interface BaileysAdapterHandle {
  /** The contract — pass to kernel / api / pluginLoader. */
  contract: WaContract;
  /** Rebind adapter event listeners to a fresh socket (post-reconnect). */
  rebind(sock: RawSocket): void;
  /** Drop adapter event listeners on a socket being torn down. */
  unbind(sock: RawSocket): void;
}

export function createBaileysAdapter(initial: BaileysAdapterDeps): BaileysAdapterHandle {
  // mutable so rebind() can swap it; closure-scoped so the contract below
  // always sees the latest sock.
  let sock:  RawSocket   = initial.sock;
  const store: BotStore  = initial.store;
  // ── Adapter-local helpers ────────────────────────────────────────────────

  /** Compute sha1-hex of a normalized buffer or string. */
  function sha1(input: Buffer | string): string {
    const hash = createHash("sha1");
    if (typeof input === "string") {
      hash.update(input, "utf8");
    } else {
      hash.update(input);
    }
    return hash.digest("hex");
  }

  /** Translate a Baileys WAMessage into the neutral BotMessage envelope. */
  function toBotMessage(msg: RawMessage): BotMessage {
    const m = normalizeMessageContent(msg.message) ?? undefined;
    let type: BotMessage["type"] = "other";
    let body = "";
    let mimetype: string | undefined;
    if (m?.conversation)            { type = "text";     body = m.conversation; }
    else if (m?.extendedTextMessage?.text) { type = "text";     body = m.extendedTextMessage.text ?? ""; }
    else if (m?.imageMessage)       { type = "image";    body = m.imageMessage.caption   ?? ""; mimetype = m.imageMessage.mimetype    ?? undefined; }
    else if (m?.videoMessage)       { type = "video";    body = m.videoMessage.caption   ?? ""; mimetype = m.videoMessage.mimetype    ?? undefined; }
    else if (m?.audioMessage)       { type = "audio";                                mimetype = m.audioMessage.mimetype    ?? undefined; }
    else if (m?.documentMessage)    { type = "document"; body = m.documentMessage.caption ?? ""; mimetype = m.documentMessage.mimetype ?? undefined; }
    else if (m?.stickerMessage)     { type = "sticker";                              mimetype = m.stickerMessage.mimetype  ?? undefined; }

    const key = msg.key as unknown as {
      participant?: string; participantAlt?: string;
      remoteJid?: string;  remoteJidAlt?: string;
    };

    const contextInfo =
      m?.extendedTextMessage?.contextInfo ??
      m?.imageMessage?.contextInfo ??
      m?.videoMessage?.contextInfo ??
      m?.audioMessage?.contextInfo ??
      m?.documentMessage?.contextInfo ??
      undefined;

    return {
      id:           msg.key.id ?? "",
      chatId:       msg.key.remoteJid ?? "",
      fromMe:       !!msg.key.fromMe,
      type,
      contentHash:  sha1(body.trim()),
      timestamp:    Number(msg.messageTimestamp ?? 0) * 1000,
      body,
      mimetype:     mimetype ?? undefined,
      pushName:     (msg as unknown as { pushName?: string }).pushName,
      mentionedJid: contextInfo?.mentionedJid ?? undefined,
      quotedKey: contextInfo?.stanzaId ? {
        id:          contextInfo.stanzaId,
        remoteJid:   msg.key.remoteJid ?? undefined,
        fromMe:      false,
        participant: contextInfo.participant ?? undefined,
      } : undefined,
      fromLid:        key.participantAlt,
      fromPn:         key.participant,
      participantAlt: key.participantAlt,
      remoteJidAlt:   key.remoteJidAlt,
      // Poll-decryption key lives here for poll vote decryption downstream.
      _raw: {
        pollEncKeyRaw: m?.messageContextInfo?.messageSecret ?? undefined,
      },
    };
  }

  /** Plain summary of a Baileys Chat. */
  function chatSummary(c: RawStoreContact | { id: string; name?: string }): BotChatSummary {
    return { id: c.id, name: (c as { name?: string }).name };
  }

  /** Plain summary of a Baileys Contact. */
  function contactSummary(c: { id: string; name?: string; notify?: string; verifiedName?: string; lid?: string }): BotContactSummary {
    return {
      id: c.id,
      name:         c.name,
      notify:       c.notify,
      verifiedName: c.verifiedName,
      lid:          c.lid,
    };
  }

  // ── Event fan-out ───────────────────────────────────────────────────────
  //
  // Multiple subscribers may listen to the same event. We dispatch with a
  // try/catch in each callback so one misbehaving plugin can't take down the
  // others.

  type AnyHandler = (payload: unknown) => void;
  const subscribers = new Map<WaEventName, Set<AnyHandler>>();

  // Tracks the handlers each socket has registered so we can remove them on a
  // fresh socket after reconnect. Declared up here because the rebind helpers
  // below close over it and the first `bindSockEventsExternal(sock)` call
  // happens before the later declaration site would have executed — accessing
  // it there would hit the temporal dead zone.
  const boundHandlers = new WeakMap<RawSocket, Map<string, (...args: unknown[]) => void>>();

  function emit<E extends WaEventName>(event: E, payload: WaEventPayload<E>): void {
    const set = subscribers.get(event);
    if (!set) return;
    for (const h of set) {
      try { (h as (p: WaEventPayload<E>) => void)(payload); }
      catch (e) { logger.debug(`[waContract] handler for "${event}" threw: ${(e as Error).message}`); }
    }
  }

  bindSockEventsExternal(sock);

  // ── The contract ────────────────────────────────────────────────────────

  const contract: WaContract = {
    name: "baileys" as const,

    // ── lifecycle ─────────────────────────────────────────────────────────
    async connect()    { /* managed by drivers/baileys/index.ts (state machine, login, reconnect) */ },
    async disconnect() { /* managed by drivers/baileys/index.ts */ },
    isReady()          { return false; /* drivers/baileys/index.ts overrides this via the WaContract lifecycle */ },

    async resolveLid(lid: string) {
      try {
        const repo = (sock as unknown as {
          signalRepository?: { lidMapping?: { getPNForLID?(lid: string): Promise<string | null> } }
        }).signalRepository;
        const fn = repo?.lidMapping?.getPNForLID;
        if (typeof fn === "function") {
          const pn = await fn(lid);
          return pn ?? null;
        }
      } catch (err) {
        logger.debug(`[waContract] resolveLid cross-check failed for "${lid}": ${(err as Error).message}`);
      }
      return null;
    },

    // ── event subscription ────────────────────────────────────────────────
    on(event, handler) {
      let set = subscribers.get(event);
      if (!set) { set = new Set(); subscribers.set(event, set); }
      set.add(handler as AnyHandler);
      return () => set!.delete(handler as AnyHandler);
    },

    // ── send ───────────────────────────────────────────────────────────────
    async sendText(jid, text, opts) {
      const content: AnyMessageContent = { text };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sendOpts: any = buildQuotedOpts(opts?.quoted);
      if (opts?.mentions?.length) content.mentions = opts.mentions;
      const ref = await sock.sendMessage(jid, content, sendOpts);
      return toSentRef(ref, jid);
    },

    async sendImage(jid, buffer, opts) {
      const content: AnyMessageContent = { image: buffer };
      if (opts?.caption) content.caption = opts.caption;
      if (opts?.viewOnce) content.viewOnce = true;
      if (opts?.mentions?.length) content.mentions = opts.mentions;
      const ref = await sock.sendMessage(jid, content, buildQuotedOpts(opts?.quoted));
      return toSentRef(ref, jid);
    },

    async sendVideo(jid, buffer, opts) {
      const content: AnyMessageContent = { video: buffer };
      if (opts?.caption) content.caption = opts.caption;
      if (opts?.viewOnce) content.viewOnce = true;
      if (opts?.gifPlayback) content.gifPlayback = true;
      if (opts?.mentions?.length) content.mentions = opts.mentions;
      const ref = await sock.sendMessage(jid, content, buildQuotedOpts(opts?.quoted));
      return toSentRef(ref, jid);
    },

    async sendAudio(jid, buffer, opts) {
      const content: AnyMessageContent = { audio: buffer };
      content.mimetype = opts?.mimetype ?? "audio/mp4";
      if (opts?.ptt) content.ptt = true;
      if (opts?.viewOnce) content.viewOnce = true;
      const ref = await sock.sendMessage(jid, content, buildQuotedOpts(opts?.quoted));
      return toSentRef(ref, jid);
    },

    async sendSticker(jid, buffer, opts) {
      const ref = await sock.sendMessage(jid, { sticker: buffer } as AnyMessageContent, buildQuotedOpts(opts?.quoted));
      return toSentRef(ref, jid);
    },

    async sendDocument(jid, buffer, filename, mimetype, opts) {
      const ref = await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename } as AnyMessageContent, buildQuotedOpts(opts?.quoted));
      return toSentRef(ref, jid);
    },

    async sendPoll(jid, opts) {
      const poll = { name: opts.name, values: opts.values, selectableCount: opts.selectableCount ?? 1 };
      const ref = await sock.sendMessage(jid, { poll } as Parameters<typeof sock.sendMessage>[1], buildQuotedOpts(opts.quoted));
      return toSentRef(ref, jid);
    },

    async react(jid, target, emoji) {
      const key = toBaileysKey(target);
      await sock.sendMessage(jid, { react: { text: emoji, key } } as AnyMessageContent);
    },

    async deleteMessage(jid, target, forEveryone) {
      if (!forEveryone) return;
      const key = toBaileysKey(target);
      await sock.sendMessage(jid, { delete: key } as AnyMessageContent);
    },

    async editMessage(jid, target, text) {
      const key = toBaileysKey(target);
      await sock.sendMessage(jid, { text, edit: key } as AnyMessageContent);
    },

    // ── presence + read ───────────────────────────────────────────────────
    async sendPresenceUpdate(state, jid) {
      const baileyState = state === "composing" ? "composing"
                       : state === "recording" ? "recording"
                       : "paused";
      await (sock as unknown as { sendPresenceUpdate(s: string, j: string): Promise<unknown> }).sendPresenceUpdate(baileyState, jid);
    },

    async readMessages(keys) {
      const baileyKeys = keys.map(toBaileysKey);
      await (sock as unknown as { readMessages(keys: unknown[]): Promise<unknown> }).readMessages(baileyKeys);
    },

    // ── contacts ──────────────────────────────────────────────────────────
    async onWhatsApp(jid) {
      const fn = (sock as unknown as { onWhatsApp(j: string): Promise<{ exists: boolean }[] | null> }).onWhatsApp?.bind(sock);
      if (!fn) return null;
      return await fn(jid);
    },

    async getBusinessProfile(jid) {
      try {
        const fn = (sock as unknown as { getBusinessProfile(j: string): Promise<unknown> }).getBusinessProfile;
        return await fn(jid);
      } catch { return null; }
    },

    async profilePictureUrl(jid) {
      try {
        const url = await sock.profilePictureUrl(jid, "image");
        return url ?? null;
      } catch { return null; }
    },

    async fetchStatus(jid) {
      const fn = (sock as unknown as { fetchStatus(j: string): Promise<unknown> }).fetchStatus?.bind(sock);
      if (!fn) return null;
      try {
        const res = await fn(jid);
        if (Array.isArray(res)) {
          const entry = res.find((r: { id: string }) => jidNormalizedUser(r.id) === jidNormalizedUser(jid)) ?? res[0];
          return (entry as { status?: { status?: string | null } })?.status?.status ?? null;
        }
        return (res as { status?: string })?.status ?? null;
      } catch { return null; }
    },

    async updateBlockStatus(jid, action) {
      const fn = (sock as unknown as { updateBlockStatus(j: string, a: string): Promise<void> }).updateBlockStatus;
      await fn(jid, action);
    },

    async addOrEditContact(jid, info) {
      await (sock as unknown as {
        addOrEditContact(jid: string, info: { fullName: string; firstName?: string; saveOnPrimaryAddressbook?: boolean }): Promise<void>
      }).addOrEditContact(jid, info);
    },

    async removeContact(jid) {
      await (sock as unknown as { removeContact(j: string): Promise<void> }).removeContact(jid);
    },

    // ── groups ─────────────────────────────────────────────────────────────
    async groupMetadata(jid) {
      const meta = await sock.groupMetadata(jid);
      return {
        subject: meta.subject,
        participants: meta.participants.map(p => ({
          id:           jidNormalizedUser(p.id),
          isAdmin:      p.admin === "admin" || p.admin === "superadmin",
          isSuperAdmin: p.admin === "superadmin",
          phoneNumber:  (p as unknown as { phoneNumber?: string }).phoneNumber,
        })),
      };
    },

    async groupParticipantsUpdate(jid, users, action) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await sock.groupParticipantsUpdate(jid, users as any, action as any);
      return res as Array<{ status: string; jid?: string }>;
    },

    async groupUpdateSubject(jid, subject) {
      await (sock as unknown as { groupUpdateSubject(j: string, s: string): Promise<void> }).groupUpdateSubject(jid, subject);
    },

    async groupUpdateDescription(jid, description) {
      await (sock as unknown as { groupUpdateDescription(j: string, d: string): Promise<void> }).groupUpdateDescription(jid, description);
    },

    async groupInviteCode(jid) {
      return await (sock as unknown as { groupInviteCode(j: string): Promise<string> }).groupInviteCode(jid);
    },

    async groupRevokeInvite(jid) {
      return await (sock as unknown as { groupRevokeInvite(j: string): Promise<string> }).groupRevokeInvite(jid);
    },

    // ── profile ────────────────────────────────────────────────────────────
    async updateProfilePicture(jid, buffer) {
      await (sock as unknown as { updateProfilePicture(j: string, b: Buffer): Promise<void> }).updateProfilePicture(jid, buffer);
    },

    async updateProfileName(name) {
      await (sock as unknown as { updateProfileName(n: string): Promise<unknown> }).updateProfileName(name);
    },

    async updateProfileStatus(status) {
      await (sock as unknown as { updateProfileStatus(s: string): Promise<unknown> }).updateProfileStatus(status);
    },

    // ── me ─────────────────────────────────────────────────────────────────
    me() {
      const u = sock.user as unknown as { id?: string; lid?: string } | undefined;
      const id = u?.id ? jidNormalizedUser(u.id) : "";
      return { id, lid: u?.lid };
    },

    // ── verification primitive ──────────────────────────────────────────
    // sendFallbackGuard calls this right after sendText resolves to confirm
    // the message actually landed. The Baileys in-memory store is updated
    // synchronously by the `messages.upsert` listener (store.ts), and
    // own-sent messages land there as soon as sock.sendMessage returns —
    // so the first lookup is effectively free (no network round-trip).
    async getHistory(jid, opts) {
      const limit = opts?.limit ?? 5;
      const chatMsgs = store.messages.get(jid);
      if (!chatMsgs || chatMsgs.size === 0) return [];
      // Newest-first so callers can slice `limit` off the head; we sort
      // by messageTimestamp (seconds) and fall back to insertion order
      // for messages synced together (same timestamp) so ordering stays
      // stable across reads.
      const all = [...chatMsgs.values()];
      all.sort((a, b) => {
        const ta = Number(a.messageTimestamp ?? 0);
        const tb = Number(b.messageTimestamp ?? 0);
        if (ta !== tb) return tb - ta;
        return 0;
      });
      return all.slice(0, limit).map(toBotMessage);
    },

    // ── media (download) ───────────────────────────────────────────────────
    async downloadMedia(msg, opts) {
      // The poll-decryption raw envelope left only what's needed for that,
      // so to downloadMediaMessage we still need the original WAMessage.
      // Get it back from the store by id.
      const raw = store.messages.get(msg.chatId)?.get(msg.id) as RawMessage | undefined;
      if (!raw) return null;
      try {
        const buffer = await downloadMediaMessage(raw, "buffer", {}, {
          logger: silentBaileysLogger,
          reuploadRequest: sock.updateMediaMessage,
        });
        if (!buffer || !Buffer.isBuffer(buffer)) return null;
        // Animated sticker → mp4 is handled by the caller (api/index.ts
        // wa.downloadMedia) — kept at the api layer for now.
        if (opts?.asMp4) {
          // No animated-sticker conversion here for now (would couple to
          // ffmpeg + node-webpmux). Caller does it.
        }
        return { mimetype: msg.mimetype ?? "application/octet-stream", data: buffer };
      } catch (err) {
        logger.warn(`[waContract] downloadMedia failed: ${(err as Error).message}`);
        return null;
      }
    },
  };

  // ── Rebind helpers (post-reconnect in drivers/baileys/index.ts) ────────
  //
  // We need to keep references to the handlers we registered on the old
  // sock.ev so we can remove them on a fresh socket — otherwise the old
  // socket would leak listeners and every reconnect would double the
  // fan-out work. The trick is the handler bodies close over `emit` and
  // `toBotMessage`, which read from module-local state that doesn't change.

  function bindSockEventsExternal(s: RawSocket): void {
    const ev = s.ev as unknown as RawEmitter;
    const handlers = new Map<string, (...args: unknown[]) => void>();

    function register(event: string, h: (...args: unknown[]) => void) {
      handlers.set(event, h);
      ev.on(event, h);
    }

    register("messages.upsert", (arg) => {
      const { messages, type } = arg as { messages: RawMessage[]; type: "notify" | "append" };
      emit("messages.upsert", { messages: messages.map(toBotMessage), type });
    });
    register("messages.update", (arg) => {
      const updates = arg as Array<{ key: BotQuotedRef; update: Record<string, unknown> }>;
      emit("messages.update", { updates });
    });
    register("messaging-history.set", (arg) => {
      const { chats, contacts, messages } = arg as { chats: RawStoreContact[]; contacts: RawStoreContact[]; messages?: RawMessage[] };
      emit("messaging-history.set", {
        chats:    chats.map(chatSummary),
        contacts: contacts.map(contactSummary),
        messages: (messages ?? []).map(toBotMessage),
      });
    });
    register("chats.upsert", (arg) => {
      emit("chats.upsert", { chats: (arg as RawStoreContact[]).map(chatSummary) });
    });
    register("chats.update", (arg) => {
      emit("chats.update", { updates: arg as Array<{ id: string; name?: string }> });
    });
    register("contacts.upsert", (arg) => {
      emit("contacts.upsert", { contacts: (arg as RawStoreContact[]).map(contactSummary) });
    });
    register("contacts.update", (arg) => {
      emit("contacts.update", { updates: (arg as RawStoreContact[]).map(contactSummary) });
    });
    register("group-participants.update", (arg) => {
      const { id, participants } = arg as { id: string; participants: Array<{ id: string; action: "add" | "remove" | "promote" | "demote" }> };
      emit("group-participants.update", { id, participants });
    });
    register("groups.update", (arg) => {
      emit("groups.update", { updates: arg as Array<{ id: string }> });
    });
    register("connection.update", (arg) => {
      const { connection, lastDisconnect } = arg as { connection: "open" | "close" | "connecting"; lastDisconnect?: { error?: Boom } };
      emit("connection.update", {
        connection,
        lastDisconnect: lastDisconnect?.error ? { statusCode: (lastDisconnect.error as Boom).output?.statusCode } : undefined,
      });
    });

    boundHandlers.set(s, handlers);
  }

  function unbindSockEvents(s: RawSocket): void {
    const handlers = boundHandlers.get(s);
    if (!handlers) return;
    const ev = s.ev as unknown as RawEmitter;
    for (const [event, h] of handlers) {
      ev.off(event, h);
    }
    boundHandlers.delete(s);
  }

  // ── Handle returned to drivers/baileys/index.ts ────────────────────────

  // Hang the raw `sock` off the contract via a private symbol so
  // `drivers/baileys/api/index.ts` (the Baileys-only plugin-context
  // builder) can pull it back when it needs a Baileys-only operation
  // (poll decryption, gif detection, message envelope decoding for the
  // helpers that don't yet have a driver-neutral equivalent). The symbol
  // is shared via Symbol.for() so the api file and the adapter can agree
  // on the same key without a top-level import. No other module in the
  // codebase sees this — the rest of the kernel talks only to WaContract.
  const RAW_SOCK = Symbol.for("manybot.baileys.rawSocket");
  (contract as unknown as { [k: symbol]: RawSocket })[RAW_SOCK] = sock;

  return {
    contract,
    rebind(newSock: RawSocket) {
      unbindSockEvents(sock);
      sock = newSock;
      bindSockEventsExternal(newSock);
      // Keep the symbol attached to the contract pointing at the new
      // socket too — api/index.ts caches the contract object, so the
      // symbol slot is the only way it sees the rebind.
      (contract as unknown as { [k: symbol]: RawSocket })[RAW_SOCK] = newSock;
    },
    unbind(oldSock: RawSocket) {
      unbindSockEvents(oldSock);
    },
  };
}

// ── Helpers used inside the adapter above ────────────────────────────────────

function buildQuotedOpts(quoted: BotQuotedRef | undefined): SendOpts | undefined {
  if (!quoted) return undefined;
  return { quoted: toBaileysKey(quoted) };
}

function toBaileysKey(ref: BotQuotedRef): {
  id: string | null; remoteJid: string; fromMe: boolean; participant: string | undefined;
} {
  return {
    id:         ref.id ?? null,
    remoteJid: ref.remoteJid ?? "",
    fromMe:    !!ref.fromMe,
    participant: ref.participant ?? undefined,
  };
}

function toSentRef(raw: unknown, fallbackChatId: string): SentMessageRef {
  const r = raw as { key?: { id?: string; remoteJid?: string } } | undefined;
  return {
    id:        r?.key?.id ?? "",
    chatId:    r?.key?.remoteJid ?? fallbackChatId,
    timestamp: Date.now(),
  };
}

/**
 * pino-shape shim for Baileys' downloadMediaMessage — see the in-source
 * explanation in api/index.ts (same shape, kept here for the adapter).
 */
const silentBaileysLogger = {
  level: "silent",
  child()  { return silentBaileysLogger; },
  trace()  {},
  debug()  {},
  info()   {},
  warn(obj: unknown, msg?: string)  { logger.warn(`[baileys]`, msg ?? obj); },
  error(obj: unknown, msg?: string) { logger.error(`[baileys]`, msg ?? obj); },
};
