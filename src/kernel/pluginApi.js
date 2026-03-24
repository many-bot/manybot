/**
 * pluginApi.js
 *
 * Monta o objeto `api` que cada plugin recebe.
 * Plugins só podem fazer o que está aqui — nunca tocam no client diretamente.
 *
 * O `chat` já vem filtrado pelo kernel (só chats permitidos no .conf),
 * então plugins não precisam e não podem escolher destino.
 */

import { logger }      from "../logger/logger.js";
import pkg             from "whatsapp-web.js";

const { MessageMedia } = pkg;

/**
 * @param {object} params
 * @param {import("whatsapp-web.js").Message} params.msg
 * @param {import("whatsapp-web.js").Chat}    params.chat
 * @param {Map<string, any>}                  params.pluginRegistry
 * @returns {object} api
 */
export function buildApi({ msg, chat, pluginRegistry }) {

  // ── Helpers internos ──────────────────────────────────────
  const currentChat = chat;

  return {

    // ── Leitura de mensagem ──────────────────────────────────

    msg: {
      /** Corpo da mensagem */
      body:   msg.body ?? "",

      /** Tipo: "chat", "image", "video", "audio", "ptt", "sticker", "document" */
      type:   msg.type,

      /** true se a mensagem veio do próprio bot */
      fromMe: msg.fromMe,

      /** ID de quem enviou (ex: "5511999999999@c.us") */
      sender: msg.author || msg.from,

      /** Nome de exibição de quem enviou */
      senderName: msg._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, ""),

      /** Tokens: ["!video", "https://..."] */
      args:   msg.body?.trim().split(/\s+/) ?? [],

      /**
       * Verifica se a mensagem é um comando específico.
       * @param {string} cmd — ex: "!hello"
       */
      is(cmd) {
        return msg.body?.trim().toLowerCase().startsWith(cmd.toLowerCase());
      },

      /** true se a mensagem tem mídia anexada */
      hasMedia: msg.hasMedia,

      /** true se a mídia é um GIF (vídeo curto em loop) */
      isGif: msg._data?.isGif ?? false,

      /**
       * Baixa a mídia da mensagem.
       * Retorna um objeto neutro { mimetype, data } — sem expor MessageMedia.
       * @returns {Promise<{ mimetype: string, data: string } | null>}
       */
      async downloadMedia() {
        const media = await msg.downloadMedia();
        if (!media) return null;
        return { mimetype: media.mimetype, data: media.data };
      },

      /** true se a mensagem é uma resposta a outra */
      hasReply: msg.hasQuotedMsg,

      /**
       * Retorna a mensagem citada, se existir.
       * @returns {Promise<import("whatsapp-web.js").Message|null>}
       */
      async getReply() {
        if (!msg.hasQuotedMsg) return null;
        return msg.getQuotedMessage();
      },

      /**
       * Responde diretamente à mensagem (com quote).
       * @param {string} text
       */
      async reply(text) {
        return msg.reply(text);
      },
    },

    // ── Envio para o chat atual ──────────────────────────────

    /**
     * Envia texto simples.
     * @param {string} text
     */
    async send(text) {
      return currentChat.sendMessage(text);
    },

    /**
     * Envia uma mídia (imagem, vídeo, áudio, documento).
     * @param {import("whatsapp-web.js").MessageMedia} media
     * @param {string} [caption]
     */
    async sendMedia(media, caption = "") {
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Envia um arquivo de vídeo a partir de um caminho local.
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendVideo(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Envia um arquivo de áudio a partir de um caminho local.
     * @param {string} filePath
     */
    async sendAudio(filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { sendAudioAsVoice: true });
    },

    /**
     * Envia uma imagem a partir de um caminho local.
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendImage(filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat.sendMessage(media, { caption });
    },

    /**
     * Envia uma figurinha (sticker).
     * Aceita filePath (string) ou buffer (Buffer) — o plugin nunca precisa
     * saber que MessageMedia existe.
     * @param {string | Buffer} source
     */
    async sendSticker(source) {
      const media = typeof source === "string"
        ? MessageMedia.fromFilePath(source)
        : new MessageMedia("image/webp", source.toString("base64"));
      return currentChat.sendMessage(media, { sendMediaAsSticker: true });
    },

    // ── Envio para chat específico ───────────────────────────

    /**
     * Envia texto para um chat específico por ID.
     * @param {string} chatId
     * @param {string} text
     */
    async sendTo(chatId, text) {
      return currentChat._client.sendMessage(chatId, text);
    },

    /**
     * Envia vídeo para um chat específico por ID.
     * @param {string} chatId
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendVideoTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat._client.sendMessage(chatId, media, { caption });
    },

    /**
     * Envia áudio para um chat específico por ID.
     * @param {string} chatId
     * @param {string} filePath
     */
    async sendAudioTo(chatId, filePath) {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat._client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    },

    /**
     * Envia imagem para um chat específico por ID.
     * @param {string} chatId
     * @param {string} filePath
     * @param {string} [caption]
     */
    async sendImageTo(chatId, filePath, caption = "") {
      const media = MessageMedia.fromFilePath(filePath);
      return currentChat._client.sendMessage(chatId, media, { caption });
    },

    /**
     * Envia figurinha para um chat específico por ID.
     * @param {string} chatId
     * @param {string | Buffer} source
     */
    async sendStickerTo(chatId, source) {
      const media = typeof source === "string"
        ? MessageMedia.fromFilePath(source)
        : new MessageMedia("image/webp", source.toString("base64"));
      return currentChat._client.sendMessage(chatId, media, { sendMediaAsSticker: true });
    },

    // ── Acesso a outros plugins ──────────────────────────────

    /**
     * Retorna a API pública de outro plugin (o que ele exportou em `exports`).
     * Retorna null se o plugin não existir ou estiver desativado.
     * @param {string} name — nome do plugin (pasta em /plugins)
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

    // ── Info do chat atual ───────────────────────────────────

    chat: {
      id:      currentChat.id._serialized,
      name:    currentChat.name || currentChat.id.user,
      isGroup: /@g\.us$/.test(currentChat.id._serialized),
    },
  };
}