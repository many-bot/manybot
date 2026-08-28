/**
 * commandRegistry.ts
 *
 * Merges commands.yaml user overrides with each active plugin's
 * `commands` defaults into a single, in-memory registry — the single
 * source of truth for command routing. No routing happens here yet
 * (that's the next step); this module just builds the structure and
 * can be exercised in isolation with a unit test.
 */

import { logger } from "#logger";
import { t } from "#i18n";
import {
  loadCommandsConfig,
  type CommandArgument,
  type CommandSubcommandSpec,
  type CommandDefaults,
  type CommandSpec,
  type CommandPermissions,
  type CommandMessages,
  type MenuConfig,
  type CategoryConfig,
  type LocalizedString,
  type LoadingSpec,
} from "./commandsConfig.js";
import {
  pluginRegistry,
  resolvePluginCommandHandler,
  type PluginEntry,
  type PluginCommandDefault,
  type PluginCommandExport,
} from "./pluginLoader.js";
import { getActiveDeprecation, syncCommandHistory } from "./commandDeprecation.js";

export type CommandHandler = (ctx: unknown, input?: unknown) => Promise<unknown>;

export interface ResolvedGroupUserList {
  groups: string[];
  users: string[];
}

export interface ResolvedPermissions {
  admin: boolean;
  botAdmin: boolean;
  scope: "group" | "dm" | "any";
  owner: boolean;
  cooldownSeconds: number;
  whitelist: ResolvedGroupUserList | null;
  blacklist: ResolvedGroupUserList | null;
  /** Specific owner JID (overrides global OWNER_NUMBER). */
  dono: string | null;
  /** Closed list of chat JIDs the command may run in. */
  allowedChats: string[] | null;
  /** When set, command is suppressed from the menu when scope !== this. */
  hiddenOutsideScope: "group" | "dm" | "any" | null;
  messages: {
    botNotAdmin: string;
    senderNotAdmin: string;
    ownerOnly?: string;
    donoOnly: string;
    wrongScope: string;
    cooldown: string;
    blacklist: string;
    allowedChats: string;
  };
}

/**
 * Resolved sub-command shape. Subcommands share the parent's `pluginName`
 * and either share the parent's `function` (the common case) or override
 * it. Each sub has its own resolved `permissions` (with chain inheritance
 * applied at build time), its own `arguments:` block, and its own manual.
 */
export interface CommandSubcommand {
  id: string;
  cmd: string;
  aliases: string[];
  desc: LocalizedString | null;
  manual: LocalizedString | null;
  /**
   * Primary plugin function name (first in `functions:`). Kept on the
   * sub for backward compatibility with the original sub-handler dispatch
   * — the v6 unified dispatcher now runs the full `functions` chain
   * instead, but pluginLoader's per-function handler lookup still
   * resolves by primary name.
   */
  function: string;
  /**
   * Ordered chain of plugin function names to run for this sub. Empty
   * when the sub is metadata-only; the dispatcher short-circuits and
   * returns "no_dispatch" for empty chains.
   */
  functions: string[];
  /**
   * Loading indicator spec for this sub. Resolved at build time
   * (chain inheritance: defaults → category → command → sub).
   */
  loading: import("./commandsConfig.js").LoadingSpec | null;
  arguments: CommandArgument[];
  permissions: ResolvedPermissions;
}

export interface CommandEntry {
  id: string;
  cmd: string;
  aliases: string[];
  desc: LocalizedString | null;
  category: string | null;
  /** Free-form grouping key (separate from the i18n label-bearing category). */
  group: string | null;
  manual: LocalizedString | null;
  source: "plugin" | "text";
  pluginName: string | null;
  /**
   * Primary plugin function name (= the function in `plugin.commands`
   * that the dispatch path calls). Always set for plugin-sourced
   * entries; null for text-only entries.
   */
  function: string | null;
  /**
   * Resolved function chain. Mirrors `function` as `[function]` when the
   * YAML only declared `function:`, or contains the multi-step chain
   * when the YAML declared `functions: [a, b, c]`. Empty for text-only
   * entries.
   */
  functions: string[];
  /** Resolved loading indicator spec for this command. */
  loading: import("./commandsConfig.js").LoadingSpec | null;
  handler: CommandHandler | null;
  text: LocalizedString | null;
  permissions: ResolvedPermissions;
  /** Declared argument types for this entry. Free-form text parsing is left to plugins. */
  arguments: CommandArgument[];
  /** Sub-commands keyed by their lowercase cmd token. */
  subcommands: Record<string, CommandSubcommand>;
  /**
   * Category-level hidden-in-scope directive (resolved at build time
   * from `categories[entry.category].hiddenInScope`). Stored on the
   * entry so the menu renderer can suppress categories that should not
   * appear in the current scope without re-resolving category metadata.
   */
  categoryHiddenInScope: "group" | "dm" | "any" | null;
  /**
   * Command-level "hide from menu when scope !== this value". Comes from
   * the flat `hidden_outside_scope: true` on a group-only / dm-only
   * command — unlike `categoryHiddenInScope` it's set per-command and
   * stored here so the menu doesn't need to re-walk the registry.
   */
  hiddenOutsideScope: "group" | "dm" | "any" | null;
}

export interface CommandRegistry {
  byId: Map<string, CommandEntry>;
  byInvocation: Map<string, string>;
  defaults: CommandDefaults;
  menu: MenuConfig;
  menuAliases: Set<string>;
  categories: Record<string, CategoryConfig>;
  manuals: Record<string, LocalizedString>;
  /** Top-level `loading_presets:` for reference (the entries already
   *  point to their resolved specs, so consumers normally don't need this). */
  loadingPresets: Record<string, import("./commandsConfig.js").LoadingSpec>;
  /** Per-category default loading spec (from `categories.<key>.loading`). */
  categoryLoading: Record<string, import("./commandsConfig.js").LoadingSpec>;
  /** Top-level `prefix:` declaration (informational). */
  prefix: string | null;
}

export const DEFAULT_PERMISSION_MESSAGES = {
  botNotAdmin:    () => t("commandPermissions.botNotAdmin") as string,
  senderNotAdmin: () => t("commandPermissions.senderNotAdmin") as string,
  ownerOnly:      () => t("commandPermissions.ownerOnly") as string,
  donoOnly:       () => t("commandPermissions.donoOnly") as string,
  wrongScope:     () => t("commandPermissions.wrongScope") as string,
  cooldown:       () => t("commandPermissions.cooldown") as string,
  blacklist:      () => t("commandPermissions.blacklist") as string,
  allowedChats:   () => t("commandPermissions.allowedChats") as string,
};

export function resolvePermissions(
  specPerms?: CommandPermissions | null,
  specMsgs?: CommandMessages | null,
  pluginPerms?: CommandPermissions | null,
  defaultsPerms?: CommandPermissions | null,
  defaultsMsgs?: CommandMessages | null,
  fallbackScope?: "group" | "dm" | "any" | null
): ResolvedPermissions {
  const admin = specPerms?.admin ?? pluginPerms?.admin ?? false;
  const botAdmin = specPerms?.botAdmin ?? pluginPerms?.botAdmin ?? false;
  const scope = specPerms?.scope ?? pluginPerms?.scope ?? fallbackScope ?? "any";
  const owner = specPerms?.owner ?? pluginPerms?.owner ?? false;
  const cooldownSeconds = specPerms?.cooldownSeconds ?? pluginPerms?.cooldownSeconds ?? defaultsPerms?.cooldownSeconds ?? 0;

  // `dono` is YAML-only (no plugin-level equivalent). Per-spec dono
  // wins; falls back to null = "no specific owner restriction" (the
  // global OWNER_NUMBER in manybot.toml is independent).
  const dono: string | null = specPerms?.dono ?? null;

  // `allowed_chats:` is a closed list of JIDs the command may run in.
  // Only set by the YAML spec; null = no chat restriction.
  const allowedChats: string[] | null = specPerms?.allowedChats && specPerms.allowedChats.length > 0
    ? [...specPerms.allowedChats]
    : null;

  // `hidden_outside_scope:` mirrors `group_only` / `dm_only`. Compute it
  // here so the resolved value is consistent across the menu and the
  // permission check. spec wins over plugin: a plugin manifest that
  // declares `group_only: true` is hidden from DMs unless the spec
  // narrows it differently.
  let hiddenOutsideScope: "group" | "dm" | "any" | null = null;
  const scopeSrc = specPerms?.scope ?? pluginPerms?.scope ?? null;
  const hiddenFlag = specPerms?.hiddenOutsideScope ?? pluginPerms?.hiddenOutsideScope ?? false;
  const groupOnlyFlag = specPerms?.groupOnly ?? pluginPerms?.groupOnly ?? false;
  const dmOnlyFlag = specPerms?.dmOnly ?? pluginPerms?.dmOnly ?? false;
  if (scopeSrc === "group") hiddenOutsideScope = "group";
  else if (scopeSrc === "dm") hiddenOutsideScope = "dm";
  else if (hiddenFlag === true || groupOnlyFlag === true) hiddenOutsideScope = "group";
  else if (dmOnlyFlag === true) hiddenOutsideScope = "dm";

  const rawWhitelist = specPerms?.whitelist ?? pluginPerms?.whitelist ?? defaultsPerms?.whitelist ?? null;
  const rawBlacklist = specPerms?.blacklist ?? pluginPerms?.blacklist ?? defaultsPerms?.blacklist ?? null;

  const whitelist: ResolvedGroupUserList | null = rawWhitelist
    ? {
        groups: rawWhitelist.groups ? [...rawWhitelist.groups] : [],
        users: rawWhitelist.users ? [...rawWhitelist.users] : [],
      }
    : null;

  const blacklist: ResolvedGroupUserList | null = rawBlacklist
    ? {
        groups: rawBlacklist.groups ? [...rawBlacklist.groups] : [],
        users: rawBlacklist.users ? [...rawBlacklist.users] : [],
      }
    : null;

  const messages = {
    botNotAdmin:    specMsgs?.botNotAdmin ?? defaultsMsgs?.botNotAdmin ?? DEFAULT_PERMISSION_MESSAGES.botNotAdmin(),
    senderNotAdmin: specMsgs?.senderNotAdmin ?? defaultsMsgs?.senderNotAdmin ?? DEFAULT_PERMISSION_MESSAGES.senderNotAdmin(),
    ownerOnly:      specMsgs?.ownerOnly ?? defaultsMsgs?.ownerOnly ?? undefined,
    donoOnly:       specMsgs?.donoOnly ?? defaultsMsgs?.donoOnly ?? DEFAULT_PERMISSION_MESSAGES.donoOnly(),
    wrongScope:     specMsgs?.wrongScope ?? defaultsMsgs?.wrongScope ?? DEFAULT_PERMISSION_MESSAGES.wrongScope(),
    cooldown:       specMsgs?.cooldown ?? defaultsMsgs?.cooldown ?? DEFAULT_PERMISSION_MESSAGES.cooldown(),
    blacklist:      specMsgs?.blacklist ?? defaultsMsgs?.blacklist ?? DEFAULT_PERMISSION_MESSAGES.blacklist(),
    allowedChats:   specMsgs?.allowedChats ?? defaultsMsgs?.allowedChats ?? DEFAULT_PERMISSION_MESSAGES.allowedChats(),
  };

  return {
    admin,
    botAdmin,
    scope,
    owner,
    cooldownSeconds,
    whitelist,
    blacklist,
    dono,
    allowedChats,
    hiddenOutsideScope,
    messages,
  };
}

function pluginCommandKey(pluginName: string, functionName: string): string {
  return `${pluginName}::${functionName}`;
}

/**
 * Plugin-provided command defaults (`export const commands = {...}`) are
 * plain JS, not parsed/validated YAML — a plugin can hand us any runtime
 * value regardless of the `PluginCommandDefault` compile-time type. `cmd`
 * and `aliases` end up bound to SQLite params (deprecation lookups) and a
 * non-string/undefined value there throws instead of failing gracefully.
 * Sanitize before it ever reaches the registry.
 */
function sanitizePluginCmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePluginAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/**
 * Normalized shape of a single `plugin.commands[fn]` export, regardless
 * of which of the two shapes the plugin used (bare handler function, or
 * a `PluginCommandDefault` object). `cmd === null` means the plugin is
 * "pure function" style — it has no built-in identity of its own and can
 * only be reached through a commands.yaml entry that supplies `cmd`.
 */
interface NormalizedPluginCommand {
  cmd: string | null;
  aliases: string[];
  desc: LocalizedString | null;
  category: string | null;
  manual: LocalizedString | null;
  permissions: CommandPermissions | null;
  handler: CommandHandler | null;
}

function normalizePluginCommand(def: PluginCommandExport | undefined): NormalizedPluginCommand {
  const handler = resolvePluginCommandHandler(def) as CommandHandler | null;
  if (def && typeof def === "object") {
    return {
      cmd: sanitizePluginCmd(def.cmd),
      aliases: sanitizePluginAliases(def.aliases),
      desc: def.desc ?? null,
      category: typeof def.category === "string" ? def.category : null,
      manual: def.manual ?? null,
      permissions: def.permissions ?? null,
      handler,
    };
  }
  // Bare function (pure-function style — no built-in identity), or
  // something malformed entirely (handler stays null in that case).
  return { cmd: null, aliases: [], desc: null, category: null, manual: null, permissions: null, handler };
}

/** Whether a `commands[fn]` export is a shape worth remembering at all —
 *  a bare handler function, or an object (even one missing `handler`,
 *  which is only validated at dispatch time, same as before this
 *  module supported the bare-function shape). Anything else (a string,
 *  a number, null/undefined) is not a command definition. */
function isUsablePluginCommandExport(def: unknown): boolean {
  return typeof def === "function" || (def !== null && typeof def === "object");
}

/** Entry kept per plugin-exported function, keyed by `pluginCommandKey()`. */
interface PluginDefaultEntry {
  plugin: PluginEntry;
  fn: string;
  norm: NormalizedPluginCommand;
}

function registerInvocation(
  byInvocation: Map<string, string>,
  text: string,
  entryId: string,
  isOverride: boolean
): boolean {
  const existing = byInvocation.get(text);
  if (existing === undefined) {
    byInvocation.set(text, entryId);
    return true;
  }
  if (existing === entryId) return true;

  logger.warn(
    t("system.commandRegistryInvocationCollision", {
      text,
      winner: existing,
      loser: entryId,
      via: isOverride ? "yaml override" : "plugin default"
    })
  );
  return false;
}

function registerInvocationWithDeprecationGuard(
  byInvocation: Map<string, string>,
  text: string,
  entryId: string,
  isOverride: boolean,
  notifyChanges: boolean
): boolean {
  if (!notifyChanges) {
    return registerInvocation(byInvocation, text, entryId, isOverride);
  }

  const deprecation = getActiveDeprecation(text);
  if (deprecation) {
    logger.warn(
      t("system.commandDeprecationReservedInvocation", {
        text,
        id: deprecation.id
      })
    );
    return false;
  }
  return registerInvocation(byInvocation, text, entryId, isOverride);
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

function resolveCategoryHiddenInScope(
  category: string | null,
  categories: Record<string, CategoryConfig>
): "group" | "dm" | "any" | null {
  if (!category) return null;
  return categories[category]?.hiddenInScope ?? null;
}

/**
 * Resolve a `CommandSubcommandSpec` into the runtime `CommandSubcommand`.
 *
 * Function-chain inheritance: a sub with `spec.functions === null` (no
 * override) inherits the parent's resolved chain. With an explicit list
 * (even an empty one) it uses that. The primary `function` is set to the
 * first non-empty entry, falling back to the parent's primary. Same
 * convention for `loading:` — spec override wins, otherwise the parent's
 * resolved spec carries through.
 *
 * Subcommand permissions inherit from the parent's resolved permissions
 * unless the spec overrides them — `parent.permissions.scope` is passed
 * as `fallbackScope` to close the category → command → subcommand chain.
 */
function buildSubcommandFromSpec(
  spec: CommandSubcommandSpec,
  parent: CommandEntry,
  pluginName: string | null,
  defaultsByKey: Map<string, PluginDefaultEntry>,
  defaults: CommandDefaults,
  manuals: Record<string, LocalizedString>,
  loadingPresetOverrides: Record<string, LoadingSpec>
): CommandSubcommand {
  const manual = spec.manual ?? manuals[spec.id] ?? null;
  const functions = spec.functions !== null ? [...spec.functions] : [...parent.functions];
  const fnName = functions[0] ?? parent.function ?? "";
  // Each sub can point at a *different* plugin function than its
  // siblings — resolve this sub's own default permissions from its own
  // primary function, not from whatever the parent happens to carry.
  const subDef = pluginName && fnName
    ? defaultsByKey.get(pluginCommandKey(pluginName, fnName))?.norm ?? null
    : null;
  return {
    id:         spec.id,
    cmd:        spec.cmd,
    aliases:    [...spec.aliases],
    desc:       spec.desc,
    manual,
    function:   fnName,
    functions,
    loading:    spec.loading ?? parent.loading,
    arguments:  [...spec.arguments],
    permissions: resolvePermissions(
      spec.permissions,
      spec.messages,
      subDef?.permissions ?? null,
      defaults.permissions,
      defaults.messages,
      parent.permissions.scope
    ),
  };
}

function buildSubcommandsFromSpecs(
  specs: CommandSubcommandSpec[],
  parent: CommandEntry,
  pluginName: string | null,
  defaultsByKey: Map<string, PluginDefaultEntry>,
  defaults: CommandDefaults,
  manuals: Record<string, LocalizedString>,
  loadingPresetOverrides: Record<string, LoadingSpec>
): Record<string, CommandSubcommand> {
  const out: Record<string, CommandSubcommand> = {};
  for (const spec of specs) {
    const token = spec.cmd.toLowerCase();
    if (out[token]) {
      logger.warn(
        t("system.commandsConfigDuplicateSubcommand", {
          id: parent.id,
          cmd: spec.cmd
        })
      );
      continue;
    }
    out[token] = buildSubcommandFromSpec(
      spec, parent, pluginName, defaultsByKey, defaults, manuals, loadingPresetOverrides
    );
  }
  return out;
}

/**
 * Chain inheritance for `loading:` is:
 *
 *   defaults.loading  →  categoryLoading[cat]  →  spec.loading
 *
 * Returns the first non-null in that order. An inline `spec.loading`
 * already won against any preset (the parser resolves preset names at
 * parse time). Categories that don't declare `loading:` pass `null`
 * through, so the defaults spec wins.
 */
function resolveLoadingChain(
  spec: LoadingSpec | null,
  categoryKey: string | null,
  categoryLoading: Record<string, LoadingSpec>,
  defaults: CommandDefaults
): LoadingSpec | null {
  return spec
    ?? (categoryKey ? categoryLoading[categoryKey] ?? null : null)
    ?? defaults.loading
    ?? null;
}

export function buildCommandRegistry(
  specs: CommandSpec[] | null,
  pluginRegistry: Map<string, PluginEntry>,
  defaults: CommandDefaults = {
    notifyChanges:    true,
    notifyPeriodDays: 7,
    notifyMessage:    null,
  },
  menu: MenuConfig = { ...DEFAULT_MENU_CONFIG },
  categories: Record<string, CategoryConfig> = {},
  manuals: Record<string, LocalizedString> = {},
  loadingPresets: Record<string, LoadingSpec> = {},
  categoryLoading: Record<string, LoadingSpec> = {},
  prefix: string | null = null
): CommandRegistry {
  const byId = new Map<string, CommandEntry>();
  const byInvocation = new Map<string, string>();

  const defaultsByKey = new Map<string, PluginDefaultEntry>();

  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active") continue;
    if (!plugin.commands) continue;

    for (const [fn, def] of Object.entries(plugin.commands)) {
      const id = pluginCommandKey(plugin.name, fn);

      // Only a genuinely broken export (not a function and not an
      // object at all) is unusable no matter what commands.yaml says
      // later — that's the one case worth a warning + a full skip.
      if (!isUsablePluginCommandExport(def)) {
        logger.warn(
          t("system.commandRegistryInvalidPluginCommand", {
            id,
            plugin: plugin.name,
            function: fn
          })
        );
        continue;
      }

      const norm = normalizePluginCommand(def);

      // Remembered regardless of whether the plugin gave it a `cmd` —
      // a "pure function" export (bare handler, no built-in identity)
      // is only reachable once a commands.yaml entry supplies `cmd`,
      // but it still needs to be findable by pluginCommandKey() below.
      // A malformed `cmd` (present but not a usable string) also lands
      // here silently — not an error, just no auto-registration.
      defaultsByKey.set(id, { plugin, fn, norm });

      if (!norm.cmd) continue; // no built-in identity — yaml-only until overridden

      const manual = norm.manual ?? manuals[id] ?? manuals[norm.cmd] ?? null;
      const category = norm.category;

      const entry: CommandEntry = {
        id,
        cmd: norm.cmd,
        aliases:    norm.aliases,
        desc:       norm.desc,
        category,
        group:      null,
        manual,
        source:     "plugin",
        pluginName: plugin.name,
        function:   fn,
        functions:  [fn],
        loading:    resolveLoadingChain(null, category, categoryLoading, defaults),
        handler:    norm.handler,
        text:       null,
        permissions: resolvePermissions(null, null, norm.permissions, defaults.permissions, defaults.messages, category ? categories[category]?.scope : null),
        arguments:  [],
        subcommands: {},
        categoryHiddenInScope: null,
        hiddenOutsideScope: null,
      };
      entry.hiddenOutsideScope = entry.permissions.hiddenOutsideScope;
      byId.set(id, entry);
    }
  }

  if (specs) {
    for (const spec of specs) {
      const primaryFn = spec.functions[0] ?? null;
      if (spec.plugin && primaryFn) {
        const key = pluginCommandKey(spec.plugin, primaryFn);
        const pluginDefault = defaultsByKey.get(key);

        if (!pluginDefault) {
          logger.warn(
            t("system.commandRegistryOrphanEntry", {
              id: spec.id,
              plugin: spec.plugin,
              function: primaryFn
            })
          );
          continue;
        }

        const norm = pluginDefault.norm;
        let existing = byId.get(key);

        if (!existing) {
          // Pure-function plugin export: no auto-registered entry yet
          // (norm.cmd was null), so commands.yaml is the sole source of
          // `cmd`. Without it there's nothing to invoke this command by.
          const cmd = spec.cmd;
          if (!cmd) {
            logger.warn(
              t("system.commandRegistryOrphanEntry", {
                id: spec.id,
                plugin: spec.plugin,
                function: primaryFn
              })
            );
            continue;
          }
          existing = {
            id: key,
            cmd,
            aliases: [],
            desc: null,
            category: null,
            group: null,
            manual: null,
            source: "plugin",
            pluginName: spec.plugin,
            function: primaryFn,
            functions: [primaryFn],
            loading: resolveLoadingChain(spec.loading, null, categoryLoading, defaults),
            handler: norm.handler,
            text: null,
            permissions: resolvePermissions(null, null, null, defaults.permissions, defaults.messages, null),
            arguments: [],
            subcommands: {},
            categoryHiddenInScope: null,
            hiddenOutsideScope: null,
          };
          existing.hiddenOutsideScope = existing.permissions.hiddenOutsideScope;
          byId.set(key, existing);
        }

        if (spec.cmd)        existing.cmd      = spec.cmd;
        if (spec.aliases.length > 0) existing.aliases = [...spec.aliases];
        if (spec.desc)       existing.desc     = spec.desc;
        if (spec.category)   existing.category = spec.category;
        if (spec.group !== null) existing.group = spec.group;

        existing.manual = spec.manual ?? norm.manual ?? manuals[spec.id] ?? manuals[existing.cmd] ?? null;

        existing.permissions = resolvePermissions(
          spec.permissions,
          spec.messages,
          norm.permissions,
          defaults.permissions,
          defaults.messages,
          existing.category ? categories[existing.category]?.scope : null
        );

        // Function chain: explicit `functions:` wins; fall back to the
        // single primary if the YAML only declared `function:` /
        // `plugin:` shorthand. Empty list intentionally means "no
        // handlers" — see `CommandSpec.functions` doc.
        if (spec.functions.length > 0) existing.functions = [...spec.functions];
        else if (primaryFn) existing.functions = [primaryFn];

        existing.arguments = [...spec.arguments];
        existing.categoryHiddenInScope = resolveCategoryHiddenInScope(existing.category, categories);
        existing.hiddenOutsideScope = existing.permissions.hiddenOutsideScope;
        existing.loading = resolveLoadingChain(spec.loading, existing.category, categoryLoading, defaults);
        existing.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          existing,
          spec.plugin,
          defaultsByKey,
          defaults,
          manuals,
          loadingPresets
        );
      } else if (spec.plugin && spec.functions.length === 0 && spec.subcommands.length > 0) {
        // Parent-only container: the top-level entry has no handler of
        // its own (e.g. `todo:`), it just groups subcommands that each
        // declare their own `function:`. Never dispatched directly —
        // resolveDispatch() always routes into one of `subcommands`.
        const id = `parent::${spec.id}`;

        const entry: CommandEntry = {
          id,
          cmd:        spec.cmd,
          aliases:    [...spec.aliases],
          desc:       spec.desc,
          category:   spec.category ?? null,
          group:      spec.group,
          manual:     spec.manual ?? manuals[spec.id] ?? manuals[spec.cmd] ?? null,
          source:     "plugin",
          pluginName: spec.plugin,
          function:   null,
          functions:  [],
          loading:    resolveLoadingChain(spec.loading, spec.category ?? null, categoryLoading, defaults),
          handler:    null,
          text:       null,
          permissions: resolvePermissions(
            spec.permissions,
            spec.messages,
            null,
            defaults.permissions,
            defaults.messages,
            spec.category ? categories[spec.category]?.scope : null
          ),
          arguments:  [...spec.arguments],
          subcommands: {},
          categoryHiddenInScope: resolveCategoryHiddenInScope(spec.category, categories),
          hiddenOutsideScope: resolvePermissions(
            spec.permissions, spec.messages, null,
            defaults.permissions, defaults.messages,
            spec.category ? categories[spec.category]?.scope : null
          ).hiddenOutsideScope,
        };

        entry.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          entry,
          spec.plugin,
          defaultsByKey,
          defaults,
          manuals,
          loadingPresets
        );

        byId.set(id, entry);
      } else if (!spec.plugin) {
        if (!spec.text) {
          logger.warn(
            t("system.commandRegistryInvalidEntry", {
              id: spec.id
            })
          );
          continue;
        }

        const id = `text::${spec.id}`;
        const manual = spec.manual ?? manuals[spec.id] ?? manuals[spec.cmd] ?? null;

        const entryPerms = resolvePermissions(
          spec.permissions,
          spec.messages,
          null,
          defaults.permissions,
          defaults.messages,
          spec.category ? categories[spec.category]?.scope : null
        );

        const entry: CommandEntry = {
          id,
          cmd:        spec.cmd,
          aliases:    [...spec.aliases],
          desc:       spec.desc,
          category:   spec.category ?? null,
          group:      spec.group,
          manual,
          source:     "text",
          pluginName: null,
          function:   null,
          functions:  [],
          loading:    resolveLoadingChain(spec.loading, spec.category ?? null, categoryLoading, defaults),
          handler:    null,
          text:       spec.text,
          permissions: entryPerms,
          arguments:  [...spec.arguments],
          subcommands: {},
          categoryHiddenInScope: resolveCategoryHiddenInScope(spec.category, categories),
          hiddenOutsideScope: entryPerms.hiddenOutsideScope,
        };

        entry.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          entry,
          null,
          defaultsByKey,
          defaults,
          manuals,
          loadingPresets
        );

        byId.set(id, entry);
      } else {
        // spec.plugin set, but neither `function:` nor a non-empty
        // `subcommands:` block — nothing tells the kernel what to run.
        logger.warn(
          t("system.commandRegistryInvalidEntry", {
            id: spec.id
          })
        );
      }
    }
  }

  for (const entry of byId.values()) {
    registerInvocationWithDeprecationGuard(byInvocation, entry.cmd, entry.id, false, defaults.notifyChanges);
    for (const alias of entry.aliases) {
      registerInvocationWithDeprecationGuard(byInvocation, alias, entry.id, false, defaults.notifyChanges);
    }
  }

  // Validate menu cmd + aliases against command invocations
  const menuAliases = new Set<string>();
  const menuInvocations = [menu.cmd, ...menu.aliases.filter(a => a !== menu.cmd)];
  for (const alias of menuInvocations) {
    const existing = byInvocation.get(alias);
    if (existing !== undefined) {
      logger.warn(
        t("system.commandRegistryMenuAliasCollision", {
          alias,
          winner: existing
        })
      );
    } else {
      menuAliases.add(alias);
    }
  }

  return { byId, byInvocation, defaults, menu, menuAliases, categories, manuals, loadingPresets, categoryLoading, prefix };
}

let currentRegistry: CommandRegistry | null = null;

export async function initCommandRegistry(): Promise<CommandRegistry> {
  const config = await loadCommandsConfig(new Set(pluginRegistry.keys()));
  const defaults = config?.defaults ?? {
    notifyChanges:    true,
    notifyPeriodDays: 7,
    notifyMessage:    null,
  };
  const menu = config?.menu ?? { ...DEFAULT_MENU_CONFIG };
  const categories = config?.categories ?? {};
  const manuals = config?.manuals ?? {};
  const loadingPresets = config?.loadingPresets ?? {};
  const categoryLoading = config?.categoryLoading ?? {};
  const prefix = config?.prefix ?? null;
  const specs = config?.specs ?? [];

  const registry = buildCommandRegistry(
    specs, pluginRegistry, defaults, menu, categories, manuals,
    loadingPresets, categoryLoading, prefix
  );
  syncCommandHistory(registry.byId, defaults, specs);
  currentRegistry = registry;
  return registry;
}

export function getCommandRegistry(): CommandRegistry | null {
  return currentRegistry;
}

/**
 * Test-only: inject a registry built with {@link buildCommandRegistry}
 * directly, bypassing `initCommandRegistry()`'s disk config + real
 * `pluginRegistry` load. Lets `runCommand.test.ts` exercise
 * `resolveDispatch()`/`runCommand()`, which read the module-singleton
 * `currentRegistry` and have no injectable-registry parameter (unlike
 * `commandAccess.ts`'s functions). Pass `null` to reset.
 */
export function __setRegistryForTests(registry: CommandRegistry | null): void {
  currentRegistry = registry;
}

export function getCommandByInvocation(command: string): CommandEntry | null {
  if (!currentRegistry) return null;
  const id = currentRegistry.byInvocation.get(command);
  if (id === undefined) return null;
  return currentRegistry.byId.get(id) ?? null;
}

