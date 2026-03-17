import fs from "fs";

function parseValue(v) {
  v = v.trim();

  // lista: [a, b, c]
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
  }

  return v;
}

const raw = fs.readFileSync("manybot.conf", "utf8");

const config = Object.fromEntries(
  raw
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [k, ...v] = l.split("=");
      return [k.trim(), parseValue(v.join("="))];
    })
);

export const CLIENT_ID  = config.CLIENT_ID  ?? "bot_permanente";
export const BOT_PREFIX = config.BOT_PREFIX ?? "🤖 *ManyBot:* ";
export const CMD_PREFIX = config.CMD_PREFIX ?? "!";
export const CHATS      = config.CHATS      ?? [];