/**
 * kernel/chatOverrides.ts
 *
 * Per-chat overrides for the bot's global command prefix and language,
 * set via `!config prefixo` / `!config idioma` (see coreCommands.ts).
 * Both are stored under the "core" plugin namespace in settingsDb —
 * the same storage plugins use via `ctx.settings`, keyed by the same
 * `normalizeJid(msg.chatId)` that `buildApi()` uses to scope
 * `ctx.settings` — so a value written here is read back under the
 * exact same key it was written under.
 *
 * Kept as a standalone leaf module (only #config, jid utils, and
 * settingsDb as deps) so it can be imported from anywhere in the
 * dispatch pipeline (api/index.ts, messageHandler.ts, runCommand.ts,
 * coreCommands.ts) without risking an import cycle.
 */

import { getPluginSetting, buildSettingsApi } from "./settingsDb.js";
import { getCurrentLang, getAvailableLocales, normalizeLocale } from "#i18n";
import { normalizeJid } from "#drivers/jid.js";
import { CMD_PREFIX } from "#config";

const CORE_PLUGIN = "core";

/**
 * Resolves the effective command prefix for a chat: the chat's saved
 * override (`!config prefixo`) if one was set, else the global
 * `CMD_PREFIX`.
 *
 * @param chatId - the *raw* chat id (e.g. `msg.chatId`), not yet
 *   normalized — this function normalizes it itself so callers don't
 *   have to know which normalization the settings layer expects.
 */
export function getChatPrefix(chatId: string): string {
  const override = getPluginSetting(CORE_PLUGIN, normalizeJid(chatId), "chat_prefix");
  return typeof override === "string" && override.length > 0 ? override : CMD_PREFIX;
}

/**
 * Resolves the effective language code for a chat: the chat's saved
 * override (`!config idioma`) if one was set, else `undefined` so the
 * caller can fall back to the global language (`getCurrentLang()` /
 * plain `t()`).
 *
 * @param chatId - the *raw* chat id (e.g. `msg.chatId`); normalized
 *   internally, same as {@link getChatPrefix}.
 */
export function getChatLocale(chatId: string): string | undefined {
  return normalizeLocale(getPluginSetting(CORE_PLUGIN, normalizeJid(chatId), "chat_locale") as string | undefined);
}

/**
 * Effective language for a chat: its saved override, else the bot's
 * default (`CONFIG.LANGUAGE`). Always returns a supported locale code.
 */
export function resolveChatLang(chatId?: string | null): string {
  return (chatId ? getChatLocale(chatId) : undefined) ?? getCurrentLang();
}

/**
 * Saves the language for a chat. Accepts regional codes ("pt-BR" → "pt").
 * @returns the stored (normalized) locale code
 * @throws {RangeError} when no translation file matches `lang`
 */
export function setChatLocale(chatId: string, lang: string): string {
  const locale = normalizeLocale(lang);
  if (!locale) {
    throw new RangeError(`Unsupported locale "${lang}". Available: ${getAvailableLocales().join(", ")}`);
  }
  buildSettingsApi(CORE_PLUGIN, normalizeJid(chatId)).set("chat_locale", locale);
  return locale;
}

/** Removes the chat's override so it follows the bot's default language again. */
export function clearChatLocale(chatId: string): void {
  buildSettingsApi(CORE_PLUGIN, normalizeJid(chatId)).delete("chat_locale");
}

