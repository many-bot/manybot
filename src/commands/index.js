import { enqueueDownload } from "../download/queue.js";
import { iniciarSessao, gerarSticker, help } from "./figurinha.js";
import { botMsg } from "../utils/botMsg.js";
import { iniciarJogo, pararJogo } from "../games/adivinhacao.js";
import { processarInfo } from "./info.js";
import client from "../client/whatsappClient.js";

export const stickerSessions = new Map();

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", gray: "\x1b[90m",
};

const now = () =>
  new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

const log = {
  cmd:   (cmd, ...a) => console.log(`${c.gray}${now()}${c.reset} ${c.cyan}⚙️  ${c.bold}${cmd}${c.reset}`, ...a),
  ok:    (...a)      => console.log(`${c.gray}${now()}${c.reset} ${c.green}✅${c.reset}`, ...a),
  warn:  (...a)      => console.log(`${c.gray}${now()}${c.reset} ${c.yellow}⚠️  ${c.reset}`, ...a),
  error: (...a)      => console.log(`${c.gray}${now()}${c.reset} ${c.red}❌${c.reset}`, ...a),
};

export async function processarComando(msg, chat, chatId) {
  const tokens = msg.body.trim().split(/\s+/);
  const cmd = tokens[0]?.toLowerCase();

  if (!cmd?.startsWith("!") && cmd !== "a") return;

  log.cmd(cmd);

  try {
    switch (cmd) {
      case "!many":
        await chat.sendMessage(botMsg(
          "*Comandos disponíveis:*\n\n" +
          "🎬 `!video <link>` — baixa um vídeo\n" +
          "🎵 `!audio <link>` — baixa um áudio\n" +
          "🖼️ `!figurinha` — cria figurinhas\n" +
          "🎮 `!adivinhação começar|parar` — jogo de adivinhar número\n"
        ));
        break;

      case "!video":
        if (!tokens[1]) {
          await msg.reply(botMsg("❌ Você precisa informar um link.\n\nExemplo: `!video https://youtube.com/...`"));
          log.warn("!video sem link");
          return;
        }
        await msg.reply(botMsg("⏳ Baixando o vídeo, aguarde..."));
        enqueueDownload("video", tokens[1], msg, chatId);
        log.ok("vídeo enfileirado →", tokens[1]);
        break;

      case "!audio":
        if (!tokens[1]) {
          await msg.reply(botMsg("❌ Você precisa informar um link.\n\nExemplo: `!audio https://youtube.com/...`"));
          log.warn("!audio sem link");
          return;
        }
        await msg.reply(botMsg("⏳ Baixando o áudio, aguarde..."));
        enqueueDownload("audio", tokens[1], msg, chatId);
        log.ok("áudio enfileirado →", tokens[1]);
        break;

      case "!figurinha":
        const author = msg.author || msg.from;
        const name = msg._data?.notifyName || author.replace(/(:\d+)?@.*$/, "");
        const groupId = chat.id._serialized; // < fonte única de verdade
      
        if (tokens[1] === "criar") {
          await gerarSticker(msg, groupId);
        } else {
          if (stickerSessions.has(groupId)) {
            return msg.reply(botMsg(
              "⚠️ Já existe uma sessão aberta.\n\n" +
              "Envie as mídias e depois use `!figurinha criar`.\n" +
              "Ou aguarde 2 minutos para a sessão expirar."
            ));
          }
          iniciarSessao(groupId, author, msg);
          await msg.reply(botMsg(
            `✅ Sessão iniciada por *${name}*!\n\n` + help
          ));
        }
        break;


      case "!adivinhação":
        if (!tokens[1]) {
          await chat.sendMessage(botMsg(
            "🎮 *Jogo de adivinhação:*\n\n" +
            "`!adivinhação começar` — inicia o jogo\n" +
            "`!adivinhação parar` — encerra o jogo"
          ));
          return;
        }
        if (tokens[1] === "começar") {
          iniciarJogo();
          await chat.sendMessage(botMsg(
            "🎮 *Jogo iniciado!*\n\n" +
            "Estou pensando em um número de 1 a 100.\n" +
            "Tente adivinhar! 🤔"
          ));
          log.ok("jogo iniciado");
        } else if (tokens[1] === "parar") {
          pararJogo();
          await chat.sendMessage(botMsg("🛑 Jogo encerrado."));
          log.ok("jogo parado");
        } else {
          await chat.sendMessage(botMsg(
            `❌ Subcomando *${tokens[1]}* não existe.\n\n` +
            "Use `!adivinhação começar` ou `!adivinhação parar`."
          ));
          log.warn("!adivinhação — subcomando desconhecido:", tokens[1]);
        }
        break;

      case "!obrigado":
      case "!valeu":
      case "!brigado":
        await msg.reply(botMsg("😊 Por nada!"));
        break;

      case "a":
        if (!tokens[1]) await msg.reply(botMsg("B"));
        break;
    }
  } catch (err) {
    log.error("Falha em", cmd, "—", err.message);
    await chat.sendMessage(botMsg(
      "❌ Algo deu errado ao executar esse comando.\n" +
      "Tente novamente em instantes."
    ));
  }
}