#!/usr/bin/env node
/**
 * main.ts
 *
 * ManyBot entry point.
 * Orchestrates process lifecycle, error handling, and driver startup.
 */

import Module      from "module";
import path        from "path";
import dns         from "node:dns";

process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
(Module as unknown as { _initPaths: () => void })._initPaths();

// This host has no working IPv6 route (only link-local addresses on the
// Docker bridges) — every outbound fetch/download otherwise wastes an
// attempt on IPv6 that fails immediately (ENETUNREACH) before falling
// back to IPv4. Forcing IPv4-first here avoids that noise for every
// downstream fetch() call (downloadMedia, updateCheck, etc.) in one place.
dns.setDefaultResultOrder("ipv4first");

import { baileysContract }            from "#drivers/baileys/index.js";
import { cleanupPlugins }             from "#kernel/pluginLoader.js";
import { stopAll as stopScheduler }   from "#kernel/scheduler.js";
import { sendAlert }                  from "#kernel/alerts.js";
import { startStatusServer }          from "#kernel/statusServer.js";
import { getDriverManager }           from "#kernel/driverManager.js";
import { CONFIG, STATUS_ENABLED, STATUS_PORT, LOG_LEVEL } from "#config";
import { logger, setLogLevel }        from "#logger";
import { t }                          from "#i18n";
import { getCurrentPluginName }       from "#kernel/pluginContext.js";
import { recordPluginFailure }        from "#kernel/pluginGuard.js";
import { CLIENT_ID, CONFIG_DIR }      from "#config";
import { rmSync }                     from "node:fs";
import { access }                     from "node:fs/promises";

setLogLevel(LOG_LEVEL);

let shuttingDown = false;

// DriverManager registration: only Baileys driver now
const driverManager = getDriverManager();
driverManager.register(baileysContract, { isPrimary: true });
const activeDriver = driverManager.active();

async function shutdown(reason: string, isError = false) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (isError) {
    // `reason` already carries its own descriptive label — handleGlobalError()
    // and the driver-connect catch below both build a self-describing
    // message, so no generic prefix is added here.
    logger.error(reason);
    try {
      await sendAlert({
        level:   "critical",
        title:   t("alerts.botCrashedTitle"),
        message: reason,
        // The one genuinely fatal alert kind: shutdown(reason, true) only
        // runs from an error with no plugin owner (main.ts's global error
        // listeners already hand plugin-attributable errors off to
        // recordPluginFailure and return early — see handleGlobalError
        // below) or a failed driver connect at startup. Either way the
        // process is exiting right after this.
        fatal:   true,
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

// Global error listeners.
//
// A plugin is allowed to crash — the bot itself is not. Before deciding
// to shut down, check whether the error happened while a plugin was
// executing (pluginContext.ts tracks this across the whole async chain,
// including promises the plugin created but never awaited/caught — the
// exact case a plain try/catch around the plugin call can't cover). If
// so, hand it to the same 3-strikes bookkeeping normal plugin errors go
// through (recordPluginFailure) and keep running. Only errors with no
// plugin owner (real bugs in kernel/driver code) bring the process down.
function handleGlobalError(kind: "uncaught" | "unhandled", err: Error) {
  const pluginName = getCurrentPluginName();
  if (pluginName && recordPluginFailure(pluginName, err)) {
    logger.warn(`${t("bot.error.pluginCaught", { plugin: pluginName })}: ${err.message}`);
    return;
  }

  const stackFrame = err.stack?.split("\n")[1]?.trim() ?? "";
  const label = kind === "uncaught" ? t("bot.error.uncaught") : t("bot.error.unhandled");
  shutdown(`${label}: ${err.message}\n             ${t("errors.stack")}: ${stackFrame}`, true);
}

process.on("uncaughtException", (err) => {
  handleGlobalError("uncaught", err);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  handleGlobalError("unhandled", err);
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

// --logout
// Does not enter the normal bot flow, just deletes all saved sessions for the current CLIENT_ID
} else if (process.argv.includes("--logout")) {
  const session_dir = path.join(CONFIG_DIR, "sessions", CLIENT_ID);
  
  try {
    await access(session_dir);

    rmSync(session_dir, { recursive: true });
    logger.success(t("bot.logout.success", { session_dir }));
  } catch {
    logger.error(t("bot.logout.notFound", { CLIENT_ID }));
  }
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

