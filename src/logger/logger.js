import {
  c, now,
  formatType, formatContext, formatBody, formatReply,
} from "./formatter.js";
import { t } from "../i18n/index.js";

/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 */
export const logger = {
  info:    (...a) => console.log(`${c.gray}${now()}${c.reset}${c.cyan}INFO   ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.gray}${now()}${c.reset}${c.green}OK     ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.gray}${now()}${c.reset}${c.yellow}WARN   ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.gray}${now()}${c.reset}${c.red}ERROR  ${c.reset}`, ...a),

  /**
   * Log a received message from a resolved context.
   * @param {import("./messageContext.js").MessageContext} ctx
   */
  msg(ctx) {
    const { chatName, isGroup, senderName, senderNumber, type, body, quoted } = ctx;
    const context = isGroup ? `${chatName} (${t("log.context.group")})` : chatName;
    const reply = quoted ? ` → ${t("log.context.replyTo")} ${quoted.name} +${quoted.number}: "${quoted.preview}"` : "";
    console.log(`\n${c.gray}${now()}${c.reset}${c.cyan}MSG${c.reset}     ${context} ${c.gray}— ${t("log.context.from")}:${c.reset} ${c.white}${senderName}${c.reset} ${c.dim}+${senderNumber}${c.reset} ${c.gray}— ${t("log.context.type")}:${c.reset} ${type} — ${c.green}"${body}"${c.reset}${c.gray}${reply}${c.reset}`);
  },

  cmd: (cmd, extra = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.yellow}CMD    ${c.reset}` +
      `${c.bold}${cmd}${c.reset}` +
      (extra ? `  ${c.dim}${extra}${c.reset}` : "")
    ),

  done: (cmd, detail = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.green}DONE   ${c.reset}` +
      `${c.dim}${cmd}${c.reset}` +
      (detail ? ` — ${detail}` : "")
    ),
};