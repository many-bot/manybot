// ── Paleta ANSI ──────────────────────────────────────────────
export const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", gray: "\x1b[90m", white: "\x1b[37m",
  blue: "\x1b[34m", magenta: "\x1b[35m",
};

export const SEP = `${c.gray}${"─".repeat(52)}${c.reset}`;

export const now = () => {
  if (process.argv[2] === "--systemd") return "";
  return `[${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}]`;
};

export const formatType = (type) => ({
  sticker:  `${c.magenta}sticker${c.reset}`,
  image:    `${c.cyan}imagem${c.reset}`,
  video:    `${c.cyan}vídeo${c.reset}`,
  audio:    `${c.cyan}áudio${c.reset}`,
  ptt:      `${c.cyan}áudio${c.reset}`,
  document: `${c.cyan}arquivo${c.reset}`,
  chat:     `${c.white}texto${c.reset}`,
}[type] ?? `${c.gray}${type}${c.reset}`);

export const formatContext = (chatName, isGroup) =>
  isGroup
    ? `${c.bold}${chatName}${c.reset} ${c.dim}(grupo)${c.reset}`
    : `${c.bold}${chatName}${c.reset} ${c.dim}(privado)${c.reset}`;

export const formatBody = (body, isCommand) =>
  body?.trim()
    ? `${isCommand ? c.yellow : c.green}"${body.length > 200 ? body.slice(0, 200) + "..." : body}"${c.reset}`
    : `${c.dim}<mídia>${c.reset}`;

export const formatReply = (quotedName, quotedNumber, quotedPreview) =>
  `\n${c.gray}            ↩ Para: ${c.reset}${c.white}${quotedName}${c.reset} ${c.dim}+${quotedNumber}${c.reset}` +
  `\n${c.gray}            ↩ Msg:  ${c.reset}${c.dim}${quotedPreview}${c.reset}`;