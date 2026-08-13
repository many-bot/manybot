import fs from "fs/promises";
import path from "path";
import * as yaml from "js-yaml";
import { logger } from "#logger";
import { t } from "#i18n";
import { PATHS } from "#config";

export type LocalizedString = string | Record<string, string>;

export interface GroupUserList {
  groups?: string[];
  users?: string[];
}

export interface CommandPermissions {
  admin?: boolean;
  botAdmin?: boolean;
  scope?: "group" | "dm" | "any";
  owner?: boolean;
  cooldownSeconds?: number;
  whitelist?: GroupUserList;
  blacklist?: GroupUserList;
}

export interface CommandMessages {
  botNotAdmin?: string;
  senderNotAdmin?: string;
  ownerOnly?: string;
  wrongScope?: string;
  cooldown?: string;
}

export interface MenuConfig {
  title: LocalizedString | null;
  intro: LocalizedString | null;
  footer: LocalizedString | null;
  aliases: string[];
  /**
   * Replies to otherwise unknown prefixed commands after legacy plugins run.
   * Legacy plugins cannot report that they handled a message, so this can
   * produce an extra reply; keep it opt-in.
   */
  notFoundFallback: boolean;
}

export interface CategoryConfig {
  label: LocalizedString;
  order: number;
}

export interface CommandYamlSpec {
  cmd?: unknown;
  aliases?: unknown;
  plugin?: unknown;
  function?: unknown;
  text?: unknown;
  desc?: unknown;
  category?: unknown;
  manual?: unknown;
  deprecatedMessage?: unknown;
  notifyChanges?: unknown;
  permissions?: unknown;
  messages?: unknown;
}

export interface CommandSpec {
  id: string;
  cmd: string;
  aliases: string[];
  plugin: string | null;
  function: string | null;
  text: LocalizedString | null;
  desc: LocalizedString | null;
  category: string | null;
  manual: LocalizedString | null;
  deprecatedMessage: string | null;
  notifyChanges: boolean | null;
  permissions: CommandPermissions | null;
  messages: CommandMessages | null;
}

export interface CommandDefaults {
  notifyChanges: boolean;
  notifyPeriodDays: number;
  notifyMessage: string | null;
  permissions?: CommandPermissions | null;
  messages?: CommandMessages | null;
}

export interface CommandsConfig {
  defaults: CommandDefaults;
  menu: MenuConfig;
  categories: Record<string, CategoryConfig>;
  manuals: Record<string, LocalizedString>;
  specs: CommandSpec[];
}

const COMMANDS_FILE = path.join(PATHS.HOME, "commands.yaml");

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asAliasList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function parseLocalizedString(raw: unknown): LocalizedString | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [lang, val] of Object.entries(raw)) {
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed.length > 0) out[lang] = trimmed;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

export async function resolveFileRef(value: LocalizedString | null | undefined): Promise<LocalizedString | null> {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("file:")) {
      const relativePath = trimmed.slice(5).trim();
      const fullPath = path.resolve(PATHS.HOME, relativePath);
      try {
        return await fs.readFile(fullPath, "utf8");
      } catch (e) {
        const err = e as Error;
        logger.warn(`commandsConfig: failed to read file ref "${trimmed}" (${fullPath}): ${err.message}`);
        return trimmed;
      }
    }
    return trimmed;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, string> = {};
    for (const [lang, val] of Object.entries(value)) {
      if (typeof val === "string") {
        const resolved = await resolveFileRef(val);
        if (resolved && typeof resolved === "string") {
          out[lang] = resolved;
        }
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return null;
}

function parseGroupUserList(raw: unknown): GroupUserList | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const groups = asAliasList(obj.groups);
  const users = asAliasList(obj.users);
  if (groups.length === 0 && users.length === 0) return undefined;
  return {
    groups: groups.length > 0 ? groups : undefined,
    users: users.length > 0 ? users : undefined,
  };
}

function parsePermissions(raw: unknown): CommandPermissions | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const admin = asBool(obj.admin) ?? undefined;
  const botAdmin = asBool(obj.botAdmin) ?? undefined;
  const owner = asBool(obj.owner) ?? undefined;

  let scope: "group" | "dm" | "any" | undefined = undefined;
  const scopeStr = asString(obj.scope)?.toLowerCase();
  if (scopeStr === "group" || scopeStr === "dm" || scopeStr === "any") {
    scope = scopeStr;
  }

  let cooldownSeconds: number | undefined = undefined;
  if (typeof obj.cooldownSeconds === "number" && Number.isFinite(obj.cooldownSeconds) && obj.cooldownSeconds >= 0) {
    cooldownSeconds = obj.cooldownSeconds;
  }

  const whitelist = parseGroupUserList(obj.whitelist);
  const blacklist = parseGroupUserList(obj.blacklist);

  if (
    admin === undefined &&
    botAdmin === undefined &&
    owner === undefined &&
    scope === undefined &&
    cooldownSeconds === undefined &&
    whitelist === undefined &&
    blacklist === undefined
  ) {
    return null;
  }

  return {
    admin,
    botAdmin,
    owner,
    scope,
    cooldownSeconds,
    whitelist,
    blacklist,
  };
}

function parseMessages(raw: unknown): CommandMessages | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const botNotAdmin = asString(obj.botNotAdmin) ?? undefined;
  const senderNotAdmin = asString(obj.senderNotAdmin) ?? undefined;
  const ownerOnly = asString(obj.ownerOnly) ?? undefined;
  const wrongScope = asString(obj.wrongScope) ?? undefined;
  const cooldown = asString(obj.cooldown) ?? undefined;

  if (!botNotAdmin && !senderNotAdmin && !ownerOnly && !wrongScope && !cooldown) {
    return null;
  }

  return {
    botNotAdmin,
    senderNotAdmin,
    ownerOnly,
    wrongScope,
    cooldown,
  };
}

const DEFAULT_MENU_CONFIG: MenuConfig = {
  title: "🤖 ManyBot — Menu",
  intro: {
    en: "Use {prefix}<command> to run it or {prefix}help <command> to view its manual.",
    pt: "Use {prefix}<comando> para executar ou {prefix}help <comando> para ver o manual.",
    es: "Usa {prefix}<comando> para ejecutarlo o {prefix}help <comando> para ver el manual.",
  },
  footer: null,
  aliases: ["help", "man", "menu", "bot", "?"],
  notFoundFallback: false,
};

function parseMenu(raw: unknown): MenuConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_MENU_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  const aliases = asAliasList(obj.aliases);
  return {
    title: parseLocalizedString(obj.title) ?? DEFAULT_MENU_CONFIG.title,
    intro: parseLocalizedString(obj.intro) ?? DEFAULT_MENU_CONFIG.intro,
    footer: parseLocalizedString(obj.footer) ?? DEFAULT_MENU_CONFIG.footer,
    aliases: aliases.length > 0 ? aliases : [...DEFAULT_MENU_CONFIG.aliases],
    notFoundFallback: asBool(obj.notFoundFallback) ?? DEFAULT_MENU_CONFIG.notFoundFallback,
  };
}

function parseCategories(raw: unknown): Record<string, CategoryConfig> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, CategoryConfig> = {};
  for (const [catKey, value] of Object.entries(obj)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const catObj = value as Record<string, unknown>;
    const label = parseLocalizedString(catObj.label) ?? catKey;
    const order = typeof catObj.order === "number" && Number.isFinite(catObj.order) ? catObj.order : 999;
    out[catKey] = { label, order };
  }
  return out;
}

async function parseManuals(raw: unknown): Promise<Record<string, LocalizedString>> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: Record<string, LocalizedString> = {};
  for (const [id, value] of Object.entries(obj)) {
    const parsed = parseLocalizedString(value);
    if (parsed) {
      const resolved = await resolveFileRef(parsed);
      if (resolved) out[id] = resolved;
    }
  }
  return out;
}

const DEFAULT_NOTIFY_CHANGES    = true;
const DEFAULT_NOTIFY_PERIOD_DAYS = 7;

function parseDefaults(raw: unknown): CommandDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      notifyChanges:    DEFAULT_NOTIFY_CHANGES,
      notifyPeriodDays: DEFAULT_NOTIFY_PERIOD_DAYS,
      notifyMessage:    null,
      permissions:      null,
      messages:         null,
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    notifyChanges:    asBool(obj.notifyChanges)    ?? DEFAULT_NOTIFY_CHANGES,
    notifyPeriodDays: asPositiveInt(obj.notifyPeriodDays, DEFAULT_NOTIFY_PERIOD_DAYS),
    notifyMessage:    asString(obj.notifyMessage),
    permissions:      parsePermissions(obj.permissions),
    messages:         parseMessages(obj.messages),
  };
}

async function parseEntry(id: string, raw: CommandYamlSpec): Promise<CommandSpec | null> {
  const cmd = asString(raw.cmd);
  if (!cmd) {
    logger.warn(
      t("system.commandsConfigMissingCmd", {
        id,
        path: COMMANDS_FILE
      })
    );
    return null;
  }

  const rawText = parseLocalizedString(raw.text);
  const text = rawText ? await resolveFileRef(rawText) : null;

  const rawManual = parseLocalizedString(raw.manual);
  const manual = rawManual ? await resolveFileRef(rawManual) : null;

  return {
    id,
    cmd,
    aliases:          asAliasList(raw.aliases),
    plugin:           asString(raw.plugin),
    function:         asString(raw.function),
    text,
    desc:             parseLocalizedString(raw.desc),
    category:         asString(raw.category),
    manual,
    deprecatedMessage: asString(raw.deprecatedMessage),
    notifyChanges:    asBool(raw.notifyChanges),
    permissions:      parsePermissions(raw.permissions),
    messages:         parseMessages(raw.messages),
  };
}

const RESERVED_KEYS = new Set(["defaults", "menu", "categories", "manuals"]);

export async function loadCommandsConfig(): Promise<CommandsConfig | null> {
  let raw: string;
  try {
    raw = await fs.readFile(COMMANDS_FILE, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    logger.error(
      t("system.commandsConfigReadFailed", {
        path: COMMANDS_FILE,
        message: err.message
      })
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw, { filename: COMMANDS_FILE });
  } catch (e) {
    const err = e as Error;
    logger.error(
      t("system.commandsConfigParseFailed", {
        path: COMMANDS_FILE,
        message: err.message
      })
    );
    return null;
  }

  if (parsed === null || parsed === undefined) {
    return {
      defaults: {
        notifyChanges:    DEFAULT_NOTIFY_CHANGES,
        notifyPeriodDays: DEFAULT_NOTIFY_PERIOD_DAYS,
        notifyMessage:    null,
        permissions:      null,
        messages:         null,
      },
      menu: { ...DEFAULT_MENU_CONFIG },
      categories: {},
      manuals: {},
      specs: [],
    };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    logger.error(
      t("system.commandsConfigInvalidRoot", {
        path: COMMANDS_FILE
      })
    );
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const defaults = parseDefaults(root.defaults);
  const menu = parseMenu(root.menu);
  const categories = parseCategories(root.categories);
  const manuals = await parseManuals(root.manuals);

  const out: CommandSpec[] = [];
  for (const [id, value] of Object.entries(root)) {
    if (RESERVED_KEYS.has(id)) continue;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      logger.warn(
        t("system.commandsConfigInvalidEntry", {
          id,
          path: COMMANDS_FILE
        })
      );
      continue;
    }
    const spec = await parseEntry(id, value as CommandYamlSpec);
    if (spec) out.push(spec);
  }

  return { defaults, menu, categories, manuals, specs: out };
}
