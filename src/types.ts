/**
 * types.ts
 *
 * ManyBot domain types for the Baileys adapter layer.
 * Replaces the whatsapp-web.js (#wwjs) types throughout the kernel.
 */

import type { proto, WASocket as BaileysSocket } from "@whiskeysockets/baileys";
import type { BotStore }                         from "#client/store";

export type { proto };
export type WASocket   = BaileysSocket;
export type WAStore    = BotStore;
export type WAProtoMsg = proto.IWebMessageInfo;

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface WAChat {
  id: { _serialized: string; user: string };
  name: string;
  isGroup: boolean;
}

// ── Participant ───────────────────────────────────────────────────────────────

export interface WAParticipant {
  id: { _serialized: string };
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

// ── Store contact shape ───────────────────────────────────────────────────────

export interface WAStoreContact {
  id?: string;
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
}
