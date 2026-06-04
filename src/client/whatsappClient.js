/* whatsappClient
 *
 * Initialize client and connect to WhatsApp
 *
 * if PHONE_NUMBER is set on config, it will request a verficiation code
 * but if it is not, it will display a QR Code on the screen to scan using your phone
 *
 * */

import pkg                         from "whatsapp-web.js";
import fs                          from "fs";
import path                        from "path";
import { fileURLToPath }           from "url";
import { PHONE_NUMBER, CLIENT_ID } from "#config";
import { logger }                  from "#logger";
import qrcode                      from "qrcode-terminal";
import { t }                       from "#i18n"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const { Client, LocalAuth, MessageMedia } = pkg;

// -- Instance --------------------------------------------------
const clientOptions = {
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  },
};

// -- Qr Handle --------------------------------------------------
export function handleQR(qr) {
  logger.info(t("system.qrScan"));
  qrcode.generate(qr, { small: true });
}

// -- Handle pairing code ---------------------------------------
export function handlePairingCode(code) {
  logger.info(t("system.pairingCodeTitle"));
  logger.info(t("system.pairingCodeValue", { code: code }));
  logger.info(t("system.pairingCodeInstructions"));
}

// -- Phone Number Validation ------------------------------------
const AUTH_STATE_PATH = path.join(__dirname, `../../.auth_${CLIENT_ID}.json`);

// Validates if phone string has 10-15 characters
function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const phoneRegex = /^\d{10,15}$/;
  return phoneRegex.test(phone);
}

// Checks if phone number changed since last authentication
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

// Saves phone number to auth state file
function savePhoneNumber(phone) {
  try {
    fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify({ phoneNumber: phone, savedAt: new Date().toISOString() }));
  } catch {
    return false;
  }
}

// Check if phone number changed and force re-authentication if needed
if (PHONE_NUMBER && hasPhoneNumberChanged(PHONE_NUMBER)) {
  // Delete auth folder to force fresh authentication
  const authPath = path.join(__dirname, `../../.wwebjs_auth/session-${CLIENT_ID}`);
  if (fs.existsSync(authPath)) {
    fs.rmSync(authPath, { recursive: true, force: true });
  }
} 

// Add phone number pairing if PHONE_NUMBER is configured and valid
if (PHONE_NUMBER) {
  if (isValidPhoneNumber(PHONE_NUMBER)) {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber: PHONE_NUMBER,
      showNotification: true,
    };
  }
  savePhoneNumber(PHONE_NUMBER);
}

export const client = new Client(clientOptions);


export default client;
