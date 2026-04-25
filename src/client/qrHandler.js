import qrcode   from "qrcode-terminal";
import path     from "path";
import { logger } from "../logger/logger.js";
import { t }      from "../i18n/index.js";
import { isTermux } from "./environment.js";

const QR_PATH = path.resolve("qr.png");

/**
 * Display or save QR Code based on environment.
 * @param {string} qr  — raw string from "qr" event
 */
export async function handleQR(qr) {
  if (isTermux) {
    try {
      await QRCode.toFile(QR_PATH, qr, { width: 400 });
      logger.info(t("system.qrSaved", { path: QR_PATH }));
      logger.info(t("system.qrOpen"));
    } catch (err) {
      logger.error(t("system.qrSaveFailed"), err.message);
    }
  } else {
    logger.info(t("system.qrScan"));
    qrcode.generate(qr, { small: true });
  }
}

/**
 * Display pairing code for phone number authentication.
 * @param {string} code  — 8-character pairing code
 */
export function handlePairingCode(code) {
  logger.info(t("system.pairingCodeTitle"));
  logger.info(t("system.pairingCodeValue", { code }));
  logger.info(t("system.pairingCodeInstructions"));
}