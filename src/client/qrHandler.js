import qrcode   from "qrcode-terminal";
import path     from "path";
import { logger } from "../logger/logger.js";
import { isTermux } from "./environment.js";

const QR_PATH = path.resolve("qr.png");

/**
 * Exibe ou salva o QR Code conforme o ambiente.
 * @param {string} qr  — string bruta do evento "qr"
 */
export async function handleQR(qr) {
  if (isTermux) {
    try {
      await QRCode.toFile(QR_PATH, qr, { width: 400 });
      logger.info(`QR Code salvo em: ${QR_PATH}`);
      logger.info(`Abra com: termux-open qr.png`);
    } catch (err) {
      logger.error("Falha ao salvar QR Code:", err.message);
    }
  } else {
    logger.info("Escaneie o QR Code abaixo:");
    qrcode.generate(qr, { small: true });
  }
}