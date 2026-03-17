import fs from "fs";

function parseConf(raw) {
  // Remove comentários inline e de linha inteira, preservando estrutura
  const lines = raw.split("\n");

  const cleaned = [];
  let insideList = false;
  let buffer = "";

  for (let line of lines) {
    // Remove comentário inline (# ...) — mas só fora de strings
    line = line.replace(/#.*$/, "").trim();
    if (!line) continue;

    if (!insideList) {
      if (line.includes("=[") && !line.includes("]")) {
        // Início de lista multilinha
        insideList = true;
        buffer = line;
      } else {
        cleaned.push(line);
      }
    } else {
      buffer += line;
      if (line.includes("]")) {
        // Fim da lista
        insideList = false;
        cleaned.push(buffer);
        buffer = "";
      }
    }
  }

  // Parseia cada linha chave=valor
  const result = {};
  for (const line of cleaned) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    const raw = line.slice(eqIdx + 1).trim();

    if (raw.startsWith("[") && raw.endsWith("]")) {
      result[key] = raw
        .slice(1, -1)
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    } else {
      result[key] = raw;
    }
  }

  return result;
}

const raw = fs.readFileSync("manybot.conf", "utf8");
const config = parseConf(raw);

export const CLIENT_ID  = config.CLIENT_ID  ?? "bot_permanente";
export const BOT_PREFIX = config.BOT_PREFIX ?? "🤖 *ManyBot:* ";
export const CMD_PREFIX = config.CMD_PREFIX ?? "!";
export const CHATS      = config.CHATS      ?? [];