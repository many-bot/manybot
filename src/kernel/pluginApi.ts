/**
 * pluginApi.ts
 *
 * Builds the `ctx` object each plugin receives.
 * Plugins can only do what's here — never touch sock directly.
 *
 * All wwjs types have been replaced with Baileys equivalents.
 * The ctx surface area is preserved so existing plugins stay compatible.
 */

import type { PluginEntry }          from "#kernel/pluginLoader";
import type { WASocket, WAStore, WAProtoMsg, WAChat, WAParticipant, WAStoreContact, proto } from "#types";
import { logger }                    from "#logger";
import { t, createPluginT,
         reloadTranslations,
         getCurrentLang }            from "#i18n";
import { CONFIG, CONFIG_DIR }        from "#config";
import { enqueue }                   from "#download";
import { emptyFolder }               from "#utils/file";
import { getChatId }                 from "#utils/getChatId";
import { normalizeJid }              from "#client/baileysSock";
import { mkdirSync }                 from "fs";
import { readFile, writeFile }       from "fs/promises";
import { readFileSync }              from "fs";
import path                          from "path";
import { waitForSendSlot, simulateState,
         typingDuration, mediaDuration } from "#sendguard";
import { buildSettingsApi }          from "#settingsdb";
import { downloadMediaMessage,
         getAggregateVotesInPollMessage } from "@whiskeysockets/baileys";

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
function getMsgSender(msg: WAProtoMsg): string {
  return normalizeJid(msg.key.participant || msg.key.remoteJid || "");
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

/**
 * Build a WAChat adapter from a Baileys message + store.
 * Exposed for use in messageHandler.ts.
 *
 * @param {WAProtoMsg} msg
 * @param {WAStore}    store
 * @returns {WAChat}
 */
export function buildChatFromMsg(msg: WAProtoMsg, store: WAStore): WAChat {
  const rawJid = msg.key.remoteJid ?? "";
  const jid    = normalizeJid(rawJid);
  const user   = jid.split("@")[0];
  const isGroup = rawJid.endsWith("@g.us");

  // Try to get name from store
  const stored = store.chats.get(rawJid);
  const name   = stored?.name ?? user;

  return { id: { _serialized: jid, user }, name, isGroup };
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

function buildI18nApi(): Record<string, unknown> {
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

function buildUtilsApi(): Record<string, unknown> {
  return { emptyFolder, getChatId };
}

// ── Download API ──────────────────────────────────────────────────────────────

function buildDownloadApi(): Record<string, unknown> {
  return {
    /**
     * Enqueue a download work function.
     * @param {Function} workFn
     * @param {Function} [errorFn]
     */
    enqueue,
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
 * @param {string}           jid
 * @param {WAStoreContact}   [info]
 * @param {string|null}      [botJid]
 */
function normalizeContact(jid: string, info?: WAStoreContact, botJid?: string | null) {
  const number = jid.split("@")[0];
  return {
    id:           jid,
    number,
    pushname:     info?.notify ?? null,
    name:         info?.name ?? info?.verifiedName ?? null,
    shortName:    null,
    isBusiness:   false,
    isEnterprise: false,
    isBlocked:    false,
    isMe:         botJid ? jid === normalizeJid(botJid) : false,
    isMyContact:  !!(info?.name),
    isWAContact:  true,
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
      const info = (store.contacts as Record<string, WAStoreContact>)[contactId]
                ?? (store.contacts as Record<string, WAStoreContact>)[normalizeJid(contactId)];
      return normalizeContact(normalizeJid(contactId), info, botJid);
    },

    /**
     * Get the profile picture URL of a contact.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getPfpUrl(contactId: string) {
      try {
        return await sock.profilePictureUrl(contactId, "image");
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
      try {
        const res = await (sock as unknown as {
          fetchStatus(jid: string): Promise<{ status?: string }>
        }).fetchStatus(contactId);
        return res?.status ?? null;
      } catch {
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

// ── MessageHandle ─────────────────────────────────────────────────────────────

/**
 * Wraps a pending send and exposes chainable post-send actions.
 * Thenable: `await ctx.send.text("hi")` resolves to the proto message.
 */
class MessageHandle {
  private _p: Promise<WAProtoMsg | undefined>;
  private _sock: WASocket;

  constructor(promise: Promise<WAProtoMsg | undefined>, sock: WASocket) {
    this._p    = promise;
    this._sock = sock;
  }

  then<T>(res: (v: WAProtoMsg | undefined) => T, rej?: (e: unknown) => T) { return this._p.then(res, rej); }
  catch<T>(rej: (e: unknown) => T) { return this._p.catch(rej); }
  finally(fn: () => void)          { return this._p.finally(fn); }

  /** Pin the sent message. */
  async pin(_duration?: number) {
    logger.warn("[pluginApi] pin() is not supported yet");
  }

  /** Delete the sent message. */
  async delete(forEveryone = true) {
    const msg = await this._p;
    if (!msg?.key) return;
    const jid = msg.key.remoteJid!;
    if (forEveryone) {
      return this._sock.sendMessage(jid, { delete: msg.key });
    }
    // delete for me only is not exposed in Baileys — silently skip
  }

  /** React to the sent message. */
  async react(emoji: string) {
    const msg = await this._p;
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
 * @param {WASocket}       sock
 * @param {string}         jid         — destination JID (raw, not normalized)
 * @param {WAProtoMsg}     [quoted]    — message to quote
 * @param {object}         [guard]
 */
function makeSender(
  sock:   WASocket,
  jid:    string,
  quoted: WAProtoMsg | null = null,
  { cooldown = true, jitter = true } = {}
) {
  const normJid = normalizeJid(jid);
  const qOpts   = quoted ? { quoted } : undefined;

  return {
    text(content: string, _opts: Record<string, unknown> = {}) {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, typingDuration(content), "typing");
        return sock.sendMessage(jid, { text: content }, qOpts);
      })(), sock);
    },

    image(filePath: string, caption = "") {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, mediaDuration(), "typing");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { image: buffer, caption }, qOpts);
      })(), sock);
    },

    video(filePath: string, caption = "") {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, mediaDuration(), "typing");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { video: buffer, caption }, qOpts);
      })(), sock);
    },

    audio(filePath: string, { asVoice = true } = {}) {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, mediaDuration(), "recording");
        const buffer = await readFile(filePath);
        return sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mp4", ptt: asVoice }, qOpts);
      })(), sock);
    },

    sticker(source: string | Buffer) {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, mediaDuration(), "typing");
        const buffer = Buffer.isBuffer(source) ? source : await readFile(source);
        return sock.sendMessage(jid, { sticker: buffer }, qOpts);
      })(), sock);
    },

    file(filePath: string, filename?: string) {
      return new MessageHandle((async () => {
        await waitForSendSlot(normJid, { cooldown, jitter });
        await simulateState(sock, jid, mediaDuration(), "typing");
        const buffer   = await readFile(filePath);
        const mimetype = mimeFromPath(filePath);
        return sock.sendMessage(jid, {
          document: buffer,
          mimetype,
          fileName: filename ?? path.basename(filePath),
        }, qOpts);
      })(), sock);
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
        await waitForSendSlot(normJid, { cooldown, jitter });
        return sock.sendMessage(jid, {
          poll: {
            name:            question,
            values:          options,
            selectableCount: allowMultipleAnswers ? 0 : 1,
          },
        } as Parameters<typeof sock.sendMessage>[1], qOpts);
      })(), sock);
    },
  };
}

// ── Send API ──────────────────────────────────────────────────────────────────

function buildSendApi(sock: WASocket, rawJid: string, guardOptions: Record<string, unknown> = {}) {
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter   = (guardOptions.jitter   ?? true) as boolean;
  const current  = makeSender(sock, rawJid, null, { cooldown, jitter });

  return {
    send: {
      text:    (text: string, opts?: Record<string, unknown>)           => current.text(text, opts),
      image:   (filePath: string, caption?: string)                     => current.image(filePath, caption),
      video:   (filePath: string, caption?: string)                     => current.video(filePath, caption),
      audio:   (filePath: string, opts?: Record<string, unknown>)       => current.audio(filePath, opts as never),
      sticker: (source: string | Buffer)                                => current.sticker(source),
      file:    (filePath: string, filename?: string)                    => current.file(filePath, filename),
      poll:    (q: string, opts: string[], cfg?: { allowMultipleAnswers?: boolean }) => current.poll(q, opts, cfg),

      viewOnce: (() => {
        // Baileys supports viewOnce on image/video/audio natively
        const sender = makeSender(sock, rawJid, null, { cooldown, jitter });
        return {
          image(filePath: string, caption?: string) {
            return new MessageHandle((async () => {
              await waitForSendSlot(normalizeJid(rawJid), { cooldown, jitter });
              await simulateState(sock, rawJid, mediaDuration(), "typing");
              const buffer = await readFile(filePath);
              return sock.sendMessage(rawJid, { image: buffer, caption, viewOnce: true });
            })(), sock);
          },
          video(filePath: string, caption?: string) {
            return new MessageHandle((async () => {
              await waitForSendSlot(normalizeJid(rawJid), { cooldown, jitter });
              await simulateState(sock, rawJid, mediaDuration(), "typing");
              const buffer = await readFile(filePath);
              return sock.sendMessage(rawJid, { video: buffer, caption, viewOnce: true });
            })(), sock);
          },
          audio(filePath: string, opts?: { asVoice?: boolean }) {
            const asVoice = opts?.asVoice ?? true;
            return new MessageHandle((async () => {
              await waitForSendSlot(normalizeJid(rawJid), { cooldown, jitter });
              await simulateState(sock, rawJid, mediaDuration(), "recording");
              const buffer = await readFile(filePath);
              return sock.sendMessage(rawJid, { audio: buffer, mimetype: "audio/mp4", ptt: asVoice, viewOnce: true });
            })(), sock);
          },
        };
      })(),

      /**
       * Returns a sender bound to another chat.
       * @param {string} targetJid
       */
      to: (targetJid: string) => makeSender(sock, targetJid, null, { cooldown: false, jitter: false }),
    },
  };
}

/** Setup send API — no current chat, only .to(). */
function buildSetupSendApi(sock: WASocket) {
  return {
    send: {
      to: (targetJid: string) => makeSender(sock, targetJid),
    },
  };
}

// ── Events API ────────────────────────────────────────────────────────────────

const listenerRegistry = new Map<string, Set<{ event: string; handler: (...args: unknown[]) => void }>>();

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
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return executeCurrent().then(res, rej); },
      catch(rej: (e: unknown) => unknown) { return executeCurrent().catch(rej); },
      finally(fn: () => void) { return executeCurrent().finally(fn); },
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

  if (!pollListeners.has(pluginName)) {
    pollListeners.add(pluginName);

    // Baileys delivers poll votes via messages.update with pollUpdates field
    sock.ev.on("messages.update", async (updates) => {
      for (const { key, update } of updates) {
        if (!update.pollUpdates?.length) continue;

        const handle = registry.get(key.id ?? "");
        if (!handle) continue;

        // Retrieve the original poll message from store for decryption
        const storeMsg = store.messages.get(key.remoteJid ?? "")?.get(key.id ?? "");
        if (!storeMsg) continue;

        try {
          const aggregated = getAggregateVotesInPollMessage({
            message:     storeMsg.message,
            pollUpdates: storeMsg.pollUpdates ?? [],
          });
          handle._updateFromAggregated(aggregated);
        } catch {}
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
      const sender  = makeSender(sock, rawJid, null, { cooldown, jitter });
      const sentMsg = await sender.poll(question, options, opts);
      if (!sentMsg) throw new Error("[poll] failed to send poll message");
      const handle = new PollHandle(sentMsg, options, registry);
      registry.set(handle.msgId, handle);
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
    config:   buildConfigApi(),
    i18n:     buildI18nApi(),
    utils:    buildUtilsApi(),
    download: buildDownloadApi(),
    plugins:  buildPluginsApi(pluginRegistry),
    contacts: buildContactsApi(sock, store, botJid),
    storage:  buildStorageApi(pluginName),
    botId:    botJid,
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
    ...buildSetupSendApi(sock),
    admin:    buildAdminApi(sock, null),
    events:   buildEventsApi(sock, pluginName),
    me:       buildMeApi(sock),
    settings: { global: buildSettingsApi(pluginName, "_global").global },
  };
}

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
  const sender   = getMsgSender(msg);
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

  return {
    ...buildBaseApi(sock, store, pluginRegistry, pluginName),
    ...buildSendApi(sock, rawJid, guardOptions),

    // ── msg ──────────────────────────────────────────────────────────────────

    msg: {
      body,
      type:       getMsgType(msg),
      fromMe:     !!(msg.key.fromMe),
      sender,
      senderName: msg.pushName ?? sender.replace(/(:\d+)?@.*$/, ""),

      /** Command token without prefix (e.g. "play" for "!play foo"). */
      command,

      /** Arguments after the command token. */
      args: rawArgs.slice(1),

      /**
       * Check if message matches a given command.
       * @param {string} cmd
       */
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

      reply: makeSender(sock, rawJid, msg, { cooldown, jitter }),

      async react(emoji: string) {
        return sock.sendMessage(rawJid, { react: { text: emoji, key: msg.key } });
      },

      async delete(forEveryone = true) {
        if (forEveryone) {
          return sock.sendMessage(rawJid, { delete: msg.key });
        }
      },

      /** Pin this message — not supported in Baileys. */
      async pin(_duration?: number) {
        logger.warn("[pluginApi] pin() is not supported with Baileys");
      },

      hasPrefix,

      /**
       * Get the sender as a normalized contact object.
       * @returns {Promise<object|null>}
       */
      async getContact() {
        const info = (store.contacts as Record<string, WAStoreContact>)[sender]
                  ?? (store.contacts as Record<string, WAStoreContact>)[msg.key.participant ?? ""];
        const botJid = sock.user?.id ? normalizeJid(sock.user.id) : null;
        return normalizeContact(sender, info, botJid);
      },
    },

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
            p => normalizeJid(p.id) === contactId && (p.admin === "admin" || p.admin === "superadmin")
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
          return meta.participants.some(
            p => normalizeJid(p.id) === sender && (p.admin === "admin" || p.admin === "superadmin")
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
        const botJid = sock.user?.id ? normalizeJid(sock.user.id) : null;
        if (!botJid) return false;
        try {
          const meta = await sock.groupMetadata(rawJid);
          return meta.participants.some(
            p => normalizeJid(p.id) === botJid && (p.admin === "admin" || p.admin === "superadmin")
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
  };
}
