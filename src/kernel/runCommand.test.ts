import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveDispatch, runCommand, renderUsage } from "#kernel/runCommand.js";
import { buildCommandRegistry, __setRegistryForTests, type CommandRegistry } from "#kernel/commandRegistry.js";
import { pluginRegistry } from "#kernel/pluginLoader.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";
import type { CommandSpec, CommandSubcommandSpec } from "#kernel/commandsConfig.js";
import type { PluginContext } from "#kernel/pluginApi.js";
import { STOP_CHAIN } from "#kernel/commandsConfig.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";

function emptySpec(overrides: Partial<CommandSpec>): CommandSpec {
  return {
    id: overrides.id ?? "todo::add",
    cmd: overrides.cmd ?? "todo",
    aliases: overrides.aliases ?? [],
    plugin: overrides.plugin ?? "todoPlugin",
    functions: overrides.functions ?? ["addFn"],
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
    id: overrides.id ?? "todo::list",
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

let addCalls: Array<{ ctx: unknown; input: unknown }> = [];
let listCalls: Array<{ ctx: unknown; input: unknown }> = [];

function registerTodoPlugin(): void {
  addCalls = [];
  listCalls = [];
  const plugin: PluginEntry = {
    name: "todoPlugin",
    status: "active",
    run: null,
    setup: null,
    exports: {},
    error: null,
    guardOptions: {},
    commands: {
      addFn: {
        cmd: "todo",
        aliases: [],
        handler: async (ctx: unknown, input?: unknown) => {
          addCalls.push({ ctx, input });
        },
      },
      listFn: {
        cmd: "list",
        aliases: [],
        handler: async (ctx: unknown, input?: unknown) => {
          listCalls.push({ ctx, input });
        },
      },
      crashFn: {
        cmd: "crash",
        aliases: [],
        handler: async () => {
          throw new Error("boom");
        },
      },
      gateFn: {
        cmd: "gate",
        aliases: [],
        handler: async () => STOP_CHAIN,
      },
    },
  };
  pluginRegistry.set("todoPlugin", plugin);
}

function fakeCtx(overrides: Partial<{ isGroup: boolean; sender: string }> = {}): PluginContext {
  return {
    chat: {
      isGroup: overrides.isGroup ?? true,
      id: "chat1@g.us",
      isSenderAdmin: async () => true,
      isBotAdmin: async () => true,
    },
    msg: {
      sender: overrides.sender ?? "5511999999999@s.whatsapp.net",
    },
  } as unknown as PluginContext;
}

function buildRegistry(specs: CommandSpec[]): CommandRegistry {
  return buildCommandRegistry(specs, pluginRegistry);
}

describe("kernel/runCommand", () => {
  beforeEach(() => {
    registerTodoPlugin();
  });

  afterEach(() => {
    pluginRegistry.delete("todoPlugin");
    __setRegistryForTests(null);
  });

  test("resolveDispatch: kind none when registry is empty", () => {
    __setRegistryForTests(buildCommandRegistry([], new Map()));
    const { target } = resolveDispatch("todo", "");
    assert.equal(target.kind, "none");
  });

  test("resolveDispatch: kind parent when no subcommands declared", () => {
    __setRegistryForTests(buildRegistry([emptySpec({})]));
    const { target } = resolveDispatch("todo", "buy milk");
    assert.equal(target.kind, "parent");
    if (target.kind === "parent") {
      assert.deepEqual(target.args, ["buy", "milk"]);
    }
  });

  test("resolveDispatch: kind sub when a declared subcommand token matches", () => {
    const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
    __setRegistryForTests(buildRegistry([spec]));
    const { target } = resolveDispatch("todo", "list");
    assert.equal(target.kind, "sub");
    if (target.kind === "sub") {
      assert.equal(target.sub.function, "listFn");
    }
  });

  test("resolveDispatch: unmatchedSubToken falls through to parent", () => {
    const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
    __setRegistryForTests(buildRegistry([spec]));
    const { target, unmatchedSubToken } = resolveDispatch("todo", "wat now");
    assert.equal(target.kind, "parent");
    assert.equal(unmatchedSubToken, "wat");
  });

  test("runCommand: executes the parent handler and passes args through", async () => {
    __setRegistryForTests(buildRegistry([emptySpec({})]));
    const resolution = resolveDispatch("todo", "buy milk");
    const replies: string[] = [];
    const result = await runCommand({
      pluginName: "todoPlugin",
      ctx: fakeCtx(),
      resolution,
      reply: { text: (t) => replies.push(t) },
    });
    assert.equal(result.status, "executed");
    assert.equal(addCalls.length, 1);
    assert.deepEqual(addCalls[0].input, { args: ["buy", "milk"], subcommand: undefined });
    assert.equal(replies.length, 0);
  });

  test("runCommand: routes to the subcommand handler, not the parent's", async () => {
    const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
    __setRegistryForTests(buildRegistry([spec]));
    const resolution = resolveDispatch("todo", "list");
    const result = await runCommand({
      pluginName: "todoPlugin",
      ctx: fakeCtx(),
      resolution,
      reply: { text: () => {} },
    });
    assert.equal(result.status, "executed");
    assert.equal(listCalls.length, 1);
    assert.equal(addCalls.length, 0);
  });

  test("runCommand: unmatchedSubToken replies with a usage hint and does not dispatch", async () => {
    const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
    __setRegistryForTests(buildRegistry([spec]));
    const resolution = resolveDispatch("todo", "wat");
    const replies: string[] = [];
    const result = await runCommand({
      pluginName: "todoPlugin",
      ctx: fakeCtx(),
      resolution,
      reply: { text: (t) => replies.push(t) },
    });
    assert.equal(result.status, "unknown_sub");
    assert.equal(addCalls.length, 0);
    assert.equal(replies.length, 1);
  });

  test("runCommand: denies on scope mismatch and does not dispatch", async () => {
    const spec = emptySpec({ permissions: { scope: "group" } });
    __setRegistryForTests(buildRegistry([spec]));
    const resolution = resolveDispatch("todo", "buy milk");
    const result = await runCommand({
      pluginName: "todoPlugin",
      ctx: fakeCtx({ isGroup: false }),
      resolution,
      reply: { text: () => {} },
    });
    assert.equal(result.status, "permission_denied");
    assert.equal(addCalls.length, 0);
  });

  test("runCommand: rejects when a required argument is missing", async () => {
    const spec = emptySpec({ arguments: [{ name: "item", type: "quoted_text", required: true }] });
    __setRegistryForTests(buildRegistry([spec]));
    const resolution = resolveDispatch("todo", "");
    const result = await runCommand({
      pluginName: "todoPlugin",
      ctx: fakeCtx(),
      resolution,
      reply: { text: () => {} },
    });
    assert.equal(result.status, "argument_missing");
    assert.equal(addCalls.length, 0);
  });

  test("runCommand: re-throws on handler crash after firing the alert", async () => {
    const spec = emptySpec({ id: "todo::crash", cmd: "crashcmd", functions: ["crashFn"] });
    __setRegistryForTests(buildRegistry([spec]));
    const resolution = resolveDispatch("crashcmd", "");
    await assert.rejects(
      () =>
        runCommand({
          pluginName: "todoPlugin",
          ctx: fakeCtx(),
          resolution,
          reply: { text: () => {} },
        }),
      /boom/
    );
  });

  test("resolveDispatch: kind none for an unknown invocation", () => {
    __setRegistryForTests(buildRegistry([emptySpec({})]));
    const { target } = resolveDispatch("nope", "");
    assert.equal(target.kind, "none");
  });

  test("renderUsage: builds a usage line from declared arguments", () => {
    const spec = emptySpec({
      arguments: [
        { name: "item", type: "quoted_text", required: true },
        { name: "priority", type: "choice", choices: ["low", "high"], required: false },
      ],
    });
    __setRegistryForTests(buildRegistry([spec]));
    const { target } = resolveDispatch("todo", "");
    const usage = renderUsage(target);
    assert.match(usage, /^!todo /);
    assert.match(usage, /"<text>"/);
    assert.match(usage, /\[--priority=<low\|high>\]/);
  });

  test("renderUsage: empty string for a none target", () => {
    const usage = renderUsage({ kind: "none" });
    assert.equal(usage, "");
  });

  test("renderUsage: accepts a prefix override", () => {
    const spec = emptySpec({
      arguments: [{ name: "item", type: "quoted_text", required: true }],
    });
    __setRegistryForTests(buildRegistry([spec]));
    const { target } = resolveDispatch("todo", "");
    const usage = renderUsage(target, "#");
    assert.match(usage, /^#todo /);
  });

  describe("per-chat overrides (prefix / language via !config)", () => {
    const overrideChatId = "5511988887777@c.us"; // already-normalized form

    beforeEach(() => {
      buildSettingsApi("core", overrideChatId).deleteAll();
    });

    afterEach(() => {
      buildSettingsApi("core", overrideChatId).deleteAll();
    });

    test("missing-argument usage message uses the chat's saved prefix override", async () => {
      buildSettingsApi("core", overrideChatId).set("chat_prefix", "#");
      const spec = emptySpec({ arguments: [{ name: "item", type: "quoted_text", required: true }] });
      __setRegistryForTests(buildRegistry([spec]));
      const resolution = resolveDispatch("todo", "");
      const replies: string[] = [];
      const result = await runCommand({
        pluginName: "todoPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: (t) => replies.push(t) },
        chatId: overrideChatId,
      });
      assert.equal(result.status, "argument_missing");
      assert.match(replies[0], /#todo/, "usage line should use the chat's saved prefix, not the global one");
    });

    test("missing-argument usage message falls back to the global prefix when no override is set", async () => {
      const spec = emptySpec({ arguments: [{ name: "item", type: "quoted_text", required: true }] });
      __setRegistryForTests(buildRegistry([spec]));
      const resolution = resolveDispatch("todo", "");
      const replies: string[] = [];
      await runCommand({
        pluginName: "todoPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: (t) => replies.push(t) },
        chatId: overrideChatId,
      });
      assert.match(replies[0], /!todo/);
    });

    test("unknown-subcommand message uses the chat's saved language override", async () => {
      buildSettingsApi("core", overrideChatId).set("chat_locale", "pt");
      const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
      __setRegistryForTests(buildRegistry([spec]));
      const resolution = resolveDispatch("todo", "wat");
      const replies: string[] = [];
      await runCommand({
        pluginName: "todoPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: (t) => replies.push(t) },
        chatId: overrideChatId,
      });
      assert.match(replies[0], /Subcomando "wat" desconhecido/);
    });

    test("unknown-subcommand message falls back to the global language when no override is set", async () => {
      const spec = emptySpec({ subcommands: [emptySub({ functions: ["listFn"] })] });
      __setRegistryForTests(buildRegistry([spec]));
      const resolution = resolveDispatch("todo", "wat");
      const replies: string[] = [];
      await runCommand({
        pluginName: "todoPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: (t) => replies.push(t) },
        chatId: overrideChatId,
      });
      assert.match(replies[0], /Unknown subcommand "wat"/);
    });

    test("omitting chatId behaves exactly like an unset override (backward compatible)", async () => {
      const spec = emptySpec({ arguments: [{ name: "item", type: "quoted_text", required: true }] });
      __setRegistryForTests(buildRegistry([spec]));
      const resolution = resolveDispatch("todo", "");
      const replies: string[] = [];
      const result = await runCommand({
        pluginName: "todoPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: (t) => replies.push(t) },
      });
      assert.equal(result.status, "argument_missing");
      assert.match(replies[0], /!todo/);
    });
  });

  describe("functions: chain + STOP_CHAIN", () => {
    test("runs every function in the chain in declared order", async () => {
      let second = false;
      let third = false;
      const plugin: PluginEntry = {
        name: "chainPlugin",
        status: "active",
        run: null,
        setup: null,
        exports: {},
        error: null,
        guardOptions: {},
        commands: {
          firstFn: { cmd: "todo", aliases: [], handler: async () => { second = true; } },
          secondFn: { cmd: "todo", aliases: [], handler: async () => {
            assert.equal(second, true, "second handler ran before first finished");
            third = true;
          } },
          thirdFn: { cmd: "todo", aliases: [], handler: async () => {
            assert.equal(third, true, "third handler ran before second finished");
          } },
        },
      } as unknown as PluginEntry;
      pluginRegistry.set("chainPlugin", plugin);

      const specs: CommandSpec[] = [
        {
          id: "chainPlugin::firstFn",
          cmd: "chain",
          aliases: [],
          plugin: "chainPlugin",
          functions: ["firstFn", "secondFn", "thirdFn"],
          loading: null,
          text: null,
          desc: null,
          category: null,
          group: null,
          manual: null,
          deprecatedMessage: null,
          notifyChanges: null,
          permissions: null,
          messages: null,
          arguments: [],
          subcommands: [],
        },
      ];
      __setRegistryForTests(buildCommandRegistry(specs, pluginRegistry));
      const resolution = resolveDispatch("chain", "");
      const result = await runCommand({
        pluginName: "chainPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: () => {} },
      });
      assert.equal(result.status, "executed");
      assert.equal(third, true);
      pluginRegistry.delete("chainPlugin");
    });

    test("STOP_CHAIN short-circuits the rest of the chain", async () => {
      let secondRan = false;
      const plugin: PluginEntry = {
        name: "stopPlugin",
        status: "active",
        run: null,
        setup: null,
        exports: {},
        error: null,
        guardOptions: {},
        commands: {
          firstFn: { cmd: "stop", aliases: [], handler: async () => STOP_CHAIN },
          secondFn: { cmd: "stop", aliases: [], handler: async () => { secondRan = true; } },
        },
      } as unknown as PluginEntry;
      pluginRegistry.set("stopPlugin", plugin);

      const specs: CommandSpec[] = [
        {
          id: "stopPlugin::firstFn",
          cmd: "stop",
          aliases: [],
          plugin: "stopPlugin",
          functions: ["firstFn", "secondFn"],
          loading: null,
          text: null,
          desc: null,
          category: null,
          group: null,
          manual: null,
          deprecatedMessage: null,
          notifyChanges: null,
          permissions: null,
          messages: null,
          arguments: [],
          subcommands: [],
        },
      ];
      __setRegistryForTests(buildCommandRegistry(specs, pluginRegistry));
      const resolution = resolveDispatch("stop", "");
      const result = await runCommand({
        pluginName: "stopPlugin",
        ctx: fakeCtx(),
        resolution,
        reply: { text: () => {} },
      });
      assert.equal(result.status, "executed");
      assert.equal(secondRan, false);
      pluginRegistry.delete("stopPlugin");
    });

    test("chain throw propagates and stops the chain", async () => {
      let secondRan = false;
      const plugin: PluginEntry = {
        name: "throwPlugin",
        status: "active",
        run: null,
        setup: null,
        exports: {},
        error: null,
        guardOptions: {},
        commands: {
          firstFn: { cmd: "throw", aliases: [], handler: async () => { throw new Error("mid"); } },
          secondFn: { cmd: "throw", aliases: [], handler: async () => { secondRan = true; } },
        },
      } as unknown as PluginEntry;
      pluginRegistry.set("throwPlugin", plugin);

      const specs: CommandSpec[] = [
        {
          id: "throwPlugin::firstFn",
          cmd: "throw",
          aliases: [],
          plugin: "throwPlugin",
          functions: ["firstFn", "secondFn"],
          loading: null,
          text: null,
          desc: null,
          category: null,
          group: null,
          manual: null,
          deprecatedMessage: null,
          notifyChanges: null,
          permissions: null,
          messages: null,
          arguments: [],
          subcommands: [],
        },
      ];
      __setRegistryForTests(buildCommandRegistry(specs, pluginRegistry));
      const resolution = resolveDispatch("throw", "");
      await assert.rejects(
        () => runCommand({
          pluginName: "throwPlugin",
          ctx: fakeCtx(),
          resolution,
          reply: { text: () => {} },
        }),
        /mid/
      );
      assert.equal(secondRan, false);
      pluginRegistry.delete("throwPlugin");
    });
  });
});

