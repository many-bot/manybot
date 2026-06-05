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
import { client }                              from "#client/whatsappClient";

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
        throw new Error(`Plugin dependency "${name}" is not active.`);
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
    async text(content) {
      return target.sendMessage(content);
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
    sendTo:        (chatId, text)              => client.sendMessage(chatId, text),
    sendImageTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).image(filePath, caption),
    sendVideoTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).video(filePath, caption),
    sendAudioTo:   (chatId, filePath)          => makeSender(chatIdTarget(client, chatId)).audio(filePath),
    sendStickerTo: (chatId, source)            => makeSender(chatIdTarget(client, chatId)).sticker(source),

    log,
    t,
    config:   buildConfigApi(),
    i18n:     buildI18nApi(),
    utils:    buildUtilsApi(),
    download: buildDownloadApi(),
    plugins:  buildPluginsApi(pluginRegistry),
    botId:    client.info?.wid?._serialized ?? null,
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

  const currentSender = makeSender(chat);

  return {

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
        return msg.body?.trim().toLowerCase().startsWith(cmd.toLowerCase());
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
    },

    // ── chat ─────────────────────────────────────────────────

    chat: {
      id:      chat.id._serialized,
      name:    chat.name || chat.id.user,
      isGroup: /@g\.us$/.test(chat.id._serialized),
    },

    // ── send (current chat) ──────────────────────────────────

    send:        (text)              => currentSender.text(text),
    sendImage:   (filePath, caption) => currentSender.image(filePath, caption),
    sendVideo:   (filePath, caption) => currentSender.video(filePath, caption),
    sendAudio:   (filePath)          => currentSender.audio(filePath),
    sendSticker: (source)            => currentSender.sticker(source),

    // ── sendTo (specific chat) ───────────────────────────────

    sendTo:        (chatId, text)              => client.sendMessage(chatId, text),
    sendImageTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).image(filePath, caption),
    sendVideoTo:   (chatId, filePath, caption) => makeSender(chatIdTarget(client, chatId)).video(filePath, caption),
    sendAudioTo:   (chatId, filePath)          => makeSender(chatIdTarget(client, chatId)).audio(filePath),
    sendStickerTo: (chatId, source)            => makeSender(chatIdTarget(client, chatId)).sticker(source),

    // ── system ───────────────────────────────────────────────

    log,
    t,
    config:   buildConfigApi(),
    i18n:     buildI18nApi(),
    utils:    buildUtilsApi(),
    download: buildDownloadApi(),
    plugins:  buildPluginsApi(pluginRegistry),
    botId: client.info?.wid?._serialized ?? null,
  };
}
