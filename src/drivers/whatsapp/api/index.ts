/**
 * drivers/whatsapp/api/index.ts
 *
 * WhatsApp plugin context builder.
 * Exports buildApi() and buildSetupApi() for the WhatsApp driver.
 *
 * Plugins receive a `ctx` object built by buildApi().
 * All wwjs types have been replaced with Baileys equivalents.
 * The ctx surface area is preserved so existing plugins stay compatible.
 */

import type { PluginEntry }          from "#kernel/pluginLoader.js";
import type { WASocket, WAStore, WAProtoMsg, WAChat, WAStoreContact, proto } from "#types";
import { logger }                    from "#logger";
import { t, createPluginT,
         reloadTranslations,
         getCurrentLang }            from "#i18n";
import { CONFIG, CONFIG_DIR }        from "#config";
import { enqueue }                   from "#download";
import { schedule, cancelPlugin }    from "#kernel/scheduler.js";
import { emptyFolder }               from "#utils/file.js";
import { normalizeJid, toPresenceCapable } from "../sdk/baileysSock.js";
import { mkdirSync }                 from "fs";
import { readFile, writeFile }       from "fs/promises";
import { readFileSync }              from "fs";
import path                          from "path";
import { waitForSendSlot, simulateState,
         typingDuration, mediaDuration } from "#sendguard";
import { buildSettingsApi }          from "#settingsdb";
import { downloadMediaMessage,
         getAggregateVotesInPollMessage,
         decryptPollVote,
         jidNormalizedUser } from "@whiskeysockets/baileys";

// ── Message body / type helpers ───────────────────────────────────────────────

function getMsgBody(msg: WAProtoMsg): string {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    ""
  ) as string;
}

function getMsgType(msg: WAProtoMsg): string {
  const m = msg.message;
  if (!m) return "unknown";
  if (m.conversation || m.extendedTextMessage)     return "chat";
  if (m.imageMessage)                              return "image";
  if (m.videoMessage)                              return "video";
  if (m.audioMessage)                              return "audio";
  if (m.stickerMessage)                            return "sticker";
  if (m.documentMessage)                           return "document";
  if (m.pollCreationMessage ||
      m.pollCreationMessageV2 ||
      m.pollCreationMessageV3)                     return "poll";
  return "unknown";
}

function msgHasMedia(msg: WAProtoMsg): boolean {
  const m = msg.message;
  return !!(m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.documentMessage || m?.stickerMessage);
}

function msgIsGif(msg: WAProtoMsg): boolean {
  return !!(msg.message?.videoMessage?.gifPlayback);
}

/** Sender JID — group participant or DM remote JID, normalized. */
function getMsgSender(msg: WAProtoMsg, store: WAStore): string {
  const raw = normalizeJid(msg.key.participant || msg.key.remoteJid || "");
  return normalizeJid(store.resolveJid(raw));
}

function getContextInfo(msg: WAProtoMsg): proto.IContextInfo | null {
  const m = msg.message;
  return (
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    m?.videoMessage?.contextInfo ??
    m?.audioMessage?.contextInfo ??
    m?.documentMessage?.contextInfo ??
    null
  );
}

function getMsgMimetype(msg: WAProtoMsg): string {
  const m = msg.message;
  return (
    m?.imageMessage?.mimetype ??
    m?.videoMessage?.mimetype ??
    m?.audioMessage?.mimetype ??
    m?.documentMessage?.mimetype ??
    m?.stickerMessage?.mimetype ??
    "application/octet-stream"
  ) as string;
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

/**
 * Build a WAChat adapter from a Baileys message + store.
 * Exposed for use in messageHandler.ts.
 *
 * @param {WAProtoMsg} msg
 * @param {WAStore}    store
 * @param {WASocket}   sock
 * @returns {Promise<WAChat>}
 */
export async function buildChatFromMsg(msg: WAProtoMsg, store: WAStore, sock: WASocket): Promise<WAChat> {
  const rawJid = msg.key.remoteJid ?? "";
  const jid    = normalizeJid(rawJid);
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
        const meta = await sock.groupMetadata(rawJid);
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
 * Build a normalized contact object from a JID and optional store metadata.
 * isBusiness is resolved via sock.getBusinessProfile(jid) — it resolves to
 * a profile only for WhatsApp Business accounts, undefined otherwise.
 * @param {string}           jid
 * @param {WAStoreContact}   [info]
 * @param {string|null}      [botJid]
 * @param {WASocket}         [sock]
 */
async function normalizeContact(jid: string, info: WAStoreContact | undefined, botJid: string | null | undefined, sock?: WASocket) {
  const number = jid.split("@")[0];
  let isBusiness = false;
  // We already have a contact record for this jid (learned from a real
  // contacts.upsert or an actual message from them) — that alone proves
  // it's a real WhatsApp account. Only fall back to the onWhatsApp() query
  // when we don't, since that query is PN-oriented and unreliable for a
  // raw @lid we've never resolved to a phone number (returns a false
  // "doesn't exist" instead of throwing).
  let isWAAccount = Boolean(info);
  if (!isWAAccount && sock && !jid.endsWith("@g.us")) {
    try {
      const results = await sock.onWhatsApp(jid);
      isWAAccount = Boolean(results?.[0]?.exists);
    } catch {
      // Couldn't verify — leave as false rather than claiming certainty.
      isWAAccount = false;
    }
  }
  if (sock && !jid.endsWith("@g.us")) {
    try {
      isBusiness = Boolean(await sock.getBusinessProfile(jid));
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
    mention:      { text: `@${number}`, mentions: [jid] },
  };
}

// ── Contact API ───────────────────────────────────────────────────────────────

function buildContactsApi(sock: WASocket, store: WAStore, botJid: string | null) {
  return {
    /**
     * Get a normalized contact object by JID.
     * @param {string} contactId
     * @returns {Promise<object|null>}
     */
    async get(contactId: string) {
      const resolved = normalizeJid(store.resolveJid(normalizeJid(contactId)));
      // The same person's data can be split across the raw (e.g. @lid) and
      // store-resolved (PN) keys — one may have `notify` and the other
      // `verifiedName`/`name`. Merge instead of taking whichever key
      // happens to exist first, or we silently drop real fields.
      const raw      = (store.contacts as Record<string, WAStoreContact>)[contactId];
      const resolvedInfo = (store.contacts as Record<string, WAStoreContact>)[resolved];
      const info = (raw || resolvedInfo) ? { ...raw, ...resolvedInfo } as WAStoreContact : undefined;
      return normalizeContact(resolved, info, botJid, sock);
    },

    /**
     * Get the profile picture URL of a contact.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getPfpUrl(contactId: string) {
      const resolved = normalizeJid(store.resolveJid(normalizeJid(contactId)));
      try {
        const url = await sock.profilePictureUrl(resolved, "image");
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
        const res = await (sock as unknown as {
          fetchStatus(jid: string): Promise<
            { status?: string }
            | { id: string; status?: { status?: string | null; setAt?: Date } }[]
            | undefined
          >
        }).fetchStatus(resolved);
        // Current Baileys versions return a USync result array
        // (`[{ id, status: { status, setAt } }]`) instead of the legacy
        // single `{ status }` object — handle both shapes.
        if (Array.isArray(res)) {
          const entry = res.find(r => normalizeJid(r.id) === resolved) ?? res[0];
          return entry?.status?.status ?? null;
        }
        return res?.status ?? null;
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
      return (sock as unknown as {
        updateBlockStatus(jid: string, action: string): Promise<void>
      }).updateBlockStatus(contactId, "block");
    },

    /**
     * Unblock a contact.
     * @param {string} contactId
     */
    async unblock(contactId: string) {
      return (sock as unknown as {
        updateBlockStatus(jid: string, action: string): Promise<void>
      }).updateBlockStatus(contactId, "unblock");
    },
  };
}

export function buildMessageContext(
  msg: WAProtoMsg,
  sock: WASocket,
  store: WAStore,
  guardOptions: { cooldown?: boolean; jitter?: boolean } = {}
) {
  const body    = getMsgBody(msg);
  const prefix  = CONFIG.CMD_PREFIX as string;
  const rawArgs = body.trim().split(/\s+/);
  const first   = rawArgs[0]?.toLowerCase() ?? "";
  const hasPrefix = first.startsWith(prefix);
  const command = hasPrefix ? first.slice(prefix.length) : "";

  const rawJid   = msg.key.remoteJid ?? "";
  const sender   = getMsgSender(msg, store);
  const cooldown = guardOptions.cooldown ?? true;
  const jitter   = guardOptions.jitter ?? true;

  const contextInfo = getContextInfo(msg);
  const quotedRaw: WAProtoMsg | null = contextInfo?.quotedMessage
    ? {
        key: {
          remoteJid:   rawJid,
          fromMe:      false,
          id:          contextInfo.stanzaId ?? undefined,
          participant: contextInfo.participant ?? undefined,
        },
        message:  contextInfo.quotedMessage,
        pushName: null,
      }
    : null;

  return {
    body,
    type:       getMsgType(msg),
    fromMe:     !!(msg.key.fromMe),
    sender,
    senderName: msg.pushName ?? sender.replace(/(:\d+)?@.*$/, ""),
    command,
    args: rawArgs.slice(1),
    is(cmd: string) {
      return hasPrefix && command === cmd.toLowerCase();
    },
    hasMedia: msgHasMedia(msg),
    isGif:    msgIsGif(msg),

    async downloadMedia(): Promise<{ mimetype: string; data: string } | null> {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {});
        if (!buffer || !Buffer.isBuffer(buffer)) return null;
        return { mimetype: getMsgMimetype(msg), data: buffer.toString("base64") };
      } catch {
        return null;
      }
    },

    hasReply: !!(contextInfo?.quotedMessage),

    async getReply(): Promise<WAProtoMsg | null> {
      return quotedRaw;
    },

    reply: makeSender(sock, store, rawJid, msg, { cooldown, jitter }),

    async react(emoji: string) {
      return sock.sendMessage(rawJid, { react: { text: emoji, key: msg.key } });
    },

    async delete(forEveryone = true) {
      if (forEveryone) {
        return sock.sendMessage(rawJid, { delete: msg.key });
      }
    },

    async pin(_duration?: number) {
      logger.warn("[pluginApi] pin() is not supported with Baileys");
    },

    hasPrefix,

    async getContact() {
      const info = (store.contacts as Record<string, WAStoreContact>)[sender]
                ?? (store.contacts as Record<string, WAStoreContact>)[store.resolveJid(msg.key.participant ?? "")];
      const botJid = sock.user?.id ? normalizeJid(sock.user.id) : null;
      return normalizeContact(sender, info, botJid, sock);
    },
  };
}

/** Inferred shape of the `ctx.msg` object passed to plugins on every message. */
export type WAMessageContext = ReturnType<typeof buildMessageContext>;

// ── MessageHandle ─────────────────────────────────────────────────────────────

/**
 * Wraps a pending send and exposes chainable post-send actions.
 * Thenable: `await ctx.send.text("hi")` resolves to the message context.
 */
class MessageHandle implements PromiseLike<WAMessageContext | undefined> {
  private _p: Promise<WAMessageContext | undefined>;
  private _sock: WASocket;
  private _store: WAStore;
  private _jid: string | null = null;
  private _guardOptions: { cooldown?: boolean; jitter?: boolean };
  public rawPromise: Promise<WAProtoMsg | undefined>;

  constructor(
    promise: Promise<WAProtoMsg | undefined>,
    sock: WASocket,
    store: WAStore,
    guardOptions?: { cooldown?: boolean; jitter?: boolean }
  ) {
    this.rawPromise = promise;
    this._sock = sock;
    this._store = store;
    this._guardOptions = guardOptions ?? {};

    this._p = promise.then(msg => {
      if (!msg) return undefined;
      if (!this._jid) this._jid = msg.key.remoteJid || null;
      return buildMessageContext(msg, sock, store, guardOptions);
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
      this._sock,
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
    if (!msg?.key) return;
    const jid = msg.key.remoteJid!;
    if (forEveryone) {
      return this._sock.sendMessage(jid, { delete: msg.key });
    }
  }

  /** React to the sent message. */
  async react(emoji: string) {
    const msg = await this.rawPromise;
    if (!msg?.key) return;
    return this._sock.sendMessage(msg.key.remoteJid!, {
      react: { text: emoji, key: msg.key },
    });
  }
}

// ── Sender factory ────────────────────────────────────────────────────────────

/**
 * Returns send methods bound to a specific JID.
 *
 * @param {WASocket}                                    sock
 * @param {WAStore}                                     store
 * @param {string}                                      jid         — destination JID (raw, not normalized)
 * @param {WAProtoMsg | Promise<WAProtoMsg | null>}    [quoted]    — message to quote (can be Promise)
 * @param {object}                                      [guard]
 */
function makeSender(
  sock:   WASocket,
  store:  WAStore,
  jid:    string,
  quoted: WAProtoMsg | Promise<WAProtoMsg | null | undefined> | null = null,
  { cooldown = true, jitter = true } = {}
) {
  const normJid = normalizeJid(jid);

  // Helper: resolve quoted message if it's a Promise
  const resolveQuoted = async () => {
    if (!quoted) return undefined;
    if (quoted instanceof Promise) {
      const result = await quoted;
      return result || undefined;
    }
    return quoted as WAProtoMsg;
  };

  return {
    text(content: string, opts: { linkPreview?: boolean; mentions?: string[] } = {}) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const sendOpts: any = quotedMsg ? { quoted: quotedMsg } : undefined;
        if (opts.linkPreview === false) {
          sendOpts.linkPreview = false;
        }
        if (opts.mentions?.length) {
          sendOpts.mentions = opts.mentions;
        }
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, typingDuration(content), "typing");
        return sock.sendMessage(jid, { text: content }, sendOpts);
      })(), sock, store, { cooldown, jitter });
    },

    image(filePath: string, caption = "", opts: { viewOnce?: boolean } = {}) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const sendOpts: any = quotedMsg ? { quoted: quotedMsg } : undefined;
        if (opts.viewOnce) {
          sendOpts.viewOnce = true;
        }
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, mediaDuration(), "typing");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { image: buffer, caption }, sendOpts);
      })(), sock, store, { cooldown, jitter });
    },

    video(filePath: string, caption = "", opts: { viewOnce?: boolean } = {}) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const sendOpts: any = quotedMsg ? { quoted: quotedMsg } : undefined;
        if (opts.viewOnce) {
          sendOpts.viewOnce = true;
        }
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, mediaDuration(), "typing");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { video: buffer, caption }, sendOpts);
      })(), sock, store, { cooldown, jitter });
    },

    audio(filePath: string, { asVoice = true, viewOnce = false } = {}) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const sendOpts: any = quotedMsg ? { quoted: quotedMsg } : undefined;
        if (viewOnce) {
          sendOpts.viewOnce = true;
        }
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, mediaDuration(), "recording");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt: asVoice }, sendOpts);
      })(), sock, store, { cooldown, jitter });
    },

    sticker(source: string | Buffer) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const qOpts = quotedMsg ? { quoted: quotedMsg } : undefined;
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, mediaDuration(), "typing");
        const buffer = Buffer.isBuffer(source) ? source : await readFile(source);
        return sock.sendMessage(jid, { sticker: buffer }, qOpts);
      })(), sock, store, { cooldown, jitter });
    },

    file(filePath: string, filename?: string) {
      return new MessageHandle((async () => {
        const quotedMsg = await resolveQuoted();
        const qOpts = quotedMsg ? { quoted: quotedMsg } : undefined;
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(toPresenceCapable(sock), jid, mediaDuration(), "typing");
        const buffer   = await readFile(filePath);
        const mimetype = mimeFromPath(filePath);
        return sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName: filename ?? path.basename(filePath),
        }, qOpts);
      })(), sock, store, { cooldown, jitter });
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
        const quotedMsg = await resolveQuoted();
        const qOpts = quotedMsg ? { quoted: quotedMsg } : undefined;
        await waitForSendSlot(normJid, { cooldown, jitter });
        return sock.sendMessage(jid, {
          poll: {
            name:            question,
            values:          options,
            selectableCount: allowMultipleAnswers ? 0 : 1,
          },
        } as Parameters<typeof sock.sendMessage>[1], qOpts);
      })(), sock, store, { cooldown, jitter });
    },
  };
}

/** Inferred shape of the chainable sender returned by makeSender() / ctx.send / ctx.msg.reply. */
export type WAMessageSender = ReturnType<typeof makeSender>;

// ── Send API ──────────────────────────────────────────────────────────────────

function buildSendApi(sock: WASocket, store: WAStore, rawJid: string, guardOptions: Record<string, unknown> = {}) {
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;
  const current  = makeSender(sock, store, rawJid, null, { cooldown, jitter });

  return {
    send: {
      text:    (text: string, opts?: Record<string, unknown>)           => current.text(text, opts),
      image:   (filePath: string, caption?: string)                     => current.image(filePath, caption),
      video:   (filePath: string, caption?: string)                     => current.video(filePath, caption),
      audio:   (filePath: string, opts?: Record<string, unknown>)       => current.audio(filePath, opts as never),
      sticker: (source: string | Buffer)                                => current.sticker(source),
      file:    (filePath: string, filename?: string)                    => current.file(filePath, filename),
      poll:    (q: string, opts: string[], cfg?: { allowMultipleAnswers?: boolean }) => current.poll(q, opts, cfg),

      /**
       * Returns a sender bound to another chat.
       * @param {string} targetJid
       */
      to: (targetJid: string) => makeSender(sock, store, targetJid, null, { cooldown: false, jitter: false }),
    },
  };
}

/** Setup send API — no current chat, only .to(). */
function buildSetupSendApi(sock: WASocket, store: WAStore) {
  return {
    send: {
      to: (targetJid: string) => makeSender(sock, store, targetJid),
    },
  };
}

// ── Events API ────────────────────────────────────────────────────────────────

const listenerRegistry = new Map<string, Set<{ event: string; handler: (...args: unknown[]) => void }>>();

export function cleanupPluginEvents(pluginName: string, sock: WASocket): void {
  const list = listenerRegistry.get(pluginName);
  if (list) {
    for (const { event, handler } of list) {
      try {
        (sock.ev as unknown as NodeJS.EventEmitter).off(event, handler);
      } catch {}
    }
    listenerRegistry.delete(pluginName);
  }
  cancelPlugin(pluginName);
}


/**
 * @param {WASocket} sock
 * @param {string}   pluginName
 */
function buildEventsApi(sock: WASocket, pluginName: string) {
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      (sock.ev as unknown as NodeJS.EventEmitter).on(event, handler);

      if (!listenerRegistry.has(pluginName)) listenerRegistry.set(pluginName, new Set());
      const ref = { event, handler };
      listenerRegistry.get(pluginName)!.add(ref);

      return () => {
        (sock.ev as unknown as NodeJS.EventEmitter).off(event, handler);
        listenerRegistry.get(pluginName)?.delete(ref);
      };
    },

    once(event: string) {
      return new Promise(resolve => {
        const off = this.on(event, (data) => { off(); resolve(data); });
      });
    },

    cleanup() {
      const list = listenerRegistry.get(pluginName);
      if (!list) return;
      for (const { event, handler } of list)
        (sock.ev as unknown as NodeJS.EventEmitter).off(event, handler);
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
function buildAdminApi(sock: WASocket, chatJid: string | null) {
  const norm = (v: string | string[]): string[] => Array.isArray(v) ? v : [v];

  function requireChat() {
    if (!chatJid) throw new Error("This admin operation requires a runtime group context.");
  }

  async function getGroup(jid: string) {
    const meta = await sock.groupMetadata(jid);
    if (!meta) throw new Error(`Group not found: ${jid}`);
    return meta;
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
    /** @param {string|string[]} memberIds */
    add(memberIds: string | string[]) {
      return createTargetableAction(
        (jid, users) => sock.groupParticipantsUpdate(jid, users, "add"),
        memberIds
      );
    },
    /** @param {string|string[]} memberIds */
    async kick(memberIds: string | string[]) {
      requireChat();
      return sock.groupParticipantsUpdate(chatJid!, norm(memberIds), "remove");
    },
    /** @param {string|string[]} memberIds */
    async promote(memberIds: string | string[]) {
      requireChat();
      return sock.groupParticipantsUpdate(chatJid!, norm(memberIds), "promote");
    },
    /** @param {string|string[]} memberIds */
    async demote(memberIds: string | string[]) {
      requireChat();
      return sock.groupParticipantsUpdate(chatJid!, norm(memberIds), "demote");
    },
    /** @param {string} name */
    async setSubject(name: string) {
      requireChat();
      return sock.groupUpdateSubject(chatJid!, name);
    },
    /** @param {string} text */
    async setDescription(text: string) {
      requireChat();
      return sock.groupUpdateDescription(chatJid!, text);
    },
    /** @param {string|Buffer} source */
    async setProfilePic(source: string | Buffer) {
      requireChat();
      const buffer = Buffer.isBuffer(source) ? source : readFileSync(source);
      return sock.updateProfilePicture(chatJid!, buffer);
    },
    async getInviteLink() {
      requireChat();
      const code = await sock.groupInviteCode(chatJid!);
      return `https://chat.whatsapp.com/${code}`;
    },
    async revokeInvite() {
      requireChat();
      return sock.groupRevokeInvite(chatJid!);
    },
  };
}

// ── Me API ────────────────────────────────────────────────────────────────────

/** @param {WASocket} sock */
function buildMeApi(sock: WASocket) {
  return {
    /** @param {string} name */
    async setName(name: string) {
      return sock.updateProfileName(name);
    },
    /** @param {string} text */
    async setAbout(text: string) {
      return sock.updateProfileStatus(text);
    },
    /** @param {string|Buffer} source */
    async setProfilePic(source: string | Buffer) {
      const buffer = Buffer.isBuffer(source) ? source : readFileSync(source);
      const jid    = sock.user?.id ?? "";
      return sock.updateProfilePicture(jid, buffer);
    },
  };
}

// ── Poll API ──────────────────────────────────────────────────────────────────

const pollRegistry  = new Map<string, Map<string, PollHandle>>();
const pollListeners = new Set<string>();

/**
 * Tracks votes for an active poll.
 * Obtained via ctx.poll.create().
 */
class PollHandle {
  msgId:      string;
  private _options:   Map<string, Set<string>>;
  private _callbacks: Array<(results: Record<string, number>, raw: unknown) => void>;
  private _registry:  Map<string, PollHandle>;

  constructor(msg: WAProtoMsg, options: string[], registry: Map<string, PollHandle>) {
    this.msgId      = msg.key.id ?? "";
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
 * @param {WASocket} sock
 * @param {WAStore}  store
 * @param {string}   rawJid       — destination JID (not normalized)
 * @param {object}   guardOptions
 * @param {string}   pluginName
 */
function buildPollApi(
  sock:         WASocket,
  store:        WAStore,
  rawJid:       string,
  guardOptions: Record<string, unknown>,
  pluginName:   string
) {
  if (!pollRegistry.has(pluginName)) pollRegistry.set(pluginName, new Map());
  const registry = pollRegistry.get(pluginName)!;
  // Keyed by creationId -> (voterKey -> latest vote entry). WhatsApp resends
  // the *entire current selection* on every tap (not a diff), and Baileys'
  // getAggregateVotesInPollMessage() replays whatever pollUpdates you give it
  // with no dedup — so we must keep only the latest entry per voter ourselves,
  // or retracted/changed votes keep counting alongside the new one.
  const pollVotesByCreationId = new Map<string, Map<string, unknown>>();

  if (!pollListeners.has(pluginName)) {
    pollListeners.add(pluginName);
  
    const meId = sock.user?.id ? jidNormalizedUser(sock.user.id) : "me";

    // WhatsApp doesn't consistently use the same JID shape (LID vs PN) for
    // pollCreatorJid/voterJid when deriving the poll-vote decryption key —
    // it depends on addressingMode, 1:1 vs group, and which side sent last.
    // Trying to compute "the" correct JID up front (as the old resolveAuthor
    // did, always preferring participantPn) causes AES-GCM auth failures
    // whenever WhatsApp actually used the LID for that message. Instead,
    // gather every plausible JID for each side and brute-force combinations
    // until one decrypts successfully — see
    // https://github.com/WhiskeySockets/Baileys/issues/2342 and #1678.
    function jidCandidates(key: { fromMe?: boolean; participant?: string; remoteJid?: string; participantPn?: string }): string[] {
      const cands: string[] = [];
      if (key.fromMe) {
        const selfLid = (sock.user as unknown as { lid?: string })?.lid;
        if (selfLid) cands.push(jidNormalizedUser(selfLid));
        if (sock.user?.id) cands.push(jidNormalizedUser(sock.user.id));
      } else {
        const rawParticipant = key.participant ?? key.remoteJid;
        if (rawParticipant) cands.push(jidNormalizedUser(rawParticipant));
        if (key.participantPn) cands.push(jidNormalizedUser(key.participantPn));
        if (rawParticipant?.endsWith("@lid")) {
          const resolved = store.resolveJid(rawParticipant);
          if (resolved && resolved !== rawParticipant) cands.push(jidNormalizedUser(resolved));
        }
      }
      return Array.from(new Set(cands.filter(Boolean)));
    }
  
    sock.ev.on("messages.upsert", async ({ messages: msgs }) => {
      for (const msg of msgs) {
        const pum = msg.message?.pollUpdateMessage;
        if (!pum) continue;
  
        const creationKey = pum.pollCreationMessageKey;
        const creationId  = creationKey?.id ?? "";
        const handle       = registry.get(creationId);
        if (!handle) continue;
  
        const storeMsg = store.messages.get(creationKey?.remoteJid ?? "")?.get(creationId);
        const pollEncKeyRaw = storeMsg?.message?.messageContextInfo?.messageSecret;
        if (!storeMsg || !pollEncKeyRaw || !pum.vote) continue;
  
        try {
          const pollEncKey = Buffer.isBuffer(pollEncKeyRaw)
            ? pollEncKeyRaw
            : Buffer.from(pollEncKeyRaw as unknown as string, "base64");
  
          const creatorCandidates = jidCandidates((creationKey ?? {}) as never);
          const voterCandidates   = jidCandidates(msg.key as never);
  
          let decryptedVote: ReturnType<typeof decryptPollVote> | undefined;
          for (const pollCreatorJid of creatorCandidates) {
            for (const voterJid of voterCandidates) {
              try {
                decryptedVote = decryptPollVote(pum.vote, {
                  pollEncKey,
                  pollCreatorJid,
                  pollMsgId: creationId,
                  voterJid,
                });
                break;
              } catch {
                // try next JID combination
              }
            }
            if (decryptedVote) break;
          }
          if (!decryptedVote) {
            throw new Error(
              `all JID combinations failed (creator=${JSON.stringify(creatorCandidates)}, voter=${JSON.stringify(voterCandidates)})`
            );
          }
  
          const voterKey = msg.key.fromMe
            ? meId
            : jidNormalizedUser(msg.key.participant ?? msg.key.remoteJid ?? "");

          const votesByVoter = pollVotesByCreationId.get(creationId) ?? new Map<string, unknown>();
          votesByVoter.set(voterKey, {
            pollUpdateMessageKey: msg.key,
            vote:                 decryptedVote,
            senderTimestampMs:    pum.senderTimestampMs,
          });
          pollVotesByCreationId.set(creationId, votesByVoter);
  
          const aggregated = getAggregateVotesInPollMessage(
            { message: storeMsg.message, pollUpdates: Array.from(votesByVoter.values()) as never },
            meId
          );
          handle._updateFromAggregated(aggregated);
        } catch (err) {
          logger.error(`[poll] erro ao decriptar voto: ${err}`);
        }
      }
    });
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
      const sender  = makeSender(sock, store, rawJid, null, { cooldown, jitter });
      const handlePromise = sender.poll(question, options, opts);
      const rawMsg = await handlePromise.rawPromise;
      if (!rawMsg) throw new Error("[poll] failed to send poll message");
      const handle = new PollHandle(rawMsg, options, registry);
      registry.set(handle.msgId, handle);

      // Ensure the poll message is in the store before any vote arrives —
      // messages.upsert isn't guaranteed to fire (or land in time) for the
      // bot's own sent messages, which previously dropped every vote.
      const remoteJid = rawMsg.key.remoteJid;
      if (remoteJid) {
        if (!store.messages.has(remoteJid)) store.messages.set(remoteJid, new Map());
        if (!store.messages.get(remoteJid)!.has(handle.msgId)) {
          store.messages.get(remoteJid)!.set(handle.msgId, rawMsg);
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
  sock:           WASocket,
  store:          WAStore,
  pluginRegistry: Map<string, PluginEntry>,
  pluginName:     string
) {
  const botJid = sock.user?.id ? normalizeJid(sock.user.id) : null;
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
    contacts:  buildContactsApi(sock, store, botJid),
    storage:   buildStorageApi(pluginName),
    botId:     botJid,
  };
}

// ── Setup API ─────────────────────────────────────────────────────────────────

/**
 * Setup API — without message context.
 * Passed to plugin.setup(ctx) during initialization.
 *
 * @param {WASocket}              sock
 * @param {WAStore}               store
 * @param {Map<string, any>}      pluginRegistry
 * @param {string}                pluginName
 */
export function buildSetupApi(
  sock:           WASocket,
  store:          WAStore,
  pluginRegistry: Map<string, PluginEntry>,
  pluginName:     string
) {
  return {
    ...buildBaseApi(sock, store, pluginRegistry, pluginName),
    ...buildSetupSendApi(sock, store),
    admin:    buildAdminApi(sock, null),
    events:   buildEventsApi(sock, pluginName),
    me:       buildMeApi(sock),
    settings: { global: buildSettingsApi(pluginName, "_global").global },
  };
}

/** Inferred shape of the ctx object passed to plugin.setup(ctx). */
export type SetupContext = ReturnType<typeof buildSetupApi>;

// ── Runtime API ───────────────────────────────────────────────────────────────

/**
 * Runtime API — full context with message and chat.
 * Passed to plugin.default(ctx) on every message.
 *
 * @param {object}          params
 * @param {WAProtoMsg}      params.msg
 * @param {WAChat}          params.chat
 * @param {WASocket}        params.sock
 * @param {WAStore}         params.store
 * @param {Map}             params.pluginRegistry
 * @param {string}          params.pluginName
 * @param {object}          [params.guardOptions]
 */
export function buildApi({
  msg,
  chat,
  sock,
  store,
  pluginRegistry,
  pluginName,
  guardOptions = {},
}: {
  msg:            WAProtoMsg;
  chat:           WAChat;
  sock:           WASocket;
  store:          WAStore;
  pluginRegistry: Map<string, PluginEntry>;
  pluginName:     string;
  guardOptions?:  Record<string, unknown>;
}) {
  const prefix  = CONFIG.CMD_PREFIX as string;
  const body    = getMsgBody(msg);
  const rawArgs = body.trim().split(/\s+/);
  const first   = rawArgs[0]?.toLowerCase() ?? "";
  const hasPrefix = first.startsWith(prefix);
  const command = hasPrefix ? first.slice(prefix.length) : "";

  const rawJid   = msg.key.remoteJid ?? "";
  const normJid  = normalizeJid(rawJid);
  const sender   = getMsgSender(msg, store);
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;

  // Sender for quoted messages
  const contextInfo = getContextInfo(msg);
  const quotedRaw: WAProtoMsg | null = contextInfo?.quotedMessage
    ? {
        key: {
          remoteJid:   rawJid,
          fromMe:      false,
          id:          contextInfo.stanzaId ?? undefined,
          participant: contextInfo.participant ?? undefined,
        },
        message:  contextInfo.quotedMessage,
        pushName: null,
      }
    : null;

  // Group participant JIDs come back in whatever addressing mode the group
  // uses (@lid or @s.whatsapp.net/@c.us) — same issue as poll vote decryption.
  // "sender" and "sock.user.id" are usually PN-normalized, so a straight
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
    ...buildBaseApi(sock, store, pluginRegistry, pluginName),
    ...buildSendApi(sock, store, rawJid, guardOptions),

    // ── msg ──────────────────────────────────────────────────────────────────

    msg: buildMessageContext(msg, sock, store, { cooldown, jitter }),

    // ── chat ─────────────────────────────────────────────────────────────────

    chat: {
      id:      normJid,
      name:    chat.name,
      isGroup: chat.isGroup,

      /**
       * List of group participants.
       * Returns [] for non-group chats.
       * @returns {Promise<Array<{ id: string, isAdmin: boolean, isSuperAdmin: boolean }>>}
       */
      async getParticipants(): Promise<Array<{ id: string; isAdmin: boolean; isSuperAdmin: boolean }>> {
        if (!chat.isGroup) return [];
        try {
          const meta = await sock.groupMetadata(rawJid);
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
          const meta = await sock.groupMetadata(rawJid);
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
          const meta = await sock.groupMetadata(rawJid);
          const rawSenderParticipant = msg.key.participant ?? msg.key.remoteJid ?? "";
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
        const botLid = (sock.user as unknown as { lid?: string })?.lid;
        const botCandidates = [sock.user?.id, botLid];
        if (!botCandidates.some(Boolean)) return false;
        try {
          const meta = await sock.groupMetadata(rawJid);
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

    admin: buildAdminApi(sock, rawJid),

    // ── me ────────────────────────────────────────────────────────────────────

    me: buildMeApi(sock),

    // ── poll ──────────────────────────────────────────────────────────────────

    poll: buildPollApi(sock, store, rawJid, guardOptions, pluginName),

    // ── settings ──────────────────────────────────────────────────────────────

    settings: buildSettingsApi(pluginName, normJid),

    // ── isolated platform contexts ────────────────────────────────────────────

    wa: {
      sock,
      store,
      msg,
      downloadMedia: async () => {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          if (!buffer || !Buffer.isBuffer(buffer)) return null;
          return { mimetype: getMsgMimetype(msg), data: buffer.toString("base64") };
        } catch {
          return null;
        }
      }
    },
    tg: null,
    dc: null,
  };
}

/** Inferred shape of the `ctx` object passed to plugin.default(ctx) on every message. */
export type PluginContext = ReturnType<typeof buildApi>;
