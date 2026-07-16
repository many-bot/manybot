/**
 * config.ts
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
export const CONFIG_DIR = path.join(os.homedir(), ".manybot");
/** @deprecated Use TOML_CONFIG_FILE. Frozen — no new keys. */
export const CONFIG_FILE = path.join(CONFIG_DIR, "manybot.conf");
/** @deprecated Use TOML_PLUGIN_FILE. Frozen — no new keys. */
export const PLUGIN_FILE = path.join(CONFIG_DIR, "manyplug.conf");
export const TOML_CONFIG_FILE = path.join(CONFIG_DIR, "manybot.toml");
export const TOML_PLUGIN_FILE = path.join(CONFIG_DIR, "manyplug.toml");
// ---------------------------------------------------------------------------
// Legacy .conf parser (frozen — do not extend)
// ---------------------------------------------------------------------------
function parseValue(value) {
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return value;
}
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
            }
            else {
                mergedLines.push(line);
            }
        }
        else {
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
            return `${k} = [${v.map((v) => JSON.stringify(v)).join(", ")}]`;
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
        if (!raw)
            return false;
        const cfg = parseConf(raw);
        for (const k of omit)
            delete cfg[k];
        await fs.writeFile(dest, toToml(cfg), "utf8");
        await fs.rename(src, `${src}.bak`);
        return true;
    };
    const migrated = await migrate(CONFIG_FILE, TOML_CONFIG_FILE, ["PLUGINS"]) ||
        await migrate(PLUGIN_FILE, TOML_PLUGIN_FILE);
    if (migrated)
        logger.success("Config migrated to TOML");
}
// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
async function fileExists(file) {
    try {
        await fs.stat(file);
        return true;
    }
    catch {
        return false;
    }
}
async function readFileSafe(file) {
    try {
        return await fs.readFile(file, "utf-8");
    }
    catch (e) {
        if (e.code !== "ENOENT")
            logger.warn(`Error reading ${file}: ${e.message}`);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Bootstrap: ensure at least one config file exists
// ---------------------------------------------------------------------------
/**
 * Detects the OS locale without depending on a single env var, since LANG
 * isn't reliably set on macOS GUI sessions or Windows. Only used to pick
 * the language of the bootstrap config file — after that, LANGUAGE in
 * manybot.toml is the single source of truth.
 */
function detectSystemLang() {
    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale;
        if (locale)
            return locale.split("-")[0].toLowerCase();
    }
    catch {
        // Intl unavailable — fall through to env vars
    }
    const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
    if (envLocale)
        return envLocale.split(/[_.]/)[0].toLowerCase();
    return "en";
}
const DEFAULT_TOML_EN = `# ManyBot configuration file
# See https://manybot.org/docs/config to learn more

CLIENT_ID    = "manybot"
CMD_PREFIX   = "!"
CHATS        = []
LANGUAGE     = "en"
PHONE_NUMBER = ""

# How to connect the first time: "qr" (scan with WhatsApp on your phone)
# or "phone" (receive a pairing code on the number set in PHONE_NUMBER).
# Leave blank to choose interactively on first run — the choice is then
# saved here automatically.
LOGIN_METHOD = ""

# JID of a single chat where the bot is allowed to respond to messages
# sent by yourself (fromMe) — useful for testing commands without
# affecting other conversations. In every other chat, fromMe messages
# are always ignored.
# Example: TEST_CHAT = "5511999999999@c.us"
TEST_CHAT    = ""
`;
const DEFAULT_TOML_PT = `# Arquivo de configuração do ManyBot
# Veja https://manybot.org/docs/config para saber mais

CLIENT_ID    = "manybot"
CMD_PREFIX   = "!"
CHATS        = []
LANGUAGE     = "pt"
PHONE_NUMBER = ""

# Como conectar pela primeira vez: "qr" (escaneie com o WhatsApp no celular)
# ou "phone" (recebe um código de pareamento no número definido em
# PHONE_NUMBER). Deixe em branco para escolher interativamente na primeira
# execução — a escolha é salva aqui automaticamente.
LOGIN_METHOD = ""

# JID de um único chat onde o bot pode responder a mensagens enviadas por
# você mesmo (fromMe) — útil para testar comandos sem afetar outras
# conversas. Em qualquer outro chat, mensagens fromMe são sempre ignoradas.
# Exemplo: TEST_CHAT = "5511999999999@c.us"
TEST_CHAT    = ""
`;
const DEFAULT_TOML = detectSystemLang() === "pt" ? DEFAULT_TOML_PT : DEFAULT_TOML_EN;
await fs.mkdir(CONFIG_DIR, { recursive: true });
await migrateLegacyIfNeeded();
if (!await fileExists(TOML_CONFIG_FILE)) {
    logger.warn(`Creating ${TOML_CONFIG_FILE}`);
    await fs.writeFile(TOML_CONFIG_FILE, DEFAULT_TOML);
}
// ---------------------------------------------------------------------------
// Layer 1 — legacy .conf
// ---------------------------------------------------------------------------
const legacyLayer = {};
// ---------------------------------------------------------------------------
// Layer 2 — TOML  (all new features land here)
// ---------------------------------------------------------------------------
let tomlLayer = {};
async function loadToml(file, label) {
    const raw = await readFileSafe(file);
    if (raw === null)
        return {};
    try {
        return parseToml(raw);
    }
    catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(`Error parsing ${label}: ${err.message}`);
        return {};
    }
}
tomlLayer = {
    ...await loadToml(TOML_CONFIG_FILE, "manybot.toml"),
    ...await loadToml(TOML_PLUGIN_FILE, "manyplug.toml"),
};
const DEFAULTS = {
    CMD_PREFIX: "!",
    CLIENT_ID: "manybot",
    CHATS: [],
    PLUGINS: [],
    LANGUAGE: "en",
    PHONE_NUMBER: null,
    PLATFORM: "whatsapp",
    TEST_CHAT: null,
    LOGIN_METHOD: null,
};
function normalize(cfg) {
    // Empty string and absent PHONE_NUMBER are both treated as null so plugins
    // can always do a simple truthiness check regardless of config source.
    if (cfg.PHONE_NUMBER === "")
        cfg.PHONE_NUMBER = null;
    if (cfg.TEST_CHAT === "")
        cfg.TEST_CHAT = null;
    // Anything other than "phone"/"qr" is treated as "not configured yet",
    // so a typo or leftover garbage value falls back to the interactive
    // prompt instead of silently misbehaving.
    if (cfg.LOGIN_METHOD !== "phone" && cfg.LOGIN_METHOD !== "qr") {
        cfg.LOGIN_METHOD = null;
    }
    return cfg;
}
export const CONFIG = normalize({
    ...DEFAULTS,
    ...legacyLayer, // legacy .conf overrides defaults
    ...tomlLayer, // TOML overrides legacy .conf
});
export async function reloadConfig() {
    const newTomlLayer = {
        ...await loadToml(TOML_CONFIG_FILE, "manybot.toml"),
        ...await loadToml(TOML_PLUGIN_FILE, "manyplug.toml"),
    };
    const newConfig = normalize({
        ...DEFAULTS,
        ...legacyLayer,
        ...newTomlLayer,
    });
    Object.assign(CONFIG, newConfig);
    // Mutate array exports to propagate changes
    PLUGINS.length = 0;
    PLUGINS.push(...(CONFIG.PLUGINS || []));
    CHATS.length = 0;
    CHATS.push(...(CONFIG.CHATS || []));
}
// ---------------------------------------------------------------------------
// Named exports — identical shape regardless of config source
// ---------------------------------------------------------------------------
export const CLIENT_ID = CONFIG.CLIENT_ID;
export const CMD_PREFIX = CONFIG.CMD_PREFIX;
export const CHATS = CONFIG.CHATS;
export const PLUGINS = CONFIG.PLUGINS;
export const LANGUAGE = CONFIG.LANGUAGE;
export const PHONE_NUMBER = CONFIG.PHONE_NUMBER;
export const PLATFORM = CONFIG.PLATFORM;
export const TEST_CHAT = CONFIG.TEST_CHAT;
export const LOGIN_METHOD = CONFIG.LOGIN_METHOD;
/**
 * Writes a single value back to manybot.toml without rewriting the whole
 * file (preserves comments and the rest of the content). If the key
 * already exists, its line is replaced; otherwise the line is appended
 * at the end. Also updates the in-memory `CONFIG`, so the change is
 * reflected within the same run (needed by the interactive login flow,
 * which runs before any reload).
 *
 * Known limitation: since CLIENT_ID, PHONE_NUMBER, etc. above are const
 * primitives captured at module load time, they only reflect the new
 * value after the process restarts — the same limitation already
 * applied to the rest of this file. Code that needs the updated value
 * within the same run (like the login flow itself) should read from
 * `CONFIG.<KEY>` directly.
 */
export async function persistConfigValue(key, value) {
    const raw = (await readFileSafe(TOML_CONFIG_FILE)) ?? "";
    const newLine = `${key} = "${escapeTomlString(value)}"`;
    const lineRe = new RegExp(`^${key}\\s*=.*$`, "m");
    const updated = lineRe.test(raw)
        ? raw.replace(lineRe, newLine)
        : `${raw.trimEnd()}\n${newLine}\n`;
    await fs.writeFile(TOML_CONFIG_FILE, updated, "utf8");
    CONFIG[key] = value;
}
export const PATHS = {
    HOME: CONFIG_DIR,
    CONFIG_FILE,
    PLUGIN_FILE,
    TOML_CONFIG_FILE,
    TOML_PLUGIN_FILE,
};
