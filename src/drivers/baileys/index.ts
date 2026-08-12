/**
 * drivers/baileys/index.ts
 *
 * Main WhatsApp driver entry point (Baileys implementation).
 *
 * Owns the socket state machine (connect / disconnect / reconnect /
 * circuit breaker) and exposes the live `WaContract` adapter to the
 * rest of the kernel. Plugins, sendFallbackGuard, messageHandler,
 * pluginLoader, contactAutoSave and sendGuard all consume the
 * `WaContract` returned here — they never touch the raw Baileys socket.
 *
 * The contract's per-call methods (sendText, react, presence, etc.)
 * come from `./adapter.ts` (createBaileysAdapter). The lifecycle
 * methods (connect / disconnect / isReady) live HERE because they
 * also drive the chat-cache persistence, plugin reload, alert
 * registration, and the reconnect circuit breaker — none of which
 * the adapter should know about.
 *
 * For the verification-required path (sendFallbackGuard), the contract
 * also exposes `getHistory?` — which the adapter populates from the
 * Baileys store.messages map on demand.
 */

import { createSocket, AUTH_DIR, store as sharedStore } from "./sdk/baileysSock.js";
import { createBaileysAdapter } from "./adapter.js";
import { handleMessage } from "./messageHandler.js";
import { normalizeJid } from "#drivers/jid.js";
import { loadPlugins, setupPlugins } from "#kernel/pluginLoader.js";
import { runContactRefreshSweep } from "#kernel/contactAutoSave.js";
import { registerAlertSockProvider, sendAlert } from "#kernel/alerts.js";
import { getDriverManager } from "#kernel/driverManager.js";
import { startUpdateCheckSchedule, stopUpdateCheckSchedule } from "#kernel/updateCheck.js";
import { setStatus } from "#kernel/statusServer.js";
import { logger } from "#logger";
import { PLUGINS, CLIENT_ID } from "#config";
import { t } from "#i18n";
import { printBanner } from "#client/banner.js";
import { loadChatCache, saveChatCache, isCacheFresh } from "#client/cache.js";
import type { WASocket, WAStore, WAProtoMsg } from "#types";
import type { WaContract } from "#kernel/waContract.js";
import { Boom } from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";
import fs from "fs/promises";
import * as clack from "@clack/prompts";
import { copyToClipboard } from "#utils/clipboard.js";
import { applyPatches } from "../patches/index.js";

applyPatches();

let state = "BOOT";
let shuttingDown = false;
let currentSock: WASocket | null = null;
let currentStore: WAStore | null = null;
let currentAdapter: { contract: WaContract; rebind: (s: WASocket) => void; unbind: (s: WASocket) => void } | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let connecting = false;
let reconnectAttempts = 0;
let halted = false;
let cacheHydrated = false;
let cacheSaveTimer: NodeJS.Timeout | null = null;
let contactRefreshTimer: NodeJS.Timeout | null = null;

registerAlertSockProvider(() => currentSock);

// ── Per-chat message queue ──────────────────────────────────────────────────
// Messages from the same chat are processed one at a time (in order), but
// different chats run concurrently — a slow plugin in one chat (e.g. sticker
// generation) no longer blocks replies in every other chat.
const chatQueues = new Map<string, Promise<void>>();

function enqueueForChat(jid: string, task: () => Promise<void>): void {
  const prev = chatQueues.get(jid) ?? Promise.resolve();

  const settled = prev.catch(() => {}).then(task).catch((e) => {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error(`${err.message}\n${err.stack}`);
  });

  chatQueues.set(jid, settled);

  settled.finally(() => {
    if (chatQueues.get(jid) === settled) chatQueues.delete(jid);
  });
}

// Messages older than this (WhatsApp's own delivery delay — e.g. backlog
// dumped after the bot reconnects) are skipped. Checked at arrival time,
// so time spent waiting in chatQueues never counts against a message.
const MAX_MESSAGE_AGE_SECONDS = 60;

function isMessageStale(timestamp: number): boolean {
  if (!timestamp) return false;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const age = nowInSeconds - timestamp;
  if (age > MAX_MESSAGE_AGE_SECONDS) return true;
  return false;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 60000;
// Circuit breaker: after this many consecutive failed reconnects, stop
// retrying automatically instead of hammering the connection forever.
// Rapid repeated attempts are themselves a ban signal (WhatsApp's abuse
// detection treats connect/disconnect loops as suspicious automation and
// each failed re-pairing attempt during a cooldown resets its timer), so
// silently retrying past this point can make a restriction last longer.
const MAX_RECONNECT_ATTEMPTS = 6;
const CACHE_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5min
// Track consecutive restartRequired (515) — same counter space as
// reconnectAttempts but with a lower threshold for degradation since
// repeated 515 signals a protocol drift the current session can't
// recover from on its own.
const MAX_RESTART_REQUIRED = 3;
let restartRequiredCount = 0;

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

// Runs a few times a day, each time touching only a couple of stale
// contacts (see REFRESH_SWEEP_SAMPLE) — deliberately slow and staggered,
// same anti-detection reasoning as everything else in sendGuard.
const CONTACT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function startContactRefreshSweep(contract: WaContract) {
  if (contactRefreshTimer) return;
  contactRefreshTimer = setInterval(() => {
    runContactRefreshSweep(contract).catch(() => {});
  }, CONTACT_REFRESH_INTERVAL_MS);
}

function stopContactRefreshSweep() {
  if (!contactRefreshTimer) return;
  clearInterval(contactRefreshTimer);
  contactRefreshTimer = null;
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

  // Build the driver-neutral WaContract adapter on top of this socket.
  // Everything in the kernel (setupPlugins, handleMessage, sendGuard,
  // contactAutoSave, ...) talks to the contract, never to the raw sock
  // directly — that's how the whatsmeow driver plugs in as a second
  // adapter without any of them knowing which one is active.
  const adapter = createBaileysAdapter({ sock, store });
  currentAdapter = adapter;
  const contract: WaContract = adapter.contract;

  connecting = false;

  let pluginsReady = false;

  // ── Normal bot mode ─────────────────────────────────────────────────────────

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      state = "READY_INIT";
      reconnectAttempts = 0;
      restartRequiredCount = 0;
      setStatus(true);
      logger.success(t("system.connected"));
      logger.info(t("system.clientId", { id: CLIENT_ID }));
      printBanner();

      if (!pluginsReady) {
        pluginsReady = true;
        await loadPlugins(PLUGINS);
        await setupPlugins(contract, store);
      }
      startCacheAutosave(store);
      startContactRefreshSweep(contract);
      startUpdateCheckSchedule();

      // buffer anti-replay / sync ghost messages
      setTimeout(() => { state = "READY"; }, 2000);
    }

    if (connection === "close") {
      const code      = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      const badSession = code === DisconnectReason.badSession;
      const restartReq = code === DisconnectReason.restartRequired;
      state = "BOOT";
      setStatus(false, String(code));

      logger.warn(t("system.disconnected", { reason: String(code) }));

      if (loggedOut || badSession) {
        if (badSession) {
          logger.warn("Session data corrupted (badSession=500). Clearing session dir.");
          getDriverManager().markDegraded("baileys", 300_000);
        } else {
          logger.warn(t("system.sessionExpired"));
        }
        try {
          await fs.rm(AUTH_DIR, { recursive: true, force: true });
        } catch (e) {
          logger.error(`[whatsapp] Failed to remove session dir: ${(e as Error).message}`);
        }
        scheduleReconnect(1000);
      } else if (restartReq) {
        restartRequiredCount++;
        if (restartRequiredCount >= MAX_RESTART_REQUIRED) {
          halted = true;
          logger.error(`restartRequired (515) recurring — protocol drift suspected. Halting.`);
          getDriverManager().markDegraded("baileys", 600_000);
          sendAlert({
            level:   "critical",
            title:   "manybot — restartRequired recurring",
            message: `Protocol drift suspected after ${restartRequiredCount}x restartRequired. Bot halted on Baileys. Run connect() manually.`,
          }).catch(() => {});
          return;
        }
        const delay = Math.min(500, RECONNECT_BASE_MS);
        logger.info(t("system.reconnecting", { secs: Math.round(delay / 1000) }));
        scheduleReconnect(delay);
      } else if (!shuttingDown) {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          halted = true;
          getDriverManager().markDegraded("baileys", 600_000);
          logger.error(t("system.reconnectHalted", { attempts: reconnectAttempts }));
          sendAlert({
            level:   "critical",
            title:   "manybot parou de tentar reconectar",
            message: `Desisti após ${reconnectAttempts} tentativas — possível restrição de conta. Rode connect() manualmente pra tentar de novo.`,
          }).catch(() => {});
          return;
        }
        const delay = nextBackoffMs();
        logger.info(t("system.reconnecting", { secs: Math.round(delay / 1000) }));
        scheduleReconnect(delay);
      }
    }
  });

  // Subscribe to the contract's translated messages.upsert events so
  // there's a single placeholder where the WAMessage → BotMessage
  // conversion lives (the adapter). The adapter's rebind() handles
  // re-subscribing on the fresh socket on reconnect — we registered
  // once here, that's it.
  contract.on("messages.upsert", ({ messages, type }) => {
    if (state !== "READY") return;
    if (type !== "notify" && type !== "append") return;

    for (const msg of messages) {
      const tsSec = Math.floor(msg.timestamp / 1000);
      if (type === "append" && !msg.fromMe) continue;
      if (isMessageStale(tsSec)) continue;

      const jid = normalizeJid(msg.chatId);
      enqueueForChat(jid, () => handleMessage(msg, contract, store));
    }
  });
}

/**
 * isReady() mirrors the "open" event from Baileys — once connect() resolves
 * we don't yet have a session, so we wait for the connection.update === "open"
 * path to flip the flag. isReady() requires true ONLY after both.
 */
function sockIsOpen(): boolean {
  return state === "READY" || state === "READY_INIT";
}

// ── Public driver: WaContract ────────────────────────────────────────────────
//
// Drivers expose the full WaContract surface: the kernel plugs in this
// object, and the lifecycle methods (connect / disconnect / isReady) wrap
// the startBot state machine. Until connect() resolves, the contract's
// per-call methods throw — plugins are only loaded after `connection.update
// === "open"`, so they never see the pre-connect state.

function requireReady(): WaContract {
  if (!currentAdapter) {
    throw new Error("[baileys] driver not connected — call connect() first");
  }
  return currentAdapter.contract;
}

export const baileysContract: WaContract & { getId?(): Promise<void> } = {
  name: "baileys" as const,

  async connect() {
    shuttingDown = false;
    halted = false;
    reconnectAttempts = 0;
    await startBot();
  },

  async disconnect() {
    shuttingDown = true;
    reconnectAttempts = 0;
    setStatus(false);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopCacheAutosave();
    stopContactRefreshSweep();
    stopUpdateCheckSchedule();
    if (currentStore) await saveChatCache(currentStore);
    teardownSock(currentSock);
    currentSock = null;
    currentStore = null;
    currentAdapter = null;
  },

  isReady() {
    return sockIsOpen();
  },

  // ── event passthrough ───────────────────────────────────────────────────
  on: (...args) => requireReady().on(...args),
  resolveLid: (...args) => {
    const c = requireReady();
    return c.resolveLid ? c.resolveLid(...args) : Promise.resolve(null);
  },

  // ── send ────────────────────────────────────────────────────────────────
  sendText:    (...args) => requireReady().sendText(...args),
  sendImage:   (...args) => requireReady().sendImage(...args),
  sendVideo:   (...args) => requireReady().sendVideo(...args),
  sendAudio:   (...args) => requireReady().sendAudio(...args),
  sendSticker: (...args) => requireReady().sendSticker(...args),
  sendDocument:(...args) => requireReady().sendDocument(...args),
  sendPoll:    (...args) => requireReady().sendPoll(...args),

  // ── react / edit / delete ───────────────────────────────────────────────
  react:         (...args) => requireReady().react(...args),
  deleteMessage: (...args) => requireReady().deleteMessage(...args),
  editMessage:   (...args) => requireReady().editMessage(...args),

  // ── presence + read ─────────────────────────────────────────────────────
  sendPresenceUpdate: (...args) => requireReady().sendPresenceUpdate(...args),
  readMessages:       (...args) => requireReady().readMessages(...args),

  // ── contacts ────────────────────────────────────────────────────────────
  onWhatsApp:        (...args) => requireReady().onWhatsApp(...args),
  getBusinessProfile:(...args) => requireReady().getBusinessProfile(...args),
  profilePictureUrl: (...args) => requireReady().profilePictureUrl(...args),
  fetchStatus:       (...args) => requireReady().fetchStatus(...args),
  updateBlockStatus: (...args) => requireReady().updateBlockStatus(...args),
  addOrEditContact:  (...args) => requireReady().addOrEditContact(...args),
  removeContact:     (...args) => requireReady().removeContact(...args),

  // ── groups ──────────────────────────────────────────────────────────────
  groupMetadata:           (...args) => requireReady().groupMetadata(...args),
  groupParticipantsUpdate:(...args) => requireReady().groupParticipantsUpdate(...args),
  groupUpdateSubject:      (...args) => requireReady().groupUpdateSubject(...args),
  groupUpdateDescription: (...args) => requireReady().groupUpdateDescription(...args),
  groupInviteCode:         (...args) => requireReady().groupInviteCode(...args),
  groupRevokeInvite:       (...args) => requireReady().groupRevokeInvite(...args),

  // ── profile ────────────────────────────────────────────────────────────
  updateProfilePicture: (...args) => requireReady().updateProfilePicture(...args),
  updateProfileName:    (...args) => requireReady().updateProfileName(...args),
  updateProfileStatus:  (...args) => requireReady().updateProfileStatus(...args),

  // ── me ──────────────────────────────────────────────────────────────────
  me: () => requireReady().me(),

  // ── media (download) ────────────────────────────────────────────────────
  downloadMedia: (...args) => requireReady().downloadMedia(...args),

  // ── verification primitive ─────────────────────────────────────────────
  // Delegates to the adapter, which reads from the in-memory Baileys
  // store (store.messages). The adapter guarantees getHistory is defined
  // (the Baileys adapter guarantees getHistory is defined), so the defensive fallback is gone.
  getHistory: (jid, opts) => requireReady().getHistory!(jid, opts),

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
          const timer = setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS);
          created.sock.ev.on("connection.update", (u) => {
            if (u.connection === "open") {
              clearTimeout(timer);
              resolve(true);
            }
          });
        });

        if (!opened) {
          logger.warn(`[getid] round ${round} attempt ${attempt} timed out waiting for "open"`);
          teardownSock(created.sock);
          continue;
        }

        sock = created.sock;
        store = created.store;
      }
    }

    if (!sock || !store) {
      logger.error(`[getid] failed to open a session after ${MAX_ROUNDS * MAX_ATTEMPTS} attempts`);
      process.exit(1);
    }

    // Wait for the initial chat sync to land in the store.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      sock!.ev.on("messaging-history.set", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const chats = store.chats.all();
    if (chats.length === 0) {
      logger.warn(`[getid] no chats synced yet — try again in a few seconds`);
      teardownSock(sock);
      process.exit(1);
    }

    const sorted = chats
      .map((c: { id: string; name?: string }) => ({ id: c.id, name: c.name ?? "" }))
      .sort((a: { id: string; name: string }, b: { id: string; name: string }) => a.name.localeCompare(b.name));

    const picked = await clack.select({
      message: t("getid.pickChat"),
      options: sorted.map((c: { id: string; name: string }) => ({ label: c.name || c.id, value: c.id })),
    });

    if (clack.isCancel(picked) || typeof picked !== "string") {
      teardownSock(sock);
      process.exit(0);
    }

    const resolved = await resolveLidForJid(sock, picked);
    const finalJid = resolved ?? picked;
    try {
      await copyToClipboard(finalJid);
      logger.success(`[getid] ${t("getid.copied", { id: finalJid })}`);
    } catch {
      logger.info(`[getid] ${finalJid}`);
    }

    teardownSock(sock);
  },
};

/**
 * Try to resolve a `@lid` JID to its real `@s.whatsapp.net` form via the
 * Baileys signal repository. Returns null if the adapter doesn't expose
 * one (very old sessions) or the lookup fails.
 */
async function resolveLidForJid(sock: WASocket, jid: string): Promise<string | null> {
  try {
    const repo = (sock as unknown as { signalRepository?: { lidMapping?: { getPNForLID?(l: string): Promise<string | null> } } }).signalRepository;
    const fn = repo?.lidMapping?.getPNForLID;
    if (typeof fn === "function") {
      const pn = await fn(jid);
      return pn ?? null;
    }
  } catch {}
  return null;
}

/**
 * Backwards-compat: callers that still import `baileysDriver` get the
 * new contract object. The old `WaDriver` surface is gone — kernel
 * code that needs the driver only ever sees the `WaContract` now.
 *
 * @deprecated Use `baileysContract` directly.
 */
export const baileysDriver: WaContract & { getId?(): Promise<void> } = baileysContract;

// ── Baileys-only helpers used by the plugin-context builder ─────────────────
// The plugin-context layer (drivers/baileys/api/index.ts) still works
// against Baileys' raw WAMessage shape for things that don't yet have a
// driver-neutral equivalent (poll decryption, gif detection, history
// reconstruction from store.messages). These helpers stay here so the
// api file can convert a raw WAMessage into a driver-neutral BotMessage
// without re-importing the adapter's private internals.

import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { createHash } from "node:crypto";

/**
 * Map a Baileys WAMessage into the driver-neutral BotMessage envelope.
 * Mirrors the adapter's internal conversion (the two diverged once —
 * keep them in sync if you change one).
 */
export function toBotMessage(msg: WAProtoMsg): import("#drivers/types.js").BotMessage {
  const m = normalizeMessageContent(msg.message) as
    | {
        conversation?: string;
        extendedTextMessage?: { text?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        imageMessage?:    { caption?: string; mimetype?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        videoMessage?:    { caption?: string; mimetype?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        audioMessage?:    { mimetype?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        documentMessage?: { caption?: string; mimetype?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        stickerMessage?:  { mimetype?: string; contextInfo?: { stanzaId?: string; participant?: string; mentionedJid?: string[] } };
        messageContextInfo?: { messageSecret?: number[] | Uint8Array };
      }
    | null
    | undefined;

  let type: import("#drivers/types.js").BotMessage["type"] = "other";
  let text = "";
  let mimetype: string | undefined;
  if (m?.conversation)                       { type = "text";     text = m.conversation; }
  else if (m?.extendedTextMessage?.text)     { type = "text";     text = m.extendedTextMessage.text; }
  else if (m?.imageMessage)                  { type = "image";    text = m.imageMessage.caption    ?? ""; mimetype = m.imageMessage.mimetype    ?? undefined; }
  else if (m?.videoMessage)                  { type = "video";    text = m.videoMessage.caption    ?? ""; mimetype = m.videoMessage.mimetype    ?? undefined; }
  else if (m?.audioMessage)                  { type = "audio";    text = ""; mimetype = m.audioMessage.mimetype ?? undefined; }
  else if (m?.documentMessage)               { type = "document"; text = m.documentMessage.caption ?? ""; mimetype = m.documentMessage.mimetype ?? undefined; }
  else if (m?.stickerMessage)                { type = "sticker";  text = ""; mimetype = m.stickerMessage.mimetype ?? undefined; }

  const key = msg.key as unknown as {
    participant?: string; participantAlt?: string;
    remoteJid?: string;  remoteJidAlt?: string;
  };
  const contextInfo =
    m?.extendedTextMessage?.contextInfo ??
    m?.imageMessage?.contextInfo ??
    m?.videoMessage?.contextInfo ??
    m?.audioMessage?.contextInfo ??
    m?.documentMessage?.contextInfo ??
    undefined;

  return {
    id:          msg.key?.id ?? "",
    chatId:      normalizeJid(msg.key?.remoteJid ?? ""),
    fromMe:      !!msg.key?.fromMe,
    type,
    contentHash: hashText(text),
    timestamp:   Number(msg.messageTimestamp ?? 0) * 1000,
    body:           text || undefined,
    mimetype,
    pushName:       msg.pushName ?? undefined,
    mentionedJid:   contextInfo?.mentionedJid ?? undefined,
    quotedKey:      contextInfo?.stanzaId ? {
      id:          contextInfo.stanzaId,
      remoteJid:   msg.key?.remoteJid ?? undefined,
      fromMe:      false,
      participant: contextInfo.participant ?? undefined,
    } : undefined,
    fromLid:        key.participantAlt,
    fromPn:         key.participant,
    participantAlt: key.participantAlt,
    remoteJidAlt:   key.remoteJidAlt,
    _raw: {
      pollEncKeyRaw: m?.messageContextInfo?.messageSecret ?? undefined,
    },
  };
}

function hashText(text: string): string {
  return createHash("sha1").update(text.trim(), "utf8").digest("hex");
}
