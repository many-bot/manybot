import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { buildCommandRegistry } from "#kernel/commandRegistry.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";
import type { CommandSpec } from "#kernel/commandsConfig.js";

function createMockPluginRegistry(plugins: Array<{ name: string; status?: "active" | "inactive"; commands?: Record<string, any> }>): Map<string, PluginEntry> {
  const map = new Map<string, PluginEntry>();
  for (const p of plugins) {
    map.set(p.name, {
      name: p.name,
      status: p.status ?? "active",
      manifest: { name: p.name, version: "1.0.0" },
      commands: p.commands ?? {},
    } as unknown as PluginEntry);
  }
  return map;
}

describe("kernel/commandRegistry", () => {
  test("builds registry from active plugin defaults", () => {
    const plugins = createMockPluginRegistry([
      {
        name: "pingPlugin",
        commands: {
          pingFn: {
            cmd: "ping",
            aliases: ["p"],
            desc: "Pong command",
            handler: async () => "pong",
          },
        },
      },
    ]);

    const registry = buildCommandRegistry(null, plugins);

    assert.equal(registry.byId.size, 1);
    const entry = registry.byId.get("pingPlugin::pingFn");
    assert.ok(entry);
    assert.equal(entry?.cmd, "ping");
    assert.deepEqual(entry?.aliases, ["p"]);
    assert.equal(entry?.source, "plugin");

    assert.equal(registry.byInvocation.get("ping"), "pingPlugin::pingFn");
    assert.equal(registry.byInvocation.get("p"), "pingPlugin::pingFn");
  });

  test("skips plugin commands with a non-string cmd instead of throwing", () => {
    const plugins = createMockPluginRegistry([
      {
        name: "brokenPlugin",
        commands: {
          badFn: {
            cmd: true,
            handler: async () => "x",
          },
          goodFn: {
            cmd: "ok",
            aliases: [1, "valid", null],
            handler: async () => "x",
          },
        },
      },
    ]);

    assert.doesNotThrow(() => buildCommandRegistry(null, plugins));

    const registry = buildCommandRegistry(null, plugins);
    assert.equal(registry.byId.has("brokenPlugin::badFn"), false);

    const good = registry.byId.get("brokenPlugin::goodFn");
    assert.ok(good);
    assert.equal(good?.cmd, "ok");
    assert.deepEqual(good?.aliases, ["valid"]);
  });

  test("applies spec overrides to plugin commands", () => {
    const plugins = createMockPluginRegistry([
      {
        name: "funPlugin",
        commands: {
          jokeFn: {
            cmd: "joke",
            aliases: ["j"],
            desc: "Original desc",
          },
        },
      },
    ]);

    const specs: CommandSpec[] = [
      {
        id: "funPlugin::jokeFn",
        plugin: "funPlugin",
        function: "jokeFn",
        cmd: "telljoke",
        aliases: ["tj"],
        desc: "Overridden desc",
        category: "Fun",
        group: null,
        manual: null,
        text: null,
        deprecatedMessage: null,
        notifyChanges: null,
        permissions: { admin: true },
        messages: null,
        arguments: [],
        subcommands: [],
      },
    ];

    const registry = buildCommandRegistry(specs, plugins);
    const entry = registry.byId.get("funPlugin::jokeFn");

    assert.ok(entry);
    assert.equal(entry?.cmd, "telljoke");
    assert.deepEqual(entry?.aliases, ["tj"]);
    assert.equal(entry?.desc, "Overridden desc");
    assert.equal(entry?.category, "Fun");
    assert.equal(entry?.permissions.admin, true);

    // Old invocation "joke" should no longer map to entry if overridden by new cmd/aliases
    assert.equal(registry.byInvocation.get("telljoke"), "funPlugin::jokeFn");
    assert.equal(registry.byInvocation.get("tj"), "funPlugin::jokeFn");
  });

  test("registers text-only command specs", () => {
    const plugins = createMockPluginRegistry([]);
    const specs: CommandSpec[] = [
      {
        id: "custom_hello",
        plugin: null,
        function: null,
        cmd: "hello",
        aliases: ["hi"],
        desc: "Says hello",
        category: "General",
        group: null,
        manual: null,
        text: "Hello World!",
        deprecatedMessage: null,
        notifyChanges: null,
        permissions: null,
        messages: null,
        arguments: [],
        subcommands: [],
      },
    ];

    const registry = buildCommandRegistry(specs, plugins);

    assert.equal(registry.byId.size, 1);
    const entry = registry.byId.get("text::custom_hello");
    assert.ok(entry);
    assert.equal(entry?.source, "text");
    assert.equal(entry?.text, "Hello World!");
    assert.equal(registry.byInvocation.get("hello"), "text::custom_hello");
    assert.equal(registry.byInvocation.get("hi"), "text::custom_hello");
  });

  test("ignores inactive plugin commands", () => {
    const plugins = createMockPluginRegistry([
      {
        name: "disabledPlugin",
        status: "inactive",
        commands: {
          testFn: { cmd: "disabledCmd" },
        },
      },
    ]);

    const registry = buildCommandRegistry(null, plugins);
    assert.equal(registry.byId.size, 0);
    assert.equal(registry.byInvocation.has("disabledCmd"), false);
  });
});

