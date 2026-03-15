import { botMsg } from "../utils/botMsg.js";

let jogoAtivo = null;

export function iniciarJogo() {
  jogoAtivo = Math.floor(Math.random() * 100) + 1;
  return jogoAtivo;
}

export function pararJogo() {
  jogoAtivo = null;
}

export async function processarJogo(msg, chat) {
  if (!jogoAtivo) return;

  const tentativa = msg.body.trim();
  if (!/^\d+$/.test(tentativa)) return;

  const num = parseInt(tentativa);

  if (num === jogoAtivo) {
    await msg.reply(botMsg(
      `🎉 *Acertou!* O número era ${jogoAtivo}!\n\n` +
      "Use `!adivinhação começar` para jogar de novo."
    ));
    pararJogo();
  } else if (num < 1 || num > 100) {
    await msg.reply(botMsg("⚠️ Digite um número entre 1 e 100."));
  } else if (num > jogoAtivo) {
    await chat.sendMessage(botMsg("📉 Tente um número *menor*!"));
  } else {
    await chat.sendMessage(botMsg("📈 Tente um número *maior*!"));
  }
}