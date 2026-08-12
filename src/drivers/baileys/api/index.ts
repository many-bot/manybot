/**
 * drivers/baileys/api/index.ts
 *
 * WhatsApp plugin context builder.
 * Exports buildApi() and buildSetupApi() for the WhatsApp driver.
 *
 * Plugins receive a `ctx` object built by buildApi().
 * All wwjs types have been replaced with Baileys equivalents.
 * The ctx surface area is preserved so existing plugins stay compatible.
 */

import type { PluginEntry }          from "#kernel/pluginLoader.js";
import type { PluginContext, SetupContext } from "#kernel/pluginApi.js";
import type { BotMessage, BotQuotedRef } from "#drivers/types.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import type { WASocket, WAStore, WAProtoMsg, WAChat } from "#types";
import { toBotMessage } from "#drivers/baileys/index.js";
import { decodeContent } from "#drivers/baileys/adapter.js";
import { logger }                    from "#logger";
import { t, createPluginT,
         reloadTranslations,
         getCurrentLang }            from "#i18n";
import { CONFIG, CONFIG_DIR }        from "#config";
import { enqueue }                   from "#download";
import { schedule, cancelPlugin }    from "#kernel/scheduler.js";
import { emptyFolder }               from "#utils/file.js";
import { normalizeJid, denormalizeJid, toWireJid } from "#drivers/jid.js";

import { mkdirSync }                 from "fs";
import { readFile, writeFile, unlink, mkdtemp, rm } from "fs/promises";
import { readFileSync }              from "fs";
import path                          from "path";
import os                            from "os";
import { spawn }                     from "child_process";
import { randomUUID }                from "crypto";
import { waitForSendSlot, simulateState,
         typingDuration, mediaDuration,
         waitForEditSlot }  from "#sendguard";
import { sendWithFallback }          from "#kernel/sendFallbackGuard.js";
import { buildSettingsApi }          from "#settingsdb";
import WebP                          from "node-webpmux";
import {
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

// ── Raw-Baileys escape hatch ─────────────────────────────────────────────────
//
// This whole file is the Baileys driver's plugin-context builder, so the
// few operations that don't have a driver-neutral equivalent yet (poll
// decryption, gif detection, message envelope decoding for the helpers
// above) need direct access to the underlying WASocket. The WaContract
// intentionally doesn't expose the raw socket — but the adapter that
// builds it from a real Baileys socket hangs the socket off a private
// symbol so we can pull it back here without leaking Baileys types
// through the kernel/pluginApi surface.
//
// Defined as a separate symbol so the rest of the kernel can still
// import the WaContract without ever knowing this exists.
const RAW_SOCK = Symbol.for("manybot.baileys.rawSocket");
interface RawAccess {
  [RAW_SOCK]?: import("#types").WASocket;
}
function rawSocketOf(contract: WaContract): import("#types").WASocket {
  const sock = (contract as unknown as RawAccess)[RAW_SOCK];
  if (!sock) {
    throw new Error("[baileys/api] WaContract has no raw socket attached — only the Baileys adapter provides one.");
  }
  return sock;
}

/**
 * Pull a Baileys-shaped message envelope off a `BotMessage._raw` when an
 * api-layer helper needs fields the neutral envelope intentionally
 * doesn't model (poll enc key, gifPlayback flag, …). The store still
 * stores the raw `WAMessage` keyed by jid+id, so the common case is
 * to read it back from there.
 */
function rawMsgOf(msg: BotMessage, store: BotStore): import("#types").WAProtoMsg | undefined {
  const raw = store.messages.get(msg.chatId)?.get(msg.id);
  return raw as import("#types").WAProtoMsg | undefined;
}

/**
 * Convert a `BotMessage` (driver-neutral incoming envelope) into a
 * `BotQuotedRef` (driver-neutral outgoing reference), used as the
 * `quoted` argument to the contract's send methods. The fields the
 * adapter pre-extracts (id, chatId, fromMe, participantAlt/fromLid/
 * fromPn) are enough for the protocol — no raw Baileys access needed.
 */
function quotedRefFromMsg(msg: BotMessage): BotQuotedRef {
  return {
    id:          msg.id,
    remoteJid:   msg.chatId,
    fromMe:      msg.fromMe,
    participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
  };
}

/**
 * Read the just-sent message off the store after a `contract.sendX()`
 * call resolves with a `SentMessageRef` (id + chatId + timestamp).
 * Mirrors the text path's polling window — the driver's own
 * `messages.upsert` handler writes the freshly-sent WAMessage into
 * the store keyed by chatId+id, but that write may not have landed
 * on the very next tick.
 */
async function refToBotMessage(ref: { id: string; chatId: string; timestamp: number }, store: BotStore): Promise<BotMessage | undefined> {
  const deadline = Date.now() + 200;
  while (Date.now() < deadline) {
    const stored = store.messages.get(ref.chatId)?.get(ref.id);
    if (stored) return toBotMessage(stored as WAProtoMsg);
    await new Promise<void>(r => setTimeout(r, 20));
  }
  const final = store.messages.get(ref.chatId)?.get(ref.id);
  return final ? toBotMessage(final as WAProtoMsg) : undefined;
}

// ── Message body / type helpers ───────────────────────────────────────────────
//
// Helpers read the neutral `BotMessage` envelope. Fields the neutral
// envelope intentionally doesn't model (poll enc key, gifPlayback,
// messageSecret) are pulled out of the raw store entry when needed —
// the adapter fills `BotMessage._raw` with the bits a Baileys-side
// consumer might need (poll enc key) and leaves the rest on the raw
// WAMessage in the store.

function getMsgBody(msg: BotMessage): string {
  // The adapter pre-extracts the body into `BotMessage.body`, so the
  // common path is one field read. Fall back to the raw store entry only
  // if the body wasn't populated (older code paths that built the
  // envelope by hand).
  if (msg.body !== undefined) return msg.body;
  return msg.body ?? "";
}

function getMsgType(msg: BotMessage): string {
  // body-style text vs extendedTextMessage, buttons vs list response, etc.
  // — these distinctions live on the raw envelope, since the neutral
  // `type` only models the high-level kind (text/image/video/...).
  const raw = (msg._raw as { kind?: string } | undefined)?.kind;
  if (raw) return raw;
  switch (msg.type) {
    case "text":     return "chat";
    case "image":    return "image";
    case "video":    return "video";
    case "audio":    return "audio";
    case "sticker":  return "sticker";
    case "document": return "document";
    default:         return "unknown";
  }
}

function msgHasMedia(msg: BotMessage): boolean {
  return msg.type === "image" || msg.type === "video" || msg.type === "audio" || msg.type === "document" || msg.type === "sticker";
}

function msgIsGif(msg: BotMessage, store: BotStore): boolean {
  const raw = rawMsgOf(msg, store);
  if (!raw) return false;
  // gifPlayback is a Baileys-specific flag — read it off the raw
  // WAMessage directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(raw.message as any)?.videoMessage?.gifPlayback;
}

/** Sender JID — group participant or DM remote JID, normalized. */
function getMsgSender(msg: BotMessage, store: BotStore): string {
  // Prefer the @s.whatsapp.net form when we know it (Baileys-advisor split
  // exposes both forms on incoming messages). The adapter fills
  // `fromPn` when known; fall back to `chatId` for DMs.
  const participant = (msg._raw as { key?: { participant?: string } } | undefined)?.key?.participant
                    ?? msg.fromPn;
  const raw = participant ?? msg.chatId;
  return normalizeJid(store.resolveJid(normalizeJid(raw)));
}

/** Quoted-message metadata as the rest of the api uses it. */
function getQuotedContext(msg: BotMessage): BotQuotedRef | null {
  if (!msg.quotedKey) return null;
  return {
    id:          msg.quotedKey.id ?? null,
    remoteJid:   msg.chatId,
    fromMe:      false,
    participant: (msg._raw as { contextInfo?: { participant?: string } } | undefined)?.contextInfo?.participant ?? null,
  };
}

function getContextInfo(msg: BotMessage): unknown {
  // The context info lives on the raw envelope (it carries mentions,
  // stanzaId, etc.). The adapter doesn't pre-extract it because no
  // neutral consumer needs it — pull it on demand from the store.
  const raw = (msg._raw as { contextInfo?: unknown } | undefined)?.contextInfo;
  return raw ?? null;
}

/** True if the message has any @mention at all. */
function hasMention(contextInfo: unknown): boolean {
  const ci = contextInfo as { mentionedJid?: unknown } | null;
  return !!(ci?.mentionedJid && Array.isArray(ci.mentionedJid) && ci.mentionedJid.length > 0);
}

/** True if the bot's own JID (PN or LID) is in contextInfo.mentionedJid. */
function hasBotMention(contextInfo: unknown, sock: import("#types").WASocket, store: BotStore): boolean {
  const ci = contextInfo as { mentionedJid?: string[] } | null;
  const mentioned = ci?.mentionedJid;
  if (!mentioned || mentioned.length === 0) return false;

  const botLid = (sock.user as unknown as { lid?: string })?.lid;
  const botCandidates = [sock.user?.id, botLid]
    .filter((v): v is string => !!v)
    .map(v => normalizeJid(store.resolveJid(normalizeJid(v))));

  if (botCandidates.length === 0) return false;

  return mentioned.some(jid => {
    const resolved = normalizeJid(store.resolveJid(normalizeJid(jid)));
    return botCandidates.includes(resolved);
  });
}

function getMsgMimetype(msg: BotMessage): string {
  return msg.mimetype ?? "application/octet-stream";
}

// ── Chat adapter builder ──────────────────────────────────────────────────────

// Group subjects only land in `store.chats` once Baileys fires chats.upsert
// / chats.update for that chat — which depends on history sync and doesn't
// always happen promptly (or at all) for a group the bot just joined. When
// that hasn't happened yet, `chat.name` silently fell back to the numeric
// group ID. sock.groupMetadata() always has the real subject, straight from
// WhatsApp, so use it as a fallback — cached briefly so we're not hitting it
// on every single incoming message from the same group.
const GROUP_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const groupNameCache = new Map<string, { name: string; at: number }>();

// chat.getParticipants()/isAdmin()/isSenderAdmin()/isBotAdmin() used to hit
// sock.groupMetadata() on every single call — a network round trip per
// message in busy groups. wwjs read this from an in-memory Chat object
// instead. Cache full metadata with the same TTL pattern as groupNameCache
// above, and drop the entry as soon as membership/admin state actually
// changes so a promote/kick/join is visible well before the TTL expires.
type WAGroupMetadata = Awaited<ReturnType<import("@whiskeysockets/baileys").WASocket["groupMetadata"]>>;
const GROUP_META_CACHE_TTL_MS = 5 * 60 * 1000;
const groupMetaCache = new Map<string, { meta: WAGroupMetadata; at: number }>();

async function getGroupMetadataCached(contract: WaContract, jid: string): Promise<WAGroupMetadata> {
  const cached = groupMetaCache.get(jid);
  if (cached && Date.now() - cached.at < GROUP_META_CACHE_TTL_MS) return cached.meta;
  // Go through the raw sock for the Baileys-flavored metadata (carries
  // pn/phoneNumber which the neutral contract drops). The neutral
  // contract's groupMetadata is used everywhere the kernel asks for it.
  const sock = rawSocketOf(contract);
  const meta = await sock.groupMetadata(jid);
  groupMetaCache.set(jid, { meta, at: Date.now() });
  return meta;
}

let groupMetaInvalidationBound = false;
function bindGroupMetaInvalidation(contract: WaContract) {
  if (groupMetaInvalidationBound) return;
  groupMetaInvalidationBound = true;
  contract.on("group-participants.update", (u) => {
    groupMetaCache.delete(u.id);
  });
  contract.on("groups.update", (p) => {
    for (const u of p.updates) if (u.id) groupMetaCache.delete(u.id);
  });
}

/**
 * Build a WAChat adapter from a BotMessage + store.
 * Exposed for use in messageHandler.ts.
 *
 * @param {BotMessage}  msg
 * @param {BotStore}    store
 * @param {WaContract}  contract
 * @returns {Promise<WAChat>}
 */
export async function buildChatFromMsg(msg: BotMessage, store: BotStore, contract: WaContract): Promise<WAChat> {
  const rawJid = msg.chatId;
  const jid    = normalizeJid(store.resolveJid(rawJid));
  const user   = jid.split("@")[0];
  const isGroup = rawJid.endsWith("@g.us");

  // Try to get name from store
  const stored = store.chats.get(rawJid);
  let name = stored?.name;

  if (!name && isGroup) {
    const cached = groupNameCache.get(rawJid);
    if (cached && Date.now() - cached.at < GROUP_NAME_CACHE_TTL_MS) {
      name = cached.name;
    } else {
      try {
        const meta = await getGroupMetadataCached(contract, rawJid);
        if (meta?.subject) {
          name = meta.subject;
          groupNameCache.set(rawJid, { name: meta.subject, at: Date.now() });
        }
      } catch {
        // fall through to the numeric fallback below
      }
    }
  }

  return { id: { _serialized: jid, user }, name: name ?? user, isGroup };
}

// ── MIME map for file sends ───────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".pdf":  "application/pdf",
  ".doc":  "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls":  "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip":  "application/zip",
  ".mp3":  "audio/mpeg",
  ".mp4":  "video/mp4",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".txt":  "text/plain",
  ".csv":  "text/csv",
};

function mimeFromPath(filePath: string): string {
  return MIME_MAP[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// ── Media source resolution (path or Buffer) ────────────────────────────────

/**
 * Resolves a media source to a Buffer. Every ctx.send.* / msg.reply.*
 * media method accepts either a filesystem path (string) or an
 * already-loaded Buffer — this is what auto-detects which one it got.
 */
async function resolveMediaBuffer(source: string | Buffer): Promise<Buffer> {
  return Buffer.isBuffer(source) ? source : await readFile(source);
}

const GIF_MAGIC = Buffer.from("GIF8");

/** True if the buffer's magic bytes identify it as a raw .gif image. */
function isGifBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).equals(GIF_MAGIC);
}

/** True if a gif() source needs ffmpeg conversion to mp4 before sending. */
function needsGifConversion(source: string | Buffer): boolean {
  return Buffer.isBuffer(source)
    ? isGifBuffer(source)
    : path.extname(source).toLowerCase() === ".gif";
}

// ── Storage API ───────────────────────────────────────────────────────────────

export function buildStorageApi(pluginName: string) {
  if (typeof pluginName !== "string" || pluginName.trim() === "") {
    throw new Error("[storage] buildStorageApi: pluginName must be a non-empty string");
  }

  const dir = path.join(CONFIG_DIR, "data", pluginName);
  mkdirSync(dir, { recursive: true });

  return {
    dir,

    /**
     * Resolves a path inside the plugin's data directory.
     * Creates subdirectories automatically.
     * @param {string} relativePath
     * @returns {string}
     */
    resolve(relativePath: string) {
      if (!relativePath || typeof relativePath !== "string")
        throw new Error(`[storage] resolve() requires a non-empty string, got: ${typeof relativePath}`);
      if (relativePath.includes(".."))
        throw new Error(`[storage] path traversal detected in: "${relativePath}"`);
      if (path.isAbsolute(relativePath))
        throw new Error(`[storage] absolute paths are not allowed: "${relativePath}"`);
      if (relativePath.includes("\\"))
        throw new Error(`[storage] Windows-style paths are not allowed: "${relativePath}"`);

      const resolved = path.join(dir, relativePath);
      if (!resolved.startsWith(path.resolve(dir) + path.sep))
        throw new Error(`[storage] resolved path escapes plugin data dir: "${resolved}"`);

      mkdirSync(path.dirname(resolved), { recursive: true });
      return resolved;
    },
  };
}

// ── Config API ────────────────────────────────────────────────────────────────

function buildConfigApi(): { get(key: string, defaultValue?: unknown): unknown } {
  return {
    /**
     * Get a config value with optional default.
     * @param {string} key
     * @param {any}    [defaultValue]
     */
    get(key, defaultValue = null) {
      return CONFIG[key] ?? defaultValue;
    },
  };
}

// ── i18n API ──────────────────────────────────────────────────────────────────

function buildI18nApi() {
  return {
    t,
    /**
     * Create a scoped t() for a plugin's own locale files.
     * @param {string} pluginMetaUrl — pass import.meta.url from the plugin
     */
    createT: createPluginT,
    reload:  reloadTranslations,
    getCurrentLang,
  };
}

// ── Utils API ─────────────────────────────────────────────────────────────────

function buildUtilsApi() {
  return { emptyFolder };
}

// ── Download API ──────────────────────────────────────────────────────────────

function buildDownloadApi() {
  return {
    /**
     * Enqueue a download work function.
     * @param {Function} workFn
     * @param {Function} [errorFn]
     */
    enqueue,
  };
}

// ── Scheduler API ─────────────────────────────────────────────────────────────

function buildSchedulerApi(pluginName: string) {
  return {
    /**
     * Register a cron task, scoped to this plugin.
     * Re-registering the same expression replaces the previous task
     * instead of stacking a new one.
     * @param {string}   expression — cron expression, e.g. "0 9 * * 1"
     * @param {Function} fn         — async function to run on schedule
     * @returns {{ stop(): void }}
     */
    schedule(expression: string, fn: () => Promise<void>) {
      return schedule(expression, fn, pluginName);
    },
  };
}

// ── Plugin registry API ───────────────────────────────────────────────────────

function buildPluginsApi(pluginRegistry: Map<string, PluginEntry>) {
  return {
    /**
     * Return public API of another plugin, or null if not active.
     * @param {string} name
     */
    get(name: string) {
      return pluginRegistry.get(name)?.exports ?? null;
    },

    /**
     * Return public API of another plugin, or throw if not active.
     * @param {string} name
     */
    require(name: string) {
      const plugin = pluginRegistry.get(name);
      if (!plugin || plugin.status !== "active")
        throw new Error(`[plugins] dependency "${name}" does not exist or is not active`);
      return plugin.exports;
    },

    /**
     * Check if a plugin is active.
     * @param {string} name
     */
    exists(name: string) {
      return pluginRegistry.get(name)?.status === "active";
    },
  };
}

// ── Log API ───────────────────────────────────────────────────────────────────

const log = {
  info:    (...a: unknown[]) => logger.info(...a),
  warn:    (...a: unknown[]) => logger.warn(...a),
  error:   (...a: unknown[]) => logger.error(...a),
  success: (...a: unknown[]) => logger.success(...a),
};

// ── Contact normalization ─────────────────────────────────────────────────────

/**
 * Resolve the text to show after "@" in a mention.
 *
 * WhatsApp's tag/notify behavior (who gets pinged, the bold highlight) is
 * driven entirely by contextInfo.mentionedJid — the visible text after "@"
 * is cosmetic and each client fills it in independently. Web commonly
 * resolves it from the group's synced metadata, but mobile clients only do
 * this when the number is saved in the phone's own contacts — otherwise
 * they show the raw digits (e.g. "@5516999999999"), which is the "só
 * aparece @numero no celular" behavior. Using the name Baileys already
 * knows (contact name / business verifiedName / WhatsApp "notify" push
 * name) instead of the number sidesteps that client-side lookup and
 * renders consistently everywhere.
 * @param {string}          jid
 * @param {WAStoreContact}  [info]
 */
function mentionDisplayName(jid: string): string {
  return jid.split("@")[0];
}

/**
 * Build a normalized contact object from a JID and optional store metadata.
 * isBusiness is resolved via contract.getBusinessProfile(jid) — it resolves
 * to a profile only for WhatsApp Business accounts, undefined otherwise.
 * @param {string}              jid
 * @param {RawStoreContact}     [info]
 * @param {string|null}         [botJid]
 * @param {WaContract}          [contract]
 */
async function normalizeContact(jid: string, info: import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact | undefined, botJid: string | null | undefined, contract?: WaContract) {
  const number = jid.split("@")[0];
  let isBusiness = false;
  // We already have a contact record for this jid (learned from a real
  // contacts.upsert or an actual message from them) — that alone proves
  // it's a real WhatsApp account. Only fall back to the onWhatsApp() query
  // when we don't, since that query is PN-oriented and unreliable for a
  // raw @lid we've never resolved to a phone number (returns a false
  // "doesn't exist" instead of throwing).
  let isWAAccount = Boolean(info);
  if (!isWAAccount && contract && !jid.endsWith("@g.us")) {
    try {
      const results = await contract.onWhatsApp(jid);
      isWAAccount = Boolean(results?.[0]?.exists);
    } catch {
      // Couldn't verify — leave as false rather than claiming certainty.
      isWAAccount = false;
    }
  }
  // No store record and no confirmed WhatsApp account (and not a group,
  // which we can't verify this way) — nothing backs this contact.
  // Matches the old whatsapp-web.js contract: getContactById() threw /
  // resolved to null for an unknown ID instead of returning a hollow object.
  if (!jid.endsWith("@g.us") && !isWAAccount) return null;
  if (contract && !jid.endsWith("@g.us")) {
    try {
      isBusiness = Boolean(await contract.getBusinessProfile(jid));
    } catch {
      isBusiness = false;
    }
  }
  return {
    id:           jid,
    number,
    pushname:     info?.notify ?? null,
    name:         info?.name ?? info?.verifiedName ?? null,
    // Baileys' Contact type has no "short name" equivalent (that's a
    // whatsapp-web.js/vCard concept) — always null here, not a bug.
    shortName:    null,
    isBusiness,
    isEnterprise: false,
    isBlocked:    false,
    isMe:         botJid ? jid === normalizeJid(botJid) : false,
    isWAAccount,
    isUser:       !jid.endsWith("@g.us"),
    isGroup:      jid.endsWith("@g.us"),
    mention:      { text: `@${mentionDisplayName(jid)}`, mentions: [toWireJid(jid)] },
  };
}

// ── Chats API ─────────────────────────────────────────────────────────────────

function buildChatsApi(store: BotStore) {
  return {
    /**
     * Chats currently known from the in-memory cache (populated from
     * Baileys' chats.upsert / messaging-history.set events) — no network call.
     * @returns {Array<{ id: string, name: string, isGroup: boolean }>}
     */
    all(): Array<{ id: string; name: string; isGroup: boolean }> {
      return store.chats.all().map((c) => {
        const id = normalizeJid(c.id);
        return { id, name: c.name, isGroup: id.endsWith("@g.us") };
      });
    },
  };
}

// ── Contact API ───────────────────────────────────────────────────────────────

function buildContactsApi(contract: WaContract, store: BotStore, botJid: string | null) {
  return {
    /**
     * Get a normalized contact object by JID.
     * @param {string} contactId
     * @param {{groupId?: string}} [opts] — when `contactId` is a raw `@lid`, this
     *   always cross-checks it against Baileys' own protocol-level
     *   `sock.signalRepository.lidMapping` first (populated from real Signal
     *   session/identity resolution — not a heuristic, and doesn't need a
     *   group). If `opts.groupId` is also given and that didn't resolve it,
     *   falls back to a live `groupMetadata()` call for that group as a
     *   second attempt (NOTE: on Baileys 6.7.x, `groupMetadata()` is known to
     *   still return a bare `@lid` with no `phoneNumber` for some
     *   participants — see WhiskeySockets/Baileys#1505 — so this second
     *   attempt is best-effort and won't always help). Either source, once
     *   it yields a phone-based JID, corrects the store's own `lidMap` too,
     *   which is only ever learned from past messages/contact syncs and can
     *   go stale or, rarely, end up mapped to the wrong person (e.g. after a
     *   `@lid` gets reassigned). Every cross-check is best-effort: on any
     *   failure this silently falls back to whatever the store already has
     *   — never throws because of the cross-check itself.
     * @returns {Promise<object|null>}
     */
    async get(contactId: string, opts?: { groupId?: string }) {
      if (contactId.endsWith("@lid")) {
        let freshPn: string | null | undefined;

        // 1) Baileys' own protocol-level LID↔PN store — populated as part of
        // real Signal session/identity handling, so it's authoritative when
        // it has an answer (unlike our own heuristic lidMap). Routed through
        // the contract's optional resolveLid() helper (drivers without one
        // — e.g. the future whatsmeow client — fall through to step 2).
        if (contract.resolveLid) {
          try {
            freshPn = await contract.resolveLid(contactId);
          } catch (err) {
            logger.warn(`[contacts.get] contract.resolveLid cross-check failed for "${contactId}" — ${(err as Error).message}`);
          }
        }

        // 2) Fall back to live groupMetadata() when we know the group and
        // the signal repository didn't have an answer. Best-effort — see
        // the Baileys 6.7.x caveat in the doc comment above.
        if (!freshPn && opts?.groupId) {
          try {
            const meta = await getGroupMetadataCached(contract, opts.groupId);
            const participant = meta.participants.find(
              (p) => normalizeJid((p as unknown as { id: string }).id) === normalizeJid(contactId)
            );
            freshPn = (participant as unknown as { phoneNumber?: string })?.phoneNumber;
          } catch (err) {
            logger.warn(`[contacts.get] live groupMetadata cross-check failed for "${contactId}" in "${opts.groupId}" — ${(err as Error).message}`);
          }
        }

        if (freshPn) store.learnLid(contactId, normalizeJid(freshPn));
      }

      const normalizedContactId = normalizeJid(contactId);
      let resolved = normalizeJid(store.resolveJid(normalizedContactId));

      // Sanity guard: a @lid resolving to the bot's own JID is only ever
      // legitimate when we were actually looking up the bot itself. Any
      // other case means the stored lidMap entry is stale/wrong — e.g. a
      // @lid that got reassigned to a different WhatsApp account since we
      // learned it (see the best-effort cross-check above, which doesn't
      // always catch this — WhiskeySockets/Baileys#1505). Serving it
      // anyway would silently hand the bot owner's own identity out as
      // some other member's. Discard the bad mapping so it can be
      // relearned correctly, and treat this lookup as unresolved instead.
      if (
        botJid &&
        normalizedContactId.endsWith("@lid") &&
        resolved === normalizeJid(botJid) &&
        normalizedContactId !== normalizeJid(botJid)
      ) {
        logger.warn(`[contacts.get] "${contactId}" resolved to the bot's own JID — discarding stale lidMap entry, treating as unresolved.`);
        store.forgetLid(normalizedContactId);
        resolved = normalizedContactId;
      }

      // The same person's data can be split across the raw (e.g. @lid) and
      // store-resolved (PN) keys — one may have `notify` and the other
      // `verifiedName`/`name`. Merge field-by-field instead of spreading
      // whole objects: upsertContact() always writes all three fields, so
      // a plain `{ ...raw, ...resolvedInfo }` lets resolvedInfo's explicit
      // `undefined` silently clobber a real value already present in raw
      // (or vice versa) — which is how a contact could resolve correctly
      // by id yet still come back with a null pushname/name.
      const raw      = (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[contactId]
                     ?? (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[denormalizeJid(contactId)];
      const resolvedInfo = (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[resolved]
                     ?? (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[denormalizeJid(resolved)];
      const info: import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact | undefined = (raw || resolvedInfo) ? {
        id:           resolved,
        name:         resolvedInfo?.name ?? raw?.name,
        notify:       resolvedInfo?.notify ?? raw?.notify,
        verifiedName: resolvedInfo?.verifiedName ?? raw?.verifiedName,
      } : undefined;
      return normalizeContact(resolved, info, botJid, contract);
    },

    /**
     * Get the profile picture URL of a contact.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getPfpUrl(contactId: string) {
      const resolved = normalizeJid(store.resolveJid(normalizeJid(contactId)));
      try {
        const url = await contract.profilePictureUrl(resolved);
        return url ?? null;
      } catch {
        return null;
      }
    },

    /**
     * Download a contact's profile picture to a local path.
     * @param {string} contactId
     * @param {string} destPath — absolute path (e.g. via ctx.storage.resolve)
     * @returns {Promise<string|null>}
     */
    async getPfpPath(contactId: string, destPath: string) {
      const url = await this.getPfpUrl(contactId);
      if (!url) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
        return destPath;
      } catch {
        return null;
      }
    },

    /**
     * Get the "about" / status text of a contact.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getAbout(contactId: string) {
      // fetchStatus is a legacy/USync query — pass the store-resolved JID
      // (PN when known) rather than a raw @lid, which it may not accept.
      const resolved = normalizeJid(store.resolveJid(normalizeJid(contactId)));
      try {
        const res = await contract.fetchStatus(resolved);
        // Current Baileys versions return a USync result array
        // (`[{ id, status: { status, setAt } }]`) instead of the legacy
        // single `{ status }` object — handle both shapes.
        if (Array.isArray(res)) {
          const entry = res.find(r => normalizeJid((r as { id: string }).id) === resolved) ?? res[0];
          return (entry as { status?: { status?: string | null } })?.status?.status ?? null;
        }
        if (res && typeof res === "object") {
          return (res as { status?: string | null }).status ?? null;
        }
        return null;
      } catch (err) {
        // Previously swallowed silently, which made "always null" look
        // identical to "no status set" — log so real failures are visible.
        logger.warn(`[contacts] getAbout(${contactId}) failed: ${err}`);
        return null;
      }
    },

    /**
     * Block a contact.
     * @param {string} contactId
     */
    async block(contactId: string) {
      await contract.updateBlockStatus(contactId, "block");
    },

    /**
     * Unblock a contact.
     * @param {string} contactId
     */
    async unblock(contactId: string) {
      await contract.updateBlockStatus(contactId, "unblock");
    },
  };
}

/** Shape of the `ctx.msg` object passed to plugins on every message. */
export interface WAMessageContext {
  id:         string;
  timestamp:  number;
  body:       string;
  type:       string;
  fromMe:     boolean;
  sender:     string;
  senderName: string;
  command:    string;
  args:       string[];
  is(cmd: string): boolean;
  hasMedia: boolean;
  isGif:    boolean;
  downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  hasReply: boolean;
  getReply(): Promise<WAMessageContext | null>;
  hasMention: boolean;
  hasBotMention: boolean;
  reply: WAMessageSender;
  react(emoji: string): Promise<unknown>;
  delete(forEveryone?: boolean): Promise<unknown>;
  edit(text: string): Promise<unknown>;
  pin(duration?: number): Promise<void>;
  hasPrefix: boolean;
  getContact(): ReturnType<typeof normalizeContact>;
}

/**
 * Array of past messages (oldest → newest), as returned by `ctx.chat.history`.
 * Behaves like a normal array (`history[10]`, `.length`, `.map()`, ...) plus
 * two convenience filters, both chainable and re-wrapped as WAHistoryArray.
 */
export interface WAHistoryArray extends Array<WAMessageContext> {
  /** Last `n` messages (oldest → newest). Omit `n` for the full list. */
  last(n?: number): WAHistoryArray;
  /** Only messages sent by `senderId`. */
  from(senderId: string): WAHistoryArray;
}

function makeHistoryArray(entries: WAMessageContext[], store: BotStore): WAHistoryArray {
  const arr = entries as WAHistoryArray;
  arr.last = (n?: number) =>
    makeHistoryArray(typeof n === "number" ? entries.slice(-n) : entries.slice(), store);
  arr.from = (senderId: string) => {
    const target = normalizeJid(store.resolveJid(normalizeJid(senderId)));
    return makeHistoryArray(entries.filter((e) => e.sender === target), store);
  };
  return arr;
}

export function buildMessageContext(
  msg: BotMessage,
  contract: WaContract,
  store: BotStore,
  guardOptions: { cooldown?: boolean; jitter?: boolean } = {}
): WAMessageContext {
  const sock = rawSocketOf(contract);
  const body    = getMsgBody(msg);
  const prefix  = CONFIG.CMD_PREFIX as string;
  const rawArgs = body.trim().split(/\s+/);
  const first   = rawArgs[0]?.toLowerCase() ?? "";
  const hasPrefix = first.startsWith(prefix);
  const command = hasPrefix ? first.slice(prefix.length) : "";

  const rawJid   = msg.chatId;
  const sender   = getMsgSender(msg, store);
  const cooldown = guardOptions.cooldown ?? true;
  const jitter   = guardOptions.jitter ?? true;

  const contextInfo = getContextInfo(msg) as
    | {
        stanzaId?: string | null;
        participant?: string | null;
        mentionedJid?: string[] | null;
        quotedMessage?: unknown;
      }
    | null;
  // Build a synthetic quoted BotMessage when the original envelope carries
  // a quotedMessage (the adapter pre-decodes the full IContextInfo into
  // msg._raw.contextInfo). The synthetic uses the same decodeContent
  // helper as toBotMessage so type/body/mimetype reflect what's actually
  // in the quoted payload — without this, msgHasMedia()/downloadMedia()
  // on the result of getReply() always reported type=other / no media,
  // even when the quoted message was an image/video/document/etc.
  //
  // We carry the same _raw.contextInfo on the synthetic so a recursive
  // getReply().getReply() keeps working (the inner call re-reads
  // getContextInfo off _raw.contextInfo).
  const quotedRaw: BotMessage | null = contextInfo?.quotedMessage
    ? (() => {
        const decoded = decodeContent(contextInfo.quotedMessage);
        return {
          id:          contextInfo.stanzaId ?? "",
          chatId:      msg.chatId,
          fromMe:      false,
          type:        decoded.type,
          contentHash: "",
          timestamp:   0,
          body:        decoded.body,
          mimetype:    decoded.mimetype,
          _raw: {
            contextInfo: {
              stanzaId:      contextInfo.stanzaId,
              participant:   contextInfo.participant,
              mentionedJid:  contextInfo.mentionedJid,
              quotedMessage: contextInfo.quotedMessage,
            },
          },
        } as BotMessage;
      })()
    : msg.quotedKey
      // No embedded quotedMessage (older envelopes, evicted from store, or
      // the quoted message pre-dates contextInfo-quoting). Fall back to a
      // key-only synthetic so hasReply()/getReply() still work, but
      // hasMedia/downloadMedia on the result will degrade gracefully
      // (type=other, mimetype=undefined).
      ? {
          id:          msg.quotedKey.id ?? "",
          chatId:      msg.chatId,
          fromMe:      false,
          type:        "other",
          contentHash: "",
          timestamp:   0,
        }
      : null;

  return {
    id:         msg.id,
    timestamp:  msg.timestamp || 0,
    body,
    type:       getMsgType(msg),
    fromMe:     msg.fromMe,
    sender,
    senderName: msg.pushName ?? sender.replace(/(:\d+)?@.*$/, ""),
    command,
    args: rawArgs.slice(1),
    is(cmd: string) {
      return hasPrefix && command === cmd.toLowerCase();
    },
    hasMedia: msgHasMedia(msg),
    isGif:    msgIsGif(msg, store),

    async downloadMedia(opts: { asMp4?: boolean } = {}): Promise<{ mimetype: string; data: string } | null> {
      try {
        // contract.downloadMedia handles reupload internally via the
        // driver's own protocol knowledge (Baileys: sock.updateMediaMessage).
        const result = await contract.downloadMedia(msg, {});
        if (!result) return null;
        const raw = rawMsgOf(msg, store);
        const isAnimatedSticker = !!((raw?.message as { stickerMessage?: { isAnimated?: boolean } } | undefined)?.stickerMessage?.isAnimated);
        if (opts.asMp4 && isAnimatedSticker) {
          const mp4 = await stickerToMp4(result.data);
          return { mimetype: "video/mp4", data: mp4.toString("base64") };
        }
        return { mimetype: result.mimetype, data: result.data.toString("base64") };
      } catch (err) {
        logger.warn(`[whatsapp] downloadMedia failed: ${(err as Error).message}`);
        return null;
      }
    },

    hasReply: !!(msg.quotedKey),

    async getReply(): Promise<WAMessageContext | null> {
      if (!quotedRaw) return null;
      return buildMessageContext(quotedRaw, contract, store, { cooldown: false, jitter: false });
    },

    hasMention: hasMention(contextInfo),
    hasBotMention: hasBotMention(contextInfo, sock, store),

    reply: makeSender(contract, store, rawJid, msg, { cooldown, jitter }),

    async react(emoji: string) {
      await contract.react(rawJid, {
        id:          msg.id,
        remoteJid:   msg.chatId,
        fromMe:      msg.fromMe,
        participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
      }, emoji);
    },

    async delete(forEveryone = true) {
      if (forEveryone) {
        await contract.deleteMessage(rawJid, {
          id:          msg.id,
          remoteJid:   msg.chatId,
          fromMe:      msg.fromMe,
          participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
        }, true);
      }
    },

    async edit(text: string) {
      if (!msg.fromMe) {
        throw new Error("[pluginApi] edit() can only be used on the bot's own messages");
      }
      if (!msg.id || !(await waitForEditSlot(msg.id))) return;
      await contract.editMessage(rawJid, {
        id:          msg.id,
        remoteJid:   msg.chatId,
        fromMe:      msg.fromMe,
        participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
      }, text);
    },

    async pin(_duration?: number) {
      logger.warn("[pluginApi] pin() is not supported with Baileys");
    },

    hasPrefix,

    /**
     * Normalized contact of the message sender.
     * @returns {Promise<object|null>} null if the sender can't be confirmed as a real WhatsApp account.
     */
    async getContact() {
      const info = (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[sender]
                ?? (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[denormalizeJid(sender)]
                ?? (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[store.resolveJid(msg.fromPn ?? "")]
                ?? (store.contacts as Record<string, import("#drivers/baileys/sdk/baileysSock.js").RawStoreContact>)[denormalizeJid(store.resolveJid(msg.fromPn ?? ""))];
      const botJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
      return normalizeContact(sender, info, botJid, contract);
    },
  };
}


// ── MessageHandle ─────────────────────────────────────────────────────────────

/**
 * Wraps a pending send and exposes chainable post-send actions.
 * Thenable: `await ctx.send.text("hi")` resolves to the message context.
 *
 * The wrapped `rawPromise` now resolves to a `BotMessage` (driver-neutral)
 * instead of a raw `WAMessage` — the driver writes its own sent message
 * into the in-memory store under jid+id, and the api reads it back as a
 * BotMessage (built from the adapter's WAMessage→BotMessage translator).
 * This keeps the rest of the api from depending on Baileys' wire shape.
 */
class MessageHandle implements PromiseLike<WAMessageContext | undefined> {
  private _p: Promise<WAMessageContext | undefined>;
  private _contract: WaContract;
  private _store: BotStore;
  private _jid: string | null = null;
  private _guardOptions: { cooldown?: boolean; jitter?: boolean };
  public rawPromise: Promise<BotMessage | undefined>;

  constructor(
    promise: Promise<BotMessage | undefined>,
    contract: WaContract,
    store: BotStore,
    guardOptions?: { cooldown?: boolean; jitter?: boolean }
  ) {
    this.rawPromise = promise;
    this._contract = contract;
    this._store = store;
    this._guardOptions = guardOptions ?? {};

    this._p = promise.then(msg => {
      if (!msg) return undefined;
      if (!this._jid) this._jid = msg.chatId || null;
      return buildMessageContext(msg, this._contract, store, guardOptions);
    });
  }

  then<TResult1 = WAMessageContext | undefined, TResult2 = never>(
    onfulfilled?: ((value: WAMessageContext | undefined) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this._p.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<WAMessageContext | undefined | TResult> {
    return this._p.catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<WAMessageContext | undefined> {
    return this._p.finally(onfinally);
  }

  /**
   * Reply to the sent message.
   * Returns a sender that will quote this message when methods are called.
   *
   * Usage:
   *   const audio = await ctx.send.audio("file.mp3");
   *   const reply = await audio.reply.text("here it is!");
   */
  get reply(): WAMessageSender {
    return makeSender(
      this._contract,
      this._store,
      this._jid || "",
      this.rawPromise,
      this._guardOptions
    );
  }

  /** Pin the sent message. */
  async pin(_duration?: number) {
    logger.warn("[pluginApi] pin() is not supported yet");
  }

  /** Delete the sent message. */
  async delete(forEveryone = true) {
    const msg = await this.rawPromise;
    if (!msg) return;
    if (forEveryone) {
      await this._contract.deleteMessage(msg.chatId, {
        id:          msg.id,
        remoteJid:   msg.chatId,
        fromMe:      msg.fromMe,
        participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
      }, true);
    }
  }

  /** React to the sent message. */
  async react(emoji: string) {
    const msg = await this.rawPromise;
    if (!msg) return;
    await this._contract.react(msg.chatId, {
      id:          msg.id,
      remoteJid:   msg.chatId,
      fromMe:      msg.fromMe,
      participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
    }, emoji);
  }

  /** Edit the sent message's text. Only works on the bot's own messages. */
  async edit(text: string) {
    const msg = await this.rawPromise;
    if (!msg) return;
    if (!msg.fromMe) {
      throw new Error("[pluginApi] edit() can only be used on the bot's own messages");
    }
    if (!msg.id || !(await waitForEditSlot(msg.id))) return;
    await this._contract.editMessage(msg.chatId, {
      id:          msg.id,
      remoteJid:   msg.chatId,
      fromMe:      msg.fromMe,
      participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
    }, text);
  }
}

// ── Sender factory ────────────────────────────────────────────────────────────

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "ignore" });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("ffmpeg not found on PATH — required to send .gif files. Install ffmpeg, or pass an already mp4-encoded file to gif()."));
      } else {
        reject(err);
      }
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
}

/**
 * Converts a raw .gif to an mp4 WhatsApp can actually decode as a video —
 * sending GIF89a bytes labeled as video/mp4 leaves the client unable to
 * play it (blurred placeholder + download button, no inline loop).
 */
async function gifToMp4(gifSource: string | Buffer): Promise<Buffer> {
  const outPath = path.join(os.tmpdir(), `${randomUUID()}.mp4`);
  const isBuffer = Buffer.isBuffer(gifSource);
  const inPath   = isBuffer ? path.join(os.tmpdir(), `${randomUUID()}.gif`) : gifSource;
  try {
    if (isBuffer) await writeFile(inPath, gifSource);
    await runFfmpeg([
      "-y",
      "-i", inPath,
      "-movflags", "faststart",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await unlink(outPath).catch(() => {});
    if (isBuffer) await unlink(inPath).catch(() => {});
  }
}

/**
 * Converts an animated-sticker WebP buffer to mp4.
 *
 * ffmpeg's own "webp" decoder cannot read animated WebP at all — it
 * silently skips the ANIM/ANMF chunks ("skipping unsupported chunk: ANIM",
 * "image data not found") and the whole conversion fails. This is a
 * long-standing ffmpeg limitation (still true as of ffmpeg-devel
 * discussion in mid-2025: "we have no [animated webp] decoder"), not
 * anything specific to this bot — passing an animated .webp straight to
 * `ffmpeg -i` always fails this way, no matter what you ask it to output.
 *
 * Workaround: use node-webpmux (already a project dependency, bundles its
 * own libwebp via WASM) to demux the animation into individual
 * single-frame WebP files — those decode fine with ffmpeg, since only the
 * ANIM *container* trips it up, not the WebP codec itself — then hand
 * ffmpeg a concat list with each frame's real delay so timing survives.
 *
 * Caveat: this assumes each ANMF frame is a full-canvas frame, which is
 * true for the vast majority of sticker-maker output. Stickers authored
 * with partial-frame deltas (a blend region smaller than the canvas)
 * won't composite correctly here — that would need full RGBA canvas
 * compositing via getFrameData() per frame, which isn't implemented.
 */
async function stickerToMp4(webpBuffer: Buffer): Promise<Buffer> {
  const img = new WebP.Image();
  await img.load(webpBuffer);
  const outPath = path.join(os.tmpdir(), `${randomUUID()}.mp4`);
  const scaleFilter = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

  if (!img.hasAnim) {
    // Not actually animated — a plain static webp decodes fine on its own.
    const inPath = path.join(os.tmpdir(), `${randomUUID()}.webp`);
    try {
      await writeFile(inPath, webpBuffer);
      await runFfmpeg([
        "-y",
        "-i", inPath,
        "-movflags", "faststart",
        "-pix_fmt", "yuv420p",
        "-vf", scaleFilter,
        outPath,
      ]);
      return await readFile(outPath);
    } finally {
      await unlink(inPath).catch(() => {});
      await unlink(outPath).catch(() => {});
    }
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "sticker-"));
  try {
    const frameBuffers = await img.demux({ buffers: true });
    const delays = (img.frames ?? []).map(f => (f.delay > 0 ? f.delay : 100)); // ms; WebP spec treats 0 as implementation-defined

    const listLines: string[] = [];
    for (let i = 0; i < frameBuffers.length; i++) {
      const framePath = path.join(dir, `frame_${i}.webp`);
      await writeFile(framePath, frameBuffers[i]);
      listLines.push(`file '${framePath}'`);
      listLines.push(`duration ${((delays[i] ?? 100) / 1000).toFixed(3)}`);
    }
    // The concat demuxer ignores the final `duration` line unless the last
    // file is listed once more after it.
    listLines.push(`file '${path.join(dir, `frame_${frameBuffers.length - 1}.webp`)}'`);
    const listPath = path.join(dir, "list.txt");
    await writeFile(listPath, listLines.join("\n"));

    await runFfmpeg([
      "-y",
      "-f", "concat", "-safe", "0",
      "-i", listPath,
      "-vsync", "vfr",
      "-pix_fmt", "yuv420p",
      "-vf", scaleFilter,
      "-movflags", "faststart",
      outPath,
    ]);
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/**
 * Returns send methods bound to a specific JID.
 *
 * @param {WaContract}                                                contract
 * @param {BotStore}                                                  store
 * @param {string}                                                    jid         — destination JID (raw, not normalized)
 * @param {BotMessage | Promise<BotMessage | null | undefined> | null} [quoted]   — message to quote (can be Promise)
 * @param {object}                                                    [guard]
 */
function makeSender(
  contract: WaContract,
  store:    BotStore,
  jid:      string,
  quoted:   BotMessage | Promise<BotMessage | null | undefined> | null = null,
  { cooldown = true, jitter = true } = {}
) {
  const normJid = normalizeJid(jid);

  // Helper: resolve quoted message if it's a Promise, then turn it into a
  // BotQuotedRef the contract's send methods accept.
  const resolveQuoted = async (): Promise<BotQuotedRef | undefined> => {
    if (!quoted) return undefined;
    const msg = quoted instanceof Promise ? (await quoted) || undefined : quoted;
    return msg ? quotedRefFromMsg(msg) : undefined;
  };

  return {
    text(content: string, opts: { linkPreview?: boolean; mentions?: string[] } = {}) {
      // The text path goes through sendFallbackGuard:
      // try the active driver, verify the message actually landed in the
      // driver's history, and on failure swap to the other driver. sendMedia
      // and react below still go straight to the contract on purpose — media
      // fallback is out of scope for this phase, react is one-shot and
      // already idempotent at the protocol level.
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        const mentionsResolved = opts.mentions?.length
          ? await resolveMentionJids(contract, store, jid, opts.mentions)
          : undefined;

        // Pre-send bookkeeping the Baileys path used to do inline:
        // waitForSendSlot is already invoked by sendFallbackGuard on the
        // primary attempt, so we don't repeat it here. simulateState is
        // best-effort and per-driver, so it stays on this side.
        await simulateState(contract, jid, typingDuration(content), "typing");

        const ref = await sendWithFallback(jid, content, {
          quoted: quotedRef ?? undefined,
          mentions: mentionsResolved,
        });

        // The guard returns a SentMessageRef (id + chatId + timestamp) but
        // the rest of the sender API (MessageHandle, buildPollApi's
        // rawMsg.chatId, etc.) expects the full BotMessage. The driver's
        // messages.upsert handler stores own sent messages into the store
        // keyed by jid+id, so we can read it back. Give the store a tiny
        // window to catch up — a freshly-sent message may not be in the
        // map yet on the very same tick — and return undefined if it
        // never lands; downstream code already tolerates that (e.g.
        // .reply / .delete are no-ops when rawPromise resolves to
        // undefined).
        const deadline = Date.now() + 200;
        while (Date.now() < deadline) {
          const stored = store.messages.get(ref.chatId)?.get(ref.id);
          if (stored) return toBotMessage(stored as WAProtoMsg);
          await new Promise<void>(r => setTimeout(r, 20));
        }
        const final = store.messages.get(ref.chatId)?.get(ref.id);
        return final ? toBotMessage(final as WAProtoMsg) : undefined;
      })(), contract, store, { cooldown, jitter });
    },

    image(source: string | Buffer, caption = "", opts: { viewOnce?: boolean; mentions?: string[] } = {}) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(caption), "typing");
        const buffer = await resolveMediaBuffer(source);
        const mentionsResolved = opts.mentions?.length
          ? await resolveMentionJids(contract, store, jid, opts.mentions)
          : undefined;
        const ref = await contract.sendImage(jid, buffer, {
          caption,
          quoted:     quotedRef ?? undefined,
          mentions:   mentionsResolved,
          viewOnce:   opts.viewOnce,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    video(source: string | Buffer, caption = "", opts: { viewOnce?: boolean; mentions?: string[] } = {}) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(caption), "typing");
        const buffer = await resolveMediaBuffer(source);
        const mentionsResolved = opts.mentions?.length
          ? await resolveMentionJids(contract, store, jid, opts.mentions)
          : undefined;
        const ref = await contract.sendVideo(jid, buffer, {
          caption,
          quoted:     quotedRef ?? undefined,
          mentions:   mentionsResolved,
          viewOnce:   opts.viewOnce,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    /**
     * Send a GIF. WhatsApp has no native GIF format — this sends an mp4
     * with the `gifPlayback` flag, which the client auto-loops, muted.
     * Accepts a path or a Buffer. `.gif` input (detected by extension for
     * a path, or by magic bytes for a Buffer) is converted to mp4 via
     * ffmpeg automatically; already mp4-encoded input is sent as-is, no
     * conversion cost.
     */
    gif(source: string | Buffer, caption = "", opts: { viewOnce?: boolean; mentions?: string[] } = {}) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(caption), "typing");
        const buffer = needsGifConversion(source)
          ? await gifToMp4(source)
          : await resolveMediaBuffer(source);
        const mentionsResolved = opts.mentions?.length
          ? await resolveMentionJids(contract, store, jid, opts.mentions)
          : undefined;
        const ref = await contract.sendVideo(jid, buffer, {
          caption,
          quoted:      quotedRef ?? undefined,
          mentions:    mentionsResolved,
          viewOnce:    opts.viewOnce,
          gifPlayback: true,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    audio(source: string | Buffer, { asVoice = true, viewOnce = false } = {}) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(), "recording");
        const buffer = await resolveMediaBuffer(source);
        const ref = await contract.sendAudio(jid, buffer, {
          quoted:   quotedRef ?? undefined,
          viewOnce: viewOnce,
          ptt:      asVoice,
          mimetype: "audio/mp4",
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    sticker(source: string | Buffer) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(), "typing");
        const buffer = await resolveMediaBuffer(source);
        const ref = await contract.sendSticker(jid, buffer, {
          quoted: quotedRef ?? undefined,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    file(source: string | Buffer, filename?: string) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(contract, jid, mediaDuration(), "typing");
        const isBuffer = Buffer.isBuffer(source);
        const buffer   = await resolveMediaBuffer(source);
        // With a path we can always infer the mimetype/name from it. With a
        // raw Buffer there's no extension to read, so an explicit `filename`
        // is what lets us infer the mimetype too — otherwise we fall back to
        // a generic octet-stream document named "file".
        const mimetype = filename ? mimeFromPath(filename) : (isBuffer ? "application/octet-stream" : mimeFromPath(source));
        const resolvedFilename = filename ?? (isBuffer ? "file" : path.basename(source));
        const ref = await contract.sendDocument(jid, buffer, resolvedFilename, mimetype, {
          quoted: quotedRef ?? undefined,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },

    /**
     * Send a poll.
     * @param {string}   question
     * @param {string[]} options
     * @param {object}   [opts]
     * @param {boolean}  [opts.allowMultipleAnswers=false]
     */
    poll(question: string, options: string[], { allowMultipleAnswers = false } = {}) {
      return new MessageHandle((async () => {
        const quotedRef = await resolveQuoted();
        await waitForSendSlot(normJid, { cooldown, jitter });
        const ref = await contract.sendPoll(jid, {
          name:            question,
          values:          options,
          selectableCount: allowMultipleAnswers ? 0 : 1,
          quoted:          quotedRef ?? undefined,
        });
        return refToBotMessage(ref, store);
      })(), contract, store, { cooldown, jitter });
    },
  };
}

/** Inferred shape of the chainable sender returned by makeSender() / ctx.send / ctx.msg.reply. */
export type WAMessageSender = ReturnType<typeof makeSender>;

// ── Send API ──────────────────────────────────────────────────────────────────

function buildSendApi(contract: WaContract, store: BotStore, rawJid: string, guardOptions: Record<string, unknown> = {}) {
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;
  const current  = makeSender(contract, store, rawJid, null, { cooldown, jitter });

  return {
    send: {
      text:    (text: string, opts?: Record<string, unknown>)           => current.text(text, opts),
      image:   (source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }) => current.image(source, caption, opts),
      video:   (source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }) => current.video(source, caption, opts),
      gif:     (source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }) => current.gif(source, caption, opts),
      audio:   (source: string | Buffer, opts?: Record<string, unknown>)       => current.audio(source, opts as never),
      sticker: (source: string | Buffer)                                       => current.sticker(source),
      file:    (source: string | Buffer, filename?: string)                    => current.file(source, filename),
      poll:    (q: string, opts: string[], cfg?: { allowMultipleAnswers?: boolean }) => current.poll(q, opts, cfg),

      /**
       * Returns a sender bound to another chat.
       * @param {string} targetJid
       */
      to: (targetJid: string) => makeSender(contract, store, targetJid, null, { cooldown: false, jitter: false }),
    },
  };
}

/** Setup send API — no current chat, only .to(). */
function buildSetupSendApi(contract: WaContract, store: BotStore) {
  return {
    send: {
      to: (targetJid: string) => makeSender(contract, store, targetJid),
    },
  };
}

// ── Events API ────────────────────────────────────────────────────────────────
//
// Plugins listen to driver events through this API. The set of supported
// event names is the same `WaEventName` union the contract declares — no
// raw `sock.ev` access here. Subscriptions are routed through
// `contract.on()`, which always returns an unsubscribe function. We
// mirror that handle in `listenerRegistry` so `cleanupPluginEvents()`
// (called on plugin reload / unload) can drop every listener at once.

import type { WaEventName, WaEventPayload } from "#kernel/waContract.js";

const WA_EVENT_NAMES: ReadonlySet<WaEventName> = new Set<WaEventName>([
  "messages.upsert",
  "messages.update",
  "messages.delete",
  "messaging-history.set",
  "chats.upsert",
  "chats.update",
  "chats.delete",
  "contacts.upsert",
  "contacts.update",
  "group-participants.update",
  "groups.upsert",
  "groups.update",
  "group.join-request",
  "blocklist.set",
  "blocklist.update",
  "connection.update",
]);

function assertSupportedEvent(event: string): asserts event is WaEventName {
  if (!WA_EVENT_NAMES.has(event as WaEventName)) {
    throw new Error(
      `[events] unsupported event "${event}". Supported: ${[...WA_EVENT_NAMES].join(", ")}. ` +
      `If you need this event, file an issue — adding events to WaEventName is a contract change.`
    );
  }
}

interface RegisteredListener {
  event:    WaEventName;
  handler:  (payload: unknown) => void;
  /** The unsubscribe handle returned by `contract.on()`. */
  detach:   () => void;
}

const listenerRegistry = new Map<string, Set<RegisteredListener>>();

export function cleanupPluginEvents(pluginName: string, _contract: WaContract): void {
  const list = listenerRegistry.get(pluginName);
  if (list) {
    for (const ref of list) {
      try { ref.detach(); } catch {}
    }
    listenerRegistry.delete(pluginName);
  }
  // The poll-vote subscription is created in `buildPollApi` by calling
  // `contract.on(...)` directly, so it lives outside `listenerRegistry`.
  // Detach it here so the listener doesn't outlive the plugin (and a
  // reloaded plugin can re-subscribe — `buildPollApi` gates on the
  // `boundPollPlugins` map).
  const pollDetach = boundPollPlugins.get(pluginName);
  if (pollDetach) {
    try { pollDetach(); } catch {}
    boundPollPlugins.delete(pluginName);
  }
  // Drop the per-plugin poll registry so reloading a plugin doesn't see
  // stale PollHandles from a prior instance.
  pollRegistry.delete(pluginName);
  cancelPlugin(pluginName);
}


/**
 * @param {WaContract} contract
 * @param {string}     pluginName
 */
function buildEventsApi(contract: WaContract, pluginName: string) {
  return {
    on<E extends WaEventName>(event: E, handler: (payload: WaEventPayload<E>) => void): () => void {
      assertSupportedEvent(event);
      const wrapped = (payload: unknown) => handler(payload as WaEventPayload<E>);
      const detach  = contract.on(event, wrapped);

      if (!listenerRegistry.has(pluginName)) listenerRegistry.set(pluginName, new Set());
      const ref: RegisteredListener = { event, handler: wrapped, detach };
      listenerRegistry.get(pluginName)!.add(ref);

      return () => {
        try { detach(); } catch {}
        listenerRegistry.get(pluginName)?.delete(ref);
      };
    },

    once<E extends WaEventName>(event: E): Promise<WaEventPayload<E>> {
      assertSupportedEvent(event);
      return new Promise<WaEventPayload<E>>((resolve) => {
        const off = this.on(event, (data) => { off(); resolve(data); });
      });
    },

    cleanup() {
      const list = listenerRegistry.get(pluginName);
      if (!list) return;
      for (const ref of list) {
        try { ref.detach(); } catch {}
      }
      listenerRegistry.delete(pluginName);
    },
  };
}

// ── Admin API ─────────────────────────────────────────────────────────────────

/**
 * Group administration actions.
 *
 * @param {WASocket}     sock
 * @param {string|null}  chatJid — raw JID of the current group (null in setup context)
 */
/**
 * Resolve mentions to the exact JID form the destination group uses for
 * that participant — not whatever store.resolveJid() happens to have
 * mapped it to. A group can address a member via @lid even when we've
 * separately learned their phone number; WhatsApp only tags/notifies a
 * mention when the JID matches the group's own addressing for that
 * member. DMs have no participant list to check against, so just wire-
 * normalize as before (mentions aren't a real thing in DMs anyway).
 */
async function resolveMentionJids(
  contract: WaContract,
  store: WAStore,
  jid: string,
  mentions: string[]
): Promise<string[]> {
  const result: string[] = [];

  for (const m of mentions) {
    const wire = toWireJid(m);
    if (wire) result.push(wire);

    const resolved = store.resolveJid(m);
    if (resolved && resolved !== m) {
      const resolvedWire = toWireJid(resolved);
      if (resolvedWire) result.push(resolvedWire);
    }
  }

  if (!jid.endsWith("@g.us")) {
    return Array.from(new Set(result.filter(Boolean)));
  }

  let meta;
  try {
    // getGroupMetadataCached uses the raw sock internally for the
    // Baileys-flavored participant field shape (admin: "admin" |
    // "superadmin", etc.); the neutral contract's groupMetadata doesn't
    // expose that yet.
    meta = await getGroupMetadataCached(contract, jid);
  } catch {
    return Array.from(new Set(result.filter(Boolean)));
  }

  for (const m of mentions) {
    const wire     = toWireJid(m);
    const resolved = normalizeJid(store.resolveJid(m));
    const match = meta.participants.find(p =>
      toWireJid(p.id) === wire || normalizeJid(store.resolveJid(p.id)) === resolved
    );
    if (match) {
      const matchWire = toWireJid(match.id);
      if (matchWire) result.push(matchWire);
    }
  }

  return Array.from(new Set(result.filter(Boolean)));
}

function buildAdminApi(contract: WaContract, chatJid: string | null) {
  const norm = (v: string | string[]): string[] =>
    (Array.isArray(v) ? v : [v]).map(toWireJid);

  function requireChat() {
    if (!chatJid) throw new Error("This admin operation requires a runtime group context.");
  }

  async function getGroup(jid: string) {
    const meta = await contract.groupMetadata(jid);
    if (!meta) throw new Error(`Group not found: ${jid}`);
    return meta;
  }

  /**
   * The contract's `groupParticipantsUpdate()` resolves normally even
   * when WhatsApp rejected some (or all) of the requested participants —
   * it returns an array with a per-participant `status` code (`'200'` =
   * success; anything else is a rejection — e.g. `'403'`/`'401'` not
   * authorized, often because the target's privacy settings block being
   * added by a non-contact; `'409'` already a participant; `'408'`
   * partial/timeout). A caller that only awaits the promise sees a
   * "successful" resolution even when nobody was actually
   * added/removed/promoted/demoted — silently reporting failure as
   * success. Throw here so `ctx.admin.add/kick/promote/demote` produce a
   * real rejection callers can catch, instead of a false positive.
   */
  function assertParticipantsUpdateOk(
    action: "add" | "remove" | "promote" | "demote",
    results: unknown
  ): void {
    if (!Array.isArray(results)) return; // unexpected shape — nothing to validate
    const failed = (results as { status?: string; jid?: string }[]).filter(
      (r) => r?.status && r.status !== "200"
    );
    if (failed.length > 0) {
      const detail = failed.map((r) => `${r.jid ?? "?"}=${r.status}`).join(", ");
      throw new Error(`groupParticipantsUpdate("${action}") rejeitado para: ${detail}`);
    }
  }

  /**
   * Thin wrapper around `contract.groupParticipantsUpdate()` that turns
   * an opaque rejection (e.g. the whole IQ query bounced with
   * "bad-request") into an error that names the group/action/participants
   * involved, then still runs the per-participant status check above.
   */
  async function runParticipantsUpdate(
    jid: string,
    users: string[],
    action: "add" | "remove" | "promote" | "demote"
  ) {
    let results: unknown;
    try {
      results = await contract.groupParticipantsUpdate(jid, users, action);
    } catch (err) {
      throw new Error(
        `groupParticipantsUpdate("${action}") falhou para o grupo "${jid}" com participantes [${users.join(", ")}]: ${(err as Error).message}`
      );
    }
    assertParticipantsUpdateOk(action, results);
    return results;
  }

  function createTargetableAction(
    action: (jid: string, users: string[]) => Promise<unknown>,
    memberIds: string | string[]
  ) {
    const users          = norm(memberIds);
    const executeCurrent = async () => { requireChat(); return action(chatJid!, users); };
    return {
      async to(targetJid: string) { await getGroup(targetJid); return action(targetJid, users); },
      then<TResult1 = any, TResult2 = never>(
        onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
      ): Promise<TResult1 | TResult2> {
        return executeCurrent().then(onfulfilled, onrejected);
      },
      catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
      ): Promise<any | TResult> {
        return executeCurrent().catch(onrejected);
      },
      finally(onfinally?: (() => void) | undefined | null): Promise<any> {
        return executeCurrent().finally(onfinally);
      },
    };
  }

  return {
    /** @param {string|string[]} memberIds — JID (@s.whatsapp.net/@lid), this framework's @c.us form, or a bare phone number */
    add(memberIds: string | string[]) {
      return createTargetableAction(
        (jid, users) => runParticipantsUpdate(jid, users, "add"),
        memberIds
      );
    },
    /** @param {string|string[]} memberIds — JID (@s.whatsapp.net/@lid), this framework's @c.us form, or a bare phone number */
    async kick(memberIds: string | string[]) {
      requireChat();
      return runParticipantsUpdate(chatJid!, norm(memberIds), "remove");
    },
    /** @param {string|string[]} memberIds — JID (@s.whatsapp.net/@lid), this framework's @c.us form, or a bare phone number */
    async promote(memberIds: string | string[]) {
      requireChat();
      return runParticipantsUpdate(chatJid!, norm(memberIds), "promote");
    },
    /** @param {string|string[]} memberIds — JID (@s.whatsapp.net/@lid), this framework's @c.us form, or a bare phone number */
    async demote(memberIds: string | string[]) {
      requireChat();
      return runParticipantsUpdate(chatJid!, norm(memberIds), "demote");
    },
    /** @param {string} name */
    async setSubject(name: string) {
      requireChat();
      return contract.groupUpdateSubject(chatJid!, name);
    },
    /** @param {string} text */
    async setDescription(text: string) {
      requireChat();
      return contract.groupUpdateDescription(chatJid!, text);
    },
    /** @param {string|Buffer} source */
    async setProfilePic(source: string | Buffer) {
      requireChat();
      const buffer = Buffer.isBuffer(source) ? source : readFileSync(source);
      return contract.updateProfilePicture(chatJid!, buffer);
    },
    async getInviteLink(groupId?: string) {
      const jid = groupId ?? chatJid;
      if (!jid) throw new Error("This admin operation requires a runtime group context.");
      const code = await contract.groupInviteCode(jid);
      return `https://chat.whatsapp.com/${code}`;
    },
    async revokeInvite() {
      requireChat();
      return contract.groupRevokeInvite(chatJid!);
    },
  };
}

// ── Me API ────────────────────────────────────────────────────────────────────

/** @param {WaContract} contract */
function buildMeApi(contract: WaContract) {
  return {
    /** @param {string} name */
    async setName(name: string) {
      return contract.updateProfileName(name);
    },
    /** @param {string} text */
    async setAbout(text: string) {
      return contract.updateProfileStatus(text);
    },
    /** @param {string|Buffer} source */
    async setProfilePic(source: string | Buffer) {
      const buffer = Buffer.isBuffer(source) ? source : readFileSync(source);
      const jid    = contract.me().id ?? "";
      return contract.updateProfilePicture(jid, buffer);
    },
  };
}

// ── Poll API ──────────────────────────────────────────────────────────────────

const pollRegistry = new Map<string, Map<string, PollHandle>>();
// Per-process map of plugin names whose poll-vote subscription is bound,
// to its unsubscribe handle. The contract handles rebinding to a fresh
// socket on reconnect (its `on()` returns an unsubscribe that drops
// cleanly on the dead socket's fan-out once it's torn down), so a simple
// per-process map is enough — no per-sock WeakMap needed anymore.
// `cleanupPluginEvents` MUST call the stored detach handle on unload so
// the listener doesn't outlive the plugin and so a reloaded plugin can
// re-subscribe.
const boundPollPlugins = new Map<string, () => void>();

/**
 * Tracks votes for an active poll.
 * Obtained via ctx.poll.create().
 */
export class PollHandle {
  msgId:      string;
  private _options:   Map<string, Set<string>>;
  private _callbacks: Array<(results: Record<string, number>, raw: unknown) => void>;
  private _registry:  Map<string, PollHandle>;

  constructor(msg: BotMessage, options: string[], registry: Map<string, PollHandle>) {
    this.msgId      = msg.id ?? "";
    this._options   = new Map(options.map(o => [o, new Set<string>()]));
    this._callbacks = [];
    this._registry  = registry;
  }

  /** Update from Baileys aggregated vote result. */
  _updateFromAggregated(aggregated: { name: string; voters: string[] }[]) {
    // Reset all counts then rebuild from aggregate
    for (const voters of this._options.values()) voters.clear();
    for (const { name, voters } of aggregated) {
      if (this._options.has(name))
        this._options.set(name, new Set(voters));
    }
    for (const cb of this._callbacks) cb(this.results(), aggregated);
  }

  /**
   * Register a callback invoked on every vote change.
   * @param cb Receives (results, raw)
   */
  onVote(cb: (results: Record<string, number>, raw: unknown) => void): this {
    this._callbacks.push(cb);
    return this;
  }

  /** Current tally as a plain object. */
  results(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, voters] of this._options) out[name] = voters.size;
    return out;
  }

  /** Name(s) of the leading option(s). Returns [] if no votes yet. */
  winner(): string[] {
    const res    = this.results();
    const counts = Object.values(res);
    if (!counts.length) return [];
    const max = Math.max(...counts);
    if (max === 0) return [];
    return Object.entries(res).filter(([, v]) => v === max).map(([k]) => k);
  }

  /** Remove this poll from tracking. */
  close(): void {
    this._registry.delete(this.msgId);
  }
}

/**
 * @param {WaContract} contract
 * @param {BotStore}   store
 * @param {string}     rawJid       — destination JID (not normalized)
 * @param {object}     guardOptions
 * @param {string}     pluginName
 */
function buildPollApi(
  contract:     WaContract,
  store:        BotStore,
  rawJid:       string,
  guardOptions: Record<string, unknown>,
  pluginName:   string
) {
  if (!pollRegistry.has(pluginName)) pollRegistry.set(pluginName, new Map());
  const registry = pollRegistry.get(pluginName)!;
  // Keyed by creationId -> (voterKey -> latest vote entry). WhatsApp resends
  // the *entire current selection* on every tap (not a diff), and the
  // aggregatePollVotes() contract method replays whatever pollUpdates you
  // give it with no dedup — so we must keep only the latest entry per
  // voter ourselves, or retracted/changed votes keep counting alongside
  // the new one.
  const pollVotesByCreationId = new Map<string, Map<string, unknown>>();

  // Poll decryption is Baileys-specific. Both the subscription
  // (`messages.upsert`) and the decryption/aggregation go through the
  // contract — `buildPollApi` doesn't touch the raw socket anymore. The
  // contract's optional methods are only implemented by the Baileys
  // adapter; drivers that don't have poll decryption leave them off the
  // contract and we silently no-op here (a bot on a non-Baileys driver
  // simply can't track poll votes).
  if (
    !boundPollPlugins.has(pluginName) &&
    typeof contract.decryptPollVote === "function" &&
    typeof contract.aggregatePollVotes === "function"
  ) {
    const detach = contract.on("messages.upsert", async ({ messages: msgs }) => {
      for (const msg of msgs) {
        // Filter poll-update messages by reading the raw envelope from
        // the store (the neutral `BotMessage` doesn't carry the
        // `pollUpdateMessage` field — it's a Baileys-proto detail).
        const raw = store.messages.get(msg.chatId)?.get(msg.id) as
          | { message?: { pollUpdateMessage?: unknown } }
          | undefined;
        const pum = raw?.message?.pollUpdateMessage as
          | { pollCreationMessageKey?: { id?: string; remoteJid?: string; participant?: string; participantPn?: string }; vote?: unknown; senderTimestampMs?: number | bigint | string }
          | undefined;
        if (!pum) continue;

        const creationKey = pum.pollCreationMessageKey;
        const creationId  = creationKey?.id ?? "";
        const handle       = registry.get(creationId);
        if (!handle) continue;

        const storeMsg = store.messages.get(creationKey?.remoteJid ?? "")?.get(creationId);
        const pollEncKeyRaw = (storeMsg?.message as { messageContextInfo?: { messageSecret?: Buffer | string } } | undefined)?.messageContextInfo?.messageSecret;
        if (!storeMsg || !pollEncKeyRaw || !pum.vote) continue;

        try {
          const decrypted = await contract.decryptPollVote!({
            voteKey: {
              id:          msg.id,
              remoteJid:   msg.chatId,
              fromMe:      msg.fromMe,
              participant: msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? null,
            },
            pollKey: {
              id:          creationId,
              remoteJid:   creationKey?.remoteJid ?? null,
              fromMe:      null,
              participant: creationKey?.participant ?? null,
            },
            pollEncKey: pollEncKeyRaw,
          });
          if (!decrypted) {
            throw new Error("decryptPollVote returned null — JID candidate exhaustion or stale enc key");
          }

          const voterKey = msg.fromMe
            ? (contract.me().id ?? "me")
            : jidNormalizedUser(msg.participantAlt ?? msg.fromLid ?? msg.chatId);

          const votesByVoter = pollVotesByCreationId.get(creationId) ?? new Map<string, unknown>();
          votesByVoter.set(voterKey, {
            pollUpdateMessageKey: { id: msg.id, remoteJid: msg.chatId, fromMe: msg.fromMe },
            vote:                 decrypted,
            senderTimestampMs:    pum.senderTimestampMs,
          });
          pollVotesByCreationId.set(creationId, votesByVoter);

          const pollAggregateOpts = contract.aggregatePollVotes!;
          type AggregateVotes = Parameters<typeof pollAggregateOpts>[0]["votes"];
          const aggregated = pollAggregateOpts({
            pollKey: {
              id:        creationId,
              remoteJid: creationKey?.remoteJid ?? null,
              fromMe:    null,
            },
            votes: Array.from(votesByVoter.values()).map((v) => (v as { vote: AggregateVotes[number] }).vote),
            selfJid: contract.me().id ?? undefined,
          });
          handle._updateFromAggregated(aggregated);
        } catch (err) {
          logger.error(`[poll] erro ao decriptar voto: ${err}`);
        }
      }
    });
    boundPollPlugins.set(pluginName, detach);
  }
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;

  return {
    /**
     * Send a poll and start tracking votes.
     * @param {string}   question
     * @param {string[]} options
     * @param {object}   [opts]
     * @param {boolean}  [opts.allowMultipleAnswers=false]
     * @returns {Promise<PollHandle>}
     */
    async create(question: string, options: string[], opts: { allowMultipleAnswers?: boolean } = {}) {
      const sender  = makeSender(contract, store, rawJid, null, { cooldown, jitter });
      const handlePromise = sender.poll(question, options, opts);
      const rawMsg = await handlePromise.rawPromise;
      if (!rawMsg) throw new Error("[poll] failed to send poll message");
      const handle = new PollHandle(rawMsg, options, registry);
      registry.set(handle.msgId, handle);

      // Ensure the poll message is in the store before any vote arrives —
      // messages.upsert isn't guaranteed to fire (or land in time) for the
      // bot's own sent messages, which previously dropped every vote.
      // The store still keeps raw WAMessages keyed by jid+id (the
      // poll-decryption path below reads the raw envelope off the store),
      // so push a raw entry back in here too. refToBotMessage keeps the
      // driver-neutral envelope current; rawStore keeps the Baileys shape
      // the decryption helper still needs.
      const remoteJid = rawMsg.chatId;
      if (remoteJid) {
        if (!store.messages.has(remoteJid)) store.messages.set(remoteJid, new Map());
        if (!store.messages.get(remoteJid)!.has(handle.msgId)) {
          store.messages.get(remoteJid)!.set(handle.msgId, rawMsg as unknown as WAProtoMsg);
        }
      }

      return handle;
    },

    /**
     * Retrieve an active PollHandle by its message ID.
     * @param {string} msgId
     */
    get(msgId: string) {
      return registry.get(msgId) ?? null;
    },
  };
}

// ── Base API (shared between setup and runtime) ───────────────────────────────

function buildBaseApi(
  contract:       WaContract,
  store:          BotStore,
  pluginRegistry: Map<string, PluginEntry>,
  pluginName:     string
) {
  const botJid = contract.me().id ? jidNormalizedUser(contract.me().id as string) : null;
  if (!botJid) logger.warn("[pluginApi] botId is null — socket may not be ready yet.");

  return {
    log,
    t,
    config:    buildConfigApi(),
    i18n:      buildI18nApi(),
    utils:     buildUtilsApi(),
    download:  buildDownloadApi(),
    scheduler: buildSchedulerApi(pluginName),
    plugins:   buildPluginsApi(pluginRegistry),
    chats:     buildChatsApi(store),
    contacts:  buildContactsApi(contract, store, botJid),
    storage:   buildStorageApi(pluginName),
    botId:     botJid,
  };
}

// ── Setup API ─────────────────────────────────────────────────────────────────

/**
 * Setup API — without message context.
 * Passed to plugin.setup(ctx) during initialization.
 *
 * @param {WaContract}              contract
 * @param {BotStore}                store
 * @param {Map<string, any>}        pluginRegistry
 * @param {string}                  pluginName
 */
export function buildSetupApi(
  contract:       WaContract,
  store:          BotStore,
  pluginRegistry: Map<string, PluginEntry>,
  pluginName:     string
): SetupContext {
  bindGroupMetaInvalidation(contract);
  return {
    ...buildBaseApi(contract, store, pluginRegistry, pluginName),
    ...buildSetupSendApi(contract, store),
    admin:    buildAdminApi(contract, null),
    events:   buildEventsApi(contract, pluginName),
    me:       buildMeApi(contract),
    settings: { global: buildSettingsApi(pluginName, "_global").global },
  };
}

// ── Runtime API ───────────────────────────────────────────────────────────────

/**
 * Runtime API — full context with message and chat.
 * Passed to plugin.default(ctx) on every message.
 *
 * @param {object}          params
 * @param {BotMessage}      params.msg
 * @param {WAChat}          params.chat
 * @param {WaContract}      params.contract
 * @param {BotStore}        params.store
 * @param {Map}             params.pluginRegistry
 * @param {string}          params.pluginName
 * @param {object}          [params.guardOptions]
 */
export function buildApi({
  msg,
  chat,
  contract,
  store,
  pluginRegistry,
  pluginName,
  guardOptions = {},
}: {
  msg:            BotMessage;
  chat:           WAChat;
  contract:       WaContract;
  store:          BotStore;
  pluginRegistry: Map<string, PluginEntry>;
  pluginName:     string;
  guardOptions?:  Record<string, unknown>;
}): PluginContext {
  const prefix  = CONFIG.CMD_PREFIX as string;
  const body    = getMsgBody(msg);
  const rawArgs = body.trim().split(/\s+/);
  const first   = rawArgs[0]?.toLowerCase() ?? "";
  const hasPrefix = first.startsWith(prefix);
  const command = hasPrefix ? first.slice(prefix.length) : "";

  const rawJid   = msg.chatId;
  const normJid  = normalizeJid(rawJid);
  const sender   = getMsgSender(msg, store);
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;

  bindGroupMetaInvalidation(contract);

  // Group participant JIDs come back in whatever addressing mode the group
  // uses (@lid or @s.whatsapp.net/@c.us) — same issue as poll vote decryption.
  // "sender" and the bot's own JID are usually PN-normalized, so a straight
  // `=== ` against an @lid participant list silently never matches, even
  // when the person genuinely is an admin. Compare every known form
  // (raw + store-resolved) on both sides instead of trusting a single shape.
  function matchesParticipant(candidates: (string | null | undefined)[], participantId: string): boolean {
    const pRaw      = normalizeJid(participantId);
    const pResolved = normalizeJid(store.resolveJid(pRaw));
    for (const raw of candidates) {
      if (!raw) continue;
      const c         = normalizeJid(raw);
      const cResolved = normalizeJid(store.resolveJid(c));
      if (c === pRaw || c === pResolved || cResolved === pRaw || cResolved === pResolved) return true;
    }
    return false;
  }

  return {
    ...buildBaseApi(contract, store, pluginRegistry, pluginName),
    ...buildSendApi(contract, store, rawJid, guardOptions),

    // ── msg ──────────────────────────────────────────────────────────────────

    msg: buildMessageContext(msg, contract, store, { cooldown, jitter }),

    // ── chat ─────────────────────────────────────────────────────────────────

    chat: {
      id:      normJid,
      name:    chat.name,
      isGroup: chat.isGroup,

      /**
       * Cached message history for this chat (oldest → newest), capped at
       * the store's per-chat limit. Supports index access (`history[10]`)
       * and two chainable filters: `.last(n)` and `.from(senderId)`.
       * @returns {WAHistoryArray}
       */
      get history(): WAHistoryArray {
        const chatMsgs = store.messages.get(rawJid);
        const entries = chatMsgs
          ? [...chatMsgs.values()].map((m) => buildMessageContext(toBotMessage(m as WAProtoMsg), contract, store, { cooldown: false, jitter: false }))
          : [];
        return makeHistoryArray(entries, store);
      },

      /**
       * List of group participants.
       * Returns [] for non-group chats.
       * @returns {Promise<Array<{ id: string, isAdmin: boolean, isSuperAdmin: boolean }>>}
       */
      async getParticipants(): Promise<Array<{ id: string; isAdmin: boolean; isSuperAdmin: boolean }>> {
        if (!chat.isGroup) return [];
        try {
          const meta = await getGroupMetadataCached(contract, rawJid);
          return meta.participants.map(p => ({
            id:           normalizeJid(p.id),
            isAdmin:      p.admin === "admin" || p.admin === "superadmin",
            isSuperAdmin: p.admin === "superadmin",
          }));
        } catch {
          return [];
        }
      },

      /**
       * Check if a contact is an admin of this group.
       * @param {string} contactId
       * @returns {Promise<boolean>}
       */
      async isAdmin(contactId: string): Promise<boolean> {
        if (!chat.isGroup) return false;
        try {
          const meta = await getGroupMetadataCached(contract, rawJid);
          return meta.participants.some(
            p => matchesParticipant([contactId], p.id) && (p.admin === "admin" || p.admin === "superadmin")
          );
        } catch {
          return false;
        }
      },

      /**
       * Check if the message sender is an admin of this group.
       * @returns {Promise<boolean>}
       */
      async isSenderAdmin(): Promise<boolean> {
        if (!chat.isGroup) return false;
        try {
          const meta = await getGroupMetadataCached(contract, rawJid);
          // The adapter's pre-extracted participant fields give us both the
          // LID and PN forms of the sender; match either against the group's
          // own participant list.
          const rawSenderParticipant =
            msg.participantAlt ?? msg.fromLid ?? msg.fromPn ?? msg.chatId ?? "";
          return meta.participants.some(
            p => matchesParticipant([sender, rawSenderParticipant], p.id) && (p.admin === "admin" || p.admin === "superadmin")
          );
        } catch {
          return false;
        }
      },

      /**
       * Check if the bot is an admin of this group.
       * @returns {Promise<boolean>}
       */
      async isBotAdmin(): Promise<boolean> {
        if (!chat.isGroup) return false;
        const me       = contract.me();
        const botLid   = (me as unknown as { lid?: string })?.lid;
        const botCandidates = [me.id, botLid];
        if (!botCandidates.some(Boolean)) return false;
        try {
          const meta = await getGroupMetadataCached(contract, rawJid);
          return meta.participants.some(
            p => matchesParticipant(botCandidates, p.id) && (p.admin === "admin" || p.admin === "superadmin")
          );
        } catch {
          return false;
        }
      },

      /** Clear all messages in this chat — not supported in Baileys. */
      async clearMessages() {
        logger.warn("[pluginApi] clearMessages() is not supported with Baileys");
      },

    },

    // ── admin ─────────────────────────────────────────────────────────────────

    admin: buildAdminApi(contract, rawJid),

    // ── me ────────────────────────────────────────────────────────────────────

    me: buildMeApi(contract),

    // ── poll ──────────────────────────────────────────────────────────────────

    poll: buildPollApi(contract, store, rawJid, guardOptions, pluginName),

    // ── settings ──────────────────────────────────────────────────────────────

    settings: buildSettingsApi(pluginName, normJid),

    // ── isolated platform contexts ────────────────────────────────────────────

    wa: {
      contract,
      store,
      msg,
      downloadMedia: async (opts: { asMp4?: boolean } = {}) => {
        try {
          const result = await contract.downloadMedia(msg, opts);
          if (!result) return null;
          return { mimetype: result.mimetype, data: result.data.toString("base64") };
        } catch (err) {
          logger.warn(`[whatsapp] downloadMedia failed: ${(err as Error).message}`);
          return null;
        }
      }
    },
    tg: null,
    dc: null,
  };
}
