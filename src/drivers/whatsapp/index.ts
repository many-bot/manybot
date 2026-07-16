/**
 * drivers/whatsapp/index.ts
 *
 * Main WhatsApp driver entry point.
 * Implements the BotDriver interface for WhatsApp (Baileys).
 *
 * Responsibilities:
 * - Socket lifecycle (connect/disconnect)
 * - Message routing to kernel
 * - Plugin context building (via buildApi)
 * - Event handling and plugin execution
 */

import { createSocket, normalizeJid, AUTH_DIR } from "./sdk/baileysSock.js";
import { handleMessage } from "./messageHandler.js";
import { loadPlugins, setupPlugins } from "#kernel/pluginLoader.js";
import { logger } from "#logger";
import { PLUGINS, CLIENT_ID } from "#config";
import { t } from "#i18n";
import { printBanner } from "#client/banner.js";
import type { WASocket, WAStore, WAProtoMsg } from "#types";
import type { BotDriver } from "#drivers/index.js";
import { Boom } from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";
import fs from "fs/promises";

let state = "BOOT";
let shuttingDown = false;
let currentSock: WASocket | null = null;
let currentStore: WAStore | null = null;

async function startBot() {
  const { sock, store } = await createSocket();
  currentSock = sock;
  currentStore = store;

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

      if (loggedOut) {
        logger.warn(t("system.sessionExpired"));
        try {
          await fs.rm(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          logger.error(`[whatsapp] Failed to remove session dir: ${(e as Error).message}`);
        }
        if (!shuttingDown) setTimeout(() => startBot(), 1000);
      } else if (!shuttingDown) {
        logger.info(t("system.reconnecting", { secs: 5 }));
        setTimeout(() => startBot(), 5000);
      }
    }
  });

  // Incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || state !== "READY") return;

    for (const msg of messages) {
      // Skip empty messages (e.g. presence updates)
      const body = getBodyQuick(msg as WAProtoMsg);
      if (!body && !msgHasMediaQuick(msg as WAProtoMsg)) continue;

      try {
        await handleMessage(msg as WAProtoMsg, sock, store);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(`${err.message}\n${err.stack}`);
      }
    }
  });
}

/** Quick body extraction to avoid importing helpers here. */
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

export const whatsappDriver: BotDriver = {
  async connect(): Promise<void> {
    shuttingDown = false;
    await startBot();
  },

  async disconnect(): Promise<void> {
    shuttingDown = true;
    if (currentSock) {
      try {
        (currentSock.ev as unknown as NodeJS.EventEmitter)?.removeAllListeners();
      } catch {}
      try {
        currentSock.end(undefined);
      } catch {}
      currentSock = null;
      currentStore = null;
    }
  },

  /**
   * Diagnostic mode: connects normally (reusing an already saved
   * session/QR), but instead of loading plugins, just waits for the
   * NEXT message to arrive — from any chat, from any sender, whether
   * it's your own message or someone else's — prints the normalized
   * JID and the chat name (if any), and exits.
   *
   * Intentionally does not go through the CHATS/fromMe/dedup filters of
   * handleMessage: the only goal here is to discover the JID so you can
   * configure CHATS/TEST_CHAT afterward, so there's no reason to filter
   * anything out yet.
   */
  async getId(): Promise<void> {
    const { sock } = await createSocket();

    logger.info("[getid] Connecting... wait for the QR/pairing prompt if this is the first run.");

    await new Promise<void>((resolve) => {
      let done = false;

      sock.ev.on("connection.update", (update) => {
        if (update.connection === "open") {
          logger.success("[getid] Connected. Send ANY message in the chat you want to identify.");
        }
      });

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (done || type !== "notify") return;

        const msg = messages[0] as WAProtoMsg | undefined;
        const rawJid = msg?.key?.remoteJid;
        if (!rawJid) return;

        done = true;

        const jid = normalizeJid(rawJid);
        const name = msg?.pushName ?? "";

        logger.success(`[getid] JID: ${jid}`);
        if (name) logger.info(`[getid] Chat/sender: ${name}`);
        logger.info("[getid] Paste this value into CHATS or TEST_CHAT in manybot.toml.");

        resolve();
      });
    });

    try {
      (sock.ev as unknown as NodeJS.EventEmitter)?.removeAllListeners();
      sock.end(undefined);
    } catch {}
  },
};
