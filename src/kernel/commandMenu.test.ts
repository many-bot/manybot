import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocalizedString,
  renderOverview,
  renderCategory,
  renderManual,
  renderNotFound,
  handleMenuCommand
} from "#kernel/commandMenu.js";
import { buildCommandRegistry } from "#kernel/commandRegistry.js";
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

  return buildCommandRegistry(null, plugins, undefined, undefined, categories);
}

describe("kernel/commandMenu", () => {
  describe("resolveLocalizedString", () => {
    test("returns string directly if plain string", () => {
      assert.equal(resolveLocalizedString("hello"), "hello");
    });

    test("resolves requested language from object map", () => {
      const localized = { en: "Hello", pt: "Olá", es: "Hola" };
      assert.equal(resolveLocalizedString(localized, "pt"), "Olá");
      assert.equal(resolveLocalizedString(localized, "en"), "Hello");
    });

    test("falls back to en or first key if target language missing", () => {
      const localized = { en: "English fallback", es: "Hola" };
      assert.equal(resolveLocalizedString(localized, "fr"), "English fallback");
    });

    test("returns null for nullish inputs", () => {
      assert.equal(resolveLocalizedString(null), null);
      assert.equal(resolveLocalizedString(undefined), null);
    });
  });

  describe("renderOverview", () => {
    test("uses English built-in labels by default in tests", () => {
      const registry = createTestRegistry();
      const overview = renderOverview(registry);

      assert.match(overview, /Use !<command> to run it/);
    });

    test("renders categorized menu overview", () => {
      const registry = createTestRegistry();
      const overview = renderOverview(registry, "pt");

      assert.match(overview, /ManyBot — Menu/);
      assert.match(overview, /📁 \*Utilitários\*/);
      assert.match(overview, /!ping — Testa a latência/);
      assert.match(overview, /!info — Informações do bot/);
    });
  });

  describe("renderCategory", () => {
    test("renders commands under a specific category", () => {
      const registry = createTestRegistry();
      const output = renderCategory(registry, "utils", "pt");

      assert.ok(output);
      assert.match(output, /Categoria: Utilitários/);
      assert.match(output, /!ping/);
      assert.match(output, /!info/);
    });

    test("returns null for unknown category", () => {
      const registry = createTestRegistry();
      assert.equal(renderCategory(registry, "unknown"), null);
    });
  });

  describe("renderManual", () => {
    test("renders command manual with aliases and description", () => {
      const registry = createTestRegistry();
      const entry = registry.byId.get("utilPlugin::pingFn")!;
      const manual = renderManual(entry, registry, "pt");

      assert.match(manual, /Manual: !ping/);
      assert.match(manual, /\*Aliases:\* !p/);
      assert.match(manual, /\*Categoria:\* Utilitários/);
      assert.match(manual, /\*Descrição:\* Testa a latência/);
      assert.match(manual, /Uso: !ping/);
    });
  });

  describe("handleMenuCommand", () => {
    test("shows overview when no args provided", () => {
      const registry = createTestRegistry();
      const result = handleMenuCommand("help", "", registry, "pt");
      assert.match(result, /ManyBot — Menu/);
    });

    test("routes to category if arg matches category name", () => {
      const registry = createTestRegistry();
      const result = handleMenuCommand("help", "utils", registry, "pt");
      assert.match(result, /Categoria: Utilitários/);
    });

    test("routes to manual if arg matches command invocation", () => {
      const registry = createTestRegistry();
      const result = handleMenuCommand("help", "ping", registry, "pt");
      assert.match(result, /Manual: !ping/);
    });

    test("returns not found message for unknown query", () => {
      const registry = createTestRegistry();
      const result = handleMenuCommand("help", "nonexistent", registry, "pt");
      assert.match(result, /nonexistent/);
    });
  });
});
