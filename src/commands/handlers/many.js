import { botMsg } from "../../utils/botMsg.js";

export async function cmdMany(msg, chat) {
  await chat.sendMessage(botMsg(
    "*Comandos disponíveis:*\n\n" +
    "🎬 `!video <link>` — baixa um vídeo\n" +
    "🎵 `!audio <link>` — baixa um áudio\n" +
    "🖼️ `!figurinha` — cria figurinhas\n" +
    "🎮 `!adivinhação começar|parar` — jogo de adivinhar número\n"
  ));
}