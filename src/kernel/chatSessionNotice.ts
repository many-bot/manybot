/**
 * kernel/chatSessionNotice.ts
 *
 * Friendly reply sent when a chat's open exclusive session (Phase 7,
 * MANYBOT-6.md) blocks a *different* plugin's recognized command from
 * running. Kept separate from chatSession.ts itself, which is a pure
 * lock primitive with no config/i18n dependency.
 */

import { CONFIG } from "#config";
import { tFor } from "#i18n";
import { getChatLocale } from "./chatOverrides.js";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

/**
 * Renders the "a command/session is already running" notice for `chatId`.
 * `holderPlugin` is the plugin currently holding the session — exposed as
 * an optional `{{plugin}}` placeholder for a customized SESSION_LOCKED_MESSAGE.
 */
export function renderSessionLockedMessage(chatId: string, holderPlugin: string): string {
  const custom = CONFIG.SESSION_LOCKED_MESSAGE.trim();
  if (custom) return interpolate(custom, { plugin: holderPlugin });
  return tFor(getChatLocale(chatId), "chatSession.locked", { plugin: holderPlugin });
}
