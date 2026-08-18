#!/usr/bin/env node
/**
 * main.ts
 *
 * ManyBot entry point.
 * Orchestrates process lifecycle, error handling, and driver startup.
 */

import Module      from "module";
import path        from "path";

process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
(Module as unknown as { _initPaths: () => void })._initPaths();

import { baileysContract }            from "#drivers/baileys/index.js";
import { cleanupPlugins }             from "#kernel/pluginLoader.js";
import { stopAll as stopScheduler }   from "#kernel/scheduler.js";
import { sendAlert }                  from "#kernel/alerts.js";
import { startStatusServer }          from "#kernel/statusServer.js";
import { getDriverManager }           from "#kernel/driverManager.js";
import { CONFIG, STATUS_ENABLED, STATUS_PORT } from "#config";
import { logger }                     from "#logger";
import { t }                          from "#i18n";

let shuttingDown = false;

// DriverManager registration: only Baileys driver now
const driverManager = getDriverManager();
driverManager.register(baileysContract, { isPrimary: true });
const activeDriver = driverManager.active();

async function shutdown(reason: string, isError = false) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (isError) {
    logger.error(`${t("bot.error.uncaught")}: ${reason}`);
    try {
      await sendAlert({
        level:   "critical",
        title:   "manybot crashed",
        message: reason,
      });
    } catch {
      // sendAlert already swallows sink failures internally; this is only
      // a final safety net so a crash alert never blocks shutdown itself.
    }
  } else {
    logger.warn(t("bot.signal.sigterm", { signal: reason }));
  }

  try {
    await cleanupPlugins();
  } catch (err) {
    logger.error(`Error cleaning up plugins: ${(err as Error).message}`);
  }

  stopScheduler();

  try {
    await driverManager.shutdown();
  } catch (err) {
    logger.error(`Error disconnecting driver: ${(err as Error).message}`);
  }

  process.exit(isError ? 1 : 0);
}

// Global error listeners
process.on("uncaughtException", (err) => {
  const stackFrame = err.stack?.split("\n")[1]?.trim() ?? "";
  shutdown(`${err.message}\n             ${t("errors.stack")}: ${stackFrame}`, true);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  shutdown(`${t("bot.error.unhandled")}: ${msg}`, true);
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── --getid mode (provisional) ───────────────────────────────────────────
// Usage: npm run start -- --getid
// Connects, waits for the next message to arrive from any chat, and prints
// the JID to the console, to paste into CHATS in manybot.toml.
// Does not enter the normal bot flow (plugins are not loaded).
if (process.argv.includes("--getid")) {
  const baileys = driverManager.get("baileys");
  const getIdFn = (baileys as { getId?: () => Promise<void> } | undefined)?.getId;
  if (!getIdFn) {
    logger.error(`Current driver does not support --getid.`);
    process.exit(1);
  }

  getIdFn()
    .then(() => process.exit(0))
    .catch((err: Error) => {
      logger.error(`--getid mode failed: ${err.message}`);
      process.exit(1);
    });
} else {
  // Start bot
  logger.info(t("bot.initialized"));

  if (STATUS_ENABLED) {
    startStatusServer(STATUS_PORT);
  }

  activeDriver.connect()
    .then(() => {
      logger.success(t("bot.ready"));
    })
    .catch((err) => {
      shutdown(`Failed to connect driver: ${err.message}`, true);
    });
}