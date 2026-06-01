/**
 * config.js
 *
 * Reads and parses manybot.conf and manyplug.conf.
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
const plugFilePath = path.join(__dirname, "../manyplug.conf");

let raw;
try {
  raw = fs.readFileSync(filePath, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("Configuration file not found: manybot.conf");
    console.error("Copy the example file to get started:");
    console.error("  cp manybot.conf.example manybot.conf");
  } else {
    console.error("Error reading config:", err.message);
  }
  process.exit(1);
}

let plugRaw;
try {
  plugRaw = fs.readFileSync(plugFilePath, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    console.warn("Plugin file not found: manyplug.conf")
    console.log("You probably don't have executed manyplug to install some plugins yet")
  } else {
    console.warn("Error when reading manyplug.conf: ", err.message);
  }
}
const bringTogheter = plugRaw !== undefined;

let completeRaw;
if (bringTogheter) {
  completeRaw = raw + "\n" + plugRaw;
} else {
  completeRaw = raw;
}

const config = parseConf(completeRaw);

export const CLIENT_ID     = config.CLIENT_ID  ?? "bot_permanente";
export const CMD_PREFIX    = config.CMD_PREFIX ?? "!";
export const CHATS         = config.CHATS      ?? [];

/** Active plugin list — e.g., PLUGINS=[video, audio, hello] */
export const PLUGINS       = config.PLUGINS    ?? [];

/** Bot language — e.g., LANGUAGE=en (fallback: en) */
export const LANGUAGE      = config.LANGUAGE   ?? "en";

/** Phone number for pairing code auth (optional) — e.g., PHONE_NUMBER=5511999999999 */
export const PHONE_NUMBER  = config.PHONE_NUMBER ?? null;

/** Export full config for plugins that need custom values */
export const CONFIG        = config;
