/**
 * config.js
 *
 * Loads config from up to four files, merged in strict precedence order:
 *
 *   defaults  <  legacy .conf  <  TOML
 *
 * Legacy files (frozen — no new keys):
 *   ~/.manybot/manybot.conf
 *   ~/.manybot/manyplug.conf
 *
 * TOML files (all new features go here):
 *   ~/.manybot/manybot.toml
 *   ~/.manybot/manyplug.toml
 *
 * The final CONFIG object always has the same shape regardless of which
 * files are present. Plugins must never see a structural difference.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { parse as parseToml } from "smol-toml";
import { logger } from "#logger";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CONFIG_DIR       = path.join(os.homedir(), ".manybot");

/** @deprecated Use TOML_CONFIG_FILE. Frozen — no new keys. */
export const CONFIG_FILE      = path.join(CONFIG_DIR, "manybot.conf");
/** @deprecated Use TOML_PLUGIN_FILE. Frozen — no new keys. */
export const PLUGIN_FILE      = path.join(CONFIG_DIR, "manyplug.conf");

export const TOML_CONFIG_FILE = path.join(CONFIG_DIR, "manybot.toml");
export const TOML_PLUGIN_FILE = path.join(CONFIG_DIR, "manyplug.toml");

// ---------------------------------------------------------------------------
// Legacy .conf parser (frozen — do not extend)
// ---------------------------------------------------------------------------

function parseValue(value) {
  value = value.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (value === "true")  return true;
  if (value === "false") return false;
  return value;
}

function stripInlineComment(line) {
  let result = "";
  let quote  = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") {
      if (quote === ch)   quote = null;
      else if (!quote)    quote = ch;
    }
    if (ch === "#" && !quote) break;
    result += ch;
  }
  return result.trim();
}

function parseConf(raw) {
  const lines       = raw.split(/\r?\n/);
  const mergedLines = [];
  let insideList    = false;
  let buffer        = "";

  for (let line of lines) {
    line = stripInlineComment(line);
    if (!line) continue;

    if (!insideList) {
      if (/=\s*\[$/.test(line)) {
        insideList = true;
        buffer     = line;
      } else {
        mergedLines.push(line);
      }
    } else {
      buffer += " " + line;
      if (line.includes("]")) {
        mergedLines.push(buffer);
        buffer     = "";
        insideList = false;
      }
    }
  }

  const config = {};
  for (const line of mergedLines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key   = line.slice(0, idx).trim();
    let   value = line.slice(idx + 1).trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      config[key] = value
        .slice(1, -1)
        .split(",")
        .map(v  => parseValue(v))
        .filter(v => v !== "");
      continue;
    }
    config[key] = parseValue(value);
  }
  return config;
}

// ---------------------------------------------------------------------------
// TOML migration
// ---------------------------------------------------------------------------

function escapeTomlString(s) {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

function toToml(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v))
        return `${k} = [${v.map(JSON.stringify).join(", ")}]`;

      if (v == null || v === "")
        return `${k} = ""`;

      return typeof v === "string"
        ? `${k} = "${escapeTomlString(v)}"`
        : `${k} = ${v}`;
    })
    .join("\n") + "\n";
}

async function migrateLegacyIfNeeded() {
  if (await fileExists(TOML_CONFIG_FILE))
    return;

  const migrate = async (src, dest, omit = []) => {
    const raw = await readFileSafe(src);
    if (!raw) return false;

    const cfg = parseConf(raw);

    for (const k of omit)
      delete cfg[k];

    await fs.writeFile(dest, toToml(cfg), "utf8");
    await fs.rename(src, `${src}.bak`);

    return true;
  };

  const migrated =
    await migrate(CONFIG_FILE, TOML_CONFIG_FILE, ["PLUGINS"]) ||
    await migrate(PLUGIN_FILE, TOML_PLUGIN_FILE);

  if (migrated)
    logger.success("Config migrated to TOML");
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function fileExists(file) {
  try   { await fs.stat(file); return true; }
  catch { return false; }
}

async function readFileSafe(file) {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (err) {
    if (err.code !== "ENOENT") logger.warn(`Error reading ${file}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap: ensure at least one config file exists
// ---------------------------------------------------------------------------

const DEFAULT_TOML =
`# ManyBot configuration file
# See https://manybot.stxerr.dev/docs/config to learn more

CLIENT_ID    = "manybot"
CMD_PREFIX   = "!"
CHATS        = []
LANGUAGE     = "en"
PHONE_NUMBER = ""
`;

await fs.mkdir(CONFIG_DIR, { recursive: true });

await migrateLegacyIfNeeded();

if (!await fileExists(TOML_CONFIG_FILE)) {
  logger.warn(`Creating ${TOML_CONFIG_FILE}`);
  await fs.writeFile(TOML_CONFIG_FILE, DEFAULT_TOML);
}

// ---------------------------------------------------------------------------
// Layer 1 — tOML
// ---------------------------------------------------------------------------

const legacyLayer = {};

// ---------------------------------------------------------------------------
// Layer 2 — TOML  (all new features land here)
// ---------------------------------------------------------------------------

let tomlLayer = {};

async function loadToml(file, label) {
  const raw = await readFileSafe(file);
  if (raw === null) return {};
  try {
    return parseToml(raw);
  } catch (err) {
    logger.warn(`Error parsing ${label}: ${err.message}`);
    return {};
  }
}

tomlLayer = {
  ...await loadToml(TOML_CONFIG_FILE, "manybot.toml"),
  ...await loadToml(TOML_PLUGIN_FILE, "manyplug.toml"),
};

// ---------------------------------------------------------------------------
// Merge + normalize
//
// Normalization runs once on the final merged object so both legacy and TOML
// layers are treated identically. Add new normalization rules here only.
// ---------------------------------------------------------------------------

const DEFAULTS = {
  CMD_PREFIX:   "!",
  CLIENT_ID:    "manybot",
  CHATS:        [],
  PLUGINS:      [],
  LANGUAGE:     "en",
  PHONE_NUMBER: null,
};

function normalize(cfg) {
  // Empty string and absent PHONE_NUMBER are both treated as null so plugins
  // can always do a simple truthiness check regardless of config source.
  if (cfg.PHONE_NUMBER === "") cfg.PHONE_NUMBER = null;
  return cfg;
}

export const CONFIG = normalize({
  ...DEFAULTS,
  ...legacyLayer, // legacy .conf overrides defaults
  ...tomlLayer,   // TOML overrides legacy .conf
});

// ---------------------------------------------------------------------------
// Named exports — identical shape regardless of config source
// ---------------------------------------------------------------------------

export const CLIENT_ID    = CONFIG.CLIENT_ID;
export const CMD_PREFIX   = CONFIG.CMD_PREFIX;
export const CHATS        = CONFIG.CHATS;
export const PLUGINS      = CONFIG.PLUGINS;
export const LANGUAGE     = CONFIG.LANGUAGE;
export const PHONE_NUMBER = CONFIG.PHONE_NUMBER;

export const PATHS = {
  HOME:            CONFIG_DIR,
  CONFIG_FILE,
  PLUGIN_FILE,
  TOML_CONFIG_FILE,
  TOML_PLUGIN_FILE,
};
