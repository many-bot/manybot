/**
 * main.js
 *
 * ManyBot entry point.
 * Initializes WhatsApp client and loads plugins.
 */
import client               from "#client/whatsappClient";
import { handleMessage }    from "#kernel/messageHandler";
import { loadPlugins, setupPlugins } from "#kernel/pluginLoader";
import { buildSetupApi }    from "#manyapi";
import { logger }           from "#logger";
import { PLUGINS }          from "#config";
import { t }                from "#i18n";

logger.info(t("bot.starting"));

// Global safety net — no error should crash the bot
process.on("uncaughtException", (err) => {
  logger.error(`${t("bot.error.uncaught")} — ${err.message}`, `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`${t("bot.error.unhandled")} — ${msg}`);
});

// Clean shutdown
process.on("SIGTERM", async () => {
  logger.error(t("bot.signal.sigterm"));
  process.exit(0);
});

// Load plugins before connecting
await loadPlugins(PLUGINS);

client.on("message_create", async (msg) => {
  try {
    await handleMessage(msg);
  } catch (err) {
    logger.error(
      `${t("errors.messageProcess")} — ${err.message}`,
      `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`
    );
  }
});

client.on("ready", async () => {
  await setupPlugins(buildSetupApi(client));
});
client.initialize();
console.log("\n");
logger.info(t("bot.initialized"));
