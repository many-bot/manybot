/**
 * src/types.ts
 *
 * Shared WhatsApp-facing types. Imported everywhere as "#types" (see
 * tsconfig.json paths / package.json imports).
 *
 * IMPORTANT: This file is a thin facade over the Baileys SDK types.
 * The driver-neutral `WaContract` and `BotMessage` types live in
 * `#drivers/types.ts` and `#kernel/waContract.ts`. The core (kernel,
 * pluginApi, pluginLoader, sendGuard, contactAutoSave, messageHandler)
 * is being migrated to consume `WaContract` instead of these aliases.
 * The aliases remain so the few remaining call sites (and the Baileys
 * driver itself) keep compiling while the migration is in progress.
 *
 * After the migration is complete, nothing in the core should import
 * from this file; only the Baileys driver will.
 */

import type { WASocket as BaileysWASocket, WAMessage, Chat as BaileysChat, Contact as BaileysContact } from "@whiskeysockets/baileys";
// WAProto has to come in as a namespace (api/index.ts reads WAProto.IContextInfo,
// WAProto.HistorySync, etc.) — Baileys exports it as `proto`, but we re-export
// it here under the project's existing WAProto name so call sites stay stable.
import { proto } from "@whiskeysockets/baileys";

/** The Baileys WASocket. Today this is what the kernel uses as its sock. */
export type WASocket = BaileysWASocket;

/** A single Baileys message. */
export type WAProtoMsg = WAMessage;

/** The Baileys-generated proto namespace (re-exported under the WAProto name). */
export { proto as WAProto };

/** Minimal chat shape — uses the Baileys `id.{_serialized,user}` form. */
export type WAChat = {
  id: { _serialized: string; user: string };
  name: string;
  isGroup: boolean;
};

/** Plain-data contact metadata in the store. */
export interface WAStoreContact {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

/**
 * The Baileys in-memory store (created via createStore in client/store.ts).
 * Re-exported here so call sites that already import from "#types" keep
 * compiling while the rest of the migration lands. Will go away once
 * the kernel/contactAutoSave, pluginLoader, and messageHandler are ported
 * to consume the driver-neutral BotStore + WaContract directly.
 */
export type WAStore = import("#drivers/baileys/sdk/baileysSock.js").WAStore;
