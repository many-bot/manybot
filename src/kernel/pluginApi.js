/**
 * pluginApi.js
 *
 * Builds the `ctx` object each plugin receives.
 * Plugins can only do what's here — never touch client directly.
 *
 * `chat` is already filtered by kernel (only allowed chats from .conf),
 * so plugins don't need and can't choose destination, unless they use sendTo.
 */

import { logger }                              from "#logger";
import { t, createPluginT, reloadTranslations,
         getCurrentLang }                      from "#i18n";
import { CONFIG, CONFIG_DIR }                  from "#config";
import { enqueue }                             from "#download";
import { emptyFolder }                         from "#utils/file";
import { getChatId }                           from "#utils/getChatId";
import pkg                                     from "whatsapp-web.js";
import { mkdirSync }                           from "fs";
import path                                    from "path";

const { MessageMedia } = pkg;

// ── Storage API ──────────────────────────────────────────────────────────────

export function buildStorageApi(pluginName) {
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
    resolve(relativePath) {
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

function buildConfigApi() {
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

function buildI18nApi() {
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

function buildUtilsApi() {
  return {
    /**
     * Empty a folder's contents without removing the folder itself.
     * @param {string} folder
     */
    emptyFolder,

    /**
     * Get the serialized chat ID from a chat object.
     * @param {import("whatsapp-web.js").Chat} chat
     */
    getChatId,
  };
}

// ── Download API ─────────────────────────────────────────────────────────────

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

// ── Plugin registry API ──────────────────────────────────────────────────────

function buildPluginsApi(pluginRegistry) {
  return {
    /**
     * Return public API of another plugin, or null if not active.
     * @param {string} name
     * @returns {any|null}
     */
    get(name) {
      return pluginRegistry.get(name)?.exports ?? null;
    },

    /**
     * Return public API of another plugin, or throw if not active.
     * Analogous to require() — use when the dependency is mandatory.
     * @param {string} name
     * @returns {any}
     */
    require(name) {
      const plugin = pluginRegistry.get(name);
      if (!plugin || plugin.status !== "active") {
        throw new Error(`Plugin dependency "${name}" does not exist or is not active.`);
      }
      return plugin.exports;
    },

    /**
     * Check if a plugin is active.
     * @param {string} name
     * @returns {boolean}
     */
    exists(name) {
      return pluginRegistry.get(name)?.status === "active";
    },
  };
}

// ── Log API ──────────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => logger.info(...a),
  warn:    (...a) => logger.warn(...a),
  error:   (...a) => logger.error(...a),
  success: (...a) => logger.success(...a),
};

// ── Contact API ──────────────────────────────────────────────────────────────

/**
 * Normalizes a raw whatsapp-web.js Contact into a plain object.
 * Used internally so both ctx.contacts and ctx.msg.getContact()
 * always return the same shape.
 * @param {import("whatsapp-web.js").Contact} c
 * @returns {object}
 */
function normalizeContact(c) {
  return {
    id:           c.id._serialized,
    number:       c.number,
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
  };
}

function buildContactsApi(client) {
  return {
    /**
     * Get a normalized Contact object by ID.
     * @param {string} contactId — serialized ID (e.g. "5511999999999@c.us")
     * @returns {Promise<object|null>}
     */
    async get(contactId) {
      try {
        const c = await client.getContactById(contactId);
        return normalizeContact(c);
      } catch {
        return null;
      }
    },

    /**
     * Get the profile picture URL of a contact.
     * Respects privacy settings — may return null.
     * @param {string} contactId
     * @returns {Promise<string|null>}
     */
    async getProfilePicUrl(contactId) {
      try {
        const c = await client.getContactById(contactId);
        return await c.getProfilePicUrl();
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
    async getAbout(contactId) {
      try {
        const c = await client.getContactById(contactId);
        return await c.getAbout();
      } catch {
        return null;
      }
    },
  };
}

// ── Internal media helpers ───────────────────────────────────────────────────

/**
 * @param {string|Buffer} source
 * @param {string} mimetype — required, no ambiguous default
 */
function mediaFromSource(source, mimetype) {
  return typeof source === "string"
    ? MessageMedia.fromFilePath(source)
    : new MessageMedia(mimetype, source.toString("base64"));
}

/**
 * Returns send methods bound to a target that exposes `.sendMessage()`.
 * @param {{ sendMessage: Function }} target
 * @param {object} [extraOpts] — merged into every sendMessage call (e.g. { quoted: msg })
 */
function makeSender(target, extraOpts = {}) {
  return {
    async text(content, opts = {}) {
      return target.sendMessage(content, { ...extraOpts, ...opts });
    },
    async image(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { caption, ...extraOpts });
    },
    async video(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { caption, ...extraOpts });
    },
    async audio(filePath, { asVoice = true } = {}) {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { sendAudioAsVoice: asVoice, ...extraOpts });
    },
    async sticker(source) {
      const media = mediaFromSource(source, "image/webp");
      return target.sendMessage(media, { sendMediaAsSticker: true, ...extraOpts });
    },
    async file(filePath, filename) {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, {
        sendMediaAsDocument: true,
        filename: filename ?? path.basename(filePath),
        ...extraOpts,
      });
    },
  };
}

/** Adapts client.sendMessage(chatId, ...) to the makeSender interface. */
function chatIdTarget(client, chatId) {
  return {
    sendMessage: (content, opts) => client.sendMessage(chatId, content, opts),
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
function buildSendApi(chat, client) {
  const current = makeSender(chat);

  return {
    send: {
      text:    (text, opts)        => current.text(text, opts),
      image:   (filePath, caption) => current.image(filePath, caption),
      video:   (filePath, caption) => current.video(filePath, caption),
      audio:   (filePath, opts)    => current.audio(filePath, opts),
      sticker: (source)            => current.sticker(source),
      file:    (filePath, filename) => current.file(filePath, filename),

      /**
       * Returns a sender bound to another chat.
       * @param {string} chatId
       * @returns {{ text, image, video, audio, sticker }}
       */
      to: (chatId) => makeSender(chatIdTarget(client, chatId)),
    },
  };
}

/**
 * Setup send API — no current chat, only .to().
 *
 * ctx.send.to(adminChatId).text("bot iniciado")
 */
function buildSetupSendApi(client) {
  return {
    send: {
      to: (chatId) => makeSender(chatIdTarget(client, chatId)),
    },
  };
}

// ── Events API (setup only) ───────────────────────────────────────────────────

function buildEventsApi(client) {
  return {
    /**
     * Registers a persistent listener for a client event.
     * Returns an 'off()' function to cancel the listener when the plugin wants.
     *
     * @param {string}   event
     * @param {Function} handler
     * @returns {Function} off
     *
     * @example
     * const off = ctx.events.on("group_join", (notification) => { ... });
     * // cancels when the plugin doesn't want anymore:
     * off();
     */
    on(event, handler) {
      client.on(event, handler);
      return () => client.off(event, handler);
    },

    /**
     * Returns a Promise that resolves on the next ocurrence of the event.
     * Useful for waiting a specific event without having to manage listeners manually.
     *
     * @param {string} event
     * @returns {Promise<any>}
     *
     * @example
     * const notification = await ctx.events.once("group_join");
     */
    once(event) {
      return new Promise((resolve) => client.once(event, resolve));
    }
  };
}

// ── Base API (shared between setup and runtime) ───────────────────────────────

function buildBaseApi(client, pluginRegistry, pluginName) {
  const botId = client.info?.wid?._serialized ?? null;
  if (!botId) logger.warn("[pluginApi] botId is null - client may not be ready yet.");

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
 * @param {import("whatsapp-web.js").Client} client
 * @param {Map<string, any>} pluginRegistry
 * @returns {object}
 */
export function buildSetupApi(client, pluginRegistry, pluginName) {
  return {
    ...buildBaseApi(client, pluginRegistry, pluginName),
    ...buildSetupSendApi(client),
    events: buildEventsApi(client),
  };
}

// ── Runtime API ──────────────────────────────────────────────────────────────

/**
 * Runtime API — full context with message and chat.
 * Passed to plugin.default(ctx) on every message.
 *
 * @param {object}                            params
 * @param {import("whatsapp-web.js").Message} params.msg
 * @param {import("whatsapp-web.js").Chat}    params.chat
 * @param {import("whatsapp-web.js").Client}  params.client
 * @param {Map<string, any>}                  params.pluginRegistry
 * @returns {object} ctx
 */
export function buildApi({ msg, chat, client, pluginRegistry }) {
  const prefix  = CONFIG.CMD_PREFIX ?? "!";
  const rawArgs = msg.body?.trim().split(/\s+/) ?? [];
  const command = rawArgs[0]?.toLowerCase().startsWith(prefix)
    ? rawArgs[0].slice(prefix.length).toLowerCase()
    : rawArgs[0]?.toLowerCase() ?? "";

  return {
    ...buildBaseApi(client, pluginRegistry),
    ...buildSendApi(chat, client),

    // ── msg ──────────────────────────────────────────────────

    msg: {
      body:       msg.body ?? "",
      type:       msg.type,
      fromMe:     msg.fromMe,
      sender:     msg.author || msg.from,
      senderName: msg._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, ""),

      /** Command token without prefix (e.g. "play" for "!play foo"). */
      command,

      /** Arguments after the command token. */
      args: rawArgs.slice(1),

      /**
       * Check if message is a given command.
       * @param {string} cmd — without prefix
       */
      is(cmd) {
        return command === cmd.toLowerCase();
      },

      hasMedia:  msg.hasMedia,
      isGif:     msg._data?.isGif ?? false,

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

      reply: makeSender(chat, { quoted: msg }),

      async react(emoji) {
        return msg.react(emoji);
      },

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
      id:      chat.id._serialized,
      name:    chat.name || chat.id.user,
      isGroup: /@g\.us$/.test(chat.id._serialized),

      /**
       * List of group participants.
       * Returns [] for non-group chats.
       * @returns {Promise<Array<{ id: string, isAdmin: boolean, isSuperAdmin: boolean }>>}
       */
      async getParticipants() {
        if (!chat.participants) return [];
        return chat.participants.map((p) => ({
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
      async isAdmin(contactId) {
        return chat.participants?.some(
          (p) => p.id._serialized === contactId && (p.isAdmin || p.isSuperAdmin)
        ) ?? false;
      },
    },
  };
}
