import pkg                    from "whatsapp-web.js";
import { CLIENT_ID }          from "../config.js";
import { logger }             from "../logger/logger.js";
import { t }                  from "../i18n/index.js";
import { isTermux, resolvePuppeteerConfig } from "./environment.js";
import { handleQR }           from "./qrHandler.js";
import { printBanner }        from "./banner.js";

export const { Client, LocalAuth, MessageMedia } = pkg;

// ── Environment ───────────────────────────────────────────────
logger.info(isTermux
  ? t("system.environmentTermux")
  : t("system.environment", { platform: process.platform, puppeteer: "system Puppeteer" })
);

// ── Instance ──────────────────────────────────────────────────
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

// ── Events ────────────────────────────────────────────────────
client.on("qr", handleQR);

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