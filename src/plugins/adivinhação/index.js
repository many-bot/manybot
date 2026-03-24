/**
 * plugins/adivinhacao/index.js
 *
 * Estado dos jogos fica aqui dentro — isolado no plugin.
 * Múltiplos grupos jogam simultaneamente sem conflito.
 */

const RANGE = { min: 1, max: 100 };
const jogosAtivos = new Map();
import { CMD_PREFIX } from "../../config.js"

const sorteio = () =>
  Math.floor(Math.random() * (RANGE.max - RANGE.min + 1)) + RANGE.min;

export default async function ({ msg, api }) {
  const chatId = api.chat.id;

  // ── Comando adivinhação ──────────────────────────────────
  if (msg.is(CMD_PREFIX + "adivinhação")) {
    const sub = msg.args[1];

    if (!sub) {
      await api.send(
        "🎮 *Jogo de adivinhação:*\n\n" +
        `\`${CMD_PREFIX}adivinhação começar\` — inicia o jogo\n` +
        `\`${CMD_PREFIX}adivinhação parar\` — encerra o jogo`
      );
      return;
    }

    if (sub === "começar") {
      jogosAtivos.set(chatId, sorteio());
      await api.send(
        "🎮 *Jogo iniciado!*\n\n" +
        "Estou pensando em um número de 1 a 100.\n" +
        "Tente adivinhar! 🤔"
      );
      api.log.info(CMD_PREFIX + "adivinhação — jogo iniciado");
      return;
    }

    if (sub === "parar") {
      jogosAtivos.delete(chatId);
      await api.send("🛑 Jogo encerrado.");
      api.log.info(CMD_PREFIX + "adivinhação — jogo parado");
      return;
    }

    await api.send(
      `❌ Subcomando *${sub}* não existe.\n\n` +
      `Use ${CMD_PREFIX} + \`adivinhação começar\` ou ${CMD_PREFIX} + \`adivinhação parar\`.`
    );
    return;
  }

  // ── Tentativas durante o jogo ─────────────────────────────
  const numero = jogosAtivos.get(chatId);
  if (numero === undefined) return;

  const tentativa = msg.body.trim();
  if (!/^\d+$/.test(tentativa)) return;

  const num = parseInt(tentativa, 10);

  if (num < RANGE.min || num > RANGE.max) {
    await msg.reply(`⚠️ Digite um número entre ${RANGE.min} e ${RANGE.max}.`);
    return;
  }

  if (num === numero) {
    await msg.reply(
      `🎉 *Acertou!* O número era ${numero}!\n\n` +
      `Use ${CMD_PREFIX} + \`adivinhação começar\` para jogar de novo.`
    );
    jogosAtivos.delete(chatId);
  } else {
    await api.send(num > numero ? "📉 Tente um número *menor*!" : "📈 Tente um número *maior*!");
  }
}