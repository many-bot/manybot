import {
  c, now,
  formatType, formatContext, formatBody, formatReply,
} from "./formatter.js";

/**
 * Logger central do ManyBot.
 * Cada método lida apenas com saída — sem lógica de negócio ou I/O externo.
 */
export const logger = {
  info:    (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.cyan}INFO   ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.green}OK     ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.yellow}WARN   ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.gray}[${now()}]${c.reset} ${c.red}ERROR  ${c.reset}`, ...a),

  /**
   * Loga uma mensagem recebida a partir de um contexto já resolvido.
   * @param {import("./messageContext.js").MessageContext} ctx
   */
  msg(ctx) {
    const { chatName, isGroup, senderName, senderNumber, type, body, quoted } = ctx;
    const context = isGroup ? `${chatName} (grupo)` : chatName;
    const reply = quoted ? ` → Responde ${quoted.name} +${quoted.number}: "${quoted.preview}"` : "";
    console.log(`\n${c.gray}[${now()}]${c.reset} ${c.cyan}MSG${c.reset}     ${context} ${c.gray}— De:${c.reset} ${c.white}${senderName}${c.reset} ${c.dim}+${senderNumber}${c.reset} ${c.gray}— Tipo:${c.reset} ${type} — ${c.green}"${body}"${c.reset}${c.gray}${reply}${c.reset}`);
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