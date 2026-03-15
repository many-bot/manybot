import { enqueueDownload } from "../download/queue.js";
import { iniciarSessao, gerarSticker } from "./figurinha.js";
import { botMsg } from "../utils/botMsg.js";
import { iniciarJogo, pararJogo } from "../games/adivinhacao.js";
import { processarInfo } from "./info.js";

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
          "Comandos:\n\n" +
          "- `!ping`\n" +
          "- `!video <link>`\n" +
          "- `!audio <link>`\n" +
          "- `!figurinha`\n" +
          "- `!adivinhação começar|parar`\n" +
          "- `!info <comando>`"
        ));
        break;

      case "!ping":
        await msg.reply(botMsg("pong 🏓"));
        log.ok("pong enviado");
        break;

      case "!video":
        if (!tokens[1]) { log.warn("!video sem link"); return; }
        await msg.reply(botMsg("⏳ Baixando vídeo..."));
        enqueueDownload("video", tokens[1], msg, chatId);
        log.ok("vídeo enfileirado →", tokens[1]);
        break;

      case "!audio":
        if (!tokens[1]) { log.warn("!audio sem link"); return; }
        await msg.reply(botMsg("⏳ Baixando áudio..."));
        enqueueDownload("audio", tokens[1], msg, chatId);
        log.ok("áudio enfileirado →", tokens[1]);
        break;

      case "!figurinha":
        const author = msg.author || msg.from;
      
        if (tokens[1] === "criar") {
          await gerarSticker(msg, chatId);
        } else {
          if (stickerSessions.has(chatId)) {
             return msg.reply(botMsg("Já existe uma sessão ativa."));
          }

          iniciarSessao(chatId, author);
          
          await msg.reply(botMsg(
            `Sessão de figurinha iniciada por @${author.split("@")[0]}. Envie no máximo 10 imagens, quando estiver pronto mande \`!figurinha criar\``,
            null,
            { mentions: [author] }
          ));
        }
      
        break;
      

      case "!adivinhação":
        if (!tokens[1]) {
          await chat.sendMessage(botMsg("`!adivinhação começar`\n`!adivinhação parar`"));
          return;
        }
        if (tokens[1] === "começar") {
          iniciarJogo();
          await chat.sendMessage(botMsg("Jogo iniciado! Tente adivinhar o número de 1 a 100."));
          log.ok("jogo iniciado");
        } else if (tokens[1] === "parar") {
          pararJogo();
          await chat.sendMessage(botMsg("Jogo parado."));
          log.ok("jogo parado");
        } else {
          log.warn("!adivinhação — subcomando desconhecido:", tokens[1]);
        }
        break;

      case "!info":
        if (!tokens[1]) {
          await chat.sendMessage(botMsg("Use:\n`!info <comando>`"));
          return;
        }
        processarInfo(tokens[1], chat);
        log.ok("info →", tokens[1]);
        break;

      case "!obrigado":
      case "!valeu":
      case "!brigado":
        await msg.reply(botMsg("Por nada!"));
        break;

      case "a":
        if (!tokens[1]) await msg.reply(botMsg("B"));
        break;
    }
  } catch (err) {
    log.error("Falha em", cmd, "—", err.message);
    await chat.sendMessage(botMsg("Erro:\n`" + err.message + "`"));
  }
}