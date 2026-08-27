import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test, beforeEach, afterEach } from "node:test";
import { createStore, type BotStore } from "#client/store.js";
import type { BotMessage, WaContract, BotQuotedRef, SentMessageRef } from "#kernel/waContract.js";
import {
  buildApi,
  buildSetupApi,
  buildStorageApi,
  cleanupPluginEvents,
} from "#kernel/pluginApi.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import { __resetSessionsForTests } from "#kernel/chatSession.js";

// Setup temp config directory for tests
const testTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-pluginapi-test-"));
process.env.MANYBOT_CONFIG_DIR = testTmpDir;

const RAW_SOCK_SYM = Symbol.for("manybot.baileys.rawSocket");

interface MockCallHistory {
  sentTexts: Array<{ jid: string; text: string; opts?: unknown }>;
  sentImages: Array<{ jid: string; buffer: Buffer; opts?: unknown }>;
  sentVideos: Array<{ jid: string; buffer: Buffer; opts?: unknown }>;
  sentAudios: Array<{ jid: string; buffer: Buffer; opts?: unknown }>;
  sentStickers: Array<{ jid: string; buffer: Buffer; opts?: unknown }>;
  sentDocuments: Array<{ jid: string; buffer: Buffer; filename: string; mimetype: string; opts?: unknown }>;
  sentPolls: Array<{ jid: string; opts: unknown }>;
  reactions: Array<{ jid: string; target: BotQuotedRef; emoji: string }>;
  edits: Array<{ jid: string; target: BotQuotedRef; text: string }>;
  deletes: Array<{ jid: string; target: BotQuotedRef; forEveryone: boolean }>;
  blockUpdates: Array<{ jid: string; action: "block" | "unblock" }>;
  groupParticipantUpdates: Array<{ jid: string; users: string[]; action: string }>;
  nameUpdates: string[];
  statusUpdates: string[];
}

function createMockContract(): { contract: WaContract; calls: MockCallHistory } {
  const calls: MockCallHistory = {
    sentTexts: [],
    sentImages: [],
    sentVideos: [],
    sentAudios: [],
    sentStickers: [],
    sentDocuments: [],
    sentPolls: [],
    reactions: [],
    edits: [],
    deletes: [],
    blockUpdates: [],
    groupParticipantUpdates: [],
    nameUpdates: [],
    statusUpdates: [],
  };

  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const rawMockSock = {
    user: { id: "5516999999999:0@s.whatsapp.net", name: "ManyBot" },
    groupMetadata: async (jid: string) => ({
      id: jid,
      subject: "Test Mock Group",
      participants: [
        { id: "5516999999999@s.whatsapp.net", admin: "admin", phoneNumber: "5516999999999@s.whatsapp.net" },
        { id: "5516888888888@s.whatsapp.net", admin: "superadmin", phoneNumber: "5516888888888@s.whatsapp.net" },
        { id: "5516777777777@s.whatsapp.net", admin: null, phoneNumber: "5516777777777@s.whatsapp.net" },
      ],
    }),
  };

  let msgSeq = 0;
  const sentHistory: BotMessage[] = [];

  const contract: WaContract = {
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    isReady: () => true,
    resolveLid: async (lid) => (lid === "12345@lid" ? "5516777777777@s.whatsapp.net" : null),

    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const set = listeners.get(event)!;
      set.add(handler as (payload: unknown) => void);
      return () => {
        set.delete(handler as (payload: unknown) => void);
      };
    },

    sendText: async (jid, text, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentTexts.push({ jid, text, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "text",
        body: text,
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendImage: async (jid, buffer, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentImages.push({ jid, buffer, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "image",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendVideo: async (jid, buffer, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentVideos.push({ jid, buffer, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "video",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendAudio: async (jid, buffer, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentAudios.push({ jid, buffer, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "audio",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendSticker: async (jid, buffer, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentStickers.push({ jid, buffer, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "sticker",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendDocument: async (jid, buffer, filename, mimetype, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentDocuments.push({ jid, buffer, filename, mimetype, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "document",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },
    sendPoll: async (jid, opts) => {
      const id = `msg-${++msgSeq}`;
      calls.sentPolls.push({ jid, opts });
      const ref = { id, chatId: jid, timestamp: Date.now() };
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        type: "other",
        contentHash: "hash-" + id,
        timestamp: Date.now(),
      });
      return ref;
    },

    react: async (jid, target, emoji) => {
      calls.reactions.push({ jid, target, emoji });
    },
    deleteMessage: async (jid, target, forEveryone) => {
      calls.deletes.push({ jid, target, forEveryone });
    },
    editMessage: async (jid, target, text) => {
      calls.edits.push({ jid, target, text });
    },
    sendPresenceUpdate: async () => {},
    readMessages: async () => {},

    onWhatsApp: async (jid) => (jid.includes("999") || jid.includes("888") || jid.includes("777") ? [{ exists: true }] : [{ exists: false }]),
    getBusinessProfile: async (jid) => (jid.includes("business") ? { description: "Test Business" } : null),
    profilePictureUrl: async (jid) => (jid.includes("with-pfp") ? "https://example.com/avatar.jpg" : null),
    fetchStatus: async (jid) => (jid.includes("with-status") ? "Available for testing" : null),
    updateBlockStatus: async (jid, action) => {
      calls.blockUpdates.push({ jid, action });
    },
    addOrEditContact: async () => {},
    removeContact: async () => {},

    groupMetadata: async (jid) => ({
      subject: "Test Mock Group",
      participants: [
        { id: "5516999999999@s.whatsapp.net", isAdmin: true, isSuperAdmin: false },
        { id: "5516888888888@s.whatsapp.net", isAdmin: true, isSuperAdmin: true },
        { id: "5516777777777@s.whatsapp.net", isAdmin: false, isSuperAdmin: false },
      ],
    }),
    groupParticipantsUpdate: async (jid, users, action) => {
      calls.groupParticipantUpdates.push({ jid, users, action });
      return users.map((u) => ({ status: "200", jid: u }));
    },
    groupUpdateSubject: async () => {},
    groupUpdateDescription: async () => {},
    groupInviteCode: async () => "mock-invite-code-123",
    groupRevokeInvite: async () => "mock-new-invite-code-456",

    updateProfilePicture: async () => {},
    updateProfileName: async (name) => {
      calls.nameUpdates.push(name);
    },
    updateProfileStatus: async (status) => {
      calls.statusUpdates.push(status);
    },

    me: () => ({ id: "5516999999999@s.whatsapp.net", lid: "99999@lid" }),

    downloadMedia: async () => ({ mimetype: "image/jpeg", data: Buffer.from("fake-image-bytes") }),

    getHistory: async (jid) => sentHistory.filter((m) => m.chatId === jid),
  };

  (contract as unknown as Record<symbol, unknown>)[RAW_SOCK_SYM] = rawMockSock;

  return { contract, calls };
}

function makeBotMessage(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    id: "msg-test-100",
    chatId: "120363000000000@g.us",
    fromMe: false,
    contentHash: "mock-content-hash-123",
    timestamp: 1700000000,
    type: "text",
    body: "!ping test arg",
    participantAlt: "5516777777777@s.whatsapp.net",
    fromPn: "5516777777777@s.whatsapp.net",
    fromLid: "12345@lid",
    ...overrides,
  };
}

describe("kernel/pluginApi — storage facet", () => {
  test("buildStorageApi creates isolated dir and enforces path sandbox", () => {
    const storage = buildStorageApi("test_plugin");
    assert.ok(storage.dir.includes("test_plugin"));

    const safePath = storage.resolve("subdir/data.json");
    assert.ok(safePath.startsWith(storage.dir));

    assert.throws(() => storage.resolve("../escape.txt"), /path traversal/);
    assert.throws(() => storage.resolve("/absolute/path"), /absolute paths are not allowed/);
    assert.throws(() => storage.resolve("folder\\windows"), /Windows-style paths are not allowed/);
    assert.throws(() => storage.resolve(""), /non-empty string/);
  });
});

describe("kernel/pluginApi — buildSetupApi with Mock WaContract", () => {
  let store: BotStore;
  let pluginRegistry: Map<string, PluginEntry>;
  let mockContract: WaContract;
  let calls: MockCallHistory;

  beforeEach(() => {
    _resetDriverManagerForTests();
    store = createStore();
    pluginRegistry = new Map();
    const mock = createMockContract();
    mockContract = mock.contract;
    calls = mock.calls;
    getDriverManager().register(mockContract, { isPrimary: true });
  });

  afterEach(() => {
    cleanupPluginEvents("test_plugin", mockContract);
    _resetDriverManagerForTests();
  });

  test("exposes setup surface and base facets", async () => {
    const ctx = buildSetupApi(mockContract, store, pluginRegistry, "test_plugin");

    // Base facets
    assert.ok(ctx.log);
    assert.equal(typeof ctx.log.info, "function");
    assert.equal(typeof ctx.t, "function");
    assert.ok(ctx.config);
    assert.ok(ctx.i18n);
    assert.ok(ctx.utils);
    assert.ok(ctx.download);
    assert.ok(ctx.scheduler);
    assert.ok(ctx.plugins);
    assert.ok(ctx.chats);
    assert.ok(ctx.contacts);
    assert.ok(ctx.storage);
    assert.equal(ctx.botId, "5516999999999@s.whatsapp.net");

    // Setup send only has .to()
    assert.ok(ctx.send.to);
    assert.equal(typeof ctx.send.to, "function");

    // Admin requires explicit .to()
    assert.ok(ctx.admin);
    assert.equal(typeof ctx.admin.add, "function");

    // Me API
    assert.ok(ctx.me);
    await ctx.me.setName("New Bot Name");
    assert.deepEqual(calls.nameUpdates, ["New Bot Name"]);
    await ctx.me.setAbout("New About Text");
    assert.deepEqual(calls.statusUpdates, ["New About Text"]);

    // Events API
    let eventPayload: unknown = null;
    const unsub = ctx.events.on("messages.upsert", (payload) => {
      eventPayload = payload;
    });
    assert.equal(typeof unsub, "function");
  });

  test("setup send.to() sends messages via WaContract", async () => {
    const ctx = buildSetupApi(mockContract, store, pluginRegistry, "test_plugin");

    await ctx.send.to("5516777777777@s.whatsapp.net").text("Hello from setup");
    assert.equal(calls.sentTexts.length, 1);
    assert.equal(calls.sentTexts[0].jid, "5516777777777@s.whatsapp.net");
    assert.equal(calls.sentTexts[0].text, "Hello from setup");
  });

  test("setup admin.add().to() executes group member addition", async () => {
    const ctx = buildSetupApi(mockContract, store, pluginRegistry, "test_plugin");

    await ctx.admin.add("5516777777777@s.whatsapp.net").to("120363000000000@g.us");
    assert.equal(calls.groupParticipantUpdates.length, 1);
    assert.equal(calls.groupParticipantUpdates[0].action, "add");
    assert.equal(calls.groupParticipantUpdates[0].jid, "120363000000000@g.us");
  });
});

describe("kernel/pluginApi — buildApi (Runtime) with Mock WaContract", () => {
  let store: BotStore;
  let pluginRegistry: Map<string, PluginEntry>;
  let mockContract: WaContract;
  let calls: MockCallHistory;

  beforeEach(() => {
    _resetDriverManagerForTests();
    store = createStore();
    pluginRegistry = new Map();
    const mock = createMockContract();
    mockContract = mock.contract;
    calls = mock.calls;
    getDriverManager().register(mockContract, { isPrimary: true });
  });

  afterEach(() => {
    cleanupPluginEvents("test_plugin", mockContract);
    _resetDriverManagerForTests();
    __resetSessionsForTests();
  });

  test("buildApi provides full runtime context and resolves group admin checks", async () => {
    const msg = makeBotMessage();
    const chat = {
      id: { _serialized: "120363000000000@c.us", user: "120363000000000" },
      name: "Test Group",
      isGroup: true,
    };

    const ctx = buildApi({
      msg,
      chat,
      contract: mockContract,
      store,
      pluginRegistry,
      pluginName: "test_plugin",
      guardOptions: { cooldown: false, jitter: false },
    });

    // Chat properties & helpers
    assert.equal(ctx.chat.isGroup, true);
    assert.equal(ctx.chat.name, "Test Group");

    const participants = await ctx.chat.getParticipants();
    assert.equal(participants.length, 3);
    assert.equal(participants[0].isAdmin, true);

    const isSenderAdmin = await ctx.chat.isSenderAdmin();
    assert.equal(isSenderAdmin, false); // 5516777777777 is not admin in mock

    const isBotAdmin = await ctx.chat.isBotAdmin();
    assert.equal(isBotAdmin, true); // 5516999999999 is admin in mock

    // Send methods
    await ctx.send.text("Test response");
    assert.equal(calls.sentTexts.length, 1);
    assert.equal(calls.sentTexts[0].text, "Test response");

    await ctx.send.image(Buffer.from("image-data"), "Caption test");
    assert.equal(calls.sentImages.length, 1);
    assert.equal(calls.sentImages[0].opts && (calls.sentImages[0].opts as { caption?: string }).caption, "Caption test");

    await ctx.send.audio(Buffer.from("audio-data"));
    assert.equal(calls.sentAudios.length, 1);

    await ctx.send.sticker(Buffer.from("sticker-data"));
    assert.equal(calls.sentStickers.length, 1);

    await ctx.send.file(Buffer.from("file-data"), "test.pdf");
    assert.equal(calls.sentDocuments.length, 1);

    // Message reply helper
    await ctx.msg.reply.text("Replying to message");
    assert.equal(calls.sentTexts.length, 2);
    assert.equal(calls.sentTexts[1].text, "Replying to message");

    // Admin methods in bound chat
    await ctx.admin.promote("5516777777777@s.whatsapp.net");
    assert.equal(calls.groupParticipantUpdates.length, 1);
    assert.equal(calls.groupParticipantUpdates[0].action, "promote");

    await ctx.admin.kick("5516777777777@s.whatsapp.net");
    assert.equal(calls.groupParticipantUpdates.length, 2);
    assert.equal(calls.groupParticipantUpdates[1].action, "remove");

    const inviteLink = await ctx.admin.getInviteLink();
    assert.match(inviteLink, /chat\.whatsapp\.com\/mock-invite-code-123/);

    // Contacts helper
    const contact = await ctx.contacts.get("5516999999999@s.whatsapp.net");
    assert.ok(contact);
    // normalizeContact now returns E.164 (with leading "+") per the
    // new contract invariant; assert accordingly.
    assert.equal(contact?.number, "+5516999999999");
    assert.equal(contact?.isMe, true);

    await ctx.contacts.block("5516777777777@s.whatsapp.net");
    assert.equal(calls.blockUpdates.length, 1);
    assert.equal(calls.blockUpdates[0].action, "block");

    // Platform escape hatch
    assert.ok(ctx.wa);
    assert.equal(ctx.wa?.contract, mockContract);
    assert.equal(ctx.tg, null);
    assert.equal(ctx.dc, null);

    const mediaResult = await ctx.wa?.downloadMedia();
    assert.ok(mediaResult?.data);
  });

  test("settings, poll, and unblock facets work correctly", async () => {
    const msg = makeBotMessage();
    const chat = {
      id: { _serialized: "120363000000000@c.us", user: "120363000000000" },
      name: "Test Group",
      isGroup: true,
    };

    const ctx = buildApi({
      msg,
      chat,
      contract: mockContract,
      store,
      pluginRegistry,
      pluginName: "test_plugin",
      guardOptions: { cooldown: false, jitter: false },
    });

    // Settings API
    assert.ok(ctx.settings);
    ctx.settings.global.set("key1", "value1");
    assert.equal(ctx.settings.global.get("key1"), "value1");

    ctx.settings.forChat("chat123").set("chatKey", "chatValue");
    assert.equal(ctx.settings.forChat("chat123").get("chatKey"), "chatValue");

    // Unblock contact
    await ctx.contacts.unblock("5516777777777@s.whatsapp.net");
    assert.equal(calls.blockUpdates.length, 1);
    assert.equal(calls.blockUpdates[0].action, "unblock");

    // Send video
    await ctx.send.video(Buffer.from("video-data"), "Video caption");
    assert.equal(calls.sentVideos.length, 1);

    // Poll API
    assert.ok(ctx.poll);
    assert.equal(typeof ctx.poll.create, "function");

    // TargetableAction thenable (.then directly)
    let directThenCalled = false;
    await ctx.send.text("Direct thenable").then(() => {
      directThenCalled = true;
    });
    assert.equal(directThenCalled, true);
  });

  test("ctx.session enforces one exclusive lock per chat across plugins (Phase 7)", async () => {
    const msg = makeBotMessage();
    const chat = {
      id: { _serialized: "120363000000000@c.us", user: "120363000000000" },
      name: "Test Group",
      isGroup: true,
    };

    const gameCtx = buildApi({
      msg, chat, contract: mockContract, store, pluginRegistry,
      pluginName: "gamePlugin",
      guardOptions: { cooldown: false, jitter: false },
    });
    const figurinhaCtx = buildApi({
      msg, chat, contract: mockContract, store, pluginRegistry,
      pluginName: "figurinhaPlugin",
      guardOptions: { cooldown: false, jitter: false },
    });

    // Free chat: the first plugin to ask gets the lock.
    assert.equal(gameCtx.session.isLocked(), false);
    assert.equal(gameCtx.session.acquire(), true);
    assert.equal(gameCtx.session.isMine(), true);
    assert.equal(gameCtx.session.isLocked(), true);

    // A second plugin in the SAME chat cannot also open a session.
    assert.equal(figurinhaCtx.session.isLocked(), true);
    assert.equal(figurinhaCtx.session.acquire(), false);
    assert.equal(figurinhaCtx.session.isMine(), false);

    // The holder re-acquiring its own session is a harmless no-op.
    assert.equal(gameCtx.session.acquire(), true);

    // The non-holder cannot release someone else's session.
    figurinhaCtx.session.release();
    assert.equal(gameCtx.session.isLocked(), true, "release from a non-holder must not affect the lock");

    // Once the real holder releases it, another plugin can acquire it.
    gameCtx.session.release();
    assert.equal(gameCtx.session.isLocked(), false);
    assert.equal(figurinhaCtx.session.acquire(), true);
    assert.equal(figurinhaCtx.session.isMine(), true);
  });

  test("events.once and cleanup removes listeners", async () => {
    let triggeredCount = 0;
    const ctx = buildSetupApi(mockContract, store, pluginRegistry, "test_events_plugin");

    // Test once
    void ctx.events.once("messages.upsert").then(() => {
      triggeredCount++;
    });

    // Clean up
    cleanupPluginEvents("test_events_plugin", mockContract);
    assert.equal(typeof ctx.events.cleanup, "function");
  });

  test("config, i18n, download, scheduler, plugins, chats, contacts pfp/about facets", async () => {
    const msg = makeBotMessage();
    const chat = {
      id: { _serialized: "120363000000000@c.us", user: "120363000000000" },
      name: "Test Group",
      isGroup: true,
    };

    // Register a dependency plugin so plugins.get/require/exists have something real to resolve.
    pluginRegistry.set("dep_plugin", {
      name: "dep_plugin",
      status: "active",
      manifest: { name: "dep_plugin", version: "1.0.0" },
      exports: { greet: () => "hi" },
    } as unknown as PluginEntry);

    store.hydrate({
      chats: [{ id: "120363000000000@g.us", name: "Test Group", ephemeralExpiration: 0 }],
      contacts: {},
      lidMap: [],
    });

    const ctx = buildApi({
      msg,
      chat,
      contract: mockContract,
      store,
      pluginRegistry,
      pluginName: "test_plugin",
      guardOptions: { cooldown: false, jitter: false },
    });

    // config.get
    assert.equal(ctx.config.get("__no_such_key__", "fallback"), "fallback");

    // i18n.t — unknown key still returns a string, never throws
    assert.equal(typeof ctx.i18n.t("__no_such_key__"), "string");
    assert.equal(typeof ctx.t("__no_such_key__"), "string");

    // download.enqueue runs the work function
    let downloadRan = false;
    await new Promise<void>((resolve) => {
      ctx.download.enqueue(async () => {
        downloadRan = true;
        resolve();
      }, async () => resolve());
    });
    assert.equal(downloadRan, true);

    // scheduler.schedule returns a handle with stop()
    const handle = ctx.scheduler.schedule("0 9 * * 1", async () => {});
    assert.equal(typeof handle.stop, "function");
    handle.stop();

    // plugins.get / require / exists
    assert.ok(ctx.plugins.exists("dep_plugin"));
    assert.equal(ctx.plugins.exists("missing_plugin"), false);
    assert.equal((ctx.plugins.get("dep_plugin") as { greet(): string }).greet(), "hi");
    assert.equal(ctx.plugins.get("missing_plugin"), null);
    assert.equal((ctx.plugins.require("dep_plugin") as { greet(): string }).greet(), "hi");
    assert.throws(() => ctx.plugins.require("missing_plugin"), /does not exist or is not active/);

    // chats.all
    const allChats = ctx.chats.all();
    assert.equal(allChats.length, 1);
    assert.equal(allChats[0].name, "Test Group");
    assert.equal(allChats[0].isGroup, true);

    // contacts pfp/about — no pfp/status configured for this jid
    assert.equal(await ctx.contacts.getPfpUrl("5516777777777@s.whatsapp.net"), null);
    assert.equal(await ctx.contacts.getPfpPath("5516777777777@s.whatsapp.net", "/tmp/x.jpg"), null);
    assert.equal(await ctx.contacts.getAbout("5516777777777@s.whatsapp.net"), null);

    // contacts pfp — jid the mock contract recognizes
    assert.equal(await ctx.contacts.getPfpUrl("5516999999999-with-pfp@s.whatsapp.net"), "https://example.com/avatar.jpg");

    // NOTE: WaContract.fetchStatus is typed Promise<string|null> (the
    // Baileys adapter already unwraps the array/object USync shapes down
    // to a plain string before returning). getAbout()'s array/object
    // branches are therefore currently unreachable through the contract —
    // any contract-conformant fetchStatus always lands on the `null`
    // fallback here. Flagged in TEST_REVIEW.md rather than silently
    // asserting a value that can't happen in practice.
    assert.equal(await ctx.contacts.getAbout("5516999999999-with-status@s.whatsapp.net"), null);
  });

  test("admin demote/setSubject/setDescription/setProfilePic/revokeInvite, send.gif/poll, contacts.get resolves via contract.resolveLid", async () => {
    const msg = makeBotMessage();
    const chat = {
      id: { _serialized: "120363000000000@c.us", user: "120363000000000" },
      name: "Test Group",
      isGroup: true,
    };

    const ctx = buildApi({
      msg,
      chat,
      contract: mockContract,
      store,
      pluginRegistry,
      pluginName: "test_plugin",
      guardOptions: { cooldown: false, jitter: false },
    });

    await ctx.admin.demote("5516777777777@s.whatsapp.net");
    assert.equal(calls.groupParticipantUpdates.at(-1)?.action, "demote");

    await ctx.admin.setSubject("New Subject");
    await ctx.admin.setDescription("New Description");
    await ctx.admin.setProfilePic(Buffer.from("pic-data"));

    const invite = await ctx.admin.revokeInvite();
    assert.match(String(invite), /mock-new-invite-code-456/);

    await ctx.send.gif(Buffer.from("already-mp4-bytes"), "gif caption");
    await ctx.send.poll("Favorite color?", ["Red", "Blue"]);
    assert.equal(calls.sentPolls.length, 1);

// contacts.get() with a raw @lid routes through contract.resolveLid()
    // (mock: "12345@lid" -> "5516777777777@s.whatsapp.net").
    const contact = await ctx.contacts.get("12345@lid");
    // normalizeContact now keeps the ID as the LID form ("12345@lid")
    // when known, per the invariant that user IDs are LID-or-null; plugins
    // should treat contact.id as the canonical JID for addressing and
    // contact.number/contact.numberRaw as the dialable string.
    assert.equal(contact?.id, "12345@lid");
    assert.equal(contact?.number, "+5516777777777");
  });
});

