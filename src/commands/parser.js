import { CMD_PREFIX } from "../config.js";

/**
 * @typedef {Object} ParsedCommand
 * @property {string}   cmd    — ex: "!video", "a"
 * @property {string[]} args   — tokens restantes
 * @property {boolean}  valid  — false se não for um comando reconhecível
 */

/**
 * Extrai comando e argumentos de uma mensagem.
 * Retorna `valid: false` para mensagens que não são comandos.
 *
 * @param {string} body
 * @returns {ParsedCommand}
 */
export function parseCommand(body) {
  const tokens = body?.trim().split(/\s+/) ?? [];
  const cmd    = tokens[0]?.toLowerCase() ?? "";
  const args   = tokens.slice(1);
  const valid  = cmd.startsWith(CMD_PREFIX) || cmd === "a";

  return { cmd, args, valid };
}