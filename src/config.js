/**
 * config.js
 *
 * Lê e parseia o manybot.conf.
 * Suporta listas multilinhas e comentários inline.
 */

import fs from "fs";

function parseConf(raw) {
  const lines = raw.split("\n");

  const cleaned = [];
  let insideList = false;
  let buffer = "";

  for (let line of lines) {
    line = line.replace(/#.*$/, "").trim();
    if (!line) continue;

    if (!insideList) {
      if (line.includes("=[") && !line.includes("]")) {
        insideList = true;
        buffer = line;
      } else {
        cleaned.push(line);
      }
    } else {
      buffer += line;
      if (line.includes("]")) {
        insideList = false;
        cleaned.push(buffer);
        buffer = "";
      }
    }
  }

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

const raw    = fs.readFileSync("manybot.conf", "utf8");
const config = parseConf(raw);

export const CLIENT_ID     = config.CLIENT_ID  ?? "bot_permanente";
export const CMD_PREFIX    = config.CMD_PREFIX ?? "!";
export const CHATS         = config.CHATS      ?? [];

/** Lista de plugins ativos — ex: PLUGINS=[video, audio, hello] */
export const PLUGINS       = config.PLUGINS    ?? [];

/** Exporta o config completo para plugins que precisam de valores customizados */
export const CONFIG        = config;