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

import { createSocket, normalizeJid, sessionDir, AUTH_DIR, store as sharedStore } from "./sdk/baileysSock.js";
import { handleMessage } from "./messageHandler.js";
import { loadPlugins, setupPlugins } from "#kernel/pluginLoader.js";
import { logger } from "#logger";
import { PLUGINS, CLIENT_ID } from "#config";
import { t } from "#i18n";
import { printBanner } from "#client/banner.js";
import { createStore } from "#client/store.js";
import { loadChatCache, saveChatCache, isCacheFresh } from "#client/cache.js";
import type { WASocket, WAStore, WAProtoMsg } from "#types";
import type { BotDriver } from "#drivers/index.js";
import { Boom } from "@hapi/boom";
import { DisconnectReason, normalizeMessageContent } from "@whiskeysockets/baileys";
import fs from "fs/promises";
import * as clack from "@clack/prompts";
import { copyToClipboard } from "#utils/clipboard.js";

let state = "BOOT";
let shuttingDown = false;
let currentSock: WASocket | null = null;
let currentStore: WAStore | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let connecting = false;
let reconnectAttempts = 0;
let cacheHydrated = false;
let cacheSaveTimer: NodeJS.Timeout | null = null;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 60000;
const CACHE_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5min

/**
 * Loads the on-disk cache and merges it into `store` (union, never
 * overwrite — see client/cache.ts). Runs once per process: the shared
 * store singleton already accumulates across reconnects, so re-hydrating
 * later would just redo a no-op merge.
 */
async function hydrateFromCache(store: WAStore) {
  if (cacheHydrated) return;
  cacheHydrated = true;

  const snapshot = await loadChatCache();
  if (!snapshot) return;

  store.hydrate(snapshot);

  const fresh = await isCacheFresh();
  const count = snapshot.chats.length;
  const key   = fresh ? "system.cacheLoaded" : "system.cacheLoadedStale";
  logger.info(`[cache] ${t(key, { count })}`);
}

function startCacheAutosave(store: WAStore) {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setInterval(() => { saveChatCache(store); }, CACHE_SAVE_INTERVAL_MS);
}

function stopCacheAutosave() {
  if (!cacheSaveTimer) return;
  clearInterval(cacheSaveTimer);
  cacheSaveTimer = null;
}

function nextBackoffMs(): number {
  const delay = RECONNECT_BASE_MS * 2 ** reconnectAttempts;
  reconnectAttempts++;
  return Math.min(delay, RECONNECT_MAX_MS);
}

function teardownSock(sock: WASocket | null) {
  if (!sock) return;
  try {
    (sock.ev as unknown as NodeJS.EventEmitter).removeAllListeners();
  } catch {}
  try {
    sock.end(undefined);
  } catch {}
}

function scheduleReconnect(delayMs: number) {
  if (shuttingDown) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot();
  }, delayMs);
}

async function startBot() {
  if (connecting) return;
  connecting = true;

  await hydrateFromCache(sharedStore);

  const previousSock = currentSock;
  const { sock, store } = await createSocket();
  teardownSock(previousSock);

  currentSock = sock;
  currentStore = store;
  connecting = false;

  let pluginsReady = false;

  // ── Normal bot mode ─────────────────────────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      state = "READY_INIT";
      reconnectAttempts = 0;
      logger.success(t("system.connected"));
      logger.info(t("system.clientId", { id: CLIENT_ID }));
      printBanner();

      if (!pluginsReady) {
        pluginsReady = true;
        await loadPlugins(PLUGINS);
        await setupPlugins(sock, store);
      }
      startCacheAutosave(store);

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
        scheduleReconnect(1000);
      } else if (!shuttingDown) {
        const delay = nextBackoffMs();
        logger.info(t("system.reconnecting", { secs: Math.round(delay / 1000) }));
        scheduleReconnect(delay);
      }
    }
  });

  // Incoming messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (state !== "READY") return;
    if (type !== "notify" && type !== "append") return;
  
    for (const msg of messages) {
      const m = msg as WAProtoMsg;
      if (type === "append" && !m.key.fromMe) continue;
  
      const body = getBodyQuick(m);
      if (!body && !msgHasMediaQuick(m)) continue;
  
      try {
        await handleMessage(m, sock, store);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(`${err.message}\n${err.stack}`);
      }
    }
  });
}

/** Quick body extraction to avoid importing helpers here. */
function getBodyQuick(msg: WAProtoMsg): string {
  const m = normalizeMessageContent(msg.message);
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
  const m = normalizeMessageContent(msg.message);
  return !!(m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.documentMessage || m?.stickerMessage);
}

export const whatsappDriver: BotDriver = {
  async connect(): Promise<void> {
    shuttingDown = false;
    await startBot();
  },

  async disconnect(): Promise<void> {
    shuttingDown = true;
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopCacheAutosave();
    if (currentStore) await saveChatCache(currentStore);
    teardownSock(currentSock);
    currentSock = null;
    currentStore = null;
  },

  /**
   * Diagnostic mode: connects on its own session (separate from the
   * running bot's, so it doesn't compete for the same WhatsApp Web
   * slot), waits for the initial chat sync, then shows an interactive
   * list — arrow keys to navigate, Enter to pick. The selected chat's
   * id is normalized, resolved from `@lid` to the real phone-based JID
   * when known, copied to the clipboard, and printed.
   */
  async getId(): Promise<void> {
    logger.info(`[getid] ${t("getid.connecting")}`);

    await hydrateFromCache(sharedStore);

    const CONNECT_TIMEOUT_MS = 25000;
    const MAX_ATTEMPTS = 3;
    const MAX_ROUNDS = 2;
    const getidAuthDir = `${CLIENT_ID}-getid`;

    let sock: WASocket | null = null;
    let store: WAStore | null = null;

    for (let round = 1; round <= MAX_ROUNDS && !sock; round++) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !sock; attempt++) {
        const created = await createSocket(getidAuthDir);

        // Not a spinner here on purpose: if this session isn't paired yet,
        // Baileys prints the QR/pairing code through the normal logger
        // right after this — a spinner redrawing the line would bury it,
        // so the person never gets a chance to approve it on their phone
        // and the connection hangs forever waiting for "open".
        const opened = await new Promise<boolean>((resolve) => {
          let settled = false;

          const timer = setTimeout(() => {
            if (!settled) { settled = true; resolve(false); }
          }, CONNECT_TIMEOUT_MS);

          created.sock.ev.on("connection.update", (update) => {
            if (settled) return;

            if (update.connection === "open") {
              settled = true;
              clearTimeout(timer);
              resolve(true);
            } else if (update.connection === "close") {
              const code = (update.lastDisconnect?.error as Boom)?.output?.statusCode;
              settled = true;
              clearTimeout(timer);
              logger.warn(`[getid] ${t("getid.connectFailed", { reason: String(code ?? "?") })}`);
              resolve(false);
            }
          });
        });

        if (opened) {
          sock = created.sock;
          store = created.store;
          break;
        }

        try {
          (created.sock.ev as unknown as NodeJS.EventEmitter)?.removeAllListeners();
          created.sock.end(undefined);
        } catch {}

        if (attempt < MAX_ATTEMPTS) {
          logger.info(`[getid] ${t("getid.retrying", { attempt: attempt + 1, max: MAX_ATTEMPTS })}`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // Exhausted every attempt this round without ever reaching "open" —
      // likely a corrupted/stuck -getid session (not the normal first-pairing
      // 515, which already succeeds within a round). Wipe it and re-pair
      // from scratch instead of forcing the person to rerun the command.
      if (!sock && round < MAX_ROUNDS) {
        logger.warn(`[getid] ${t("getid.sessionWiped", { round: round + 1, max: MAX_ROUNDS })}`);
        try {
          await fs.rm(sessionDir(getidAuthDir), { recursive: true, force: true });
        } catch (e) {
          logger.error(`[getid] Failed to remove session dir: ${(e as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!sock || !store) {
      logger.error(`[getid] ${t("getid.connectGaveUp")}`);
      return;
    }

    const s = clack.spinner();
    s.start(t("getid.syncingChats"));

    // History sync arrives as several independent streams (chats,
    // contacts, push-names...), each firing its own `isLatest: true` when
    // THAT stream ends — not when everything is done. Stopping on the
    // first one cuts the others short (fewer chats, missing names).
    // Instead, wait for a quiet period with no sync activity at all.
    let lastActivityAt: number | null = null;
    const markActivity = () => { lastActivityAt = Date.now(); };
    sock.ev.on("messaging-history.set", markActivity);
    sock.ev.on("chats.upsert", markActivity);
    sock.ev.on("contacts.upsert", markActivity);
    sock.ev.on("contacts.update", markActivity);

    const QUIET_MS = 2000;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (lastActivityAt !== null && Date.now() - lastActivityAt >= QUIET_MS) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const chats = store.chats.all();
    s.stop(t("getid.chatsFound", { count: chats.length }));

    await saveChatCache(store);

    try {
      (sock.ev as unknown as NodeJS.EventEmitter)?.removeAllListeners();
      sock.end(undefined);
    } catch {}

    if (chats.length === 0) {
      logger.warn(`[getid] ${t("getid.noChatsSynced")}`);
      return;
    }

    const options = chats
      .map((chat) => {
        const isGroup = chat.id.endsWith("@g.us");
        const resolved = normalizeJid(store.resolveJid(chat.id));
        const contact  = store.contacts[chat.id] ?? store.contacts[resolved];
        const hasChatName = chat.name && chat.name !== chat.id.split("@")[0];
        const displayName = hasChatName ? chat.name : contact?.name ?? contact?.notify ?? resolved;
        return {
          value: resolved,
          label: `${isGroup ? "👥" : "👤"} ${displayName}`,
          hint:  resolved,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const picked = await clack.multiselect({
      message: t("getid.pickPrompt"),
      options,
      required: true,
    });

    if (clack.isCancel(picked)) {
      clack.cancel(t("getid.cancelled"));
      return;
    }

    const ids = picked as string[];
    const joined = ids.join("\n");
    const copied = await copyToClipboard(joined);

    if (copied) {
      logger.success(`[getid] ${t("getid.copied", { count: ids.length, ids: joined })}`);
    } else {
      logger.warn(`[getid] ${t("getid.copyFailed", { count: ids.length, ids: joined })}`);
    }
  },
};
