import type { PluginEntry } from "#kernel/pluginLoader";
/**
 * pluginApi.ts
 *
 * Builds the `ctx` object each plugin receives.
 * Plugins can only do what's here — never touch client directly.
 *
 * `chat` is already filtered by kernel (only allowed chats from .conf),
 * so plugins don't need and can't choose destination, unless they use sendTo.
 */

import type { Client, Chat, Message, Contact, GroupChat } from "#wwjs";
import { logger }                              from "#logger";
import { t, createPluginT, reloadTranslations,
         getCurrentLang }                      from "#i18n";
import { CONFIG, CONFIG_DIR }                  from "#config";
import { enqueue }                             from "#download";
import { emptyFolder }                         from "#utils/file";
import { getChatId }                           from "#utils/getChatId";
import pkg                                     from "whatsapp-web.js";
import { mkdirSync }                           from "fs";
import { writeFile }                           from "fs/promises";
import path                                    from "path";
import { waitForSendSlot, simulateState,
         typingDuration, mediaDuration }       from "#sendguard";
import { buildSettingsApi }                    from "#settingsdb";

// @ts-ignore -- pkg is WAWebJS namespace; destructuring works at runtime via tsx/esModuleInterop
const { MessageMedia, Poll } = pkg;

// ── Storage API ──────────────────────────────────────────────────────────────

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
      if (!relativePath || typeof relativePath !== "string") {
        throw new Error(`[storage] resolve() requires a non-empty string, got: ${typeof relativePath}`);
      }
      if (relativePath.includes("..")) {
        throw new Error(`[storage] path traversal detected in: "${relativePath}"`);
      }
      if (path.isAbsolute(relativePath)) {
        throw new Error(`[storage] absolute paths are not allowed: "${relativePath}"`);
      }
      if (relativePath.includes("\\")) {
        throw new Error(`[storage] Windows-style paths are not allowed: "${relativePath}"`);
      }

      const resolved = path.join(dir, relativePath);

      if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
        throw new Error(`[storage] resolved path escapes plugin data dir: "${resolved}"`);
      }

      mkdirSync(path.dirname(resolved), { recursive: true });
      return resolved;
    },
  };
}

// ── Config API ───────────────────────────────────────────────────────────────

function buildConfigApi(): { get(key: string, defaultValue?: unknown): unknown } {
  return {
    /**
     * Get a config value with optional default.
     * @param {string} key
     * @param {any} [defaultValue]
     */
    get(key, defaultValue = null) {
      return CONFIG[key] ?? defaultValue;
    },
  };
}

// ── i18n API ─────────────────────────────────────────────────────────────────

function buildI18nApi(): Record<string, unknown> {
  return {
    /** Translate a core key. */
    t,

    /**
     * Create a scoped t() for a plugin's own locale files.
     * @param {string} pluginMetaUrl — pass import.meta.url from the plugin
     */
    createT: createPluginT,

    /** Reload all translations (e.g. after language change). */
    reload: reloadTranslations,

    /** Returns current language code. */
    getCurrentLang,
  };
}

// ── Utils API ────────────────────────────────────────────────────────────────

function buildUtilsApi(): Record<string, unknown> {
  return {
    /**
     * Empty a folder's contents without removing the folder itself.
     * @param {string} folder
     */
    emptyFolder,

    /**
     * Get the serialized chat ID from a chat object.
     * @param {import("whatsapp-web.ts").Chat} chat
     */
    getChatId,
  };
}

// ── Download API ─────────────────────────────────────────────────────────────

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

// ── Plugin registry API ──────────────────────────────────────────────────────

function buildPluginsApi(pluginRegistry: Map<string, PluginEntry>) {
  return {
    /**
     * Return public API of another plugin, or null if not active.
     * @param {string} name
     * @returns {any|null}
     */
    get(name: string) {
      return pluginRegistry.get(name)?.exports ?? null;
    },

    /**
     * Return public API of another plugin, or throw if not active.
     * Analogous to require() — use when the dependency is mandatory.
     * @param {string} name
     * @returns {any}
     */
    require(name: string) {
      const plugin = pluginRegistry.get(name);
      if (!plugin || plugin.status !== "active") {
        throw new Error(`[plugins] dependency "${name}" does not exist or is not active`);
      }
      return plugin.exports;
    },

    /**
     * Check if a plugin is active.
     * @param {string} name
     * @returns {boolean}
     */
    exists(name: string) {
      return pluginRegistry.get(name)?.status === "active";
    },
  };
}

// ── Log API ──────────────────────────────────────────────────────────────────

const log = {
  info:    (...a: unknown[]) => logger.info(...a),
  warn:    (...a: unknown[]) => logger.warn(...a),
  error:   (...a: unknown[]) => logger.error(...a),
  success: (...a: unknown[]) => logger.success(...a),
};

// ── Contact API ──────────────────────────────────────────────────────────────

/**
 * Normalizes a raw whatsapp-web.ts Contact into a plain object.
 * Used internally so both ctx.contacts and ctx.msg.getContact()
 * always return the same shape.
 * @param {import("whatsapp-web.ts").Contact} c
 * @returns {object}
 */
function normalizeContact(c: Contact) {
  const id     = c.id._serialized;
  const number = id.split("@")[0];
  return {
    id,
    /** Phone number digits only (e.g. "5511999999999"). */
    number,
    pushname:     c.pushname   ?? null,
    name:         c.name       ?? null,
    shortName:    c.shortName  ?? null,
    isBusiness:   c.isBusiness,
    isEnterprise: c.isEnterprise,
    isBlocked:    c.isBlocked,
    isMe:         c.isMe,
    isMyContact:  c.isMyContact,
    isWAContact:  c.isWAContact,
    isUser:       c.isUser,
    isGroup:      c.isGroup,
    /**
     * Spread into sendMessage opts to mention this contact inline.
     * @example
     * const c = await msg.getContact();
     * msg.reply.text(`hi ${c.mention.text}`, c.mention);
     */
    mention: { text: `@${number}`, mentions: [id] },
  };
}

function buildContactsApi(client: Client) {
  return {
    /**
     * Get a normalized Contact object by ID.
     * @param {string} contactId — serialized ID (e.g. "5511999999999@c.us")
     * @returns {Promise<object|null>}
     */
    async get(contactId: string) {
      try {
        const c = await client.getContactById(contactId);
        return normalizeContact(c);
      } catch {
        return null;
      }
    },

    /**
     * Get the profile picture URL of a contact.
     * Returns null if the contact has privacy settings blocking access.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getPfpUrl(contactId: string) {
      try {
        const c = await client.getContactById(contactId);
        return await c.getProfilePicUrl();
      } catch {
        return null;
      }
    },


    /**
     * Download a contact's profile picture and save it to a local path.
     * Caller is responsible for providing a valid path (e.g. via ctx.storage.resolve)
     * and for cleaning up the file when done.
     * Returns null if the contact has no picture or privacy blocks access.
     * @param {string} contactId
     * @param {string} destPath — absolute path to write the image to
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
     * Get the "about" text of a contact.
     * Returns null if privacy settings block access.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getAbout(contactId: string) {
      try {
        const c = await client.getContactById(contactId);
        return await c.getAbout();
      } catch {
        return null;
      }
    },

    /**
     * Block a contact.
     * @param {string} contactId
     */
    async block(contactId: string) {
      const c = await client.getContactById(contactId);
      return c.block();
    },

    /**
     * Unblock a contact.
     * @param {string} contactId
     */
    async unblock(contactId: string) {
      const c = await client.getContactById(contactId);
      return c.unblock();
    },
  };
}

// ── Internal media helpers ───────────────────────────────────────────────────

/**
 * @param {string|Buffer} source
 * @param {string} mimetype — required, no ambiguous default
 */
function mediaFromSource(source: string | Buffer, mimetype: string) {
  return typeof source === "string"
    ? MessageMedia.fromFilePath(source)
    : new MessageMedia(mimetype, source.toString("base64"));
}

// ── MessageHandle ────────────────────────────────────────────────────────────

/**
 * Wraps a pending send Promise and exposes chainable post-send actions.
 * Thenable: `await ctx.send.text("oi")` resolves to the wwjs Message object.
 *
 * @example
 * await ctx.send.poll(q, opts).pin();
 * await ctx.send.text("hi").react("👍");
 */
class MessageHandle {
  private _p: Promise<Message>;

  constructor(promise: Promise<Message>) {
    this._p = promise;
  }

  then<T>(res: (v: Message) => T, rej?: (e: unknown) => T) { return this._p.then(res, rej); }
  catch<T>(rej: (e: unknown) => T)  { return this._p.catch(rej); }
  finally(fn: () => void)            { return this._p.finally(fn); }

  /** Pin the sent message. */
  async pin(duration?: number) {
    const msg = await this._p;
    return duration !== undefined ? msg?.pin(duration) : msg?.pin();
  }

  /** Delete the sent message. */
  async delete(forEveryone = true): Promise<void> {
    const msg = await this._p;
    return msg?.delete(forEveryone);
  }

  /** React to the sent message. */
  async react(emoji: string) {
    const msg = await this._p;
    return msg?.react(emoji);
  }
}

/**
 * Returns send methods bound to a target that exposes `.sendMessage()`.
 *
 * @param {{ sendMessage: Function }} target
 * @param {object}      [extraOpts]  — merged into every sendMessage call (e.g. { quoted: msg })
 * @param {string|null} [chatId]     — serialized chat ID; enables sendGuard when set
 * @param {object|null} [chatObj]    — real Chat object; enables typing indicator when set
 */
function makeSender(target: { sendMessage: (content: unknown, opts?: unknown) => Promise<Message> } | Chat, extraOpts: Record<string, unknown> = {}, chatId: string | null = null, chatObj: Chat | null = null, { cooldown = true, jitter = true } = {}) {
  return {
    text(content: string, opts: Record<string, unknown> = {}) {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, typingDuration(content), "typing");
        }
        return target.sendMessage(content, { ...extraOpts, ...opts });
      })());
    },

    image(filePath: string, caption = "") {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, mediaDuration(), "typing");
        }
        const media = MessageMedia.fromFilePath(filePath);
        return target.sendMessage(media, { caption, ...extraOpts });
      })());
    },

    video(filePath: string, caption = "") {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, mediaDuration(), "typing");
        }
        const media = MessageMedia.fromFilePath(filePath);
        return target.sendMessage(media, { caption, ...extraOpts });
      })());
    },

    audio(filePath: string, { asVoice = true } = {}) {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, mediaDuration(), "recording");
        }
        const media = MessageMedia.fromFilePath(filePath);
        return target.sendMessage(media, { sendAudioAsVoice: asVoice, ...extraOpts });
      })());
    },

    sticker(source: string | Buffer) {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, mediaDuration(), "typing");
        }
        const media = mediaFromSource(source, "image/webp");
        return target.sendMessage(media, { sendMediaAsSticker: true, ...extraOpts });
      })());
    },

    file(filePath: string, filename?: string) {
      return new MessageHandle((async () => {
        if (chatId) {
          await waitForSendSlot(chatId, { cooldown, jitter });
          await simulateState(chatObj, mediaDuration(), "typing");
        }
        const media = MessageMedia.fromFilePath(filePath);
        return target.sendMessage(media, {
          sendMediaAsDocument: true,
          filename: filename ?? path.basename(filePath),
          ...extraOpts,
        } as Record<string, unknown>);
      })());
    },

    /**
     * Send a poll.
     * @param {string}   question
     * @param {string[]} options             — poll choices
     * @param {object}   [opts]
     * @param {boolean}  [opts.allowMultipleAnswers=false]
     */
    poll(question: string, options: string[], { allowMultipleAnswers = false } = {}) {
      return new MessageHandle((async () => {
        if (chatId) await waitForSendSlot(chatId, { cooldown, jitter });
        const p = new Poll(question, options, { allowMultipleAnswers } as Record<string, unknown>);
        return target.sendMessage(p, extraOpts);
      })());
    },
  };
}

/** Adapts client.sendMessage(chatId, ...) to the makeSender interface. */
function chatIdTarget(client: Client, chatId: string) {
  return {
    sendMessage: (content: unknown, opts?: unknown) => client.sendMessage(chatId, content as string, opts as Record<string, unknown>),
  };
}

// ── Send API ─────────────────────────────────────────────────────────────────

/**
 * Runtime send API — current chat + .to() for other chats.
 *
 * ctx.send.text("oi")
 * ctx.send.image("./foto.jpg", "legenda")
 * ctx.send.to("5511@c.us").text("oi")
 */
function buildSendApi(chat: Chat, client: Client, guardOptions: Record<string, unknown> = {}) {
  const chatId  = chat.id._serialized;
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter  = (guardOptions.jitter  ?? true) as boolean;
  const current = makeSender(chat as unknown as Parameters<typeof makeSender>[0], {}, chatId, chat, { cooldown, jitter });
  return {
    send: {
      text:    (text: string, opts?: Record<string, unknown>)         => current.text(text, opts),
      image:   (filePath: string, caption?: string) => current.image(filePath, caption),
      video:   (filePath: string, caption?: string) => current.video(filePath, caption),
      audio:   (filePath: string, opts?: Record<string, unknown>) => current.audio(filePath, opts),
      sticker: (source: string | Buffer)             => current.sticker(source),
      file:    (filePath: string, filename?: string) => current.file(filePath, filename),
      poll:    (q: string, opts: string[], cfg?: { allowMultipleAnswers?: boolean })       => current.poll(q, opts, cfg),

      /**
       * Sends media that disappears after the recipient views it once.
       * Only image, video and audio are supported.
       *
       * @example
       * await ctx.send.viewOnce.image("/tmp/secret.jpg");
       * await ctx.send.viewOnce.video("/tmp/clip.mp4", "assiste uma vez só");
       */
      viewOnce: (() => {
        const vo = makeSender(chat as unknown as Parameters<typeof makeSender>[0], { viewOnce: true }, chatId, chat, { cooldown, jitter });
        return {
          image: (filePath: string, caption?: string) => vo.image(filePath, caption),
          video: (filePath: string, caption?: string) => vo.video(filePath, caption),
          audio: (filePath: string, opts?: Record<string, unknown>) => vo.audio(filePath, opts),
        };
      })(),

      /**
       * Returns a sender bound to another chat.
       * Typing simulation is skipped (no Chat object available without a fetch).
       * @param {string} targetChatId
       */
      to: (targetChatId: string) =>
        makeSender(chatIdTarget(client, targetChatId), {}, targetChatId, null),
    },
  };
}
/**
 * Setup send API — no current chat, only .to().
 *
 * ctx.send.to(adminChatId).text("bot iniciado")
 */
function buildSetupSendApi(client: Client) {
  return {
    send: {
      to: (targetChatId: string) =>
        makeSender(chatIdTarget(client, targetChatId), {}, targetChatId, null),
    },
  };
}

// ── Events API (setup only) ───────────────────────────────────────────────────

/**
 * @param {import("whatsapp-web.ts").Client} client
 * @param {string} pluginName
 */
const listenerRegistry = new Map();

// ── Poll state (module-level, plugin-scoped) ──────────────────────────────────
// Survives across buildApi calls — each plugin gets its own Map<msgId, PollHandle>.
const pollRegistry  = new Map(); // pluginName → Map<msgId, PollHandle>
const pollListeners = new Set(); // plugins that already registered the vote_update listener

function buildEventsApi(client: Client, pluginName: string) {
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      client.on(event, handler);

      if (!listenerRegistry.has(pluginName)) {
        listenerRegistry.set(pluginName, new Set());
      }

      const ref = { event, handler };
      listenerRegistry.get(pluginName).add(ref);

      return () => {
        client.off(event, handler);
        const set = listenerRegistry.get(pluginName);
        set?.delete(ref);
        if (set?.size === 0) listenerRegistry.delete(pluginName);
      };
    },

    once(event: string) {
      return new Promise((resolve) => {
        const off = this.on(event, (data) => {
          off();
          resolve(data);
        });
      });
    },

    cleanup() {
      const list = listenerRegistry.get(pluginName);
      if (!list) return;
      for (const { event, handler } of list) client.off(event, handler);
      listenerRegistry.delete(pluginName);
    },
  };
}

// ── Admin API ────────────────────────────────────────────────────────────────

/**
 * Group administration actions. Available in both runtime and setup contexts.
 *
 * Runtime (current group):
 *   await ctx.admin.kick(userId)
 *
 * Cross-group (setup or runtime):
 *   await ctx.admin.add(userId).to(groupId)
 *
 * Methods that depend on the current chat throw when called from setup().
 *
 * @param {import("whatsapp-web.ts").Chat|null} chat
 * @param {import("whatsapp-web.ts").Client}    client
 */
function buildAdminApi(chat: Chat | null = null, client: Client) {
  /**
   * Normalize single or multiple IDs into array form.
   *
   * @param {string|string[]} value
   * @returns {string[]}
   */
  const norm = (value: string | string[]): string[] => Array.isArray(value) ? value : [value];

  /**
   * Ensures a runtime chat exists.
   * Throws when called from setup().
   */
  function requireChat() {
    if (!chat)
      throw new Error("This admin operation requires a runtime group context.");
  }

  /**
   * Resolve another group.
   *
   * @param {string} groupId
   * @returns {Promise<import('whatsapp-web.ts').GroupChat>}
   */
  async function getGroup(groupId: string) {
    const group = await client.getChatById(groupId);

    if (!group)
      throw new Error(`Group not found: ${groupId}`);

    if (typeof (group as GroupChat).addParticipants !== "function")
      throw new Error(`Target is not a group: ${groupId}`);

    return group as GroupChat;
  }

  /**
   * Creates an operation object that supports:
   *
   * await admin.add(user)
   * await admin.add(user).to(group)
   *
   * @param {(target:any, users:string[])=>Promise<any>} action
   * @param {string|string[]} memberIds
   */
  function createTargetableAction(action: (target: GroupChat, users: string[]) => Promise<unknown>, memberIds: string | string[]) {
    const users = norm(memberIds);

    const executeCurrent = async () => {
      requireChat();
      return action(chat as GroupChat, users);
    };

    return {
      /**
       * Execute in another group.
       *
       * @param {string} groupId
       */
      async to(groupId: string) {
        const group = await getGroup(groupId);
        return action(group, users);
      },

      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return executeCurrent().then(resolve, reject);
      },

      catch(reject: (e: unknown) => unknown) {
        return executeCurrent().catch(reject);
      },

      finally(fn: () => void) {
        return executeCurrent().finally(fn);
      },
    };
  }

  return {
    /**
     * Add member(s).
     *
     * Current group:
     * await admin.add(id)
     *
     * Another group:
     * await admin.add(id).to(groupId)
     *
     * @param {string|string[]} memberIds
     */
    add(memberIds: string | string[]) {
      return createTargetableAction(
        (target, users) => target.addParticipants(users),
        memberIds
      );
    },

    /**
     * Remove member(s) from current group.
     *
     * @param {string|string[]} memberIds
     */
    async kick(memberIds: string | string[]) {
      requireChat();
      return (chat as GroupChat).removeParticipants(norm(memberIds));
    },

    /**
     * Promote member(s).
     *
     * @param {string|string[]} memberIds
     */
    async promote(memberIds: string | string[]) {
      requireChat();
      return (chat as GroupChat).promoteParticipants(norm(memberIds));
    },

    /**
     * Demote member(s).
     *
     * @param {string|string[]} memberIds
     */
    async demote(memberIds: string | string[]) {
      requireChat();
      return (chat as GroupChat).demoteParticipants(norm(memberIds));
    },

    /**
     * Rename current group.
     *
     * @param {string} name
     */
    async setSubject(name: string) {
      requireChat();
      return (chat as GroupChat).setSubject(name);
    },

    /**
     * Update current group description.
     *
     * @param {string} text
     */
    async setDescription(text: string) {
      requireChat();
      return (chat as GroupChat).setDescription(text);
    },

    /**
     * Update current group picture.
     *
     * @param {string|Buffer} source
     */
    async setProfilePic(source: string | Buffer) {
      requireChat();

      const media = mediaFromSource(source, "image/jpeg");
      return (chat as GroupChat).setPicture(media);
    },

    /**
     * Get invite link.
     */
    async getInviteLink() {
      requireChat();

      const code = await (chat as GroupChat).getInviteCode();
      return `https://chat.whatsapp.com/${code}`;
    },

    /**
     * Revoke invite link.
     */
    async revokeInvite() {
      requireChat();
      return (chat as GroupChat).revokeInvite();
    },
  };
}

// ── Me API ───────────────────────────────────────────────────────────────────

/**
 * Bot self-profile management.
 * Useful for bots that update their own name/status to reflect state.
 *
 * @param {import("whatsapp-web.ts").Client} client
 */
function buildMeApi(client: Client) {
  return {
    /**
     * Change the bot's display name.
     * @param {string} name
     */
    async setName(name: string) {
      return client.setDisplayName(name);
    },

    /**
     * Change the bot's "About" / status text.
     * @param {string} text
     */
    async setAbout(text: string) {
      return client.setStatus(text);
    },

    /**
     * Change the bot's profile picture.
     * @param {string|Buffer} source — file path or raw buffer (JPEG)
     */
    async setProfilePic(source: string | Buffer) {
      const media = mediaFromSource(source, "image/jpeg");
      return client.setProfilePicture(media);
    },
  };
}

// ── Poll API ─────────────────────────────────────────────────────────────────

/**
 * Represents an active poll and tracks votes per option.
 * Obtained via ctx.poll.create() — do not instantiate directly.
 */
class PollHandle {
  msgId: string;
  private _options: Map<string, Set<string>>;
  private _callbacks: Array<(results: Record<string, number>, vote: unknown) => void>;
  private _registry: Map<string, PollHandle>;

  constructor(msg: Message, options: string[], registry: Map<string, PollHandle>) {
    this.msgId      = msg.id._serialized;
    this._options   = new Map(options.map((o) => [o, new Set<string>()]));
    this._callbacks = [];
    this._registry  = registry;
  }

  /** Called by the vote_update dispatcher. Not for plugin use. */
  _update(vote: { voter: Contact & { id?: { _serialized: string } }; selectedOptions: Array<{ name: string }> }) {
    const voterId = ((vote.voter as unknown as { _serialized?: string })._serialized) ?? vote.voter.id?._serialized;
    if (!voterId) return;
    for (const voters of this._options.values()) voters.delete(voterId);
    for (const opt of vote.selectedOptions)       this._options.get(opt.name)?.add(voterId);
    for (const cb of this._callbacks)             cb(this.results(), vote);
  }

  /**
   * Register a callback invoked on every vote change.
   * Returns `this` for chaining.
   * @param cb Receives (results, vote) — results is the current tally snapshot.
   */
  onVote(cb: (results: Record<string, number>, vote: unknown) => void): this {
    this._callbacks.push(cb);
    return this;
  }

  /** Current tally as a plain object. e.g. `{ "Futebol": 3, "Tech": 1 }` */
  results(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, voters] of this._options) out[name] = voters.size;
    return out;
  }

  /**
   * Returns the name(s) of the leading option(s).
   * Returns multiple on a tie, [] if no votes yet.
   */
  winner(): string[] {
    const res    = this.results();
    const counts = Object.values(res);
    if (!counts.length) return [];
    const max = Math.max(...counts);
    if (max === 0) return [];
    return Object.entries(res).filter(([, v]) => v === max).map(([k]) => k);
  }

  /** Remove this poll from tracking. Call when done to free memory. */
  close(): void {
    this._registry.delete(this.msgId);
  }
}

/**
 * Builds the poll API for a given runtime context.
 * The vote_update listener is registered once per plugin (lazy).
 *
 * @param {import("whatsapp-web.ts").Client} client
 * @param {import("whatsapp-web.ts").Chat}   chat
 * @param {string}  chatId
 * @param {object}  guardOptions
 * @param {string}  pluginName
 */
function buildPollApi(client: Client, chat: Chat, chatId: string, guardOptions: Record<string, unknown>, pluginName: string) {
  if (!pollRegistry.has(pluginName)) {
    pollRegistry.set(pluginName, new Map());
  }
  const registry = pollRegistry.get(pluginName);

  // Register the client-level listener once per plugin.
  if (!pollListeners.has(pluginName)) {
    pollListeners.add(pluginName);
    client.on("vote_update", (vote: unknown) => {
      registry.get((vote as unknown as { msgId: { _serialized: string } }).msgId._serialized)?._update(vote);
    });
  }

  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter  = (guardOptions.jitter  ?? true) as boolean;

  return {
    /**
     * Send a poll and start tracking votes.
     * Returns a PollHandle — use .onVote(), .results(), .winner(), .close().
     *
     * @param {string}   question
     * @param {string[]} options
     * @param {object}   [opts]
     * @param {boolean}  [opts.allowMultipleAnswers=false]
     * @returns {Promise<PollHandle>}
     */
    async create(question: string, options: string[], opts: { allowMultipleAnswers?: boolean } = {}) {
      const sender  = makeSender(chat as unknown as Parameters<typeof makeSender>[0], {}, chatId, chat, { cooldown, jitter });
      const sentMsg = await sender.poll(question, options, opts);
      const handle  = new PollHandle(sentMsg, options, registry);
      registry.set(handle.msgId, handle);
      return handle;
    },

    /**
     * Retrieve an active PollHandle by its message ID.
     * Useful when a different plugin invocation needs to check an earlier poll.
     * @param {string} msgId — serialized message ID
     * @returns {PollHandle|null}
     */
    get(msgId: string) {
      return registry.get(msgId) ?? null;
    },
  };
}

// ── Base API (shared between setup and runtime) ───────────────────────────────

function buildBaseApi(client: Client, pluginRegistry: Map<string, PluginEntry>, pluginName: string) {
  const botId = client.info?.wid?._serialized ?? null;
  if (!botId) logger.warn("[pluginApi] botId is null — client may not be ready yet.");

  return {
    log,
    t,
    config:   buildConfigApi(),
    i18n:     buildI18nApi(),
    utils:    buildUtilsApi(),
    download: buildDownloadApi(),
    plugins:  buildPluginsApi(pluginRegistry),
    contacts: buildContactsApi(client),
    storage:  buildStorageApi(pluginName),
    botId,
  };
}

// ── Setup API ────────────────────────────────────────────────────────────────

/**
 * Setup API — without message context.
 * Passed to plugin.setup(ctx) during initialization.
 *
 * @param {import("whatsapp-web.ts").Client} client
 * @param {Map<string, any>}                 pluginRegistry
 * @param {string}                           pluginName
 * @returns {object}
 */
export function buildSetupApi(client: Client, pluginRegistry: Map<string, PluginEntry>, pluginName: string) {
  return {
    ...buildBaseApi(client, pluginRegistry, pluginName),
    ...buildSetupSendApi(client),
    admin: buildAdminApi(null, client),
    events:   buildEventsApi(client, pluginName),
    me:       buildMeApi(client),
    settings: { global: buildSettingsApi(pluginName, "_global").global },
  };
}

// ── Runtime API ──────────────────────────────────────────────────────────────

/**
 * Runtime API — full context with message and chat.
 * Passed to plugin.default(ctx) on every message.
 *
 * @param {object}                            params
 * @param {import("whatsapp-web.ts").Message} params.msg
 * @param {import("whatsapp-web.ts").Chat}    params.chat
 * @param {import("whatsapp-web.ts").Client}  params.client
 * @param {Map<string, any>}                  params.pluginRegistry
 * @param {string}                            params.pluginName
 * @returns {object} ctx
 */
export function buildApi({ msg, chat, client, pluginRegistry, pluginName, guardOptions = {} }: { msg: Message; chat: Chat; client: Client; pluginRegistry: Map<string, PluginEntry>; pluginName: string; guardOptions?: Record<string, unknown> }) {
  const prefix  = CONFIG.CMD_PREFIX;
  const rawArgs = msg.body?.trim().split(/\s+/) ?? [];
  const first = rawArgs[0]?.toLowerCase() ?? "";
  const hasPrefix = first.startsWith(prefix);
  const command = hasPrefix ? first.slice(prefix.length) : "";

  const chatId = chat.id._serialized;
  const cooldown = (guardOptions.cooldown ?? true) as boolean;
  const jitter  = (guardOptions.jitter  ?? true) as boolean;

  return {
    ...buildBaseApi(client, pluginRegistry, pluginName),
    ...buildSendApi(chat, client, guardOptions),

    // ── msg ──────────────────────────────────────────────────

    msg: {
      body:       msg.body ?? "",
      type:       msg.type,
      fromMe:     msg.fromMe,
      sender:     msg.author || msg.from,
      senderName: (msg as unknown as { _data: Record<string, unknown> })._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, ""),

      /** Command token without prefix (e.g. "play" for "!play foo"). */
      command,

      /** Arguments after the command token. */
      args: rawArgs.slice(1),

      /**
       * Check if message matches a given command.
       * @param {string} cmd
       */
      is(cmd: string) {
        return this.hasPrefix && command === cmd.toLowerCase();
      },

      hasMedia:  msg.hasMedia,
      isGif:     (msg as unknown as { _data: Record<string, unknown> })._data?.isGif ?? false,

      async downloadMedia() {
        const media = await msg.downloadMedia();
        if (!media) return null;
        return { mimetype: media.mimetype, data: media.data };
      },

      hasReply: msg.hasQuotedMsg,

      async getReply() {
        if (!msg.hasQuotedMsg) return null;
        return msg.getQuotedMessage();
      },

      reply: makeSender(chat as unknown as Parameters<typeof makeSender>[0], { quotedMessageId: msg.id._serialized }, chatId, chat, { cooldown, jitter }),

      async react(emoji: string) {
        return msg.react(emoji);
      },

      /** Delete this message. */
      async delete(forEveryone = true): Promise<void> {
        return msg.delete(forEveryone);
      },

      /** Pin this message in the chat (requires bot to be admin in groups). */
      async pin(duration?: number) {
        return duration !== undefined ? msg.pin(duration) : msg.pin();
      },

      hasPrefix,

      /**
       * Get the sender as a normalized Contact object.
       * Same shape as ctx.contacts.get().
       * @returns {Promise<object|null>}
       */
      async getContact() {
        try {
          const c = await msg.getContact();
          return normalizeContact(c);
        } catch {
          return null;
        }
      },
    },

    // ── chat ─────────────────────────────────────────────────

    chat: {
      id:      chatId,
      name:    chat.name || chat.id.user,
      isGroup: /@g\.us$/.test(chatId),

      /**
       * List of group participants.
       * Returns [] for non-group chats.
       * @returns {Promise<Array<{ id: string, isAdmin: boolean, isSuperAdmin: boolean }>>}
       */
      async getParticipants() {
        if (!(chat as GroupChat).participants) return [];
        return (chat as GroupChat).participants.map((p: { id: { _serialized: string }; isAdmin: boolean; isSuperAdmin: boolean }) => ({
          id:           p.id._serialized,
          isAdmin:      p.isAdmin,
          isSuperAdmin: p.isSuperAdmin,
        }));
      },

      /**
       * Check if a contact is an admin of this group.
       * Always returns false for non-group chats.
       * @param {string} contactId
       * @returns {Promise<boolean>}
       */
      async isAdmin(contactId: string) {
        return (chat as GroupChat).participants?.some(
          (p: { id: { _serialized: string }; isAdmin: boolean; isSuperAdmin: boolean }) => p.id._serialized === contactId && (p.isAdmin || p.isSuperAdmin)
        ) ?? false;
      },

      /**
       * Check if the message sender is an admin of this group.
       * Shorthand for isAdmin(ctx.msg.sender).
       * @returns {Promise<boolean>}
       */
      async isSenderAdmin() {
        const senderId = msg.author || msg.from;
        return (chat as GroupChat).participants?.some(
          (p: { id: { _serialized: string }; isAdmin: boolean; isSuperAdmin: boolean }) => p.id._serialized === senderId && (p.isAdmin || p.isSuperAdmin)
        ) ?? false;
      },

      /**
       * Check if the bot itself is an admin of this group.
       * @returns {Promise<boolean>}
       */
      async isBotAdmin() {
        const botId = client.info?.wid?._serialized;
        if (!botId) return false;
        return (chat as GroupChat).participants?.some(
          (p: { id: { _serialized: string }; isAdmin: boolean; isSuperAdmin: boolean }) => p.id._serialized === botId && (p.isAdmin || p.isSuperAdmin)
        ) ?? false;
      },

      /** Clear all messages in this chat. */
      async clearMessages() {
        return chat.clearMessages();
      },
    },

    // ── admin ─────────────────────────────────────────────────

    admin: buildAdminApi(chat, client),

    // ── me ───────────────────────────────────────────────────

    me: buildMeApi(client),

    // ── poll ─────────────────────────────────────────────────

    poll: buildPollApi(client, chat, chatId, guardOptions, pluginName),

    // ── settings ──────────────────────────────────────────────

    settings: buildSettingsApi(pluginName, chatId),
  };
}
