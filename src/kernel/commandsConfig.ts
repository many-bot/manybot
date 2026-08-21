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

/**
 * Argument types accepted by `commands.yaml`'s `arguments:` block.
 *
 * Each entry is a single kernel-recognised shape; free-form text parsing
 * remains the plugin's responsibility (the kernel only handles the
 * structured types below).
 */
export type ArgumentType =
  | "mention"
  | "url"
  | "media_direct"
  | "media_reply"
  | "number"
  | "duration"
  | "choice"
  | "boolean"
  | "quoted_text"
  | "reply";

export interface CommandArgument {
  /** Name used for the `--<name>=…` form in usage lines. */
  name: string;
  /** Recognised kind; unknown kinds are dropped by the parser with a warning. */
  type: ArgumentType;
  /** Whether the command can be dispatched without this argument. */
  required: boolean;
  /** Choice list — only meaningful when type === "choice". */
  choices?: string[];
}

export interface CommandSubcommandSpec {
  /** Stable internal id, derived from the parent's id + the subcommand cmd. */
  id: string;
  /** Invocation token used after the parent cmd (e.g. "add" for `!todo add`). */
  cmd: string;
  /** Optional aliases for the sub token; explicit `aliases: []` clears defaults. */
  aliases: string[];
  /** Plugin function name. When omitted, defaults to the parent's function. */
  function: string | null;
  desc: LocalizedString | null;
  manual: LocalizedString | null;
  arguments: CommandArgument[];
  permissions: CommandPermissions | null;
  messages: CommandMessages | null;
}

export interface MenuConfig {
  title: LocalizedString | null;
  intro: LocalizedString | null;
  footer: LocalizedString | null;
  /** Canonical menu command (default: "menu"). */
  cmd: string;
  aliases: string[];
  /**
   * Replies to otherwise unknown prefixed commands after legacy plugins run.
   * Legacy plugins cannot report that they handled a message, so this can
   * produce an extra reply; keep it opt-in.
   */
  notFoundFallback: boolean;
  /** Welcome message shown to new users within welcomeWindowDays. Supports {prefix} interpolation. */
  welcomeMessage: LocalizedString | null;
  /** Time window in days to show the welcome message (default: 3). */
  welcomeWindowDays: number;
  /** Page size for menu pagination (default: 15). */
  pageSize: number;
}

export interface CategoryConfig {
  label: LocalizedString;
  order: number;
  /** Default scope inherited by top-level commands in this category. */
  scope?: "group" | "dm" | "any" | null;
  /**
   * Scope under which the category is hidden from the menu. When the
   * active scope does not match this value, the category is suppressed
   * in the rendered menu (Phase 6 will consume this).
   */
  hiddenInScope?: "group" | "dm" | "any" | null;
}

export interface CommandYamlSpec {
  cmd?: unknown;
  aliases?: unknown;
  plugin?: unknown;
  function?: unknown;
  text?: unknown;
  desc?: unknown;
  category?: unknown;
  group?: unknown;
  manual?: unknown;
  deprecatedMessage?: unknown;
  notifyChanges?: unknown;
  permissions?: unknown;
  messages?: unknown;
  arguments?: unknown;
  subcommands?: unknown;
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
  /** Group id this command belongs to (used by the menu grouping). */
  group: string | null;
  manual: LocalizedString | null;
  deprecatedMessage: string | null;
  notifyChanges: boolean | null;
  permissions: CommandPermissions | null;
  messages: CommandMessages | null;
  arguments: CommandArgument[];
  subcommands: CommandSubcommandSpec[];
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

function asImportList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return asAliasList(value);
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

const ARGUMENT_TYPES = new Set<ArgumentType>([
  "mention", "url", "media_direct", "media_reply", "number",
  "duration", "choice", "boolean", "quoted_text", "reply",
]);

function parseArgument(raw: unknown, parentId: string): CommandArgument | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const name = asString(obj.name);
  if (!name) {
    logger.warn(
      t("system.commandsConfigArgumentMissingName", { id: parentId })
    );
    return null;
  }
  const typeStr = asString(obj.type);
  if (!typeStr) {
    logger.warn(
      t("system.commandsConfigArgumentMissingType", { id: parentId, name })
    );
    return null;
  }
  if (!ARGUMENT_TYPES.has(typeStr as ArgumentType)) {
    logger.warn(
      t("system.commandsConfigUnknownArgType", { id: parentId, name, type: typeStr })
    );
    return null;
  }

  const required = asBool(obj.required) ?? false;

  let choices: string[] | undefined;
  if (typeStr === "choice") {
    choices = asAliasList(obj.choices);
    if (choices.length === 0) {
      logger.warn(
        t("system.commandsConfigChoiceArgumentNoChoices", { id: parentId, name })
      );
      // Still allow the argument; renderUsage just falls back to "<name>".
    }
  }

  return {
    name,
    type: typeStr as ArgumentType,
    required,
    choices,
  };
}

function parseArguments(raw: unknown, parentId: string): CommandArgument[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    logger.warn(
      t("system.commandsConfigArgumentsNotList", { id: parentId })
    );
    return [];
  }
  const out: CommandArgument[] = [];
  for (const item of raw) {
    const arg = parseArgument(item, parentId);
    if (arg) out.push(arg);
  }
  return out;
}

async function parseSubcommand(
  parentId: string,
  raw: unknown
): Promise<CommandSubcommandSpec | null> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const cmd = asString(obj.cmd);
  if (!cmd) {
    logger.warn(
      t("system.commandsConfigSubcommandMissingCmd", { id: parentId })
    );
    return null;
  }

  const id = `${parentId}::${cmd}`;
  const rawManual = parseLocalizedString(obj.manual);
  const manual = rawManual ? await resolveFileRef(rawManual) : null;

  return {
    id,
    cmd,
    aliases:    asAliasList(obj.aliases),
    function:   asString(obj.function),
    desc:       parseLocalizedString(obj.desc),
    manual,
    arguments:  parseArguments(obj.arguments, id),
    permissions: parsePermissions(obj.permissions),
    messages:   parseMessages(obj.messages),
  };
}

async function parseSubcommands(
  raw: unknown,
  parentId: string
): Promise<CommandSubcommandSpec[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    logger.warn(
      t("system.commandsConfigSubcommandsNotList", { id: parentId })
    );
    return [];
  }
  const out: CommandSubcommandSpec[] = [];
  for (const item of raw) {
    const sub = await parseSubcommand(parentId, item);
    if (sub) out.push(sub);
  }
  return out;
}

const DEFAULT_MENU_CONFIG: MenuConfig = {
  title: "🤖 ManyBot — Menu",
  intro: {
    en: "Use {prefix}<command> to run it or {prefix}help <command> to view its manual.",
    pt: "Use {prefix}<comando> para executar ou {prefix}help <comando> para ver o manual.",
    es: "Usa {prefix}<comando> para ejecutarlo o {prefix}help <comando> para ver el manual.",
  },
  footer: null,
  cmd: "menu",
  aliases: ["help", "man", "menu", "bot", "?"],
  notFoundFallback: false,
  welcomeMessage: null,
  welcomeWindowDays: 3,
  pageSize: 15,
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
    cmd: asString(obj.cmd) ?? DEFAULT_MENU_CONFIG.cmd,
    aliases: aliases.length > 0 ? aliases : [...DEFAULT_MENU_CONFIG.aliases],
    notFoundFallback: asBool(obj.notFoundFallback) ?? DEFAULT_MENU_CONFIG.notFoundFallback,
    welcomeMessage: parseLocalizedString(obj.welcomeMessage) ?? DEFAULT_MENU_CONFIG.welcomeMessage,
    welcomeWindowDays: asPositiveInt(obj.welcomeWindowDays, DEFAULT_MENU_CONFIG.welcomeWindowDays),
    pageSize: asPositiveInt(obj.pageSize, DEFAULT_MENU_CONFIG.pageSize),
  };
}

function parseScopeValue(raw: unknown): "group" | "dm" | "any" | null {
  const s = asString(raw)?.toLowerCase();
  if (s === "group" || s === "dm" || s === "any") return s;
  return null;
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
    const scope = parseScopeValue(catObj.scope);
    const hiddenInScope = parseScopeValue(catObj.hiddenInScope);
    out[catKey] = {
      label,
      order,
      scope: scope ?? null,
      hiddenInScope: hiddenInScope ?? null,
    };
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
    group:            asString(raw.group),
    manual,
    deprecatedMessage: asString(raw.deprecatedMessage),
    notifyChanges:    asBool(raw.notifyChanges),
    permissions:      parsePermissions(raw.permissions),
    messages:         parseMessages(raw.messages),
    arguments:        parseArguments(raw.arguments, id),
    subcommands:      await parseSubcommands(raw.subcommands, id),
  };
}

const RESERVED_KEYS = new Set(["defaults", "menu", "categories", "manuals", "import"]);

/**
 * Resolves `import:` (a path or list of paths, relative to PATHS.HOME) by
 * reading each referenced YAML file and folding its top-level sections
 * into the main root object. Each top-level key (`menu`, `manuals`, a
 * command id, ...) may be owned by exactly one source file — no deep
 * merge, first owner wins and any later collision is reported as an
 * error and skipped, keeping the rest of that import file usable.
 */
async function resolveImports(root: Record<string, unknown>): Promise<Record<string, unknown>> {
  const importPaths = asImportList(root.import);
  if (importPaths.length === 0) return root;

  const merged: Record<string, unknown> = { ...root };
  delete merged.import;

  const owner = new Map<string, string>();
  for (const key of Object.keys(merged)) owner.set(key, COMMANDS_FILE);

  for (const relPath of importPaths) {
    const fullPath = path.resolve(PATHS.HOME, relPath);

    let raw: string;
    try {
      raw = await fs.readFile(fullPath, "utf8");
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      logger.error(
        t("system.commandsConfigImportReadFailed", { path: fullPath, message: err.message })
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(raw, { filename: fullPath });
    } catch (e) {
      const err = e as Error;
      logger.error(
        t("system.commandsConfigImportParseFailed", { path: fullPath, message: err.message })
      );
      continue;
    }

    if (parsed === null || parsed === undefined) continue;
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      logger.error(t("system.commandsConfigImportInvalidRoot", { path: fullPath }));
      continue;
    }

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key === "import") {
        logger.warn(t("system.commandsConfigImportNested", { path: fullPath }));
        continue;
      }
      const existingOwner = owner.get(key);
      if (existingOwner !== undefined) {
        logger.error(
          t("system.commandsConfigImportKeyConflict", { key, path: fullPath, owner: existingOwner })
        );
        continue;
      }
      merged[key] = value;
      owner.set(key, fullPath);
    }
  }

  return merged;
}

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

  const root = await resolveImports(parsed as Record<string, unknown>);
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

