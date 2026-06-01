import {
  c, now,
  formatType, formatContext, formatBody, formatReply,
} from "./formatter.js";

/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 */
export const logger = {
  info:    (...a) => console.log(`${c.gray}${now()}${c.reset}${c.cyan}INFO   ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.gray}${now()}${c.reset}${c.green}OK     ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.gray}${now()}${c.reset}${c.yellow}WARN   ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.gray}${now()}${c.reset}${c.red}ERROR  ${c.reset}`, ...a),

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
