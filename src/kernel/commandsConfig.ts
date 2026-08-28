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

/**
 * Raw permission block on a command (the YAML form, before inheritance).
 *
 * Two flavours are accepted side-by-side:
 *   - canonical nested form: `whitelist: { groups: [...], users: [...] }`
 *   - reference flat form:    `whitelist_groups: [...]`,
 *                             `whitelist_users: [...]`,
 *                             `blacklist_users: [...]`,
 *                             `allowed_chats: [...]`,
 *                             `dono: "<jid>"`,
 *                             `group_only: true | dm_only: true`,
 *                             `hidden_outside_scope: true`
 *
 * Same with `arguments:` vs `args:`, `function:` vs `functions: [...]`.
 */
export interface CommandPermissions {
  admin?: boolean;
  botAdmin?: boolean;
  scope?: "group" | "dm" | "any";
  owner?: boolean;
  cooldownSeconds?: number;
  whitelist?: GroupUserList;
  blacklist?: GroupUserList;
  /** Specific owner JID (alternative to global OWNER_NUMBER). */
  dono?: string;
  /** Whitelist of chats (groups + DMs) the command may run in. */
  allowedChats?: string[];
  /** Flat-form: scopes the command to groups only (alias of `scope: group`). */
  groupOnly?: boolean;
  /** Flat-form: scopes the command to DMs only (alias of `scope: dm`). */
  dmOnly?: boolean;
  /** Flat-form: whitelist of groups (no users). */
  whitelistGroups?: string[];
  /** Flat-form: blacklist of users. */
  blacklistUsers?: string[];
  /** Flat-form: hides the command from the menu when scope != this. */
  hiddenOutsideScope?: boolean;
}

export interface CommandMessages {
  botNotAdmin?: string;
  senderNotAdmin?: string;
  ownerOnly?: string;
  /** Message shown when a non-`dono` user tries a `dono`-restricted command. */
  donoOnly?: string;
  wrongScope?: string;
  cooldown?: string;
  /** Message shown when the sender is on the blacklist. */
  blacklist?: string;
  /** Message shown when the chat isn't on `allowed_chats`. */
  allowedChats?: string;
}

/**
 * Per-scope loading indicator ("processando..."). Five flavours:
 *
 *   - `reaction`        : emoji reaction on the source message (single, no cycle).
 *                         Configurable: `icon`, `on_success`, `on_error`.
 *   - `typing`          : native WhatsApp "typing..." presence. Self-clears,
 *                         no extra props accepted.
 *   - `recording_audio` : native WhatsApp "recording audio..." presence. Same
 *                         rules as `typing`.
 *   - `spinner`         : edits a self-sent message with a frame list every
 *                         `interval_ms`. Configurable: `frames`, `interval_ms`,
 *                         `on_success`, `on_error`.
 *   - `none`            : explicit off — kernel does not emit any indicator.
 */
export type LoadingType = "reaction" | "typing" | "recording_audio" | "spinner" | "none";

export interface LoadingSpec {
  type: LoadingType;
  /** `reaction` only. */
  icon?: string;
  /** `reaction` / `spinner` only. */
  onSuccess?: string;
  /** `reaction` / `spinner` only. */
  onError?: string;
  /** `spinner` only. */
  frames?: string[];
  /** `spinner` only. */
  intervalMs?: number;
}

/**
 * A `loading_presets:` entry, keyed by name and referenced from
 * `commands: ... loading: <preset-name>` (or inline under each command).
 */
export type LoadingPreset = LoadingSpec;

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
  /**
   * Ordered list of plugin function names to run, top-to-bottom. `null`
   * means "inherit the parent's chain at build time"; an empty list is
   * a deliberate "no functions" (sub is metadata-only — e.g. an alias).
   * Each function gets the same `(ctx, { args, subcommand })` shape; a
   * function may "stop the chain" by returning the sentinel `STOP_CHAIN`
   * (or throwing, which goes through the existing crash-alert path).
   */
  functions: string[] | null;
  /** Inline `loading:` override for the sub. Resolved at build time. */
  loading: LoadingSpec | null;
  desc: LocalizedString | null;
  manual: LocalizedString | null;
  arguments: CommandArgument[];
  permissions: CommandPermissions | null;
  messages: CommandMessages | null;
}

/**
 * Sentinel returned from a command function to short-circuit the chain of
 * `functions:`. Anything else (including `undefined` and a void return)
 * lets the next function in the list run with the same args.
 */
export const STOP_CHAIN: unique symbol = Symbol.for("manybot.stopChain");
export type StopChain = typeof STOP_CHAIN;

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
  /** Default loading spec inherited by top-level commands in this category. */
  loading?: LoadingSpec | null;
}

export interface CommandYamlSpec {
  cmd?: unknown;
  aliases?: unknown;
  plugin?: unknown;
  /** Either a single function name (`function: "x"`) or a list (`functions: [a, b]`). */
  function?: unknown;
  functions?: unknown;
  text?: unknown;
  desc?: unknown;
  category?: unknown;
  group?: unknown;
  manual?: unknown;
  deprecatedMessage?: unknown;
  notifyChanges?: unknown;
  permissions?: unknown;
  messages?: unknown;
  /** `arguments:` and `args:` are both accepted; reference yaml uses `args:`. */
  arguments?: unknown;
  args?: unknown;
  /** Inline loading spec (`loading: { type: spinner, ... }`) or preset name (`loading: spinner_classico`). */
  loading?: unknown;
  subcommands?: unknown;
}

export interface CommandSpec {
  id: string;
  cmd: string;
  aliases: string[];
  plugin: string | null;
  /** Resolved ordered function chain. Empty for text-only entries. */
  functions: string[];
  /** Resolved loading spec (after chain inheritance from defaults + category). */
  loading: LoadingSpec | null;
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
  /** Global `loading:` default applied to every command without an override. */
  loading?: LoadingSpec | null;
}

export interface CommandsConfig {
  /** Top-level `prefix:` declaration (informational; runtime reads from manybot.toml). */
  prefix: string | null;
  defaults: CommandDefaults;
  menu: MenuConfig;
  categories: Record<string, CategoryConfig>;
  manuals: Record<string, LocalizedString>;
  /** Named `loading_presets:` reusable across commands. */
  loadingPresets: Record<string, LoadingSpec>;
  /** Maps each category key to a default loading spec. */
  categoryLoading: Record<string, LoadingSpec>;
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

/**
 * Map the flat-form scope aliases (`group_only` / `dm_only`) plus an
 * explicit `scope:` into a single resolved "group" | "dm" | "any" | undefined
 * value. `group_only: true` and `dm_only: true` are mutually exclusive —
 * when both are set the function logs a warning and prefers the explicit
 * `scope:` (or `group_only` if `scope` is also absent).
 */
function parseScopeFromFlat(obj: Record<string, unknown>): "group" | "dm" | "any" | undefined {
  const explicit = asString(obj.scope)?.toLowerCase();
  if (explicit === "group" || explicit === "dm" || explicit === "any") return explicit;

  const groupOnly = obj.group_only;
  const dmOnly = obj.dm_only;

  if (asBool(groupOnly) === true && asBool(dmOnly) === true) {
    logger.warn(
      t("system.commandsConfigConflictingScopeFlags", { id: "(permissions)" })
    );
    return undefined;
  }
  if (asBool(groupOnly) === true) return "group";
  if (asBool(dmOnly) === true) return "dm";
  return undefined;
}

function parsePermissions(raw: unknown): CommandPermissions | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const admin = asBool(obj.admin) ?? undefined;
  const botAdmin = asBool(obj.botAdmin) ?? undefined;
  const owner = asBool(obj.owner) ?? undefined;
  const scope = parseScopeFromFlat(obj);
  const dono = asString(obj.dono) ?? undefined;

  let cooldownSeconds: number | undefined = undefined;
  if (typeof obj.cooldownSeconds === "number" && Number.isFinite(obj.cooldownSeconds) && obj.cooldownSeconds >= 0) {
    cooldownSeconds = obj.cooldownSeconds;
  }

  // Canonical nested whitelist/blacklist, with the flat-form
  // `whitelist_groups` / `blacklist_users` fields merged in.
  const nestedWhitelist = parseGroupUserList(obj.whitelist);
  const nestedBlacklist = parseGroupUserList(obj.blacklist);
  const flatWhitelistGroups = asAliasList(obj.whitelist_groups);
  const flatBlacklistUsers = asAliasList(obj.blacklist_users);

  let whitelist: GroupUserList | undefined = nestedWhitelist;
  if (flatWhitelistGroups.length > 0) {
    whitelist = {
      groups: [...(nestedWhitelist?.groups ?? []), ...flatWhitelistGroups],
      users:  nestedWhitelist?.users,
    };
  }

  let blacklist: GroupUserList | undefined = nestedBlacklist;
  if (flatBlacklistUsers.length > 0) {
    blacklist = {
      groups: nestedBlacklist?.groups,
      users:  [...(nestedBlacklist?.users ?? []), ...flatBlacklistUsers],
    };
  }

  const allowedChats = asAliasList(obj.allowed_chats);
  const hiddenOutsideScope = asBool(obj.hidden_outside_scope) ?? undefined;

  if (
    admin === undefined &&
    botAdmin === undefined &&
    owner === undefined &&
    scope === undefined &&
    cooldownSeconds === undefined &&
    whitelist === undefined &&
    blacklist === undefined &&
    dono === undefined &&
    allowedChats.length === 0 &&
    hiddenOutsideScope === undefined &&
    obj.group_only === undefined &&
    obj.dm_only === undefined
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
    dono: dono ?? undefined,
    groupOnly: obj.group_only !== undefined ? asBool(obj.group_only) ?? undefined : undefined,
    dmOnly:    obj.dm_only    !== undefined ? asBool(obj.dm_only)    ?? undefined : undefined,
    whitelistGroups: flatWhitelistGroups.length > 0 ? flatWhitelistGroups : undefined,
    blacklistUsers:  flatBlacklistUsers.length  > 0 ? flatBlacklistUsers  : undefined,
    allowedChats: allowedChats.length > 0 ? allowedChats : undefined,
    hiddenOutsideScope,
  };
}

function parseMessages(raw: unknown): CommandMessages | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const botNotAdmin = asString(obj.botNotAdmin) ?? undefined;
  const senderNotAdmin = asString(obj.senderNotAdmin) ?? undefined;
  const ownerOnly = asString(obj.ownerOnly) ?? undefined;
  const donoOnly = asString(obj.donoOnly) ?? undefined;
  const wrongScope = asString(obj.wrongScope) ?? undefined;
  const cooldown = asString(obj.cooldown) ?? undefined;
  const blacklist = asString(obj.blacklist) ?? undefined;
  const allowedChats = asString(obj.allowedChats) ?? undefined;

  if (!botNotAdmin && !senderNotAdmin && !ownerOnly && !donoOnly && !wrongScope && !cooldown && !blacklist && !allowedChats) {
    return null;
  }

  return {
    botNotAdmin,
    senderNotAdmin,
    ownerOnly,
    donoOnly,
    wrongScope,
    cooldown,
    blacklist,
    allowedChats,
  };
}

/**
 * Translate the reference yaml's flat `permission_messages:` block into a
 * `CommandMessages` shape — same keys, just renamed. Stored alongside the
 * rest of `defaults.messages` so per-command `messages:` overrides still
 * take precedence.
 */
function parsePermissionMessagesBlock(raw: unknown): CommandMessages | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  return parseMessages({
    botNotAdmin:   obj.admin_only,
    senderNotAdmin: obj.admin_only,
    ownerOnly:     obj.dono_only,
    donoOnly:      obj.dono_only,
    wrongScope:    obj.group_only ?? obj.dm_only,
    cooldown:      obj.cooldown,
    blacklist:     obj.blacklist,
    allowedChats:  obj.allowed_chats,
  });
}

// ── Loading indicator parsing ────────────────────────────────────────────────

const LOADING_TYPES: Set<LoadingType> = new Set([
  "reaction", "typing", "recording_audio", "spinner", "none",
]);

const LOADING_PROPS_BY_TYPE: Record<LoadingType, ReadonlyArray<string>> = {
  reaction:        ["icon", "onSuccess", "on_success", "onError", "on_error"],
  typing:          [],
  recording_audio: [],
  spinner:         ["frames", "intervalMs", "interval_ms", "onSuccess", "on_success", "onError", "on_error"],
  none:            [],
};

/**
 * Parse a single `loading:` value, which can be:
 *   - a preset name (string) — looked up in `presets`
 *   - an inline object: `{ type, ... }`
 * Returns the resolved spec, or `null` when the value is absent. Throws
 * nothing: malformed entries log a warning and are dropped (we keep going
 * with `null`, which means "no override; fall back to the next level in
 * the inheritance chain").
 */
function parseLoadingSpec(
  raw: unknown,
  contextId: string,
  presets: Record<string, LoadingSpec>
): LoadingSpec | null {
  if (raw === undefined || raw === null) return null;

  // `loading: spinner_classico` (preset reference)
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const preset = presets[trimmed];
    if (!preset) {
      logger.warn(
        t("system.commandsConfigLoadingPresetMissing", { id: contextId, name: trimmed })
      );
      return null;
    }
    return preset;
  }

  // Inline: `loading: { type: reaction, icon: "⏳", ... }`
  if (typeof raw !== "object" || Array.isArray(raw)) {
    logger.warn(
      t("system.commandsConfigLoadingInvalid", { id: contextId })
    );
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const typeStr = asString(obj.type)?.toLowerCase();
  if (!typeStr || !LOADING_TYPES.has(typeStr as LoadingType)) {
    logger.warn(
      t("system.commandsConfigLoadingUnknownType", { id: contextId, type: typeStr ?? "(none)" })
    );
    return null;
  }
  const type = typeStr as LoadingType;

  const allowed = new Set(LOADING_PROPS_BY_TYPE[type]);
  const recognized: string[] = [];
  for (const key of Object.keys(obj)) {
    if (key === "type") continue;
    if (!allowed.has(key)) {
      logger.error(
        t("system.commandsConfigLoadingUnknownProp", { id: contextId, type, key })
      );
      return null; // malformed config — fail closed
    }
    recognized.push(key);
  }

  const spec: LoadingSpec = { type };
  if (type === "reaction" || type === "spinner") {
    if (obj.icon !== undefined) {
      const icon = asString(obj.icon);
      if (icon) spec.icon = icon;
    }
    if (obj.onSuccess !== undefined || obj.on_success !== undefined) {
      const s = asString(obj.onSuccess ?? obj.on_success);
      if (s) spec.onSuccess = s;
    }
    if (obj.onError !== undefined || obj.on_error !== undefined) {
      const s = asString(obj.onError ?? obj.on_error);
      if (s) spec.onError = s;
    }
  }
  if (type === "spinner") {
    if (obj.frames !== undefined) {
      const frames = asAliasList(obj.frames);
      if (frames.length > 0) spec.frames = frames;
    }
    if (obj.intervalMs !== undefined || obj.interval_ms !== undefined) {
      const rawVal = obj.intervalMs ?? obj.interval_ms;
      const n = typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal >= 100
        ? Math.floor(rawVal)
        : null;
      if (n !== null) spec.intervalMs = n;
    }
  }
  return spec;
}

function parseLoadingPresets(raw: unknown): Record<string, LoadingSpec> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, LoadingSpec> = {};
  for (const [name, value] of Object.entries(raw)) {
    const spec = parseLoadingSpec(value, `loading_presets.${name}`, {});
    if (spec) out[name] = spec;
  }
  return out;
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
  // Reference yaml uses `media_direct_or_reply` (the bot accepts either a
  // direct media attachment or a reply-with-media). It's a superset of
  // `media_reply`, so we silently normalize it down.
  const normalizedType = typeStr === "media_direct_or_reply" ? "media_reply" : typeStr;
  if (!ARGUMENT_TYPES.has(normalizedType as ArgumentType)) {
    logger.warn(
      t("system.commandsConfigUnknownArgType", { id: parentId, name, type: typeStr })
    );
    return null;
  }

  // `required: true` and `optional: true` are two ways to say the same
  // thing in opposite directions. The reference yaml prefers `optional:`.
  let required: boolean;
  if (asBool(obj.required) !== null) {
    required = asBool(obj.required) ?? false;
  } else if (asBool(obj.optional) !== null) {
    required = !(asBool(obj.optional) ?? false);
  } else {
    required = false;
  }

  let choices: string[] | undefined;
  if (normalizedType === "choice") {
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
    type: normalizedType as ArgumentType,
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
  raw: unknown,
  presets: Record<string, LoadingSpec>
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
    // Per-sub function chain. `functions: [...]` wins; a single
    // `function: "x"` becomes a one-element list. `null` means "inherit
    // the parent's chain at build time" — the kernel resolves that in
    // commandRegistry, not here.
    functions:  parseFunctionList(obj.function, obj.functions),
    loading:    parseLoadingSpec(obj.loading, id, presets),
    desc:       parseLocalizedString(obj.desc),
    manual,
    arguments:  parseArguments(obj.arguments ?? obj.args, id),
    permissions: parsePermissions(obj.permissions),
    messages:   parseMessages(obj.messages),
  };
}

async function parseSubcommands(
  raw: unknown,
  parentId: string,
  presets: Record<string, LoadingSpec>
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
    const sub = await parseSubcommand(parentId, item, presets);
    if (sub) out.push(sub);
  }
  return out;
}

/**
 * Resolve `function:` (single name) and/or `functions:` (ordered list)
 * into a single ordered chain. Reference yaml mixes both forms per command.
 * Empty result means "inherit the parent's chain at build time" — the
 * spec carries `null` to flag that, and the registry resolves it.
 *
 * Items are not yet split on `.` — the kernel uses the first segment as
 * the plugin name (e.g. `core.ping` → plugin "core", function "ping"),
 * the same convention the existing `commands.[fn]` exports follow.
 */
function parseFunctionList(single: unknown, list: unknown): string[] | null {
  if (list !== undefined && list !== null) {
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const item of list) {
      const s = asString(item);
      if (s) out.push(s);
    }
    return out;
  }
  if (single !== undefined && single !== null) {
    const s = asString(single);
    return s ? [s] : [];
  }
  return null;
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

function parseCategories(
  raw: unknown,
  presets: Record<string, LoadingSpec>
): { categories: Record<string, CategoryConfig>; categoryLoading: Record<string, LoadingSpec> } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { categories: {}, categoryLoading: {} };
  }
  const obj = raw as Record<string, unknown>;
  const categories: Record<string, CategoryConfig> = {};
  const categoryLoading: Record<string, LoadingSpec> = {};
  for (const [catKey, value] of Object.entries(obj)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const catObj = value as Record<string, unknown>;
    const label = parseLocalizedString(catObj.label) ?? catKey;
    const order = typeof catObj.order === "number" && Number.isFinite(catObj.order) ? catObj.order : 999;
    const scope = parseScopeValue(catObj.scope);
    const hiddenInScope = parseScopeValue(catObj.hiddenInScope);
    categories[catKey] = {
      label,
      order,
      scope: scope ?? null,
      hiddenInScope: hiddenInScope ?? null,
    };
    const loading = parseLoadingSpec(catObj.loading, `categories.${catKey}`, presets);
    if (loading) categoryLoading[catKey] = loading;
  }
  return { categories, categoryLoading };
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

function parseDefaults(
  raw: unknown,
  presets: Record<string, LoadingSpec>
): CommandDefaults {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      notifyChanges:    DEFAULT_NOTIFY_CHANGES,
      notifyPeriodDays: DEFAULT_NOTIFY_PERIOD_DAYS,
      notifyMessage:    null,
      permissions:      null,
      messages:         null,
      loading:          null,
    };
  }
  const obj = raw as Record<string, unknown>;
  return {
    notifyChanges:    asBool(obj.notifyChanges)    ?? DEFAULT_NOTIFY_CHANGES,
    notifyPeriodDays: asPositiveInt(obj.notifyPeriodDays, DEFAULT_NOTIFY_PERIOD_DAYS),
    notifyMessage:    asString(obj.notifyMessage),
    permissions:      parsePermissions(obj.permissions),
    messages:         parseMessages(obj.messages),
    loading:          parseLoadingSpec(obj.loading, "defaults", presets),
  };
}

/**
 * Normalize the value of a `plugin:` entry against the live
 * `pluginRegistry`. The parser runs after `loadPlugins()` has populated
 * the registry, so by the time this fires every active plugin is
 * reachable under its full `owner/repo` key.
 *
 * Accepted shapes:
 *   - full registry key `owner/repo` — used verbatim if it matches;
 *   - bare `name` (no slash) — resolved to the unique `.../name` key
 *     in the registry. If zero keys match, the original `name` is
 *     returned. If more than one matches, the original `name` is also
 *     returned so the ambiguity surfaces at dispatch instead of being
 *     silently resolved by picking one owner;
 *   - inline `owner/repo.fn` or `name.fn` — split on the first dot by
 *     `parseEntry` before reaching here; only the prefix half is
 *     passed in.
 *
 * Pure: no I/O, no module imports. The registry is passed in because
 * importing `pluginLoader.ts` from this file would close a
 * commandsConfig to pluginLoader to commandRegistry to commandsConfig
 * cycle (this module already imports types from commandRegistry).
 */
function resolvePluginKey(raw: string, validPluginKeys: ReadonlySet<string>): string {
  if (validPluginKeys.has(raw)) return raw;
  if (raw.includes("/")) return raw;
  let match: string | null = null;
  for (const key of validPluginKeys) {
    if (key.endsWith("/" + raw)) {
      if (match !== null) return raw;
      match = key;
    }
  }
  return match ?? raw;
}

async function parseEntry(
  id: string,
  raw: CommandYamlSpec,
  presets: Record<string, LoadingSpec>,
  validPluginKeys?: ReadonlySet<string>
): Promise<CommandSpec | null> {
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

  // `plugin:` accepts both an `owner/repo` registry key (the canonical
  // form) and the legacy shorthand `name` (resolved against the active
  // `pluginRegistry` keys passed in via `validPluginKeys`). It also
  // accepts an inline form split on the first dot, where everything
  // after the dot is a function name treated as the head of the
  // `functions:` chain. When `validPluginKeys` is provided the parser
  // prefers an exact registry key and falls back to a `/<plugin>` suffix
  // match (one plugin per name across owners); without it the value is
  // used verbatim and the caller is responsible for resolving it.
  const pluginFull = asString(raw.plugin);
  let plugin: string | null = null;
  let inlineFn: string | null = null;
  if (pluginFull) {
    const dot = pluginFull.indexOf(".");
    if (dot >= 0) {
      plugin = pluginFull.slice(0, dot);
      inlineFn = pluginFull.slice(dot + 1);
    } else {
      plugin = pluginFull;
    }
    if (validPluginKeys) plugin = resolvePluginKey(plugin, validPluginKeys);
  }

  // `function:` → `functions: [fn]`, `functions: [...]` → as-is,
  // "core.ping" inline above → `[ping]`, no fields → null (inherit).
  const inlineFunctions = parseFunctionList(raw.function, raw.functions);
  const functions = inlineFn !== null
    ? [inlineFn, ...(inlineFunctions ?? [])]
    : inlineFunctions;

  return {
    id,
    cmd,
    aliases:          asAliasList(raw.aliases),
    plugin,
    functions:        functions ?? [],
    loading:          parseLoadingSpec(raw.loading, id, presets),
    text,
    desc:             parseLocalizedString(raw.desc),
    category:         asString(raw.category),
    group:            asString(raw.group),
    manual,
    deprecatedMessage: asString(raw.deprecatedMessage),
    notifyChanges:    asBool(raw.notifyChanges),
    permissions:      parsePermissions(raw.permissions),
    messages:         parseMessages(raw.messages),
    arguments:        parseArguments(raw.arguments ?? raw.args, id),
    subcommands:      await parseSubcommands(raw.subcommands, id, presets),
  };
}

const RESERVED_KEYS = new Set([
  "defaults", "menu", "categories", "manuals", "import",
  "loading_presets", "loading",
  "prefix",
  "notify_changes", "notify_period_days", "deprecation_message", "permission_messages",
  "commands",
]);

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

/**
 * Unwrap a `commands:` wrapper block, if present, so the rest of the
 * loader doesn't need to know whether the user wrote
 *
 *     mycommand:
 *       cmd: foo
 *
 * or
 *
 *     commands:
 *       mycommand:
 *         cmd: foo
 *
 * Both forms get parsed identically. The reference yaml uses the wrapper
 * because it's clearer once you also have a `defaults:` block at the top
 * (otherwise the command ids sit at the same indent as `defaults` and the
 * file looks ambiguous).
 */
function unwrapCommandsWrapper(root: Record<string, unknown>): Record<string, unknown> {
  const wrapper = root.commands;
  if (wrapper === undefined || wrapper === null) return root;
  if (typeof wrapper !== "object" || Array.isArray(wrapper)) {
    logger.error(t("system.commandsConfigCommandsWrapperInvalid"));
    return root;
  }
  const inner = wrapper as Record<string, unknown>;
  const out: Record<string, unknown> = { ...root };
  delete out.commands;
  for (const [key, value] of Object.entries(inner)) {
    if (key in out) {
      logger.error(
        t("system.commandsConfigCommandsWrapperCollision", { key })
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function loadCommandsConfig(
  validPluginKeys?: ReadonlySet<string>
): Promise<CommandsConfig | null> {
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
      prefix: null,
      defaults: {
        notifyChanges:    DEFAULT_NOTIFY_CHANGES,
        notifyPeriodDays: DEFAULT_NOTIFY_PERIOD_DAYS,
        notifyMessage:    null,
        permissions:      null,
        messages:         null,
        loading:          null,
      },
      menu: { ...DEFAULT_MENU_CONFIG },
      categories: {},
      manuals: {},
      loadingPresets: {},
      categoryLoading: {},
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

  const imported = await resolveImports(parsed as Record<string, unknown>);
  const root = unwrapCommandsWrapper(imported);

  const prefix = asString(root.prefix) ?? null;
  const loadingPresets = parseLoadingPresets(root.loading_presets);

  // Top-level notify_*/deprecation_message/permission_messages/loading act
  // as a shallow overlay over `defaults:` — when present, each key wins
  // over the same key under `defaults:`. Same shape, no deep merge (same
  // rule as imports).
  const defaultsRaw = (root.defaults ?? {}) as Record<string, unknown>;
  const notifyChangesTop  = asBool(root.notify_changes);
  const notifyPeriodTop   = typeof root.notify_period_days === "number" && Number.isFinite(root.notify_period_days)
    ? root.notify_period_days
    : null;
  const deprecationMessageTop = asString(root.deprecation_message);
  const permissionMessagesTop  = parsePermissionMessagesBlock(root.permission_messages);

  const mergedDefaults: Record<string, unknown> = { ...defaultsRaw };
  if (notifyChangesTop !== null) mergedDefaults.notifyChanges = notifyChangesTop;
  if (notifyPeriodTop  !== null) mergedDefaults.notifyPeriodDays = notifyPeriodTop;
  if (deprecationMessageTop !== null) mergedDefaults.notifyMessage = deprecationMessageTop;
  if (permissionMessagesTop) mergedDefaults.messages = {
    ...((defaultsRaw.messages ?? {}) as Record<string, unknown>),
    ...permissionMessagesTop,
  };
  // Top-level `loading: <preset-name-or-inline-spec>` — reference yaml's
  // global default (`loading: padrao`). Only overlays when actually
  // present; `defaults.loading` (nested form) still works on its own.
  if (root.loading !== undefined) mergedDefaults.loading = root.loading;

  const defaults = parseDefaults(mergedDefaults, loadingPresets);
  const menu = parseMenu(root.menu);
  const { categories, categoryLoading } = parseCategories(root.categories, loadingPresets);
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
    const spec = await parseEntry(id, value as CommandYamlSpec, loadingPresets, validPluginKeys);
    if (spec) out.push(spec);
  }

  return { prefix, defaults, menu, categories, manuals, loadingPresets, categoryLoading, specs: out };
}

