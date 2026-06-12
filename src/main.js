#!/usr/bin/env node
/**
 * main.js
 *
 * ManyBot entry point.
 * Initializes WhatsApp client and loads plugins.
 */
import Module from "module";
import path from "path";
process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
Module._initPaths();

import { connect, getClient }    from "#client/whatsappClient";
import { handleMessage }         from "#kernel/messageHandler";
import { loadPlugins, setupPlugins } from "#kernel/pluginLoader";
import { buildSetupApi }         from "#manyapi";
import { logger }                from "#logger";
import { PLUGINS, CLIENT_ID }    from "#config";
import { t }                     from "#i18n";
import { printBanner }           from "#client/banner";

logger.info(t("bot.starting"));

// Global safety net
process.on("uncaughtException", (err) => {
  logger.error(`${t("bot.error.uncaught")} — ${err.message}`,
    `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`${t("bot.error.unhandled")} — ${msg}`);
});
process.on("SIGTERM", async () => {
  logger.error(t("bot.signal.sigterm"));
  process.exit(0);
});

// BOOT → AUTH → SYNC → READY
let state = "BOOT";
function setState(next) { state = next; }

async function start() {
  setState("AUTH");
  const socket = await connect();

  socket.ev.on("connection.update", async ({ connection }) => {
    // Baileys doesn't have a loading_screen equivalent, but
    // 'connecting' is the closest handshake phase
    if (connection === "connecting") {
      setState("SYNC");
    }

    if (connection === "open") {
      setState("READY_INIT");
      logger.success(t("system.connected"));
      logger.info(t("system.clientId", { id: CLIENT_ID }));
      printBanner();

      await loadPlugins(PLUGINS);
      await setupPlugins(buildSetupApi(getClient()));

      // buffer anti-replay / sync ghost messages
      setTimeout(() => setState("READY"), 2000);
    }

    // disconnected is handled inside connect() with auto-reconnect;
    // log it here for visibility
    if (connection === "close") {
      setState("BOOT");
      logger.warn(t("system.disconnected", { reason: "connection closed" }));
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    // 'notify' = new incoming message; 'append' = history sync — ignore
    if (type !== "notify") return;
    if (state !== "READY") return;

    for (const msg of messages) {
      if (!msg.message) continue; // empty/revoked
      try {
        await handleMessage(msg);
      } catch (err) {
        logger.error(err);
      }
    }
  });
}

start();
logger.info(t("bot.initialized"));
