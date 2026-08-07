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
import { t } from "#i18n";

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

function parseValue(value: string): string | boolean {
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

function stripInlineComment(line: string): string {
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

function parseConf(raw: string): Record<string, unknown> {
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

  const config: Record<string, unknown> = {};
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

function escapeTomlString(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

function toToml(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v))
        return `${k} = [${v.map((v: unknown) => JSON.stringify(v)).join(", ")}]`;

      if (v == null || v === "")
        return `${k} = ""`;

      return typeof v === "string"
        ? `${k} = "${escapeTomlString(v)}"`
        : `${k} = ${v}`;
    })
    .join("\n") + "\n";
}

async function migrateLegacyIfNeeded(): Promise<void> {
  if (await fileExists(TOML_CONFIG_FILE))
    return;

  const migrate = async (src: string, dest: string, omit: string[] = []) => {
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

async function fileExists(file: string): Promise<boolean> {
  try   { await fs.stat(file); return true; }
  catch { return false; }
}

async function readFileSafe(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      logger.warn(`Error reading ${file}: ${(e as Error).message}`);
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
function detectSystemLang(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale.split("-")[0].toLowerCase();
  } catch {
    // Intl unavailable — fall through to env vars
  }

  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
  if (envLocale) return envLocale.split(/[_.]/)[0].toLowerCase();

  return "en";
}

const DEFAULT_TOML_EN =
`# ManyBot configuration file
# See https://manybot.org/docs/config to learn more

CLIENT_ID     = "manybot"
CMD_PREFIX    = "!"
CHATS         = []
EXCLUDE_CHATS = []
LANGUAGE      = "en"
PHONE_NUMBER  = ""

# How cautious the bot is about looking automated: "low", "medium", "high".
# Higher levels slow the bot down (fewer concurrent chats, longer delays)
# but reduce the risk of WhatsApp flagging the account.
SECURITY_LEVEL = "medium"

# ── Local alerts (critical warnings, update notices) ──────────────────────
# Phone number (or full JID) that receives WhatsApp alerts when the bot
# itself is up — e.g. "5511999999999" or "5511999999999@s.whatsapp.net".
# Leave blank to disable this sink (the log file and OS notification still
# work even if the bot is down or restricted).
ADMIN_JID = ""

# SMTP is optional — leave SMTP_HOST blank to disable the email sink.
# SMTP_SEC: "starttls" (port 587, upgrades after connecting — most
# providers), "ssl" (port 465, encrypted from the start), or "none".
SMTP_HOST = ""
SMTP_PORT = 587
SMTP_SEC  = "starttls"
SMTP_USER = ""
SMTP_PASS = ""
SMTP_FROM = ""
SMTP_TO   = ""
# Skip TLS certificate validation. Needed for local SMTP proxies with a
# self-signed cert — e.g. Proton Mail Bridge (127.0.0.1), Mailhog,
# Mailpit. Leave false for a real remote mail provider.
SMTP_INSECURE = false

# Checks npm for a newer manybot version: on startup, then every
# UPDATE_CHECK_INTERVAL_HOURS.
UPDATE_CHECK_ENABLED       = true
UPDATE_CHECK_INTERVAL_HOURS = 24

# How to connect the first time: "qr" (scan with WhatsApp on your phone)
# or "phone" (receive a pairing code on the number set in PHONE_NUMBER).
# Leave blank to choose interactively on first run — the choice is then
# saved here automatically.
LOGIN_METHOD = ""

# ── Status page ────────────────────────────────────────────────────────────
# Local HTTP page showing whether the bot is online or offline.
STATUS_ENABLED = true
STATUS_PORT    = 8080

# ── Driver selection (advanced) ────────────────────────────────────────────
# ManyBot can fall back from a primary driver to a secondary one when the
# primary fails to confirm a send. Today only Baileys is wired in; leave
# driver_whatsmeow_enabled = false to disable the fallback entirely (no
# extra processes are spawned, no sockets are opened).
driver_primary = "baileys"
driver_fallback_cooldown_ms = 60000
driver_verify_window_ms = [500, 1000, 1500, 2500, 5000]
driver_baileys_enabled = true
driver_whatsmeow_enabled = false
driver_whatsmeow_grpc_address = "localhost:50051"
driver_whatsmeow_binary_path = ""
`;

const DEFAULT_TOML_PT =
`# Arquivo de configuração do ManyBot
# Veja https://manybot.org/docs/config para saber mais

CLIENT_ID     = "manybot"
CMD_PREFIX    = "!"
CHATS         = []
EXCLUDE_CHATS = []
LANGUAGE      = "pt"
PHONE_NUMBER  = ""

# Quão cauteloso o bot é pra não parecer automatizado: "low", "medium", "high".
# Níveis mais altos deixam o bot mais lento (menos chats simultâneos, atrasos
# maiores), mas reduzem o risco do WhatsApp sinalizar a conta.
SECURITY_LEVEL = "medium"

# ── Avisos locais (alertas críticos, aviso de update) ──────────────────────
# Número de telefone (ou JID completo) que recebe alertas via WhatsApp
# quando o bot está de pé — ex. "5511999999999" ou
# "5511999999999@s.whatsapp.net". Deixe em branco pra desligar esse canal
# (o log e a notificação do SO continuam funcionando mesmo com o bot
# caído ou restrito).
ADMIN_JID = ""

# SMTP é opcional — deixe SMTP_HOST em branco pra desligar o canal de e-mail.
# SMTP_SEC: "starttls" (porta 587, atualiza a conexão depois de
# conectar — maioria dos provedores), "ssl" (porta 465, criptografado
# desde o início), ou "none".
SMTP_HOST = ""
SMTP_PORT = 587
SMTP_SEC  = "starttls"
SMTP_USER = ""
SMTP_PASS = ""
SMTP_FROM = ""
SMTP_TO   = ""
# Pula a validação do certificado TLS. Necessário pra proxies SMTP
# locais com certificado autoassinado — ex. Proton Mail Bridge
# (127.0.0.1), Mailhog, Mailpit. Deixe false pra um provedor remoto real.
SMTP_INSECURE = false

# Checa no npm se tem versão nova do manybot: ao iniciar, e depois a cada
# UPDATE_CHECK_INTERVAL_HOURS.
UPDATE_CHECK_ENABLED       = true
UPDATE_CHECK_INTERVAL_HOURS = 24

# Como conectar pela primeira vez: "qr" (escaneie com o WhatsApp no celular)
# ou "phone" (recebe um código de pareamento no número definido em
# PHONE_NUMBER). Deixe em branco para escolher interativamente na primeira
# execução — a escolha é salva aqui automaticamente.
LOGIN_METHOD = ""

# ── Página de status ────────────────────────────────────────────────────────
# Página HTTP local mostrando se o bot está online ou offline.
STATUS_ENABLED = true
STATUS_PORT    = 8080

# ── Seleção de driver (avançado) ───────────────────────────────────────────
# ManyBot pode cair de um driver primário pra um secundário quando o
# primário não confirma um envio. Hoje só Baileys está ligado; deixe
# driver_whatsmeow_enabled = false pra desligar o fallback por completo
# (nenhum processo extra é spawnado, nenhum socket é aberto).
driver_primary = "baileys"
driver_fallback_cooldown_ms = 60000
driver_verify_window_ms = [500, 1000, 1500, 2500, 5000]
driver_baileys_enabled = true
driver_whatsmeow_enabled = false
driver_whatsmeow_grpc_address = "localhost:50051"
driver_whatsmeow_binary_path = ""
`;

const DEFAULT_TOML =detectSystemLang() === "pt" ? DEFAULT_TOML_PT : DEFAULT_TOML_EN;

await fs.mkdir(CONFIG_DIR, { recursive: true });

await migrateLegacyIfNeeded();

if (!await fileExists(TOML_CONFIG_FILE)) {
  logger.warn(`Creating ${TOML_CONFIG_FILE}`);
  await fs.writeFile(TOML_CONFIG_FILE, DEFAULT_TOML);
}

// ---------------------------------------------------------------------------
// Layer 1 — legacy .conf
// ---------------------------------------------------------------------------

const legacyLayer: Record<string, unknown> = {};

// ---------------------------------------------------------------------------
// Layer 2 — TOML  (all new features land here)
// ---------------------------------------------------------------------------

let tomlLayer: Record<string, unknown> = {};

async function loadToml(file: string, label: string): Promise<Record<string, unknown>> {
  const raw = await readFileSafe(file);
  if (raw === null) return {};
  try {
    return parseToml(raw);
  } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
    logger.error(t("errors.invalid_config", { file: label, error: err.message }));
    logger.error(t("errors.fix_config", { file: label }));
    process.exit(1);
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

export interface Config {
  CMD_PREFIX:    string;
  CLIENT_ID:     string;
  CHATS:         string[];
  EXCLUDE_CHATS: string[];
  SECURITY_LEVEL: "low" | "medium" | "high";
  PLUGINS:       string[];
  LANGUAGE:      string;
  PHONE_NUMBER:  string | null;
  LOGIN_METHOD:  "phone" | "qr" | null;

  ADMIN_JID: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SEC:  "starttls" | "ssl" | "none";
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  SMTP_TO:   string;
  SMTP_INSECURE: boolean;

  UPDATE_CHECK_ENABLED:        boolean;
  UPDATE_CHECK_INTERVAL_HOURS: number;

  STATUS_ENABLED: boolean;
  STATUS_PORT:    number;

  // ── Driver selection ───────────────────────────────────────────────────────
  // `primary` is the driver SendFallbackGuard will try first. The other
  // driver registered with the DriverManager is the fallback. Drivers not
  // enabled here are not registered at all — no process is spawned, no
  // socket is opened, the bot simply runs on whatever remains.
  //
  // The TOML surface is flat lowercase keys (driver_primary,
  // driver_baileys_enabled, driver_whatsmeow_*, …) — same style as the
  // rest of this file. `normalize()` rebuilds the nested object below
  // from those flat keys so callers use `CONFIG.drivers.*`.
  drivers: {
    primary:             "baileys" | "whatsmeow";
    fallbackCooldownMs:  number;
    verifyWindowMs:      number[];
    baileys:             { enabled: boolean };
    whatsmeow:           { enabled: boolean; grpcAddress: string; binaryPath: string };
  };

  [key: string]: unknown;
}

const DEFAULTS: Config = {
  CMD_PREFIX:    "!",
  CLIENT_ID:     "manybot",
  CHATS:         [],
  EXCLUDE_CHATS: [],
  SECURITY_LEVEL: "medium",
  PLUGINS:       [],
  LANGUAGE:      "en",
  PHONE_NUMBER:  null,
  LOGIN_METHOD:  null,
  ADMIN_JID: "",
  SMTP_HOST: "",
  SMTP_PORT: 587,
  SMTP_SEC:  "starttls",
  SMTP_USER: "",
  SMTP_PASS: "",
  SMTP_FROM: "",
  SMTP_TO:   "",
  SMTP_INSECURE: false,
  UPDATE_CHECK_ENABLED:        true,
  UPDATE_CHECK_INTERVAL_HOURS: 24,
  STATUS_ENABLED: true,
  STATUS_PORT:    8080,

  drivers: {
    primary:            "baileys",
    fallbackCooldownMs: 60000,
    verifyWindowMs:     [500, 1000, 1500, 2500, 5000],
    baileys:            { enabled: true },
    whatsmeow:          { enabled: false, grpcAddress: "localhost:50051", binaryPath: "" },
  },
};

function normalize(cfg: Config): Config {
  // Empty string and absent PHONE_NUMBER are both treated as null so plugins
  // can always do a simple truthiness check regardless of config source.
  if (cfg.PHONE_NUMBER === "") cfg.PHONE_NUMBER = null;

  // Anything other than "phone"/"qr" is treated as "not configured yet",
  // so a typo or leftover garbage value falls back to the interactive
  // prompt instead of silently misbehaving.
  if (cfg.LOGIN_METHOD !== "phone" && cfg.LOGIN_METHOD !== "qr") {
    cfg.LOGIN_METHOD = null;
  }

  if (!["low", "medium", "high"].includes(cfg.SECURITY_LEVEL)) {
    cfg.SECURITY_LEVEL = "medium";
  }

  // Legacy .conf values arrive as strings; TOML gives real types already —
  // Number()/coercion here is a no-op for the TOML path.
  cfg.SMTP_PORT = Number(cfg.SMTP_PORT) || 587;
  if (!["starttls", "ssl", "none"].includes(cfg.SMTP_SEC)) {
    cfg.SMTP_SEC = "starttls";
  }
  const rawUpdateEnabled = cfg.UPDATE_CHECK_ENABLED as unknown;
  cfg.UPDATE_CHECK_ENABLED = rawUpdateEnabled !== false && rawUpdateEnabled !== "false";
  const rawSmtpInsecure = cfg.SMTP_INSECURE as unknown;
  cfg.SMTP_INSECURE = rawSmtpInsecure === true || rawSmtpInsecure === "true";
  cfg.UPDATE_CHECK_INTERVAL_HOURS = Number(cfg.UPDATE_CHECK_INTERVAL_HOURS) || 24;

  const rawStatusEnabled = cfg.STATUS_ENABLED as unknown;
  cfg.STATUS_ENABLED = rawStatusEnabled !== false && rawStatusEnabled !== "false";
  cfg.STATUS_PORT = Number(cfg.STATUS_PORT) || 8080;

  // drivers.* — the fallback guard and DriverManager read these at every
  // send. The TOML surface is flat lowercase keys (driver_primary,
  // driver_baileys_enabled, driver_whatsmeow_*, …) so it matches the
  // rest of the file; the nested `cfg.drivers` object is rebuilt here
  // from those flat keys so callers (main.ts, sendFallbackGuard.ts,
  // supervisor.ts, client.ts) keep using `CONFIG.drivers.*`.
  // Coerce strings (legacy .conf arrives as strings) and reject anything
  // that isn't a recognized driver name, so a typo in TOML falls back
  // to the safe default rather than crashing at boot.
  const isTruthy = (v: unknown) => v === true || v === "true";
  const coerceEnabled = (v: unknown, fallback: boolean): boolean => {
    if (v === true || v === false) return v;
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  };
  // Allow either the new flat keys or (for backward compatibility) the
  // old nested `[drivers]` block. Flat keys take precedence.
  const nestedDrv = (cfg.drivers ?? {}) as Partial<Config["drivers"]> & Record<string, unknown>;
  const flatPrimary           = cfg.driver_primary           ?? nestedDrv.primary;
  const flatCooldown          = cfg.driver_fallback_cooldown_ms ?? nestedDrv.fallbackCooldownMs;
  const flatVerify            = cfg.driver_verify_window_ms   ?? nestedDrv.verifyWindowMs;
  const flatBaileysEnabled    = cfg.driver_baileys_enabled    ?? nestedDrv.baileys?.enabled;
  const flatWhatsmeowEnabled  = cfg.driver_whatsmeow_enabled  ?? nestedDrv.whatsmeow?.enabled;
  const flatWhatsmeowGrpc     = cfg.driver_whatsmeow_grpc_address ?? nestedDrv.whatsmeow?.grpcAddress;
  const flatWhatsmeowBinary   = cfg.driver_whatsmeow_binary_path  ?? nestedDrv.whatsmeow?.binaryPath;
  cfg.drivers = {
    primary:            flatPrimary === "whatsmeow" ? "whatsmeow" : "baileys",
    fallbackCooldownMs: Number(flatCooldown) || 60000,
    verifyWindowMs:     Array.isArray(flatVerify) && flatVerify.length
      ? (flatVerify as unknown[]).map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [500, 1000, 1500, 2500, 5000],
    baileys: {
      enabled: coerceEnabled(flatBaileysEnabled, true),
    },
    whatsmeow: {
      // MANYBOT_SMOKE=1 force-enables whatsmeow regardless of the TOML
      // value — used by scripts/smoke-whatsmeow-supervisor.mjs so the
      // smoke test doesn't depend on the local manybot.toml already
      // having driver_whatsmeow_enabled = true. Not a documented
      // user-facing setting; TOML remains the source of truth outside
      // smoke runs.
      enabled:     process.env.MANYBOT_SMOKE === "1" ? true : isTruthy(flatWhatsmeowEnabled),
      grpcAddress: typeof flatWhatsmeowGrpc === "string" ? flatWhatsmeowGrpc : "localhost:50051",
      binaryPath:  typeof flatWhatsmeowBinary === "string" ? flatWhatsmeowBinary : "",
    },
  };
  // Drop the flat keys from the merged object so they don't leak as
  // loose top-level Config keys (the `Config` interface exposes only
  // the nested `drivers` block).
  delete (cfg as Record<string, unknown>).driver_primary;
  delete (cfg as Record<string, unknown>).driver_fallback_cooldown_ms;
  delete (cfg as Record<string, unknown>).driver_verify_window_ms;
  delete (cfg as Record<string, unknown>).driver_baileys_enabled;
  delete (cfg as Record<string, unknown>).driver_whatsmeow_enabled;
  delete (cfg as Record<string, unknown>).driver_whatsmeow_grpc_address;
  delete (cfg as Record<string, unknown>).driver_whatsmeow_binary_path;

  return cfg;
}

export const CONFIG: Config = normalize({
  ...DEFAULTS,
  ...legacyLayer, // legacy .conf overrides defaults
  ...tomlLayer,   // TOML overrides legacy .conf
});

export async function reloadConfig(): Promise<void> {
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

  EXCLUDE_CHATS.length = 0;
  EXCLUDE_CHATS.push(...(CONFIG.EXCLUDE_CHATS || []));
}

// ---------------------------------------------------------------------------
// Named exports — identical shape regardless of config source
// ---------------------------------------------------------------------------

export const CLIENT_ID     = CONFIG.CLIENT_ID;
export const CMD_PREFIX    = CONFIG.CMD_PREFIX;
export const CHATS         = CONFIG.CHATS;
export const EXCLUDE_CHATS = CONFIG.EXCLUDE_CHATS;
export const SECURITY_LEVEL = CONFIG.SECURITY_LEVEL;
export const PLUGINS       = CONFIG.PLUGINS;
export const LANGUAGE      = CONFIG.LANGUAGE;
export const PHONE_NUMBER  = CONFIG.PHONE_NUMBER;
export const LOGIN_METHOD  = CONFIG.LOGIN_METHOD;
export const ADMIN_JID                   = CONFIG.ADMIN_JID;
export const SMTP_HOST                   = CONFIG.SMTP_HOST;
export const SMTP_PORT                   = CONFIG.SMTP_PORT;
export const SMTP_SEC                    = CONFIG.SMTP_SEC;
export const SMTP_USER                   = CONFIG.SMTP_USER;
export const SMTP_PASS                   = CONFIG.SMTP_PASS;
export const SMTP_FROM                   = CONFIG.SMTP_FROM;
export const SMTP_TO                     = CONFIG.SMTP_TO;
export const SMTP_INSECURE               = CONFIG.SMTP_INSECURE;
export const UPDATE_CHECK_ENABLED        = CONFIG.UPDATE_CHECK_ENABLED;
export const UPDATE_CHECK_INTERVAL_HOURS = CONFIG.UPDATE_CHECK_INTERVAL_HOURS;
export const STATUS_ENABLED              = CONFIG.STATUS_ENABLED;
export const STATUS_PORT                 = CONFIG.STATUS_PORT;

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
export async function persistConfigValue(key: string, value: string): Promise<void> {
  const raw     = (await readFileSafe(TOML_CONFIG_FILE)) ?? "";
  const newLine = `${key} = "${escapeTomlString(value)}"`;
  const lineRe  = new RegExp(`^${key}\\s*=.*$`, "m");

  const updated = lineRe.test(raw)
    ? raw.replace(lineRe, newLine)
    : `${raw.trimEnd()}\n${newLine}\n`;

  await fs.writeFile(TOML_CONFIG_FILE, updated, "utf8");

  (CONFIG as Record<string, unknown>)[key] = value;
}

export const PATHS = {
  HOME:            CONFIG_DIR,
  CONFIG_FILE,
  PLUGIN_FILE,
  TOML_CONFIG_FILE,
  TOML_PLUGIN_FILE,
};

