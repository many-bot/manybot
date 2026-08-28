import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";

import { createStore, type BotStore } from "#client/store.js";
import type { BotMessage, WaContract } from "#kernel/waContract.js";
import { handleMessage } from "#drivers/baileys/messageHandler.js";
import { pluginRegistry } from "#kernel/pluginLoader.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";
import { buildCommandRegistry, __setRegistryForTests, type CommandRegistry } from "#kernel/commandRegistry.js";
import type { CommandSpec, CommandSubcommandSpec, MenuConfig } from "#kernel/commandsConfig.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";

// ── Minimal spec builders (mirrors kernel/runCommand.test.ts conventions) ──

function emptySpec(overrides: Partial<CommandSpec>): CommandSpec {
  return {
    id: overrides.id ?? "task::run",
    cmd: overrides.cmd ?? "task",
    aliases: overrides.aliases ?? [],
    plugin: overrides.plugin ?? "taskPlugin",
    functions: overrides.functions ?? ["runFn"],
    loading: overrides.loading ?? null,
    text: overrides.text ?? null,
    desc: overrides.desc ?? null,
    category: overrides.category ?? null,
    group: overrides.group ?? null,
    manual: overrides.manual ?? null,
    deprecatedMessage: overrides.deprecatedMessage ?? null,
    notifyChanges: overrides.notifyChanges ?? null,
    permissions: overrides.permissions ?? null,
    messages: overrides.messages ?? null,
    arguments: overrides.arguments ?? [],
    subcommands: overrides.subcommands ?? [],
  };
}

function emptySub(overrides: Partial<CommandSubcommandSpec>): CommandSubcommandSpec {
  return {
    id: overrides.id ?? "task::list",
    cmd: overrides.cmd ?? "list",
    aliases: overrides.aliases ?? [],
    functions: overrides.functions ?? null,
    loading: overrides.loading ?? null,
    desc: overrides.desc ?? null,
    manual: overrides.manual ?? null,
    arguments: overrides.arguments ?? [],
    permissions: overrides.permissions ?? null,
    messages: overrides.messages ?? null,
  };
}

// ── Mock WaContract — only the surface handleMessage's pipeline touches ────

function createMockContract(): {
  contract: WaContract;
  sentTexts: Array<{ jid: string; text: string }>;
  reactions: Array<{ jid: string; emoji: string }>;
  presences: Array<{ state: string; jid: string }>;
  deletions: Array<{ jid: string; forEveryone: boolean }>;
  edits: Array<{ jid: string; id: string; text: string }>;
} {
  const sentTexts: Array<{ jid: string; text: string }> = [];
  const reactions: Array<{ jid: string; emoji: string }> = [];
  const presences: Array<{ state: string; jid: string }> = [];
  const deletions: Array<{ jid: string; forEveryone: boolean }> = [];
  const edits: Array<{ jid: string; id: string; text: string }> = [];
  const sentHistory: BotMessage[] = [];
  let msgSeq = 0;

  const contract: WaContract = {
    name: "baileys",
    connect: async () => {},
    disconnect: async () => {},
    isReady: () => true,
    resolveLid: async () => null,

    on: () => () => {},

    sendText: async (jid: string, text: string) => {
      sentTexts.push({ jid, text });
      const id = `msg-${++msgSeq}`;
      sentHistory.push({
        id,
        chatId: jid,
        fromMe: true,
        contentHash: "hash",
        timestamp: Date.now(),
        type: "text",
        body: text,
        fromPn: "5511900000000@s.whatsapp.net",
      } as BotMessage);
      return { id, chatId: jid, timestamp: Date.now() };
    },
    sendImage: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),
    sendVideo: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),
    sendAudio: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),
    sendSticker: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),
    sendDocument: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),
    sendPoll: async () => ({ id: "x", chatId: "x", timestamp: Date.now() }),

    react: async (_jid: string, _key: unknown, emoji: string) => {
      reactions.push({ jid: _jid, emoji });
    },
    deleteMessage: async (_jid: string, _key: unknown, forEveryone: boolean) => {
      deletions.push({ jid: _jid, forEveryone });
    },
    editMessage: async (_jid: string, key: { id?: string }, text: string) => {
      edits.push({ jid: _jid, id: key.id ?? "", text });
    },
    sendPresenceUpdate: async (state: string, jid: string) => {
      presences.push({ state, jid });
    },
    readMessages: async () => {},

    onWhatsApp: async () => [{ exists: true }],
    getBusinessProfile: async () => null,
    profilePictureUrl: async () => null,
    fetchStatus: async () => null,
    updateBlockStatus: async () => {},
    addOrEditContact: async () => {},
    removeContact: async () => {},

    groupMetadata: async () => ({ subject: "Group", participants: [] }),
    groupParticipantsUpdate: async () => [],
    groupUpdateSubject: async () => {},
    groupUpdateDescription: async () => {},
    groupInviteCode: async () => "",
    groupRevokeInvite: async () => "",

    updateProfilePicture: async () => {},
    updateProfileName: async () => {},
    updateProfileStatus: async () => {},

    me: () => ({ id: "5511900000000@s.whatsapp.net" }),

    downloadMedia: async () => null,
    // Mirrors real Baileys behavior: sendText's result lands in history
    // immediately (sendFallbackGuard's verifyDelivery does a t=0 lookup
    // here to confirm the send before the caller's await resolves).
    getHistory: async (jid: string) => sentHistory.filter(m => m.chatId === jid),
  } as unknown as WaContract;

  return { contract, sentTexts, reactions, presences, deletions, edits };
}

function makeBotMessage(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    id: `in-${Math.random().toString(36).slice(2)}`,
    chatId: "5511888888888@s.whatsapp.net",
    fromMe: false,
    contentHash: "hash",
    timestamp: Date.now(),
    type: "text",
    body: "!task",
    fromPn: "5511888888888@s.whatsapp.net",
    ...overrides,
  };
}

function buildRegistry(specs: CommandSpec[], menu?: Partial<MenuConfig>): CommandRegistry {
  if (!menu) return buildCommandRegistry(specs, pluginRegistry);
  return buildCommandRegistry(
    specs,
    pluginRegistry,
    undefined,
    {
      title: "ManyBot — Menu",
      intro: "Help menu",
      footer: null,
      cmd: "help",
      aliases: ["help", "menu"],
      notFoundFallback: false,
      welcomeMessage: null,
      welcomeWindowDays: 3,
      pageSize: 15,
      ...menu,
    } as MenuConfig
  );
}

describe("drivers/baileys/messageHandler — v6 runCommand dispatch", () => {
  let store: BotStore;
  let contract: WaContract;
  let sentTexts: Array<{ jid: string; text: string }>;
  let reactions: Array<{ jid: string; emoji: string }>;
  let presences: Array<{ state: string; jid: string }>;
  let deletions: Array<{ jid: string; forEveryone: boolean }>;
  let edits: Array<{ jid: string; id: string; text: string }>;
  let runCalls: unknown[];
  let listCalls: unknown[];

  beforeEach(() => {
    _resetDriverManagerForTests();
    store = createStore();
    const mock = createMockContract();
    contract = mock.contract;
    sentTexts = mock.sentTexts;
    reactions = mock.reactions;
    presences = mock.presences;
    deletions = mock.deletions;
    edits = mock.edits;
    getDriverManager().register(contract, { isPrimary: true });

    runCalls = [];
    listCalls = [];
    const plugin: PluginEntry = {
      name: "taskPlugin",
      status: "active",
      run: null,
      setup: null,
      exports: {},
      error: null,
      guardOptions: {},
      commands: {
        runFn: {
          cmd: "task",
          aliases: [],
          handler: async (ctx: unknown, input?: unknown) => {
            runCalls.push(input);
            const c = ctx as { send: { text(t: string): Promise<unknown> } };
            await c.send.text("done");
          },
        },
        listFn: {
          cmd: "list",
          aliases: [],
          handler: async (_ctx: unknown, input?: unknown) => {
            listCalls.push(input);
          },
        },
        crashFn: {
          cmd: "task",
          aliases: [],
          handler: async () => {
            throw new Error("plugin exploded");
          },
        },
      },
    };
    pluginRegistry.set("taskPlugin", plugin);
  });

  afterEach(() => {
    pluginRegistry.delete("taskPlugin");
    __setRegistryForTests(null);
    _resetDriverManagerForTests();
  });

  test("routes a matched subcommand to the subcommand handler, not the parent's, and replies", async () => {
    const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
    __setRegistryForTests(buildRegistry([spec]));

    const msg = makeBotMessage({ body: "!task list" });
    await handleMessage(msg, contract, store);

    assert.equal(listCalls.length, 1, "subcommand handler was invoked");
    assert.equal(runCalls.length, 0, "parent handler was not invoked for the subcommand token");
  });

  test("matched parent command dispatches through runCommand and sends its reply", async () => {
    __setRegistryForTests(buildRegistry([emptySpec({})]));

    const msg = makeBotMessage({ body: "!task" });
    await handleMessage(msg, contract, store);

    assert.equal(runCalls.length, 1, "parent handler ran");
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].text, "done");
  });

  test("a crash inside the matched command's handler is swallowed at the messageHandler boundary", async () => {
    const spec = emptySpec({ id: "task::crash", cmd: "crashcmd", functions: ["crashFn"] });
    __setRegistryForTests(buildRegistry([spec]));

    const msg = makeBotMessage({ body: "!crashcmd" });

    // The whole point of this session's fix: runCommand() now genuinely
    // throws (rethrow: true) so Phase-8's fireAlert runs, but
    // messageHandler.ts wraps that call in its own try/catch so the
    // per-message plugin loop — and handleMessage() itself — must never
    // propagate the error to the caller.
    await assert.doesNotReject(() => handleMessage(msg, contract, store));
    assert.equal(sentTexts.length, 0, "no reply is sent for a crashed handler");
  });

  test("the message loop keeps working for the next message after a handler crash", async () => {
    const crashSpec = emptySpec({ id: "task::crash", cmd: "crashcmd", functions: ["crashFn"] });
    __setRegistryForTests(buildRegistry([crashSpec]));
    await handleMessage(makeBotMessage({ body: "!crashcmd" }), contract, store);

    // Swap in a healthy command and confirm a later message still dispatches
    // normally — the crash must not have left the plugin loop, the driver
    // manager, or the registry in a broken state.
    __setRegistryForTests(buildRegistry([emptySpec({})]));
    await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

    assert.equal(runCalls.length, 1);
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].text, "done");
  });

  // ── Loading indicator wiring ───────────────────────────────────────────
  describe("loading indicator (v6 reaction/typing/spinner)", () => {
    test("reaction: drops the icon then clears on success", async () => {
      const spec = emptySpec({ loading: { type: "reaction", icon: "🛠" } });
      __setRegistryForTests(buildRegistry([spec]));

      await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

      assert.equal(reactions.length, 2, "start + final reaction");
      assert.equal(reactions[0].emoji, "🛠");
      assert.equal(reactions[1].emoji, "");
    });

    test("reaction: replaces with onSuccess emoji on success", async () => {
      const spec = emptySpec({ loading: { type: "reaction", icon: "⏳", onSuccess: "✅" } });
      __setRegistryForTests(buildRegistry([spec]));

      await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

      assert.equal(reactions.at(-1)?.emoji, "✅");
    });

    test("typing: emits composing presence + paused on completion", async () => {
      const spec = emptySpec({ loading: { type: "typing" } });
      __setRegistryForTests(buildRegistry([spec]));

      await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

      assert.ok(presences.some(p => p.state === "composing"), "composing presence was emitted");
      assert.ok(presences.some(p => p.state === "paused"), "paused presence was emitted at end");
    });

    test("none: never calls react or sendPresenceUpdate for the indicator", async () => {
      const spec = emptySpec({ loading: { type: "none" } });
      __setRegistryForTests(buildRegistry([spec]));

      await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

      // reaction is never called — the loading indicator itself is a no-op.
      assert.equal(reactions.length, 0, "no reactions emitted");
      // Presence still shows up from two pre-existing, independent legacy
      // paths that have nothing to do with the loading indicator: the
      // per-plugin useTyping wrapper in messageHandler.ts, and simulateState()
      // inside ctx.send.text() (api/index.ts) humanizing every outbound send.
      // A "none" loading spec must add zero presence calls on top of those.
      assert.equal(presences.filter(p => p.state === "paused" && p.jid === "5511888888888@s.whatsapp.net").length, 2,
        "paused presence came only from the two pre-existing legacy paths, not from the loading indicator");
    });

    test("spinner: sends a frame message and edits it on completion", async () => {
      const spec = emptySpec({
        loading: {
          type: "spinner",
          frames: ["⏳", "⌛"],
          intervalMs: 60000, // disable the interval so the test is deterministic
          onSuccess: "ready",
        },
      });
      __setRegistryForTests(buildRegistry([spec]));

      await handleMessage(makeBotMessage({ body: "!task" }), contract, store);

      // The first sendText from the spinner carries the first frame.
      const spinnerSent = sentTexts.find(s => s.text === "⏳");
      assert.ok(spinnerSent, "spinner sent the first frame");
      assert.ok(edits.some(e => e.text === "ready"), "spinner was edited with onSuccess text");
      assert.equal(deletions.length, 0, "onSuccess set: spinner is edited, not deleted");
    });
  });

  // ── Welcome message gating ──────────────────────────────────────────────
  // Regression coverage for the false-positive welcome: history-sync
  // replays the bot's own past outgoing messages as `messages.upsert`
  // (fromMe=true) on every reconnect, and welcome must never fire for a
  // group chat either — only for a genuinely incoming DM.
  describe("welcome message gating", () => {
    const WELCOME_TEXT = "Bem-vindo! Use {prefix}help.";

    function buildWelcomeRegistry(): CommandRegistry {
      return buildRegistry([emptySpec({})], {
        welcomeMessage: WELCOME_TEXT,
        welcomeWindowDays: 3,
      });
    }

    // Each test uses its own sender so the shared (in-memory) settings DB
    // never leaks "already seen" state between tests, and clears it
    // up front regardless, mirroring kernel/commandMenu.test.ts.
    function freshSender(id: string): { chatId: string; fromPn: string } {
      const jid = `55110000${id}@s.whatsapp.net`;
      buildSettingsApi("kernel", jid).delete("last_welcome_seen");
      return { chatId: jid, fromPn: jid };
    }

    test("fires on a genuine first incoming DM", async () => {
      const { chatId, fromPn } = freshSender("0001");
      __setRegistryForTests(buildWelcomeRegistry());

      await handleMessage(makeBotMessage({ chatId, fromPn, fromMe: false, body: "oi" }), contract, store);

      assert.equal(sentTexts.length, 1, "welcome was sent");
      assert.equal(sentTexts[0].text, "Bem-vindo! Use !help.");
    });

    test("does not fire for a history-sync replay of the bot's own message (fromMe=true)", async () => {
      const { chatId, fromPn } = freshSender("0002");
      __setRegistryForTests(buildWelcomeRegistry());

      await handleMessage(makeBotMessage({ chatId, fromPn, fromMe: true, body: "oi" }), contract, store);

      assert.equal(sentTexts.length, 0, "no welcome sent for a fromMe message");
    });

    test("does not fire for a message received in a group chat", async () => {
      const { fromPn } = freshSender("0003");
      const groupChatId = "120363000000000000@g.us";
      buildSettingsApi("kernel", groupChatId).delete("last_welcome_seen");
      __setRegistryForTests(buildWelcomeRegistry());

      await handleMessage(
        makeBotMessage({ chatId: groupChatId, fromPn, fromMe: false, body: "oi" }),
        contract,
        store
      );

      assert.equal(sentTexts.length, 0, "no welcome sent for a group message");
    });

    test("does not fire twice within the welcome window for the same sender", async () => {
      const { chatId, fromPn } = freshSender("0004");
      __setRegistryForTests(buildWelcomeRegistry());

      await handleMessage(makeBotMessage({ chatId, fromPn, fromMe: false, body: "oi" }), contract, store);
      await handleMessage(makeBotMessage({ chatId, fromPn, fromMe: false, body: "oi de novo" }), contract, store);

      assert.equal(sentTexts.length, 1, "welcome only sent once inside the window");
    });

    test("does not fire when the registry has no welcomeMessage configured", async () => {
      const { chatId, fromPn } = freshSender("0005");
      __setRegistryForTests(buildRegistry([emptySpec({})])); // default menu: welcomeMessage: null

      await handleMessage(makeBotMessage({ chatId, fromPn, fromMe: false, body: "oi" }), contract, store);

      assert.equal(sentTexts.length, 0, "no welcome sent when unconfigured");
    });
  });
});

