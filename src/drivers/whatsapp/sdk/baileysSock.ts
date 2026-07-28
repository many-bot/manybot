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
import { Boom }             from "@hapi/boom";
import path                 from "path";
import qrcode               from "qrcode-terminal";
import { CONFIG_DIR, CLIENT_ID } from "#config";
import { resolveLoginMethod } from "../loginPrompt.js";
import { logger }           from "#logger";
import { t }                from "#i18n";
import { createStore }      from "#client/store.js";
import { CapabilitySet }    from "#core/capabilities.js";
import type { PresenceCapable } from "#core/adapter.js";
import type { WASocket, WAStore } from "#types";
import pino from "pino";

// ── Auth path ─────────────────────────────────────────────────────────────────

export const AUTH_DIR = path.join(CONFIG_DIR, "sessions", CLIENT_ID);

// ── Shared store (survives socket reconnects) ─────────────────────────────────

export const store: WAStore = createStore();

// ── Socket factory ────────────────────────────────────────────────────────────

export interface SocketBundle {
  sock:  WASocket;
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
  }) as WASocket;

  store.bind(sock.ev);

  // Each plugin's setup() can attach its own listeners via api.events (see
  // buildEventsApi in api/index.ts), on top of the driver's own and the
  // store's. That easily exceeds Node's default cap of 10 with a handful
  // of plugins — it's expected, not a leak. Reconnects don't add to this:
  // createSocket() always returns a fresh emitter and the caller tears
  // down the previous one.
  const evAsEmitter = sock.ev as unknown as { setMaxListeners?: (n: number) => void };
  evAsEmitter.setMaxListeners?.(50);

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

/**
 * Normalize a Baileys JID to the @c.us format used in ManyBot configs.
 * Groups (@g.us) and broadcasts are passed through unchanged.
 *
 * @param {string} jid
 * @returns {string}
 */
export function normalizeJid(jid: string): string {
  if (!jid) return jid;
  return jid
    .replace(/@s\.whatsapp\.net$/, "@c.us")
    .replace(/:\d+@/, "@");
}

/**
 * Minimal PresenceCapable view over a raw socket. Transitional shim used
 * by kernel code that still works with a raw sock instead of a full
 * PlatformAdapter — goes away once that code is migrated.
 *
 * @param {WASocket} sock
 * @returns {PresenceCapable}
 */
export function toPresenceCapable(sock: WASocket): PresenceCapable {
  return {
    capabilities: new CapabilitySet(["presence"]),
    setPresence:  (chatId, state) => sock.sendPresenceUpdate(state, chatId),
  };
}
