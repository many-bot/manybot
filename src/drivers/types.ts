/**
 * src/drivers/types.ts
 *
 * Driver-neutral envelope types shared by every WhatsApp driver
 * implementation (Baileys today, whatsmeow in a later phase). The
 * full driver surface (send, react, presence, contacts, groups,
 * profile, media) is declared as `WaContract` in `#kernel/waContract.js`
 * — every driver implements it. This module holds only the message
 * shapes that flow across the driver boundary.
 *
 * Plugins depend on these types through the `WaContract` re-exports,
 * never on a specific driver's Baileys/grpc types.
 */

/**
 * Driver-neutral shape of a stored message. Used by getHistory(),
 * delivery verification, and every inbound BotMessage that flows
 * through the kernel. `contentHash` is sha1 of normalized text or
 * media buffer — used as a tiebreaker when the id
 * alone is not reliable.
 *
 * The lean fields (id/chatId/fromMe/type/contentHash/timestamp) are
 * the stable cross-driver envelope. The remaining fields are OPTIONAL
 * — only populated by drivers that can surface them, and only on
 * messages that the adapter converts at the boundary (e.g. Baileys
 * WAMessage → BotMessage in the adapter). They exist so the core
 * (api/index.ts, messageHandler.ts, contactAutoSave.ts) can read
 * consistent data off the neutral message without re-importing each
 * driver's wire format.
 */
export interface BotMessage {
  id:          string;
  chatId:      string;
  fromMe:      boolean;
  type:        "text" | "image" | "video" | "audio" | "sticker" | "document" | "other";
  contentHash: string;
  /** Epoch milliseconds. */
  timestamp:   number;

  // ── Optional fields populated when the driver / adapter can supply them. ──

  /** Plain-text body / caption extracted from the wrapped message. */
  body?: string;
  /** MIME type of the media payload, when `type` is a media kind. */
  mimetype?: string;
  /** Sender's "push name" (the nickname WhatsApp shows for the contact). */
  pushName?: string;
  /** JIDs mentioned in the message text (extracted from contextInfo). */
  mentionedJid?:     string[];
  /** Reference to the message this one is quoting, if any. */
  quotedKey?:        BotQuotedRef;

  // ── LID-mapping hints preserved across the Baileys advisor split. ──
  /** @lid form of the sender's JID, when known. */
  fromLid?:   string;
  /** @s.whatsapp.net form of the sender's JID, when known. */
  fromPn?:    string;
  /** Group-participant @lid form (for group messages). */
  participantAlt?:   string;
  /** Group-remoteJid @lid form (for groups). */
  remoteJidAlt?:     string;

  // ── Driver-specific escape hatch (use sparingly). ──
  /**
   * Underlying driver message object, only for fields the neutral envelope
   * intentionally doesn't model (e.g. Baileys poll-decryption bits, raw
   * messageContextInfo.messageSecret for poll vote decryption). Drivers
   * that don't have a use for this can leave it undefined.
   */
  _raw?: unknown;
}

/**
 * Minimal message key, used by react / edit / delete / quoted. Every
 * driver adapts to/from this neutral shape at its own boundary —
 * Baileys via `proto.IMessageKey`, whatsmeow via its own message-id
 * struct.
 */
export interface BotQuotedRef {
  id?:          string | null;
  remoteJid?:   string | null;
  fromMe?:      boolean | null;
  participant?: string | null;
}

/** Minimal chat shape, driver-neutral. */
export interface BotChat {
  id: string;
  name: string;
  isGroup: boolean;
}

export type ConnState = "connecting" | "open" | "close" | "reconnecting";