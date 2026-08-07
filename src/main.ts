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
import { whatsmeowContract, startWhatsmeowSupervisor, wrapWithSupervisor } from "#drivers/whatsmeow/index.js";
import { cleanupPlugins }             from "#kernel/pluginLoader.js";
import { stopAll as stopScheduler }   from "#kernel/scheduler.js";
import { sendAlert }                  from "#kernel/alerts.js";
import { startStatusServer }          from "#kernel/statusServer.js";
import { getDriverManager }           from "#kernel/driverManager.js";
import { CONFIG, STATUS_ENABLED, STATUS_PORT } from "#config";
import { logger }                     from "#logger";
import { t }                          from "#i18n";

let shuttingDown = false;

// DriverManager registration: only register drivers that are enabled in
// the config. whatsmeow.enabled = false means no gRPC
// subprocess, no Go binary lookup, no extra work at boot — the manager
// simply doesn't know about it and sendFallbackGuard sees a missing
// secondary and fires send_failed_no_fallback if needed.
const driverManager = getDriverManager();
driverManager.register(baileysContract, { isPrimary: CONFIG.drivers.primary === "baileys" });

// Whatsmeow supervisor: spawns the Go subprocess when enabled=true,
// owns the restart/backoff/circuit-breaker logic, and gates the
// driver's connect()/isReady() until HealthCheck{ready:true}. When
// enabled=false or the binary can't be located, `supervisor` is null
// and the whatsmeow driver is simply not registered — ManyBot keeps
// running on Baileys alone, no fallback.
let supervisor: Awaited<ReturnType<typeof startWhatsmeowSupervisor>> = null;
if (CONFIG.drivers.whatsmeow.enabled) {
  supervisor = await startWhatsmeowSupervisor();
  if (supervisor) {
    const wrapped = wrapWithSupervisor(whatsmeowContract, supervisor);
    driverManager.register(wrapped, { isPrimary: CONFIG.drivers.primary === "whatsmeow" });
  }
}
const activeDriver = driverManager.active();
const secondaryName = (activeDriver.name === "baileys" ? "whatsmeow" : "baileys") as "baileys" | "whatsmeow";
const secondaryDriver = driverManager.get(secondaryName);

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

  // Belt-and-suspenders: driverManager.shutdown() should already have
  // disconnected the wrapped contract, which in turn calls
  // supervisor.shutdown(). This catches the case where the supervisor
  // was started but the driver wasn't registered (binary missing).
  if (supervisor) {
    try { await supervisor.shutdown(); } catch {}
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
  // getId? is a Baileys-only diagnostic method. Look it
  // up on the registered Baileys driver regardless of which one is
  // active — --getid always uses Baileys, even in a whatsmeow-primary
  // configuration, because it needs the diagnostic session, not the
  // bot's normal one.
  const baileys = driverManager.get("baileys") as (typeof driverManager.get extends (...a: never[]) => infer R ? R : never) | undefined;
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

      // The secondary driver is connected and paired in the
      // background so sendFallbackGuard can reach for it without first
      // having to wait through a connect() round-trip when the primary
      // fails. The secondary does NOT register `messages.upsert` handlers
      // (no kernel code subscribes on it — only the primary path does),
      // so connecting it does not duplicate inbound processing. A failure
      // here is non-fatal: the primary keeps running, fallback just stays
      // unavailable (sendFallbackGuard's `isReady()` check covers that).
      if (secondaryDriver) {
        secondaryDriver.connect()
          .then(() => logger.info(`[driverManager] secondary "${secondaryName}" connected — fallback available`))
          .catch((err: Error) => logger.warn(
            `[driverManager] secondary "${secondaryName}" connect failed: ${err.message} — fallback unavailable`
          ));
      }
    })
    .catch((err) => {
      shutdown(`Failed to connect driver: ${err.message}`, true);
    });
}