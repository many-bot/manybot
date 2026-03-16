import { botMsg } from "../../../utils/botMsg.js";

/**
 * Estado dos jogos ativos, keyed por chatId.
 * Permite múltiplos grupos jogando simultaneamente sem conflito.
 * @type {Map<string, number>}
 */
const jogosAtivos = new Map();

const RANGE = { min: 1, max: 100 };

const sorteio = () =>
  Math.floor(Math.random() * (RANGE.max - RANGE.min + 1)) + RANGE.min;

/**
 * @param {string} chatId
 */
export function iniciarJogo(chatId) {
  const numero = sorteio();
  jogosAtivos.set(chatId, numero);
  return numero;
}

/**
 * @param {string} chatId
 */
export function pararJogo(chatId) {
  jogosAtivos.delete(chatId);
}

/**
 * Processa uma tentativa de adivinhação.
 * @param {import("whatsapp-web.js").Message} msg
 * @param {import("whatsapp-web.js").Chat}    chat
 */
export async function processarJogo(msg, chat) {
  const chatId = chat.id._serialized;
  const numero = jogosAtivos.get(chatId);

  if (numero === undefined) return;

  const tentativa = msg.body.trim();
  if (!/^\d+$/.test(tentativa)) return;

  const num = parseInt(tentativa, 10);

  if (num < RANGE.min || num > RANGE.max) {
    await msg.reply(botMsg(`⚠️ Digite um número entre ${RANGE.min} e ${RANGE.max}.`));
    return;
  }

  if (num === numero) {
    await msg.reply(botMsg(
      `🎉 *Acertou!* O número era ${numero}!\n\n` +
      "Use \`!adivinhação começar\` para jogar de novo."
    ));
    pararJogo(chatId);
  } else {
    await chat.sendMessage(botMsg(num > numero ? "📉 Tente um número *menor*!" : "📈 Tente um número *maior*!"));
  }
}