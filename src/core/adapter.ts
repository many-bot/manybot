/**
 * core/adapter.ts
 *
 * Contract every messaging driver (whatsapp, discord, telegram, ...)
 * must implement. The kernel talks only to this interface, never to a
 * driver's native client.
 *
 * Required methods must work on every driver. Optional methods are gated
 * by `capabilities.has(...)` before being called - a driver that doesn't
 * support a capability simply omits the method.
 */

import type { CapabilitySet }                                   from "#core/capabilities";
import type { Chat, Contact, Participant, IncomingMessage,
              SendOptions, MediaSendOptions, MediaType }         from "#core/types";

export interface PlatformAdapter {
  readonly id: string; // "whatsapp" | "discord" | "telegram" | ...
  readonly capabilities: CapabilitySet;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Normalizes a raw platform id (jid, snowflake, chat_id) into a stable string. */
  normalizeId(rawId: string): string;

  onMessage(handler: (msg: IncomingMessage) => void): void;
  offMessage(handler: (msg: IncomingMessage) => void): void;

  sendText(chatId: string, text: string, options?: SendOptions): Promise<IncomingMessage>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;

  getChat(chatId: string): Promise<Chat>;
  getContact(contactId: string): Promise<Contact>;

  // ── Optional: requires capabilities.has("media") ──────────────────────────
  sendMedia?(chatId: string, type: MediaType, buffer: Buffer, options?: MediaSendOptions): Promise<IncomingMessage>;

  // ── Optional: requires capabilities.has("reactions") ──────────────────────
  sendReaction?(chatId: string, messageId: string, emoji: string): Promise<void>;

  // ── Optional: requires capabilities.has("groupAdmin") ─────────────────────
  getGroupParticipants?(chatId: string): Promise<Participant[]>;
  addParticipants?(chatId: string, userIds: string[]): Promise<void>;
  removeParticipants?(chatId: string, userIds: string[]): Promise<void>;
  promoteParticipants?(chatId: string, userIds: string[]): Promise<void>;
  demoteParticipants?(chatId: string, userIds: string[]): Promise<void>;
  updateGroupSubject?(chatId: string, subject: string): Promise<void>;

  // ── Optional: requires capabilities.has("presence") ───────────────────────
  setPresence?(chatId: string, state: "composing" | "paused"): Promise<void>;
}

/**
 * Narrow slice of PlatformAdapter used by code that only needs presence
 * simulation. Lets call sites that don't yet hold a full adapter instance
 * (e.g. during incremental migration) build a minimal one inline.
 */
export type PresenceCapable = Pick<PlatformAdapter, "capabilities" | "setPresence">;
