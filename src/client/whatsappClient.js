import pkg                    from "whatsapp-web.js";
import { CLIENT_ID }          from "../config.js";
import { logger }             from "../logger/logger.js";
import { isTermux, resolvePuppeteerConfig } from "./environment.js";
import { handleQR }           from "./qrHandler.js";
import { printBanner }        from "./banner.js";

export const { Client, LocalAuth, MessageMedia } = pkg;

// ── Ambiente ─────────────────────────────────────────────────
logger.info(isTermux
  ? "Ambiente: Termux — usando Chromium do sistema"
  : `Ambiente: ${process.platform} — usando Puppeteer padrão`
);

// ── Instância ─────────────────────────────────────────────────
export const client = new Client({
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
});

// ── Eventos ───────────────────────────────────────────────────
client.on("qr", handleQR);

client.on("ready", () => {
  printBanner();
  logger.success("WhatsApp conectado e pronto!");
  logger.info(`Client ID: ${CLIENT_ID}`);
});

client.on("disconnected", (reason) => {
  logger.warn(`Desconectado — motivo: ${reason}`);
  logger.info("Reconectando em 5s...");
  setTimeout(() => {
    logger.info("Reinicializando cliente...");
    client.initialize();
  }, 5000);
});

export default client;