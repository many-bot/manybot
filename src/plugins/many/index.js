import { CMD_PREFIX } from "../../config.js"

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "many")) return;

  await api.send(
    `🤖 *ManyBot — Comandos disponíveis:*\n\n` +
    `🎬 \`${CMD_PREFIX}video <link>\` — baixa um vídeo\n` +
    `🎵 \`${CMD_PREFIX}audio <link>\` — baixa um áudio\n` +
    `🖼️ \`${CMD_PREFIX}figurinha\` — cria figurinhas\n` +
    `🎮 \`${CMD_PREFIX}adivinhação começar|parar\` — jogo de adivinhar número\n` +
    `🎮 \`${CMD_PREFIX}forca começar|parar\` — jogo da forca\n`
  );
}