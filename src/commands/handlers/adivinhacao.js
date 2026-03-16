import { iniciarJogo, pararJogo } from "../logic/games/adivinhacao.js";
import { botMsg }                 from "../../utils/botMsg.js";
import { logger }                 from "../../logger/logger.js";

const SUBCOMANDOS = new Map([
  ["começar", async (chat) => {
    iniciarJogo(chat.id._serialized);
    await chat.sendMessage(botMsg(
      "🎮 *Jogo iniciado!*\n\n" +
      "Estou pensando em um número de 1 a 100.\n" +
      "Tente adivinhar! 🤔"
    ));
    logger.done("!adivinhação", "jogo iniciado");
  }],
  ["parar", async (chat) => {
    pararJogo(chat.id._serialized);
    await chat.sendMessage(botMsg("🛑 Jogo encerrado."));
    logger.done("!adivinhação", "jogo parado");
  }],
]);

export async function cmdAdivinhacao(msg, chat, _chatId, args) {
  if (!args[0]) {
    await chat.sendMessage(botMsg(
      "🎮 *Jogo de adivinhação:*\n\n" +
      "`!adivinhação começar` — inicia o jogo\n" +
      "`!adivinhação parar` — encerra o jogo"
    ));
    return;
  }

  const subcomando = SUBCOMANDOS.get(args[0]);

  if (!subcomando) {
    await chat.sendMessage(botMsg(
      `❌ Subcomando *${args[0]}* não existe.\n\n` +
      "Use `!adivinhação começar` ou `!adivinhação parar`."
    ));
    logger.warn(`!adivinhação — subcomando desconhecido: ${args[0]}`);
    return;
  }

  await subcomando(chat);
}