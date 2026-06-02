/**
 * pluginApi.js
 *
 * Builds the `api` object each plugin receives.
 * Plugins can only do what's here — never touch client directly.
 *
 * `chat` is already filtered by kernel (only allowed chats from .conf),
 * so plugins don't need and can't choose destination.
 */

import { logger }      from "#logger";
import pkg             from "whatsapp-web.js";

const { MessageMedia } = pkg;

/**
 * @param {object} params
 * @param {import("whatsapp-web.js").Message} params.msg
 * @param {import("whatsapp-web.js").Chat}    params.chat
 * @param {Map<string, any>}                  params.pluginRegistry
 * @returns {object} api
 */
/**
 * Setup API — without message context.
 * Passed to plugin.setup(api) during initialization.
 * Only has sendTo variants, log and schedule.
 */
export function buildSetupApi(client) {
  return {
    async sendTo(chatId, text) {
      return client.sendMessage(chatId, text);
    },
    async sendVideoTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { caption });
    },
    async sendAudioTo(chatId, filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    },
    async sendImageTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { caption });
    },
    async sendStickerTo(chatId, source) {
      const media = typeof source === "string"
        ? MessageMedia.fromFilePath(source)
        : new MessageMedia("image/webp", source.toString("base64"));
      return client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    },
    log: {
      info:    (...a) => logger.info(...a),
      warn:    (...a) => logger.warn(...a),
      error:   (...a) => logger.error(...a),
      success: (...a) => logger.success(...a),
    },
  };
}

export function buildApi({ msg, chat, client, pluginRegistry }) {

  const currentChat = chat;

  return {

    // ── Message reading ─────────────────────────────────────

    msg: {
      /** Message body */
      body:   msg.body ?? "",

      /** Type: "chat", "image", "video", "audio", "ptt", "sticker", "document" */
      type:   msg.type,

      /** true if message came from bot itself */
      fromMe: msg.fromMe,

      /** Sender ID (ex: "5511999999999@c.us") */
      sender: msg.author || msg.from,

      /** Display name of sender */
      senderName: msg._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, ""),

      /** Tokens: ["!video", "https://..."] */
      args:   msg.body?.trim().split(/\s+/) ?? [],

      /**
       * Check if message is a specific command.
       * @param {string} cmd — ex: "!hello"
       */
      is(cmd) {
        return msg.body?.trim().toLowerCase().startsWith(cmd.toLowerCase());
      },

      /** true if message has attached media */
      hasMedia: msg.hasMedia,

      /** true if media is a GIF (short looping video) */
      isGif: msg._data?.isGif ?? false,

      /**
       * Download message media.
       * Returns neutral object { mimetype, data } — without exposing MessageMedia.
       * @returns {Promise<{ mimetype: string, data: string } | null>}
       */
      async downloadMedia() {
        const media = await msg.downloadMedia();
        if (!media) return null;
        return { mimetype: media.mimetype, data: media.data };
      },

      /** true if message is a reply to another */
      hasReply: msg.hasQuotedMsg,

      /**
       * Returns quoted message if exists.
       * @returns {Promise<import("whatsapp-web.js").Message|null>}
       */
      async getReply() {
        if (!msg.hasQuotedMsg) return null;
        return msg.getQuotedMessage();
      },

      /**
       * Reply directly to message (with quote).
       * @param {string} text
       */
      async reply(text) {
        return msg.reply(text);
      },
    },

    // ── Send to current chat ─────────────────────────────────

    /**
     * Send plain text.
     * @param {string} text
     */
    async send(text) {
      return currentChat.sendMessage(text);
    },

    /**
     * Send media (image, video, audio, document).
     * @param {import("whatsapp-web.js").MessageMedia} media
     * @param {string} [caption]
     */
    async sendMedia(media, caption = "") {
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Send video file from local path.
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendVideo(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Send audio file from local path.
     * @param {string} filePath
     */
    async sendAudio(filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { sendAudioAsVoice: true });
    },

    /**
     * Send image from local path.
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendImage(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Send a sticker.
     * Accepts filePath (string) or buffer (Buffer) — plugin never needs
     * to know MessageMedia exists.
     * @param {string | Buffer} source
     */
    async sendSticker(source) {
      const media = typeof source === "string"
        ? MessageMedia.fromFilePath(source)
        : new MessageMedia("image/webp", source.toString("base64"));
      return currentChat.sendMessage(media, { sendMediaAsSticker: true });
    },

    // ── Send to specific chat ───────────────────────────────

    /**
     * Send text to specific chat by ID.
     * @param {string} chatId
     * @param {string} text
     */
    async sendTo(chatId, text) {
      return client.sendMessage(chatId, text);
    },

    /**
     * Send video to specific chat by ID.
     * @param {string} chatId
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendVideoTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { caption });
    },

    /**
     * Send audio to specific chat by ID.
     * @param {string} chatId
     * @param {string} filePath
     */
    async sendAudioTo(chatId, filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    },

    /**
     * Send image to specific chat by ID.
     * @param {string} chatId
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendImageTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return client.sendMessage(chatId, media, { caption });
    },

    /**
     * Send sticker to specific chat by ID.
     * @param {string} chatId
     * @param {string | Buffer} source
     */
    async sendStickerTo(chatId, source) {
      const media = typeof source === "string"
        ? MessageMedia.fromFilePath(source)
        : new MessageMedia("image/webp", source.toString("base64"));
      return client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    },

    // ── Access other plugins ─────────────────────────────────

    /**
     * Return public API of another plugin (what it exported in `exports`).
     * Returns null if plugin doesn't exist or is disabled.
     * @param {string} name — plugin name (folder in /plugins)
     * @returns {any|null}
     */
    getPlugin(name) {
      return pluginRegistry.get(name)?.exports ?? null;
    },

    // ── Logger ───────────────────────────────────────────────

    log: {
      info:    (...a) => logger.info(...a),
      warn:    (...a) => logger.warn(...a),
      error:   (...a) => logger.error(...a),
      success: (...a) => logger.success(...a),
    },

    // ── Current chat info ────────────────────────────────────

    chat: {
      id:      currentChat.id._serialized,
      name:    currentChat.name || currentChat.id.user,
      isGroup: /@g\.us$/.test(currentChat.id._serialized),
    },
  };
}
