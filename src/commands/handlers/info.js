import { botMsg } from "../../utils/botMsg.js";

const HELP = new Map([
  ["ping",      "> `!ping`\nResponde pong."],
  ["video",     "> `!video <link>`\nBaixa vídeo da internet."],
  ["audio",     "> `!audio <link>`\nBaixa áudio da internet."],
  ["figurinha", "> `!figurinha`\nTransforma imagem/GIF em sticker."],
]);

/**
 * Envia a descrição de um comando específico.
 * @param {string} cmd   — nome do comando (sem prefixo)
 * @param {object} chat
 */
export async function processarInfo(cmd, chat) {
  const texto = HELP.get(cmd);

  if (!texto) {
    await chat.sendMessage(botMsg(`❌ Comando '${cmd}' não encontrado.`));
    return;
  }

  await chat.sendMessage(botMsg(texto));
}