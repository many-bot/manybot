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
  messages: {
    botNotAdmin: string;
    senderNotAdmin: string;
    ownerOnly?: string;
    wrongScope: string;
    cooldown: string;
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
  /** Plugin function that implements this sub. Defaults to the parent's function. */
  function: string;
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
   * Plugin function name that implements this entry. Always set for
   * plugin-sourced entries (= the function name in `plugin.commands`);
   * null for text-only entries.
   */
  function: string | null;
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
}

export interface CommandRegistry {
  byId: Map<string, CommandEntry>;
  byInvocation: Map<string, string>;
  defaults: CommandDefaults;
  menu: MenuConfig;
  menuAliases: Set<string>;
  categories: Record<string, CategoryConfig>;
  manuals: Record<string, LocalizedString>;
}

export const DEFAULT_PERMISSION_MESSAGES = {
  botNotAdmin: () => t("commandPermissions.botNotAdmin") as string,
  senderNotAdmin: () => t("commandPermissions.senderNotAdmin") as string,
  ownerOnly: () => t("commandPermissions.ownerOnly") as string,
  wrongScope: () => t("commandPermissions.wrongScope") as string,
  cooldown: () => t("commandPermissions.cooldown") as string,
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
    botNotAdmin: specMsgs?.botNotAdmin ?? defaultsMsgs?.botNotAdmin ?? DEFAULT_PERMISSION_MESSAGES.botNotAdmin(),
    senderNotAdmin: specMsgs?.senderNotAdmin ?? defaultsMsgs?.senderNotAdmin ?? DEFAULT_PERMISSION_MESSAGES.senderNotAdmin(),
    ownerOnly: specMsgs?.ownerOnly ?? defaultsMsgs?.ownerOnly ?? undefined,
    wrongScope: specMsgs?.wrongScope ?? defaultsMsgs?.wrongScope ?? DEFAULT_PERMISSION_MESSAGES.wrongScope(),
    cooldown: specMsgs?.cooldown ?? defaultsMsgs?.cooldown ?? DEFAULT_PERMISSION_MESSAGES.cooldown(),
  };

  return {
    admin,
    botAdmin,
    scope,
    owner,
    cooldownSeconds,
    whitelist,
    blacklist,
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
 * The sub shares the parent's plugin handler function by default; if
 * `spec.function` is set, it overrides the parent's `function` field.
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
  manuals: Record<string, LocalizedString>
): CommandSubcommand {
  const manual = spec.manual ?? manuals[spec.id] ?? null;
  const fnName = spec.function ?? parent.function ?? "";
  // Each sub can point at a *different* plugin function than its
  // siblings (that's the whole point of "add"/"list"/"done" sharing one
  // parent) — resolve this sub's own default permissions from its own
  // function, not from whatever function the parent happens to carry.
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
  manuals: Record<string, LocalizedString>
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
    out[token] = buildSubcommandFromSpec(spec, parent, pluginName, defaultsByKey, defaults, manuals);
  }
  return out;
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
  manuals: Record<string, LocalizedString> = {}
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
        handler:    norm.handler,
        text:       null,
        permissions: resolvePermissions(null, null, norm.permissions, defaults.permissions, defaults.messages, category ? categories[category]?.scope : null),
        arguments:  [],
        subcommands: {},
        categoryHiddenInScope: null,
      };
      byId.set(id, entry);
    }
  }

  if (specs) {
    for (const spec of specs) {
      if (spec.plugin && spec.function) {
        const key = pluginCommandKey(spec.plugin, spec.function);
        const pluginDefault = defaultsByKey.get(key);

        if (!pluginDefault) {
          logger.warn(
            t("system.commandRegistryOrphanEntry", {
              id: spec.id,
              plugin: spec.plugin,
              function: spec.function
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
                function: spec.function
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
            function: spec.function,
            handler: norm.handler,
            text: null,
            permissions: resolvePermissions(null, null, null, defaults.permissions, defaults.messages, null),
            arguments: [],
            subcommands: {},
            categoryHiddenInScope: null,
          };
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

        existing.arguments = [...spec.arguments];
        existing.categoryHiddenInScope = resolveCategoryHiddenInScope(existing.category, categories);
        existing.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          existing,
          spec.plugin,
          defaultsByKey,
          defaults,
          manuals
        );
      } else if (spec.plugin && !spec.function && spec.subcommands.length > 0) {
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
        };

        entry.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          entry,
          spec.plugin,
          defaultsByKey,
          defaults,
          manuals
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
          handler:    null,
          text:       spec.text,
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
        };

        entry.subcommands = buildSubcommandsFromSpecs(
          spec.subcommands,
          entry,
          null,
          defaultsByKey,
          defaults,
          manuals
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

  return { byId, byInvocation, defaults, menu, menuAliases, categories, manuals };
}

let currentRegistry: CommandRegistry | null = null;

export async function initCommandRegistry(): Promise<CommandRegistry> {
  const config = await loadCommandsConfig();
  const defaults = config?.defaults ?? {
    notifyChanges:    true,
    notifyPeriodDays: 7,
    notifyMessage:    null,
  };
  const menu = config?.menu ?? { ...DEFAULT_MENU_CONFIG };
  const categories = config?.categories ?? {};
  const manuals = config?.manuals ?? {};
  const specs = config?.specs ?? [];

  const registry = buildCommandRegistry(specs, pluginRegistry, defaults, menu, categories, manuals);
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

