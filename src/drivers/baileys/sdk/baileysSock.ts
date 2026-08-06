/**
 * baileysSock.ts
 *
 * Creates and returns a Baileys WASocket.
 * Handles auth state persistence, QR/pairing-code display, and reconnection.
 */

import {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    WAProto,
} from "@whiskeysockets/baileys";
import type {
    WASocket as BaileysWASocket,
    WAMessage,
    Chat as BaileysChat,
    Contact as BaileysContact,
    BaileysEventEmitter,
} from "@whiskeysockets/baileys";
import { EventEmitter }     from "events";
import path                 from "path";
import qrcode               from "qrcode-terminal";
import { CONFIG_DIR, CLIENT_ID } from "#config";
import { resolveLoginMethod } from "../loginPrompt.js";
import { logger }           from "#logger";
import { t }                from "#i18n";
import { createStore }      from "#client/store.js";
import pino from "pino";

// ── Driver-local type aliases ────────────────────────────────────────────────
//
// PR1 of the whatsmeow-fallback refactor (see AUDIT_BAILEYS_LEAK.md): every
// type below is the Baileys-shaped type, but re-exported under a driver-local
// name so the rest of the codebase (client/store.ts, kernel/*, the plugin API
// contract) never has to import directly from @whiskeysockets/baileys. The
// only place that does is THIS file — the driver boundary. PR3 will migrate
// call sites one at a time to the driver-neutral types in src/drivers/types.ts.

/** A single incoming/outgoing Baileys WAMessage. */
export type RawMessage = WAMessage;

/** A Baileys Chat (from chats.upsert / messaging-history.set). */
export type RawChat = BaileysChat;

/** A Baileys Contact (from contacts.upsert / contacts.update). */
export type RawContact = BaileysContact;

/** Plain-data contact shape stored in the in-memory store. */
export interface RawStoreContact {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
}

/**
 * The Baileys event emitter that backs `sock.ev`. The store binds directly
 * to this so the store stays a Baileys-internal detail — outside the
 * driver boundary, consume the neutral `WaContract.on(...)` instead.
 */
export type RawEventEmitter = BaileysEventEmitter;

/** The raw Baileys WASocket, exported so the driver-local adapter can wrap
 *  it. Outside src/drivers/baileys/ this type should NOT be used directly —
 *  consume `WaContract` (see src/kernel/waContract.ts) instead. */
export type RawSocket = BaileysWASocket;

/** The store type, kept private to this module. */
type WAStore = ReturnType<typeof createStore>;

/**
 * Public re-export of the store type. Today this is the Baileys-only store;
 * in a later phase the contract will move to a driver-neutral BotStore.
 */
export type { WAStore };

// ── Auth path ─────────────────────────────────────────────────────────────────

// Baileys' sock.ev wraps an internal EventEmitter that no longer exposes
// setMaxListeners (see the comment in createSocket() below) — raised
// globally instead, before makeWASocket() ever constructs one.
EventEmitter.defaultMaxListeners = 50;

export const AUTH_DIR = path.join(CONFIG_DIR, "sessions", CLIENT_ID);

// ── Shared store (survives socket reconnects) ─────────────────────────────────

export const store: WAStore = createStore();

// ── Socket factory ────────────────────────────────────────────────────────────

export interface SocketBundle {
  sock:  RawSocket;
  store: WAStore;
}

/**
 * Create a new Baileys socket with persistent auth and store binding.
 * Reconnection is the caller's responsibility — call createSocket() again
 * on `connection.close`.
 */
export function sessionDir(authDirName: string): string {
  return path.join(CONFIG_DIR, "sessions", authDirName);
}

export async function createSocket(authDirName: string = CLIENT_ID): Promise<SocketBundle> {
  const authDir = sessionDir(authDirName);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version }          = await fetchLatestBaileysVersion();

  // Already-valid session (creds registered in .manybot/sessions) → skips
  // LOGIN_METHOD/PHONE_NUMBER and the interactive login flow entirely, and
  // connects directly. This also avoids reopening QR/pairing on normal
  // reconnects (network drop, etc), since only the FIRST run ever gets
  // here without `registered`.
  const alreadyRegistered = !!(state.creds as { registered?: boolean }).registered;

  const { method, phone } = alreadyRegistered
    ? { method: null as null, phone: null as string | null }
    : await resolveLoginMethod();

  const sock = makeWASocket({
    version,
    auth:                           state,
    printQRInTerminal:              false,
    // Recognized browser signature. A custom name (e.g. "ManyBot") works
    // fine for QR, but WhatsApp rejects phone-number pairing when the
    // browser doesn't match one of the known signatures — resulting in
    // "Couldn't link device" on the phone even with the correct code.
    browser:                        Browsers.ubuntu("Chrome"),
    logger:                         pino({ level: "silent" }) as any,
    generateHighQualityLinkPreview: false,
    syncFullHistory:                false,
    // Without this, Baileys' default for syncFullHistory:false is
    // `() => false`, which disables ALL history sync — not just full
    // messages, but the chat list, contacts, and LID mappings too (see
    // https://github.com/WhiskeySockets/Baileys — SocketConfig docs).
    // This keeps the initial/recent sync (needed for store.chats and
    // LID→phone resolution) while still skipping the full download.
    shouldSyncHistoryMessage:       ({ syncType }) => syncType !== WAProto.HistorySync.HistorySyncType.FULL,
    // Required for Baileys to decrypt incoming poll votes (and to retry
    // sends) — it looks up the original message by key internally.
    // Without this, pollUpdates never resolve even though the vote event
    // arrives: ctx.poll.results()/onVote() silently stay at zero.
    getMessage: async (key) => {
      const stored = store.messages.get(key.remoteJid ?? "")?.get(key.id ?? "");
      return stored?.message ?? undefined;
    },
  }) as RawSocket;

  store.bind(sock.ev);

  // Each plugin's setup() can attach its own listeners via api.events (see
  // buildEventsApi in api/index.ts), on top of the driver's own and the
  // store's. That easily exceeds Node's default cap of 10 with a handful
  // of plugins — it's expected, not a leak. Reconnects don't add to this:
  // createSocket() always returns a fresh emitter and the caller tears
  // down the previous one.
  //
  // Baileys 7.x's sock.ev is a buffered-event wrapper (makeEventBuffer),
  // not a raw EventEmitter — it has no setMaxListeners of its own, so
  // calling it here is a silent no-op. The cap is raised globally instead,
  // via EventEmitter.defaultMaxListeners set at module load (before any
  // socket — and its internal emitter — is created).

  sock.ev.on("creds.update", saveCreds);

  // QR code — only if the chosen method was "qr" (intentionally ignores
  // PHONE_NUMBER even if one was saved from a previous choice).
  let qrDisplayed = false;

  sock.ev.on("connection.update", (update) => {
    const { qr, connection } = update;

    if (qr && method === "qr") {
      qrDisplayed = true;
      logger.info(t("system.qrScan"));
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open" && qrDisplayed) {
      console.clear();
      qrDisplayed = false;
    }
  });

  // Number pairing — only if the chosen method was "phone".
  if (method === "phone" && phone) {
    if (!/^\d{8,15}$/.test(phone)) {
      logger.error(t("system.phoneNumberInvalid", { number: phone }));
      return { sock, store };
    }

    // Allow the socket to handshake before requesting the pairing code
    setTimeout(async () => {
      try {
        const code = await (sock as unknown as {
          requestPairingCode(phone: string): Promise<string>
        }).requestPairingCode(phone);
        logger.info(t("system.pairingCodeTitle"));
        logger.info(t("system.pairingCodeValue", { code }));
        logger.info(t("system.pairingCodeInstructions"));
      } catch (e) {
        logger.error(`[baileysSock] Pairing code request failed: ${(e as Error).message}`);
      }
    }, 3000);
  }

  return { sock, store };
}
