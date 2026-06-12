/* whatsappClient
 *
 * Initialize client and connect to WhatsApp via Baileys
 *
 * if PHONE_NUMBER is set on config, it will request a pairing code
 * but if it is not, it will display a QR Code on the screen to scan
 *
 * */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import fs                          from "fs";
import path                        from "path";
import { fileURLToPath }           from "url";
import { PHONE_NUMBER, CLIENT_ID } from "#config";
import { logger }                  from "#logger";
import qrcode                      from "qrcode-terminal";
import { t }                       from "#i18n";
import pino                        from "pino";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// -- Auth paths ------------------------------------------------
const AUTH_DIR        = path.join(__dirname, `../../.baileys_auth_${CLIENT_ID}`);
const AUTH_STATE_PATH = path.join(__dirname, `../../.auth_${CLIENT_ID}.json`);

// -- Phone Number Validation -----------------------------------
function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== "string") return false;
  return /^\d{10,15}$/.test(phone);
}

function hasPhoneNumberChanged(currentPhone) {
  try {
    if (!fs.existsSync(AUTH_STATE_PATH)) return false;
    const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, "utf8"));
    return (state.phoneNumber ?? null) !== currentPhone;
  } catch {
    return false;
  }
}

function savePhoneNumber(phone) {
  try {
    fs.writeFileSync(
      AUTH_STATE_PATH,
      JSON.stringify({ phoneNumber: phone, savedAt: new Date().toISOString() })
    );
  } catch { /* ignore */ }
}

// Force re-auth if phone number changed
if (PHONE_NUMBER && hasPhoneNumberChanged(PHONE_NUMBER)) {
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    logger.info("Phone number changed — cleared auth state.");
  }
}

if (PHONE_NUMBER) savePhoneNumber(PHONE_NUMBER);

// -- QR Handle -------------------------------------------------
export function handleQR(qr) {
  logger.info(t("system.qrScan"));
  qrcode.generate(qr, { small: true });
}

// -- Pairing Code Handle ---------------------------------------
export function handlePairingCode(code) {
  logger.info(t("system.pairingCodeTitle"));
  logger.info(t("system.pairingCodeValue", { code }));
  logger.info(t("system.pairingCodeInstructions"));
}

// -- Client Factory --------------------------------------------
// Baileys doesn't keep a persistent client instance the same way
// wwebjs does — the socket is recreated on reconnect, so we expose
// a `connect()` factory and a `getClient()` accessor instead.

let _socket = null;

export function getClient() {
  return _socket;
}

export async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  _socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    printQRInTerminal: false,          // we handle QR ourselves
    logger: pino({ level: "silent" }), // suppress Baileys noise; use your own logger
    browser: ["ManyBot", "Chrome", "1.0.0"],
  });

  // Persist credentials whenever they update
  _socket.ev.on("creds.update", saveCreds);

  // -- QR / pairing code on connection update ------------------
  _socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (PHONE_NUMBER && isValidPhoneNumber(PHONE_NUMBER)) {
        // Baileys only allows requesting the pairing code after the first QR fires
        try {
          const code = await _socket.requestPairingCode(PHONE_NUMBER);
          handlePairingCode(code);
        } catch (err) {
          logger.error("Failed to request pairing code:", err.message);
        }
      } else {
        handleQR(qr);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(`Connection closed (reason: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        await connect(); // recurse — Baileys is stateless between sockets
      } else {
        logger.error("Logged out. Delete auth dir and restart to re-authenticate.");
      }
    }

    if (connection === "open") {
      logger.info(t("system.clientReady"));
    }
  });

  return _socket;
}

export default { connect, getClient };
