/**
 * src/types.ts
 *
 * Shared WhatsApp-facing types, imported everywhere as "#types" (see
 * tsconfig.json paths / package.json imports). Kept as a single module so
 * call sites don't need to know whether a type comes straight from
 * Baileys or from ManyBot's own store/adapter layer.
 *
 * Types that are only meaningful within the plugin-API builder itself
 * (the shape of `ctx`, `ctx.msg`, the chainable sender returned by
 * ctx.send/ctx.msg.reply, etc.) are NOT defined here — they're inferred
 * with `ReturnType<typeof ...>` right next to the functions that build
 * them, in drivers/whatsapp/api/index.ts, to avoid circular type
 * definitions.
 */

import type { WASocket as BaileysWASocket, WAMessage } from "@whiskeysockets/baileys";
import type { BotStore } from "#client/store.js";

export type WASocket = BaileysWASocket;
export type WAStore = BotStore;

/** A single incoming/outgoing Baileys message. */
export type WAProtoMsg = WAMessage;

export type { proto } from "@whiskeysockets/baileys";

/** Contact metadata as tracked by the in-memory store (client/store.ts). */
export interface WAStoreContact {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

/**
 * Minimal chat shape passed into the plugin API's `ctx.chat`. Built from a
 * raw Baileys message + the store by buildChatFromMsg() in
 * drivers/whatsapp/api/index.ts.
 */
export interface WAChat {
  id: { _serialized: string; user: string };
  name: string;
  isGroup: boolean;
}
