/**
 * config.js
 *
<<<<<<< HEAD
 * Reads and parses manybot.conf and manyplug.conf.
 * Supports multiline lists and inline comments.
=======
 * Loads:
 *   ~/.manybot/manybot.conf
 *   ~/.manybot/manyplug.conf
 *
 * Merges both files into a single configuration object.
>>>>>>> dev
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

import { logger } from "#logger";

const CONFIG_DIR = path.join(os.homedir(), ".manybot");
const CONFIG_FILE = path.join(CONFIG_DIR, "manybot.conf");
const PLUGIN_FILE = path.join(CONFIG_DIR, "manyplug.conf");

/**
 * Converts strings to native JS values.
 */
function parseValue(value) {
  value = value.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (value === "true")
    return true;

  if (value === "false")
    return false;

  return value;
}

/**
 * Reads comments safely.
 * Ignores # inside quoted strings.
 */
function stripInlineComment(line) {
  let result = "";
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") {
      if (quote === ch)
        quote = null;
      else if (!quote)
        quote = ch;
    }

    if (ch === "#" && !quote)
      break;

    result += ch;
  }

  return result.trim();
}

/**
 * Parses manybot.conf syntax.
 */
function parseConf(raw) {
  const lines = raw.split(/\r?\n/);

  const mergedLines = [];

  let insideList = false;
  let buffer = "";

  for (let line of lines) {
    line = stripInlineComment(line);

    if (!line)
      continue;

    if (!insideList) {
      if (/=\s*\[$/.test(line)) {
        insideList = true;
        buffer = line;
      } else {
        mergedLines.push(line);
      }
    } else {
      buffer += " " + line;

      if (line.includes("]")) {
        mergedLines.push(buffer);
        buffer = "";
        insideList = false;
      }
    }
  }

  const config = {};

  for (const line of mergedLines) {
    const idx = line.indexOf("=");

    if (idx === -1)
      continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      config[key] = value
        .slice(1, -1)
        .split(",")
        .map(v => parseValue(v))
        .filter(v => v !== "");
      continue;
    }

    config[key] = parseValue(value);
  }

  return config;
}

async function readFileSafe(file) {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      logger.warn(`Error reading ${file}: ${err.message}`);
    }
    return "";
  }
}

<<<<<<< HEAD
const filePath = path.join(__dirname, "../manybot.conf");
const plugFilePath = path.join(__dirname, "../manyplug.conf");
=======
const defaultConfig = 
`
# Many bot configuration file
# See https://manybot.stxerr.dev/docs/config to learn more

CLIENT_ID="manybot"
CMD_PREFIX="!"
CHATS=[]
LANGUAGE=en
PHONE_NUMBER=
`;
>>>>>>> dev

try {
  await fs.stat(CONFIG_FILE);
} catch {
  logger.warn("Configuration file not found: ", CONFIG_FILE, ". Creating a new one.");

  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, defaultConfig);
}

<<<<<<< HEAD
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
=======
const baseConfig = await readFileSafe(CONFIG_FILE);
const pluginConfig = await readFileSafe(PLUGIN_FILE);
>>>>>>> dev

export const CONFIG = parseConf(baseConfig + "\n" + pluginConfig);

/**
 * Common exports.
 */
export const CLIENT_ID =
  CONFIG.CLIENT_ID ?? "manybot";

export const CMD_PREFIX =
  CONFIG.CMD_PREFIX ?? "!";

export const CHATS =
  CONFIG.CHATS ?? [];

export const PLUGINS =
  CONFIG.PLUGINS ?? [];

export const LANGUAGE =
  CONFIG.LANGUAGE ?? "en";

export const PHONE_NUMBER =
  CONFIG.PHONE_NUMBER ?? null;

/**
 * Useful paths for plugins/modules.
 */
export const PATHS = {
  HOME: CONFIG_DIR,
  CONFIG_FILE,
  PLUGIN_FILE
};
