import client from "./client/whatsappClient.js";
import { CHATS, BOT_PREFIX } from "./config.js";  // <- importar PREFIX
import { processarComando } from "./commands/index.js";
import { coletarMidia } from "./commands/figurinha.js";
import { processarJogo } from "./games/adivinhacao.js";
import { getChatId } from "./utils/getChatId.js";

// ── Cores ────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", gray: "\x1b[90m", white: "\x1b[37m",
  blue: "\x1b[34m", magenta: "\x1b[35m",
};

const now = () =>
  new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

const SEP = `${c.gray}${"─".repeat(52)}${c.reset}`;

// ── Logger ───────────────────────────────────────────────────
const logger = {
  info:    (...a) => console.log(`${SEP}\n${c.gray}[${now()}]${c.reset} ${c.cyan}INFO   ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.green}OK     ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.yellow}WARN   ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.red}ERROR  ${c.reset}`, ...a),

  msg: async (chatName, chatId, from, body, msg = {}) => {
    const number = String(from).split("@")[0];
    const isGroup = /@g\.us$/.test(chatId);
    let name = msg?.notifyName || number;

    try {
      if (typeof client?.getContactById === "function") {
        const contact = await client.getContactById(from);
        name = contact?.pushname || contact?.formattedName || name;
      }
    } catch {}

    const type = msg?.type || "text";
    const typeLabel =
      type === "sticker"  ? `${c.magenta}sticker${c.reset}` :
      type === "image"    ? `${c.cyan}imagem${c.reset}`     :
      type === "video"    ? `${c.cyan}vídeo${c.reset}`      :
      type === "audio"    ? `${c.cyan}áudio${c.reset}`      :
      type === "ptt"      ? `${c.cyan}áudio${c.reset}`      :
      type === "document" ? `${c.cyan}arquivo${c.reset}`    :
      type === "chat"     ? `${c.white}texto${c.reset}`     :
                            `${c.gray}${type}${c.reset}`;

    const isCommand = body?.trimStart().startsWith(BOT_PREFIX);

    const context = isGroup
      ? `${c.bold}${chatName}${c.reset} ${c.dim}(grupo)${c.reset}`
      : `${c.bold}${chatName}${c.reset} ${c.dim}(privado)${c.reset}`;

    const bodyPreview = body?.trim()
      ? `${isCommand ? c.yellow : c.green}"${body.length > 200 ? body.slice(0, 200) + "..." : body}"${c.reset}`
      : `${c.dim}<${typeLabel}>${c.reset}`;

    // Resolve reply
    let replyLine = "";
    if (msg?.hasQuotedMsg) {
      try {
        const quoted = await msg.getQuotedMessage();
        const quotedNumber = String(quoted.from).split("@")[0];
        let quotedName = quotedNumber;
        try {
          const quotedContact = await client.getContactById(quoted.from);
          quotedName = quotedContact?.pushname || quotedContact?.formattedName || quotedNumber;
        } catch {}
        const quotedPreview = quoted.body?.trim()
          ? `"${quoted.body.length > 80 ? quoted.body.slice(0, 80) + "…" : quoted.body}"`
          : `<${quoted.type}>`;
        replyLine =
          `\n${c.gray}            ↩ Para: ${c.reset}${c.white}${quotedName}${c.reset} ${c.dim}+${quotedNumber}${c.reset}` +
          `\n${c.gray}            ↩ Msg:  ${c.reset}${c.dim}${quotedPreview}${c.reset}`;
      } catch {}
    }

    console.log(
      `${SEP}\n` +
      `${c.gray}[${now()}]${c.reset} ${c.cyan}MSG    ${c.reset}${context}\n` +
      `${c.gray}            De:   ${c.reset}${c.white}${name}${c.reset} ${c.dim}+${number}${c.reset}\n` +
      `${c.gray}            Tipo: ${c.reset}${typeLabel}${isCommand ? `  ${c.yellow}(bot)${c.reset}` : ""}\n` +
      `${c.gray}            Text: ${c.reset}${bodyPreview}` +
      replyLine
    );
  },

  cmd: (cmd, extra = "") =>
    console.log(
      `${c.gray}[${now()}]${c.reset} ${c.yellow}CMD    ${c.reset}` +
      `${c.bold}${cmd}${c.reset}` +
      (extra ? `  ${c.dim}${extra}${c.reset}` : "")
    ),

  done: (cmd, detail = "") =>
    console.log(
      `${c.gray}[${now()}]${c.reset} ${c.green}DONE   ${c.reset}` +
      `${c.dim}${cmd}${c.reset}` +
      (detail ? ` — ${detail}` : "")
    ),
};

export { logger };

// ── Boot ─────────────────────────────────────────────────────
logger.info("Iniciando ManyBot...");

client.on("message_create", async msg => {
  try {
    const chat = await msg.getChat();
    const chatId = getChatId(chat);

    if (!CHATS.includes(chatId)) return;

    await logger.msg(chat.name || chat.id.user, chatId, msg.from, msg.body, msg);

    await coletarMidia(msg);
    await processarComando(msg, chat, chatId);
    await processarJogo(msg, chat);

    logger.done("message_create", `de +${String(msg.from).split("@")[0]}`);
  } catch (err) {
    logger.error(
      `Falha ao processar — ${err.message}`,
      `\n             Stack: ${err.stack?.split("\n")[1]?.trim() ?? ""}`
    );
  }
});

client.initialize();
logger.info("Cliente inicializado. Aguardando conexão com WhatsApp...");