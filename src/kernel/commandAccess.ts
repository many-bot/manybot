/**
 * kernel/commandAccess.ts
 *
 * ctx.commands — read-only registry queries exposed to plugins (Phase 2
 * of MANYBOT-6.md). Lets a plugin check whether another command exists,
 * or read its desc/manual, without ctx.plugins.require()'ing the owning
 * plugin. Primary consumer: many-ai, so it can verify a command before
 * mentioning it instead of hallucinating.
 *
 * Lookups are case-sensitive and unaliased-vs-aliased the same way
 * resolveDispatch() and the menu-alias check in commandRegistry.ts are —
 * keyed exactly as the command/alias was declared, no implicit
 * lowercasing here.
 */

import { getCommandRegistry, type CommandEntry, type CommandRegistry } from "./commandRegistry.js";
import { resolveLocalizedString } from "./commandMenu.js";

export interface CommandListItem {
  id: string;
  cmd: string;
  aliases: string[];
  category: string | null;
  desc: string | null;
}

/**
 * All lookups take an optional explicit `registry` (defaulting to the
 * live singleton via `getCommandRegistry()`) so this module can be unit
 * tested with `buildCommandRegistry(...)` directly, the same convention
 * `commandMenu.ts`'s `renderOverview(registry, lang)` uses.
 */

function resolveEntry(registry: CommandRegistry | null, invocation: string): CommandEntry | null {
  if (!registry) return null;
  const id = registry.byInvocation.get(invocation);
  if (!id) return null;
  return registry.byId.get(id) ?? null;
}

/** Whether `invocation` (a cmd or alias) resolves to a registered command. */
export function exists(invocation: string, registry: CommandRegistry | null = getCommandRegistry()): boolean {
  return resolveEntry(registry, invocation) !== null;
}

/** Localized short description for `invocation`, or null if unknown/unset. */
export function desc(invocation: string, lang?: string, registry: CommandRegistry | null = getCommandRegistry()): string | null {
  const entry = resolveEntry(registry, invocation);
  if (!entry) return null;
  return resolveLocalizedString(entry.desc, lang);
}

/** Localized manual text for `invocation`, falling back to `desc`. */
export function manual(invocation: string, lang?: string, registry: CommandRegistry | null = getCommandRegistry()): string | null {
  const entry = resolveEntry(registry, invocation);
  if (!entry) return null;
  return resolveLocalizedString(entry.manual, lang) ?? resolveLocalizedString(entry.desc, lang);
}

/** All registered top-level commands, one entry per stable id. */
export function list(lang?: string, registry: CommandRegistry | null = getCommandRegistry()): CommandListItem[] {
  if (!registry) return [];
  return Array.from(registry.byId.values(), (entry) => ({
    id: entry.id,
    cmd: entry.cmd,
    aliases: [...entry.aliases],
    category: entry.category,
    desc: resolveLocalizedString(entry.desc, lang),
  }));
}

/** Whether `text` is one of the menu command's own aliases (e.g. "menu", "help"). */
export function isMenuAlias(text: string, registry: CommandRegistry | null = getCommandRegistry()): boolean {
  if (!registry) return false;
  return registry.menuAliases.has(text);
}

