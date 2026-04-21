/**
 * config.js
 *
 * Reads and parses manybot.conf.
 * Supports multiline lists and inline comments.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const filePath = path.join(__dirname, "../manybot.conf");

const raw = fs.readFileSync(filePath, "utf8");
const config = parseConf(raw);

export const CLIENT_ID     = config.CLIENT_ID  ?? "bot_permanente";
export const CMD_PREFIX    = config.CMD_PREFIX ?? "!";
export const CHATS         = config.CHATS      ?? [];

/** Active plugin list — e.g., PLUGINS=[video, audio, hello] */
export const PLUGINS       = config.PLUGINS    ?? [];

/** Bot language — e.g., LANGUAGE=en (fallback: en) */
export const LANGUAGE      = config.LANGUAGE   ?? "en";

/** Export full config for plugins that need custom values */
export const CONFIG        = config;
