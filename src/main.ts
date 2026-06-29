#!/usr/bin/env tsx

/**
 * main.ts
 *
 * ManyBot entry point.
 * Initializes the Baileys socket and starts the plugin pipeline.
 *
 * --getid mode: connect, list/search chats, exit.
 *   Usage: manybot --getid [groups|contacts|<term>] [--json] [--csv]
 */

import Module      from "module";
import path        from "path";
import fs          from "fs";
import { Boom }    from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";

process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
(Module as unknown as { _initPaths: () => void })._initPaths();

import { createSocket, normalizeJid } from "#client/baileysSock";
import { handleMessage }              from "#kernel/messageHandler";
import { loadPlugins, setupPlugins }  from "#kernel/pluginLoader";
import { logger }                     from "#logger";
import { PLUGINS, CLIENT_ID }         from "#config";
import { t }                          from "#i18n";
import { printBanner }                from "#client/banner";
import type { WASocket, WAStore, WAProtoMsg } from "#types";

// ── --getid mode ──────────────────────────────────────────────────────────────

const _argv       = process.argv.slice(2);
const GET_ID_MODE = _argv.includes("--getid");
const _getIdArgs  = _argv.slice(_argv.indexOf("--getid") + 1);
const _exportJson = _getIdArgs.includes("--json");
const _exportCsv  = _getIdArgs.includes("--csv");
const _terms      = _getIdArgs.filter(a => !a.startsWith("--")).map(a => a.toLowerCase());

function _printTable(rows: Array<{ name: string; id: string; group: boolean }>) {
  const LINE = "─".repeat(48);
  rows.forEach(r => {
    console.log(LINE);
    console.log("Name:  ", r.name);
    console.log("ID:    ", r.id);
    console.log("Group: ", r.group);
  });
  console.log(LINE);
  console.log(`\n${rows.length} result(s) found.`);
}

function _exportResults(rows: Array<Record<string, unknown>>, header = "name,id,group") {
  if (_exportJson) {
    const f = "get_id_results.json";
    fs.writeFileSync(f, JSON.stringify(rows, null, 2));
    console.log(`Exported to ${f}`);
  }
  if (_exportCsv) {
    const f    = "get_id_results.csv";
    const keys = header.split(",");
    fs.writeFileSync(f, [header,
      ...rows.map((r: Record<string, unknown>) =>
        keys.map((k: string) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n"));
    console.log(`Exported to ${f}`);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

if (!GET_ID_MODE) logger.info(t("bot.starting"));

process.on("uncaughtException", (err) => {
  logger.error(`${t("bot.error.uncaught")} — ${err.message}`,
    `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`${t("bot.error.unhandled")} — ${msg}`);
});

// ── Bot lifecycle ─────────────────────────────────────────────────────────────

let shuttingDown = false;
let currentSock: WASocket | null = null;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn(t("bot.signal.sigterm", { signal }));
  try { (currentSock?.ev as unknown as NodeJS.EventEmitter)?.removeAllListeners(); } catch {}
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ── Main socket start + reconnect loop ───────────────────────────────────────

let state = "BOOT";

async function startBot() {
  const { sock, store } = await createSocket();
  currentSock = sock;

  // ── --getid mode ────────────────────────────────────────────────────────────
  if (GET_ID_MODE) {
    sock.ev.on("connection.update", async (update) => {
      if (update.connection !== "open") return;

      console.log("[OK] Connected. Searching...\n");
      const [first] = _terms;

      // self info
      if (first === "me") {
        const jid  = sock.user?.id ?? "";
        const name = sock.user?.name ?? "(no name)";
        const LINE = "─".repeat(48);
        console.log(LINE);
        console.log("Name: ", name);
        console.log("ID:   ", normalizeJid(jid));
        console.log(LINE);
        process.exit(0);
      }

      // Wait briefly for store to populate from sync
      await new Promise(r => setTimeout(r, 3000));

      const all   = store.chats.all();
      const rows  = all.map(c => ({
        name:  c.name ?? c.id.split("@")[0],
        id:    normalizeJid(c.id),
        group: c.id.endsWith("@g.us"),
      }));

      let filtered = rows;
      if      (first === "groups")   filtered = rows.filter(r => r.group);
      else if (first === "contacts") filtered = rows.filter(r => !r.group);
      else if (_terms.length)        filtered = rows.filter(r =>
        _terms.every(term => r.name.toLowerCase().includes(term) || r.id.includes(term))
      );

      if (!filtered.length) { console.log("No results found."); }
      else {
        _printTable(filtered);
        _exportResults(filtered);
      }

      process.exit(0);
    });
    return;
  }

  // ── Normal bot mode ─────────────────────────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      state = "READY_INIT";
      logger.success(t("system.connected"));
      logger.info(t("system.clientId", { id: CLIENT_ID }));
      printBanner();

      await loadPlugins(PLUGINS);
      await setupPlugins(sock, store);

      // buffer anti-replay / sync ghost messages
      setTimeout(() => { state = "READY"; }, 2000);
    }

    if (connection === "close") {
      const code      = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state = "BOOT";

      logger.warn(t("system.disconnected", { reason: String(code) }));

      if (!loggedOut && !shuttingDown) {
        logger.info("Reconnecting in 5s...");
        setTimeout(() => startBot(), 5000);
      }
    }
  });

  // Incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || state !== "READY") return;

    for (const msg of messages) {
      // Skip empty messages (e.g. presence updates)
      const body = getBodyQuick(msg);
      if (!body && !msgHasMediaQuick(msg)) continue;

      try {
        await handleMessage(msg, sock, store);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(`${err.message}\n${err.stack}`);
      }
    }
  });
}

/** Quick body extraction to avoid importing pluginApi helpers here. */
function getBodyQuick(msg: WAProtoMsg): string {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    ""
  ) as string;
}

function msgHasMediaQuick(msg: WAProtoMsg): boolean {
  const m = msg.message;
  return !!(m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.documentMessage || m?.stickerMessage);
}

startBot();
logger.info(t("bot.initialized"));
