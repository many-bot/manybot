import pkg                    from "whatsapp-web.js";
import { CLIENT_ID, PHONE_NUMBER } from "#config";
import { logger }             from "#logger";
import { t }                  from "#i18n";
import { isTermux, resolvePuppeteerConfig } from "./environment.js";
import { handleQR, handlePairingCode } from "#client/qrHandler.js";
import { printBanner }        from "#client/banner.js";
import fs                     from "fs";
import path                   from "path";
import { fileURLToPath }      from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const { Client, LocalAuth, MessageMedia } = pkg;

// ── Environment ───────────────────────────────────────────────
logger.info(isTermux
  ? t("system.environmentTermux")
  : t("system.environment", { platform: process.platform, puppeteer: "system Puppeteer" })
);

// ── Instance ──────────────────────────────────────────────────
const clientOptions = {
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(resolvePuppeteerConfig().args || [])
    ],
    ...resolvePuppeteerConfig()
  },
};

// ── Phone Number Validation ────────────────────────────────────
const AUTH_STATE_PATH = path.join(__dirname, `../../.auth_${CLIENT_ID}.json`);

/**
 * Validates phone number format: country code + area code + number (digits only)
 * Examples: 5511999999999, 12125551234
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const phoneRegex = /^\d{10,15}$/;
  return phoneRegex.test(phone);
}

/**
 * Checks if phone number changed since last authentication
 * @param {string|null} currentPhone - Current configured phone number
 * @returns {boolean} - True if phone number changed
 */
function hasPhoneNumberChanged(currentPhone) {
  try {
    if (!fs.existsSync(AUTH_STATE_PATH)) return false;
    const state = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, 'utf8'));
    const storedPhone = state.phoneNumber || null;
    return storedPhone !== currentPhone;
  } catch {
    return false;
  }
}

/**
 * Saves current phone number to auth state file
 * @param {string|null} phone - Phone number to save
 */
function savePhoneNumber(phone) {
  try {
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ phoneNumber: phone, savedAt: new Date().toISOString() }));
  } catch (err) {
    logger.warn('Failed to save auth state:', err.message);
  }
}

// Check if phone number changed and force re-authentication if needed
if (PHONE_NUMBER && hasPhoneNumberChanged(PHONE_NUMBER)) {
  logger.info(t("system.phoneNumberChanged"));
  // Delete auth folder to force fresh authentication
  const authPath = path.join(__dirname, `../../.wwebjs_auth/session-${CLIENT_ID}`);
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
      logger.info('Cleared previous authentication data');
    }
  } catch (err) {
    logger.warn('Failed to clear auth data:', err.message);
  }
  savePhoneNumber(PHONE_NUMBER);
} else if (PHONE_NUMBER) {
  savePhoneNumber(PHONE_NUMBER);
}

// Add phone number pairing if PHONE_NUMBER is configured and valid
if (PHONE_NUMBER) {
  if (isValidPhoneNumber(PHONE_NUMBER)) {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber: PHONE_NUMBER,
      showNotification: true,
    };
  } else {
    logger.error(t("system.phoneNumberInvalid", { number: PHONE_NUMBER }));
    logger.warn("Proceeding without phone number authentication...");
  }
}

export const client = new Client(clientOptions);

// ── Events ────────────────────────────────────────────────────
client.on("qr", handleQR);
client.on("code", handlePairingCode);

client.on("ready", () => {
  printBanner();
  logger.success(t("system.connected"));
  logger.info(t("system.clientId", { id: CLIENT_ID }));
});

client.on("disconnected", (reason) => {
  logger.warn(t("system.disconnected", { reason }));
  logger.info(t("system.reconnecting", { seconds: 5 }));
  setTimeout(() => {
    logger.info(t("system.reinitializing"));
    client.initialize();
  }, 5000);
});

export default client;
