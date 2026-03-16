import {
  c, SEP, now,
  formatType, formatContext, formatBody, formatReply,
} from "./formatter.js";

/**
 * Logger central do ManyBot.
 * Cada método lida apenas com saída — sem lógica de negócio ou I/O externo.
 */
export const logger = {
  info:    (...a) => console.log(`${SEP}\n${c.gray}[${now()}]${c.reset} ${c.cyan}INFO   ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.green}OK     ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.yellow}WARN   ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.red}ERROR  ${c.reset}`, ...a),

  /**
   * Loga uma mensagem recebida a partir de um contexto já resolvido.
   * @param {import("./messageContext.js").MessageContext} ctx
   */
  msg(ctx) {
    const { chatName, isGroup, senderName, senderNumber, type, body, isCommand, quoted } = ctx;

    const typeLabel  = formatType(type);
    const context    = formatContext(chatName, isGroup);
    const bodyText   = formatBody(body, isCommand);
    const replyLine  = quoted
      ? formatReply(quoted.name, quoted.number, quoted.preview)
      : "";

    console.log(
      `${SEP}\n` +
      `${c.gray}[${now()}]${c.reset} ${c.cyan}MSG    ${c.reset}${context}\n` +
      `${c.gray}            De:   ${c.reset}${c.white}${senderName}${c.reset} ${c.dim}+${senderNumber}${c.reset}\n` +
      `${c.gray}            Tipo: ${c.reset}${typeLabel}${isCommand ? `  ${c.yellow}(bot)${c.reset}` : ""}\n` +
      `${c.gray}            Text: ${c.reset}${bodyText}` +
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