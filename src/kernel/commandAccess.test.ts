import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { exists, desc, manual, list, isMenuAlias } from "#kernel/commandAccess.js";
import { buildCommandRegistry, DEFAULT_MENU_CONFIG } from "#kernel/commandRegistry.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";

function createTestRegistry() {
  const plugins = new Map<string, PluginEntry>([
    [
      "utilPlugin",
      {
        name: "utilPlugin",
        status: "active",
        manifest: { name: "utilPlugin", version: "1.0.0" },
        commands: {
          pingFn: {
            cmd: "ping",
            aliases: ["p"],
            desc: { pt: "Testa a latência", en: "Tests latency" },
            category: "utils",
            manual: "Uso: !ping",
          },
          infoFn: {
            cmd: "info",
            aliases: [],
            desc: "Informações do bot",
            category: "utils",
          },
        },
      } as unknown as PluginEntry,
    ],
  ]);

  const categories = {
    utils: { label: { pt: "Utilitários", en: "Utilities" }, order: 1 },
  };

  return buildCommandRegistry(
    null,
    plugins,
    undefined,
    { ...DEFAULT_MENU_CONFIG, enabled: true },
    categories,
  );
}

describe("kernel/commandAccess", () => {
  test("exists() is true for cmd and alias, false for unknown", () => {
    const registry = createTestRegistry();
    assert.equal(exists("ping", registry), true);
    assert.equal(exists("p", registry), true);
    assert.equal(exists("nope", registry), false);
  });

  test("exists() returns false with no registry", () => {
    assert.equal(exists("ping", null), false);
  });

  test("desc() resolves the localized string for the requested lang", () => {
    const registry = createTestRegistry();
    assert.equal(desc("ping", "pt", registry), "Testa a latência");
    assert.equal(desc("ping", "en", registry), "Tests latency");
    assert.equal(desc("info", "pt", registry), "Informações do bot");
    assert.equal(desc("nope", "pt", registry), null);
  });

  test("manual() falls back to desc() when no manual is set", () => {
    const registry = createTestRegistry();
    assert.equal(manual("ping", "pt", registry), "Uso: !ping");
    assert.equal(manual("info", "pt", registry), "Informações do bot");
  });

  test("list() returns one entry per command with resolved desc", () => {
    const registry = createTestRegistry();
    const items = list("pt", registry);
    assert.equal(items.length, 2);
    const ping = items.find((i) => i.cmd === "ping");
    assert.ok(ping);
    assert.deepEqual(ping?.aliases, ["p"]);
    assert.equal(ping?.category, "utils");
    assert.equal(ping?.desc, "Testa a latência");
  });

  test("isMenuAlias() checks the registry's menuAliases set", () => {
    const registry = createTestRegistry();
    assert.equal(isMenuAlias("help", registry), true);
    assert.equal(isMenuAlias("menu", registry), true);
    assert.equal(isMenuAlias("ping", registry), false);
  });
});

