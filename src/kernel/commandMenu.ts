/**
 * commandMenu.ts
 *
 * Menu system for ManyBot (overview, category, manual, not-found).
 */

import { CMD_PREFIX } from "#config";
import { getCurrentLang, tFor } from "#i18n";
import { buildSettingsApi } from "./settingsDb.js";
import type { CommandRegistry, CommandEntry } from "./commandRegistry.js";
import type { LocalizedString } from "./commandsConfig.js";

/**
 * Checks if the user should be shown the welcome message,
 * and marks them as seen if so.
 */
export function checkAndTriggerWelcomeMessage(
  userId: string,
  registry: CommandRegistry,
  lang?: string
): string | null {
  if (!registry.menu.welcomeMessage) return null;

  const settings = buildSettingsApi("kernel", userId);
  const lastSeen = settings.get("last_welcome_seen") as number | undefined;
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = (registry.menu.welcomeWindowDays || 3) * 86400;

  if (!lastSeen || now - lastSeen > windowSeconds) {
    settings.set("last_welcome_seen", now);
    const rawMsg = resolveLocalizedString(registry.menu.welcomeMessage, lang);
    if (!rawMsg) return null;
    return rawMsg.replace(/\{prefix\}/g, CMD_PREFIX);
  }

  return null;
}

/**
 * Resolves a LocalizedString (string | Record<string, string>) to a single
 * string for the requested language (or system language), falling back to
 * English or the first available string.
 */
export function resolveLocalizedString(
  raw: LocalizedString | null | undefined,
  lang?: string
): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const targetLang = (lang || getCurrentLang()).toLowerCase();
    if (typeof raw[targetLang] === "string") return raw[targetLang];
    if (typeof raw.en === "string") return raw.en;
    if (typeof raw.pt === "string") return raw.pt;
    if (typeof raw.es === "string") return raw.es;
    const values = Object.values(raw);
    if (values.length > 0 && typeof values[0] === "string") return values[0];
  }
  return null;
}

export function renderOverview(
  registry: CommandRegistry,
  lang?: string,
  page?: number,
  scope?: "group" | "dm"
): string {
  const parts: string[] = [];

  const titleStr = resolveLocalizedString(registry.menu.title, lang) ?? "🤖 ManyBot — Menu";
  parts.push(`*${titleStr}*`);

  const rawIntro = resolveLocalizedString(registry.menu.intro, lang) ??
    tFor(lang, "menu.intro") as string;
  const introStr = rawIntro.replace(/\{prefix\}/g, CMD_PREFIX);
  parts.push(introStr);
  parts.push(""); // blank line before categories/commands

  const allEntries = Array.from(registry.byId.values());
  const categories = Object.entries(registry.categories);
  const pageSize = registry.menu.pageSize ?? 15;

  if (categories.length > 0) {
    // Sort defined categories by order ascending
    const sortedCategories = categories.sort((a, b) => a[1].order - b[1].order);
    const assignedIds = new Set<string>();

    for (const [catKey, catConfig] of sortedCategories) {
      if (scope && catConfig.scope && catConfig.scope !== scope) {
        continue;
      }

      const entries = allEntries
        .filter(e => e.category === catKey)
        .filter(e => {
          if (!scope) return true;
          if (e.categoryHiddenInScope && e.categoryHiddenInScope === scope) return false;
          if (e.hiddenOutsideScope && e.hiddenOutsideScope !== "any" && e.hiddenOutsideScope !== scope) return false;
          return true;
        })
        .sort((a, b) => a.cmd.localeCompare(b.cmd));

      if (entries.length === 0) continue;

      const catLabel = resolveLocalizedString(catConfig.label, lang) ?? catKey;
      parts.push(`📁 *${catLabel}*`);

      for (const entry of entries) {
        assignedIds.add(entry.id);
        const descStr = resolveLocalizedString(entry.desc, lang);
        if (descStr) {
          parts.push(`  • ${CMD_PREFIX}${entry.cmd} — ${descStr}`);
        } else {
          parts.push(`  • ${CMD_PREFIX}${entry.cmd}`);
        }
      }
      parts.push("");
    }

    // Uncategorized entries
    const uncategorized = allEntries
      .filter(e => !assignedIds.has(e.id))
      .filter(e => {
        if (!scope) return true;
        if (e.categoryHiddenInScope && e.categoryHiddenInScope === scope) return false;
        if (e.hiddenOutsideScope && e.hiddenOutsideScope !== "any" && e.hiddenOutsideScope !== scope) return false;
        return true;
      })
      .sort((a, b) => a.cmd.localeCompare(b.cmd));

    if (uncategorized.length > 0) {
      const otherLabel = tFor(lang, "menu.other") as string;
      parts.push(`📁 *${otherLabel}*`);
      for (const entry of uncategorized) {
        const descStr = resolveLocalizedString(entry.desc, lang);
        if (descStr) {
          parts.push(`  • ${CMD_PREFIX}${entry.cmd} — ${descStr}`);
        } else {
          parts.push(`  • ${CMD_PREFIX}${entry.cmd}`);
        }
      }
      parts.push("");
    }
  } else {
    // Flat command list with pagination
    const filteredEntries = allEntries.filter(e => {
      if (!scope) return true;
      if (e.categoryHiddenInScope && e.categoryHiddenInScope === scope) return false;
      if (e.hiddenOutsideScope && e.hiddenOutsideScope !== "any" && e.hiddenOutsideScope !== scope) return false;
      return true;
    });
    const startIdx = page ? (page - 1) * pageSize : 0;
    const visibleEntries = filteredEntries.slice(startIdx, startIdx + pageSize);
    for (const entry of visibleEntries) {
      const descStr = resolveLocalizedString(entry.desc, lang);
      if (descStr) {
        parts.push(`• ${CMD_PREFIX}${entry.cmd} — ${descStr}`);
      } else {
        parts.push(`• ${CMD_PREFIX}${entry.cmd}`);
      }
    }
    parts.push("");
  }

  const footerStr = resolveLocalizedString(registry.menu.footer, lang);
  if (footerStr) {
    parts.push(footerStr.replace(/\{prefix\}/g, CMD_PREFIX));
  }

  return parts.join("\n").trim();
}

export function renderCategory(
  registry: CommandRegistry,
  categoryKey: string,
  lang?: string,
  scope?: "group" | "dm"
): string | null {
  const normTarget = categoryKey.trim().toLowerCase();

  // Match category key or category label
  let matchedKey: string | null = null;
  let matchedLabel: string | null = null;

  for (const [catKey, catConfig] of Object.entries(registry.categories)) {
    if (scope && catConfig.scope && catConfig.scope !== scope) {
      continue;
    }
    const labelStr = resolveLocalizedString(catConfig.label, lang) ?? catKey;
    if (catKey.toLowerCase() === normTarget || labelStr.toLowerCase() === normTarget) {
      matchedKey = catKey;
      matchedLabel = labelStr;
      break;
    }
  }

  if (!matchedKey) {
    // Try matching if any command has entry.category === categoryKey
    const hasCategoryInEntries = Array.from(registry.byId.values()).some(e => e.category?.toLowerCase() === normTarget);
    if (hasCategoryInEntries) {
      matchedKey = categoryKey;
      matchedLabel = categoryKey;
    } else {
      return null; // Category not found
    }
  }

  // If we have a scope and the matched category has a scope that doesn't match, return null
  if (scope && matchedKey && registry.categories[matchedKey]?.scope && registry.categories[matchedKey]!.scope !== scope) {
    return null;
  }

  const entries = Array.from(registry.byId.values())
    .filter(e => e.category?.toLowerCase() === matchedKey!.toLowerCase())
    .filter(e => {
      if (!scope) return true;
      // If entry has a specific scope defined and it doesn't match the requested scope, exclude it
      if (e.categoryHiddenInScope && e.categoryHiddenInScope === scope) return false;
      if (e.hiddenOutsideScope && e.hiddenOutsideScope !== "any" && e.hiddenOutsideScope !== scope) return false;
      return true;
    })
    .sort((a, b) => a.cmd.localeCompare(b.cmd));

  if (entries.length === 0) return null;

  const parts: string[] = [];
  parts.push(`📁 *${tFor(lang, "menu.category") as string}: ${matchedLabel}*`);
  parts.push("");

  for (const entry of entries) {
    const descStr = resolveLocalizedString(entry.desc, lang);
    if (descStr) {
      parts.push(`• ${CMD_PREFIX}${entry.cmd} — ${descStr}`);
    } else {
      parts.push(`• ${CMD_PREFIX}${entry.cmd}`);
    }
  }

  return parts.join("\\n").trim();
}

export function renderManual(entry: CommandEntry, registry: CommandRegistry, lang?: string): string {
  const parts: string[] = [];

  parts.push(`📖 *${tFor(lang, "menu.manual") as string}: ${CMD_PREFIX}${entry.cmd}*`);

  if (entry.aliases.length > 0) {
    parts.push(`*Aliases:* ${entry.aliases.map(a => CMD_PREFIX + a).join(", ")}`);
  }

  if (entry.category && registry.categories[entry.category]) {
    const catLabel = resolveLocalizedString(registry.categories[entry.category].label, lang) ?? entry.category;
    parts.push(`*${tFor(lang, "menu.category") as string}:* ${catLabel}`);
  }

  parts.push("");

  const descStr = resolveLocalizedString(entry.desc, lang);
  if (descStr) {
    parts.push(`*${tFor(lang, "menu.description") as string}:* ${descStr}`);
    parts.push("");
  }

  const manualStr = resolveLocalizedString(entry.manual, lang);
  if (manualStr) {
    parts.push(manualStr);
  } else {
    parts.push(tFor(lang, "system.commandManualMissing", { cmd: entry.cmd }) as string);
  }

  return parts.join("\n").trim();
}

export function renderNotFound(invocation: string, registry: CommandRegistry, lang?: string): string {
  const menuCmd = registry.menu.cmd;
  return tFor(lang, "system.commandNotFound", { cmd: invocation, prefix: CMD_PREFIX, menuCmd }) as string;
}

export function handleMenuCommand(
  command: string,
  rawArgs: string,
  registry: CommandRegistry,
  lang?: string,
  scope?: "group" | "dm"
): string {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return renderOverview(registry, lang, undefined, scope);
  }

  // Check if rawArgs is a page number or starts with "page <number>"
  const pageMatch = trimmed.match(/^(?:page\s+)?(\d+)$/i);
  if (pageMatch) {
    const pageNum = parseInt(pageMatch[1], 10);
    return renderOverview(registry, lang, pageNum, scope);
  }

  const arg1 = trimmed.split(/\s+/)[0].toLowerCase();
  const cleanArg = arg1.startsWith(CMD_PREFIX) ? arg1.slice(CMD_PREFIX.length) : arg1;

  // 1. Match category
  const categoryResult = renderCategory(registry, cleanArg, lang, scope);
  if (categoryResult) {
    return categoryResult;
  }

  // 2. Match command entry
  const entryId = registry.byInvocation.get(cleanArg);
  const entry = entryId ? registry.byId.get(entryId) : null;
  if (entry) {
    return renderManual(entry, registry, lang);
  }

  // 3. Fallback not-found
  return renderNotFound(cleanArg, registry, lang);
}

