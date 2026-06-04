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

import client, { handleQR, handlePairingCode } from "#client/whatsappClient";
import { handleMessage }                       from "#kernel/messageHandler";
import { loadPlugins, setupPlugins }           from "#kernel/pluginLoader";
import { buildSetupApi }                       from "#manyapi";
import { logger }                              from "#logger";
import { PLUGINS }                             from "#config";
import { t }                                   from "#i18n";
import { printBanner }                         from "#client/banner";
import { CLIENT_ID }                           from "#config";

logger.info(t("bot.starting"));

// Global safety net — no error should crash the bot
process.on("uncaughtException", (err) => {
  logger.error(`${t("bot.error.uncaught")} — ${err.message}`,
    `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
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

let state = "BOOT";
// BOOT → AUTH → SYNC → READY

function setState(next) {
  state = next;
}

client.on("loading_screen", (p, msg) => {
  setState("SYNC");
  logger.info(`loading ${p}% ${msg}`);
});

client.on("ready", async () => {
  setState("READY_INIT");

  logger.success(t("system.connected"));
  logger.info(t("system.clientId", { id: CLIENT_ID }));

  printBanner();

  await loadPlugins(PLUGINS);
  await setupPlugins(buildSetupApi(client));

  // buffer anti-replay / sync ghost messages
  setTimeout(() => {
    setState("READY");
  }, 2000);
});

client.on("message_create", async (msg) => {
  if (state !== "READY") return;

  if (!msg.body && !msg.hasMedia) return;

  try {
    await handleMessage(msg);
  } catch (err) {
    logger.error(err);
  }
});

client.on("disconnected", (reason) => {
  logger.warn(t("system.disconnected", { reason }));
  logger.info(t("system.reconnecting", { seconds: 5 }));
  setTimeout(() => {
    logger.info(t("system.reinitializing"));
    client.initialize();
  }, 5000);
});

// -- Events ----------------------------------------------------
client.on("code", (code) => {
  handlePairingCode(code);
});

client.on("qr", (qr) => {
  handleQR(qr);
});

client.initialize();
logger.info(t("bot.initialized"));
