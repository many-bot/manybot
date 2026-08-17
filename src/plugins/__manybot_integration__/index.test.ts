import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import type { PluginContext, SetupContext } from "#kernel/pluginApi.js";

const integrationPluginUrl = new URL(
  "../../plugins/__manybot_integration__/index.ts",
  import.meta.url,
).href;

describe("plugins/__manybot_integration__", () => {
  let mod: typeof import("../../plugins/__manybot_integration__/index.js");

  beforeEach(async () => {
    // Use a cache-busting query so each test gets a fresh module
    // (and therefore a fresh ring buffer + EventEmitter).
    mod = await import(`${integrationPluginUrl}?t=${Date.now()}-${Math.random()}`);
  });

  after(async () => {
    // Best-effort cleanup; nothing in the plugin subscribes to
    // process-level resources, but we re-clear the configured
    // chat so a subsequent suite (e.g. loadIntegrationPlugin.test.ts)
    // starts blank.
    process.env.MANYBOT_TEST_CHAT = "";
  });

  test("exports default, setup, and api", () => {
    assert.equal(typeof mod.default, "function");
    assert.equal(typeof mod.setup, "function");
    assert.ok(mod.api);
  });

  test("api.isTestChat is false before setup() is called", () => {
    assert.equal(mod.api.isTestChat("5516999999999@s.whatsapp.net"), false);
    assert.equal(mod.api.isTestChat(null), false);
  });

  test("api.recentBodies() starts empty", () => {
    assert.deepEqual(mod.api.recentBodies(), []);
  });

  test("setup() throws when MANYBOT_TEST_CHAT is unset", async () => {
    delete process.env.MANYBOT_TEST_CHAT;
    const { ctx } = makeSetupCtx();
    await assert.rejects(mod.setup(ctx), /MANYBOT_TEST_CHAT/);
  });

  test("setup() captures the test chat and isTestChat accepts it", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx } = makeSetupCtx();
    await mod.setup(ctx);
    assert.equal(mod.api.testChat, "5516999999999@s.whatsapp.net");
    assert.equal(mod.api.isTestChat("5516999999999@s.whatsapp.net"), true);
    assert.equal(mod.api.isTestChat("5516000000000@s.whatsapp.net"), false);
  });

  test("default() refuses to act on a non-test chat", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx: setupCtx } = makeSetupCtx();
    await mod.setup(setupCtx);
    const { ctx, replyCalls } = makeMessageCtx("120363012345678@g.us");
    // Should not throw and should not produce a reply.
    await mod.default(ctx);
    assert.equal(replyCalls.length, 0);
  });

  test("default() does not act even in the test chat (plugin is passive)", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx: setupCtx } = makeSetupCtx();
    await mod.setup(setupCtx);
    const { ctx, replyCalls } = makeMessageCtx("5516999999999@s.whatsapp.net");
    await mod.default(ctx);
    assert.equal(replyCalls.length, 0);
  });

  test("default() before setup() is a no-op, not a crash", async () => {
    delete process.env.MANYBOT_TEST_CHAT;
    const { ctx, replyCalls } = makeMessageCtx("5516999999999@s.whatsapp.net");
    await mod.default(ctx); // must not throw
    assert.equal(replyCalls.length, 0);
  });

  test("waitForMarker resolves when a matching messages.upsert is delivered via setup()", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx, handlers } = makeSetupCtx();
    await mod.setup(ctx);

    // Fire the wait first, then deliver the event.
    const pending = mod.api.waitForMarker("PING:", 1000);
    const handlerList = handlers.get("messages.upsert");
    assert.ok(handlerList && handlerList.length > 0, "setup() must register a messages.upsert handler");
    handlerList[0]({
      messages: [{ chatId: "5516999999999@s.whatsapp.net", body: "PING:hello", from: "5516000000000@s.whatsapp.net" }],
    });

    const id = await pending;
    assert.match(id, /^recent:\d+$/);
    assert.ok(mod.api.recentBodies().some((b) => b === "PING:hello"));
  });

  test("waitForMarker ignores messages from a different chat", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx, handlers } = makeSetupCtx();
    await mod.setup(ctx);

    const pending = mod.api.waitForMarker("PING:", 200);
    const handlerList = handlers.get("messages.upsert");
    assert.ok(handlerList);
    // Send from a different chat — must not resolve the wait.
    handlerList[0]({
      messages: [{ chatId: "120363012345678@g.us", body: "PING:should-not-match", from: "120363012345678@g.us" }],
    });
    await assert.rejects(pending, /timed out/);
  });

  test("waitForMarker resolves immediately when a matching message is already in the buffer", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx, handlers } = makeSetupCtx();
    await mod.setup(ctx);

    const handlerList = handlers.get("messages.upsert");
    assert.ok(handlerList);
    handlerList[0]({
      messages: [{ chatId: "5516999999999@s.whatsapp.net", body: "PING:already-here", from: "5516000000000@s.whatsapp.net" }],
    });

    const id = await mod.api.waitForMarker("PING:", 200);
    assert.match(id, /^recent:\d+$/);
  });

  test("waitForMarker does not match a body that does not start with the marker", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx, handlers } = makeSetupCtx();
    await mod.setup(ctx);

    const handlerList = handlers.get("messages.upsert");
    assert.ok(handlerList);
    handlerList[0]({
      messages: [{ chatId: "5516999999999@s.whatsapp.net", body: "PONG:no-match", from: "5516000000000@s.whatsapp.net" }],
    });

    await assert.rejects(
      mod.api.waitForMarker("PING:", 150),
      /timed out/,
    );
  });

  test("setup() respects TEST_CHAT env var when MANYBOT_TEST_CHAT is unset", async () => {
    delete process.env.MANYBOT_TEST_CHAT;
    process.env.TEST_CHAT = "5516999998888@s.whatsapp.net";
    const { ctx } = makeSetupCtx();
    await mod.setup(ctx);
    assert.equal(mod.api.testChat, "5516999998888@s.whatsapp.net");
    assert.equal(mod.api.isTestChat("5516999998888@s.whatsapp.net"), true);
  });

  test("setup() throws when given an invalid test chat format", async () => {
    process.env.MANYBOT_TEST_CHAT = "not_a_valid_jid";
    const { ctx } = makeSetupCtx();
    await assert.rejects(mod.setup(ctx), /invalid test chat provided/);
  });

  test("ring buffer caps at 50 messages and evicts oldest", async () => {
    process.env.MANYBOT_TEST_CHAT = "5516999999999@s.whatsapp.net";
    const { ctx, handlers } = makeSetupCtx();
    await mod.setup(ctx);

    const handlerList = handlers.get("messages.upsert");
    assert.ok(handlerList);

    // Push 55 messages
    const messages = Array.from({ length: 55 }, (_, i) => ({
      chatId: "5516999999999@s.whatsapp.net",
      body: `MSG_${i}`,
      from: "5516000000000@s.whatsapp.net",
    }));

    handlerList[0]({ messages });

    const recent = mod.api.recentBodies();
    assert.equal(recent.length, 50);
    // Oldest 5 (MSG_0 to MSG_4) should have been evicted
    assert.equal(recent[0], "MSG_5");
    assert.equal(recent.at(-1), "MSG_54");
  });
});

// ── Test helpers ──────────────────────────────────────────────────────────

interface SetupCtxMock {
  events: {
    on: (event: string, handler: (payload: unknown) => void) => () => void;
  };
  handlers: Map<string, Array<(payload: unknown) => void>>;
}

function makeSetupCtx(): { ctx: SetupContext; handlers: Map<string, Array<(payload: unknown) => void>> } {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const mock: SetupCtxMock = {
    handlers,
    events: {
      on(event, handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {
          const arr = handlers.get(event) ?? [];
          const idx = arr.indexOf(handler);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
    },
  };
  // The plugin only touches `events` in setup(); the rest of the
  // SetupContext surface is unused, so we type-cast through `unknown`
  // rather than build a full fake.
  return { ctx: mock as unknown as SetupContext, handlers };
}

interface MessageCtxMock {
  chat: { id: string; name: string; isGroup: boolean };
  msg:  { id: string; body: string };
  replyCalls: string[];
}

function makeMessageCtx(chatId: string): { ctx: PluginContext; replyCalls: string[] } {
  const mock: MessageCtxMock = {
    chat: {
      id:      chatId,
      name:    "test",
      isGroup: chatId.endsWith("@g.us"),
    },
    msg: { id: "msg-1", body: "hello" },
    replyCalls: [],
  };
  return { ctx: mock as unknown as PluginContext, replyCalls: mock.replyCalls };
}
