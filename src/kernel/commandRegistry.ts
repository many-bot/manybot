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
  type CommandDefaults,
  type CommandSpec,
  type CommandPermissions,
  type CommandMessages,
  type MenuConfig,
  type CategoryConfig,
  type LocalizedString,
} from "./commandsConfig.js";
import { pluginRegistry, type PluginEntry, type PluginCommandDefault } from "./pluginLoader.js";
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
    ownerOnly: string;
    wrongScope: string;
    cooldown: string;
  };
}

export interface CommandEntry {
  id: string;
  cmd: string;
  aliases: string[];
  desc: LocalizedString | null;
  category: string | null;
  manual: LocalizedString | null;
  source: "plugin" | "text";
  pluginName: string | null;
  handler: CommandHandler | null;
  text: LocalizedString | null;
  permissions: ResolvedPermissions;
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
  defaultsMsgs?: CommandMessages | null
): ResolvedPermissions {
  const admin = specPerms?.admin ?? pluginPerms?.admin ?? false;
  const botAdmin = specPerms?.botAdmin ?? pluginPerms?.botAdmin ?? false;
  const scope = specPerms?.scope ?? pluginPerms?.scope ?? "any";
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
    ownerOnly: specMsgs?.ownerOnly ?? defaultsMsgs?.ownerOnly ?? DEFAULT_PERMISSION_MESSAGES.ownerOnly(),
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
  isOverride: boolean
): boolean {
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
  aliases: ["help", "man", "menu", "bot", "?"],
  notFoundFallback: false,
};

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

  const defaultsByKey = new Map<string, { entry: CommandEntry; plugin: PluginEntry; fn: string; def: PluginCommandDefault }>();

  for (const plugin of pluginRegistry.values()) {
    if (plugin.status !== "active") continue;
    if (!plugin.commands) continue;

    for (const [fn, def] of Object.entries(plugin.commands) as Array<[string, PluginCommandDefault]>) {
      const id = pluginCommandKey(plugin.name, fn);
      const manual = def.manual ?? manuals[id] ?? manuals[def.cmd] ?? null;
      const category = def.category ?? null;

      const entry: CommandEntry = {
        id,
        cmd:        def.cmd,
        aliases:    def.aliases ? [...def.aliases] : [],
        desc:       def.desc ?? null,
        category,
        manual,
        source:     "plugin",
        pluginName: plugin.name,
        handler:    def.handler,
        text:       null,
        permissions: resolvePermissions(null, null, def.permissions, defaults.permissions, defaults.messages),
      };
      byId.set(id, entry);
      defaultsByKey.set(id, { entry, plugin, fn, def });
    }
  }

  if (specs) {
    for (const spec of specs) {
      if (spec.plugin && spec.function) {
        const key = pluginCommandKey(spec.plugin, spec.function);
        const existing = byId.get(key);

        if (!existing) {
          logger.warn(
            t("system.commandRegistryOrphanEntry", {
              id: spec.id,
              plugin: spec.plugin,
              function: spec.function
            })
          );
          continue;
        }

        if (spec.cmd)        existing.cmd      = spec.cmd;
        if (spec.aliases.length > 0) existing.aliases = [...spec.aliases];
        if (spec.desc)       existing.desc     = spec.desc;
        if (spec.category)   existing.category = spec.category;

        const pluginDef = defaultsByKey.get(key)?.def;
        existing.manual = spec.manual ?? pluginDef?.manual ?? manuals[spec.id] ?? manuals[existing.cmd] ?? null;

        existing.permissions = resolvePermissions(
          spec.permissions,
          spec.messages,
          pluginDef?.permissions,
          defaults.permissions,
          defaults.messages
        );
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

        byId.set(id, {
          id,
          cmd:        spec.cmd,
          aliases:    [...spec.aliases],
          desc:       spec.desc,
          category:   spec.category ?? null,
          manual,
          source:     "text",
          pluginName: null,
          handler:    null,
          text:       spec.text,
          permissions: resolvePermissions(
            spec.permissions,
            spec.messages,
            null,
            defaults.permissions,
            defaults.messages
          ),
        });
      }
    }
  }

  for (const entry of byId.values()) {
    registerInvocationWithDeprecationGuard(byInvocation, entry.cmd, entry.id, false);
    for (const alias of entry.aliases) {
      registerInvocationWithDeprecationGuard(byInvocation, alias, entry.id, false);
    }
  }

  // Validate menu aliases against command invocations
  const menuAliases = new Set<string>();
  for (const alias of menu.aliases) {
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

export function getCommandByInvocation(command: string): CommandEntry | null {
  if (!currentRegistry) return null;
  const id = currentRegistry.byInvocation.get(command);
  if (id === undefined) return null;
  return currentRegistry.byId.get(id) ?? null;
}
