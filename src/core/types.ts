/**
 * core/types.ts
 *
 * Common domain models shared across core, drivers, and plugin boundaries.
 */

export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  kind?: "group" | "direct";
  raw?: any;
}

export interface Contact {
  id: string;
  name: string;
  pushName?: string;
  isBot?: boolean;
  raw?: any;
}

export interface Participant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
}

export interface IncomingMessage {
  id: string;
  chatId: string;
  senderId: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  quotedMessageId?: string;
  mentions?: string[];
  type?: string; 
  hasMedia?: boolean;
  hasImage?: boolean;
  hasVideo?: boolean;
  hasSticker?: boolean;
  hasDocument?: boolean;
  hasAudio?: boolean;
  raw?: any;
}

export interface SendOptions {
  quotedMessageId?: string;
  mentions?: string[];
  extra?: Record<string, any>;
}

export type MediaType = "image" | "video" | "audio" | "document" | "sticker";

export interface MediaSendOptions extends SendOptions {
  caption?: string;
  fileName?: string;
  mimeType?: string;
}
