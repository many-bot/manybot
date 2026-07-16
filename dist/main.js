#!/usr/bin/env tsx
/**
 * main.ts
 *
 * ManyBot entry point.
 * Orchestrates process lifecycle, error handling, and driver startup.
 */
import Module from "module";
import path from "path";
process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
Module._initPaths();
import { initializeSelectedDriver } from "#drivers/index.js";
import { cleanupPlugins } from "#kernel/pluginLoader.js";
import { stopAll as stopScheduler } from "#kernel/scheduler.js";
import { logger } from "#logger";
import { t } from "#i18n";
let shuttingDown = false;
const activeDriver = initializeSelectedDriver();
async function shutdown(reason, isError = false) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    if (isError) {
        logger.error(`${t("bot.error.uncaught")}: ${reason}`);
    }
    else {
        logger.warn(t("bot.signal.sigterm", { signal: reason }));
    }
    try {
        await cleanupPlugins();
    }
    catch (err) {
        logger.error(`Error cleaning up plugins: ${err.message}`);
    }
    stopScheduler();
    try {
        await activeDriver.disconnect();
    }
    catch (err) {
        logger.error(`Error disconnecting driver: ${err.message}`);
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
process.on("SIGINT", () => shutdown("SIGINT"));
// ── --getid mode (provisional) ───────────────────────────────────────────
// Usage: npm run start -- --getid
// Connects, waits for the next message to arrive from any chat, and prints
// the JID to the console, to paste into CHATS/TEST_CHAT in manybot.toml.
// Does not enter the normal bot flow (plugins are not loaded).
if (process.argv.includes("--getid")) {
    if (!activeDriver.getId) {
        logger.error(`Current driver does not support --getid.`);
        process.exit(1);
    }
    activeDriver.getId()
        .then(() => process.exit(0))
        .catch((err) => {
        logger.error(`--getid mode failed: ${err.message}`);
        process.exit(1);
    });
}
else {
    // Start bot
    logger.info(t("bot.initialized"));
    activeDriver.connect()
        .then(() => {
        logger.success(t("bot.ready"));
    })
        .catch((err) => {
        shutdown(`Failed to connect driver: ${err.message}`, true);
    });
}
