/**
 * drivers/whatsapp/adapter.ts
 *
 * Implements PlatformAdapter on top of the existing Baileys socket/store.
 * This wraps current behavior unchanged - no Baileys logic moved or
 * rewritten, just exposed through the generic contract.
 */

import { createSocket, normalizeJid }        from "#client/baileysSock";
import type { WASocket, WAStore, WAProtoMsg } from "#types";
import { CapabilitySet }                      from "#core/capabilities";
import type { PlatformAdapter }               from "#core/adapter";
import type { Chat, Contact, Participant, IncomingMessage,
              SendOptions, MediaSendOptions, MediaType } from "#core/types";

function toIncomingMessage(msg: WAProtoMsg): IncomingMessage {
  const rawJid = msg.key.remoteJid ?? "";
  return {
    id:       msg.key.id ?? "",
    chatId:   normalizeJid(rawJid),
    senderId: normalizeJid(msg.key.participant ?? rawJid),
    body:     msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? "",
    type:     Object.keys(msg.message ?? {})[0] ?? "unknown",
    hasMedia: Boolean(msg.message?.imageMessage || msg.message?.videoMessage
                    || msg.message?.audioMessage || msg.message?.stickerMessage),
    raw:      msg,
  };
}

export class WhatsAppAdapter implements PlatformAdapter {
  readonly id = "whatsapp";
  readonly capabilities = new CapabilitySet([
    "media", "reactions", "groupAdmin", "polls", "presence", "viewOnce",
  ]);

  private sock!:  WASocket;
  private store!: WAStore;
  private messageHandlers = new Set<(msg: IncomingMessage) => void>();

  async connect(): Promise<void> {
    const bundle = await createSocket();
    this.sock  = bundle.sock;
    this.store = bundle.store;

    this.sock.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        const incoming = toIncomingMessage(msg as WAProtoMsg);
        for (const handler of this.messageHandlers) handler(incoming);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.sock.end(undefined);
  }

  normalizeId(rawId: string): string {
    return normalizeJid(rawId);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  async sendText(chatId: string, text: string, options?: SendOptions): Promise<IncomingMessage> {
    const quoted = options?.quotedMessageId
      ? this.store.messages.get(chatId)?.get(options.quotedMessageId)
      : undefined;
    const sent = await this.sock.sendMessage(chatId, { text }, { quoted });
    return toIncomingMessage(sent as WAProtoMsg);
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    const msg = this.store.messages.get(chatId)?.get(messageId);
    if (!msg) return;
    await this.sock.sendMessage(chatId, { delete: msg.key });
  }

  async getChat(chatId: string): Promise<Chat> {
    const stored = this.store.chats.get(chatId);
    return {
      id:   chatId,
      kind: chatId.endsWith("@g.us") ? "group" : "direct",
      name: stored?.name ?? chatId.split("@")[0],
    };
  }

  async getContact(contactId: string): Promise<Contact> {
    const info = this.store.contacts[contactId];
    return {
      id:       contactId,
      name:     info?.name ?? info?.verifiedName ?? null,
      pushName: info?.notify ?? null,
    };
  }

  async sendMedia(chatId: string, type: MediaType, buffer: Buffer, options?: MediaSendOptions): Promise<IncomingMessage> {
    const payload = { [type]: buffer, caption: options?.caption };
    const sent = await this.sock.sendMessage(chatId, payload as Parameters<typeof this.sock.sendMessage>[1]);
    return toIncomingMessage(sent as WAProtoMsg);
  }

  async sendReaction(chatId: string, messageId: string, emoji: string): Promise<void> {
    const msg = this.store.messages.get(chatId)?.get(messageId);
    if (!msg) return;
    await this.sock.sendMessage(chatId, { react: { text: emoji, key: msg.key } });
  }

  async getGroupParticipants(chatId: string): Promise<Participant[]> {
    const meta = await this.sock.groupMetadata(chatId);
    return meta.participants.map((p) => ({
      id:           normalizeJid(p.id),
      isAdmin:      p.admin === "admin" || p.admin === "superadmin",
      isSuperAdmin: p.admin === "superadmin",
    }));
  }

  async addParticipants(chatId: string, userIds: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(chatId, userIds, "add");
  }

  async removeParticipants(chatId: string, userIds: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(chatId, userIds, "remove");
  }

  async promoteParticipants(chatId: string, userIds: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(chatId, userIds, "promote");
  }

  async demoteParticipants(chatId: string, userIds: string[]): Promise<void> {
    await this.sock.groupParticipantsUpdate(chatId, userIds, "demote");
  }

  async updateGroupSubject(chatId: string, subject: string): Promise<void> {
    await this.sock.groupUpdateSubject(chatId, subject);
  }

  async setPresence(chatId: string, state: "composing" | "paused"): Promise<void> {
    await this.sock.sendPresenceUpdate(state, chatId);
  }
}
