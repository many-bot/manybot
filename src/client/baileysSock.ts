/**
 * baileysSock.ts
 *
 * Creates and returns a Baileys WASocket.
 * Handles auth state persistence, QR/pairing-code display, and reconnection.
 */

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} from "@whiskeysockets/baileys";
import { Boom }             from "@hapi/boom";
import path                 from "path";
import qrcode               from "qrcode-terminal";
import { CONFIG_DIR, PHONE_NUMBER, CLIENT_ID } from "#config";
import { logger }           from "#logger";
import { t }                from "#i18n";
import { createStore }      from "#client/store";
import type { WASocket, WAStore } from "#types";

// ── Auth path ─────────────────────────────────────────────────────────────────

const AUTH_DIR = path.join(CONFIG_DIR, "sessions", CLIENT_ID);

// ── Silent logger for Baileys internals ───────────────────────────────────────

const silentLogger = {
  level: "silent",
  trace: () => {}, debug: () => {}, info: () => {},
  warn:  () => {}, error: () => {}, fatal: () => {},
  child() { return silentLogger; },
} as unknown as Parameters<typeof makeWASocket>[0]["logger"];

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
export async function createSocket(): Promise<SocketBundle> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:                           state,
    printQRInTerminal:              false,
    browser:                        Browsers.ubuntu("ManyBot"),
    logger:                         silentLogger,
    generateHighQualityLinkPreview: false,
    syncFullHistory:                false,
  }) as WASocket;

  store.bind(sock.ev);
  sock.ev.on("creds.update", saveCreds);

  // QR code — shown when no phone pairing is configured
  sock.ev.on("connection.update", (update) => {
    const { qr } = update;
    if (qr && !PHONE_NUMBER) {
      logger.info(t("system.qrScan"));
      qrcode.generate(qr, { small: true });
    }
  });

  // Phone number pairing (if PHONE_NUMBER is set and not yet registered)
  if (PHONE_NUMBER && !(state.creds as { registered?: boolean }).registered) {
    // Allow the socket to handshake before requesting the pairing code
    setTimeout(async () => {
      try {
        const code = await (sock as unknown as {
          requestPairingCode(phone: string): Promise<string>
        }).requestPairingCode(PHONE_NUMBER!);
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
