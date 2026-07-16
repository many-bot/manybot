/**
 * baileysSock.ts
 *
 * Creates and returns a Baileys WASocket.
 * Handles auth state persistence, QR/pairing-code display, and reconnection.
 */
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, } from "@whiskeysockets/baileys";
import path from "path";
import qrcode from "qrcode-terminal";
import { CONFIG_DIR, CLIENT_ID } from "#config";
import { resolveLoginMethod } from "../loginPrompt.js";
import { logger } from "#logger";
import { t } from "#i18n";
import { createStore } from "#client/store.js";
import { CapabilitySet } from "#core/capabilities.js";
import pino from "pino";
// ── Auth path ─────────────────────────────────────────────────────────────────
export const AUTH_DIR = path.join(CONFIG_DIR, "sessions", CLIENT_ID);
// ── Shared store (survives socket reconnects) ─────────────────────────────────
export const store = createStore();
/**
 * Create a new Baileys socket with persistent auth and store binding.
 * Reconnection is the caller's responsibility — call createSocket() again
 * on `connection.close`.
 */
export async function createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    // Already-valid session (creds registered in .manybot/sessions) → skips
    // LOGIN_METHOD/PHONE_NUMBER and the interactive login flow entirely, and
    // connects directly. This also avoids reopening QR/pairing on normal
    // reconnects (network drop, etc), since only the FIRST run ever gets
    // here without `registered`.
    const alreadyRegistered = !!state.creds.registered;
    const { method, phone } = alreadyRegistered
        ? { method: null, phone: null }
        : await resolveLoginMethod();
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        // Recognized browser signature. A custom name (e.g. "ManyBot") works
        // fine for QR, but WhatsApp rejects phone-number pairing when the
        // browser doesn't match one of the known signatures — resulting in
        // "Couldn't link device" on the phone even with the correct code.
        browser: Browsers.ubuntu("Chrome"),
        logger: pino({ level: "silent" }),
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        // Required for Baileys to decrypt incoming poll votes (and to retry
        // sends) — it looks up the original message by key internally.
        // Without this, pollUpdates never resolve even though the vote event
        // arrives: ctx.poll.results()/onVote() silently stay at zero.
        getMessage: async (key) => {
            const stored = store.messages.get(key.remoteJid ?? "")?.get(key.id ?? "");
            return stored?.message ?? undefined;
        },
    });
    store.bind(sock.ev);
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
                const code = await sock.requestPairingCode(phone);
                logger.info(t("system.pairingCodeTitle"));
                logger.info(t("system.pairingCodeValue", { code }));
                logger.info(t("system.pairingCodeInstructions"));
            }
            catch (e) {
                logger.error(`[baileysSock] Pairing code request failed: ${e.message}`);
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
export function normalizeJid(jid) {
    if (!jid)
        return jid;
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
export function toPresenceCapable(sock) {
    return {
        capabilities: new CapabilitySet(["presence"]),
        setPresence: (chatId, state) => sock.sendPresenceUpdate(state, chatId),
    };
}
