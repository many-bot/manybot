import type { WAChat } from "#types";
import { normalizeJid } from "#client/baileysSock";

/**
 * Get the serialized (normalized) JID from a WAChat adapter object.
 * @param {WAChat} chat
 * @returns {string}
 */
export function getChatId(chat: WAChat): string {
  return chat.id._serialized;
}

export { normalizeJid };
