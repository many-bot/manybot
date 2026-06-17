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
import { CONFIG_DIR }              from "#config";
import { extract }                 from "tar";
import { pipeline }                from "node:stream/promises";
import { Readable }                from "node:stream";
import { Transform }               from "node:stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chrome = path.join(CONFIG_DIR, "chrome/chrome")

if (!fs.existsSync(chrome)) {
  try {
    logger.warn(t("errors.chromeNotFound"));
    const tmpDir  = "/tmp/manybot-chrome";
    const tmpPath = path.join(tmpDir, "chrome.tar.gz");
    const url     = "https://api.manybot.stxerr.dev/download-chrome";

    fs.mkdirSync(tmpDir, { recursive: true });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const expected = Number(res.headers.get("content-length"));
    let received   = 0;
    const frames   = ["|","/","-","\\"];
    let frame      = 0;
    let spinner;

    const file = fs.createWriteStream(tmpPath);

    spinner = setInterval(() => {
      const pct = expected
        ? ` ${Math.floor((received / expected) * 100)}%`
        : ` ${(received / 1024 / 1024).toFixed(1)}MB`;
      process.stderr.write(`\r${frames[frame++ % frames.length]} Baixando Chrome...${pct}`);
    }, 80);

    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        cb(null, chunk);
      }
    });

    try {
      await pipeline(
        Readable.fromWeb(res.body),
        counter,
        file
      );
    } finally {
      clearInterval(spinner);
      process.stderr.write("\r\x1b[2K"); // limpa a linha
    }

    if (expected && received !== expected) {
      throw new Error("Download incompleto");
    }

    await extract({ file: tmpPath, cwd: CONFIG_DIR, gzip: true });
  } catch (err) {
    throw new Error(t("errors.couldNotDownloadChrome") + err.message);
  }

}
export const { Client, LocalAuth, MessageMedia } = pkg;

// -- Instance --------------------------------------------------
const clientOptions = {
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    executablePath: chrome,
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
