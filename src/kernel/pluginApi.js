/**
 * pluginApi.js
 *
 * Builds the `ctx` object each plugin receives.
 * Plugins can only do what's here — never touch client directly.
 *
 * `chat` is already filtered by kernel (only allowed chats from .conf),
 * so plugins don't need and can't choose destination.
 */

import { logger }                              from "#logger";
import { t, createPluginT, reloadTranslations,
         getCurrentLang }                      from "#i18n";
import { CONFIG }                              from "#config";
import { enqueue }                             from "#download";
import { emptyFolder }                         from "#utils/file";
import { getChatId }                           from "#utils/getChatId";
import pkg                                     from "whatsapp-web.js";

const { MessageMedia } = pkg;

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

    /** Full config object — read only. */
    all: CONFIG,
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

// -- Contact API --------------------------------------------------------------

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
      } catch {
        return null;
      }
    },

    /**
     * Get the profile picture URL of a contact.
     * Uses Contact#getProfilePicUrl() — respects privacy settings.
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

function mediaFromSource(source, mimetype = "image/webp") {
  return typeof source === "string"
    ? MessageMedia.fromFilePath(source)
    : new MessageMedia(mimetype, source.toString("base64"));
}

/**
 * Returns send methods bound to a target that exposes `.sendMessage()`.
 * Used for both current-chat and sendTo variants.
 * @param {{ sendMessage: Function }} target
 */
function makeSender(target) {
  return {
    async text(content, opts = {}) {
      return target.sendMessage(content, opts);
    },
    async image(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { caption });
    },
    async video(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { caption });
    },
    async audio(filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return target.sendMessage(media, { sendAudioAsVoice: true });
    },
    async sticker(source) {
      const media = mediaFromSource(source);
      return target.sendMessage(media, { sendMediaAsSticker: true });
    },
  };
}

/** Adapts client.sendMessage(chatId, ...) to the makeSender interface. */
function chatIdTarget(client, chatId) {
  return {
    sendMessage: (content, opts) => client.sendMessage(chatId, content, opts),
  };
}

// ── Send APIs ────────────────────────────────────────────────────────────────

/** Send to a specific chat by ID. Available in both setup and runtime. */
function buildSendToApi(client) {
  return {
    sendTo:        (chatId, text, opts)        => client.sendMessage(chatId, text, opts),
    sendImageTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).image(filePath, caption),
    sendVideoTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).video(filePath, caption),
    sendAudioTo:   (chatId, filePath)          => makeSender(chatIdTarget(client, chatId)).audio(filePath),
    sendStickerTo: (chatId, source)            => makeSender(chatIdTarget(client, chatId)).sticker(source),
  };
}

/** Send to the current chat. Only available in runtime. */
function buildSendApi(chat) {
  const sender = makeSender(chat);
  return {
    send:        (text, opts)        => sender.text(text, opts),
    sendImage:   (filePath, caption) => sender.image(filePath, caption),
    sendVideo:   (filePath, caption) => sender.video(filePath, caption),
    sendAudio:   (filePath)          => sender.audio(filePath),
    sendSticker: (source)            => sender.sticker(source),
  };
}

// ── Base API (shared between setup and runtime) ───────────────────────────────

function buildBaseApi(client, pluginRegistry) {
  return {
    log,
    t,
    config:   buildConfigApi(),
    i18n:     buildI18nApi(),
    utils:    buildUtilsApi(),
    download: buildDownloadApi(),
    plugins:  buildPluginsApi(pluginRegistry),
    botId:    client.info?.wid?._serialized ?? null,
    contacts: buildContactsApi(),
    ...buildSendToApi(client),
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
export function buildSetupApi(client, pluginRegistry) {
  return {
    ...buildBaseApi(client, pluginRegistry),
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
  return {
    ...buildBaseApi(client, pluginRegistry),
    ...buildSendApi(chat),

    // ── msg ──────────────────────────────────────────────────

    msg: {
      body:       msg.body ?? "",
      type:       msg.type,
      fromMe:     msg.fromMe,
      sender:     msg.author || msg.from,
      senderName: msg._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, ""),
      args:       msg.body?.trim().split(/\s+/) ?? [],

      /** Check if message starts with a command. */
      is(cmd) {
        const command = msg.body?.trim().split(/\s+/)[0].toLowerCase();
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

      async reply(text) {
        return msg.reply(text);
      },

      async react(emoji) {
        return msg.react(emoji);
      },

      async getContact() {
        return msg.getContact();
      },
    },

    // ── chat ─────────────────────────────────────────────────

    chat: {
      id:      chat.id._serialized,
      name:    chat.name || chat.id.user,
      isGroup: /@g\.us$/.test(chat.id._serialized),
    },
  };
}
