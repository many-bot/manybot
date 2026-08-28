import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocalizedString,
  renderOverview,
  renderCategory,
  renderManual,
  renderNotFound,
  handleMenuCommand,
  checkAndTriggerWelcomeMessage
} from "#kernel/commandMenu.js";
import { buildCommandRegistry } from "#kernel/commandRegistry.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";

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
          adminCmd: {
            cmd: "adminonly",
            aliases: [],
            desc: "Comando restrito",
            category: "adminCat",
          },
        },
      } as unknown as PluginEntry,
    ],
  ]);

  const categories = {
    utils: { label: { pt: "Utilitários", en: "Utilities" }, order: 1 },
    adminCat: { label: { pt: "Administração", en: "Administration" }, order: 2, scope: "group" as const },
  };

  const menu = {
    title: "ManyBot — Menu",
    intro: "Help menu",
    footer: "Footer text",
    cmd: "help",
    aliases: ["help", "menu"],
    notFoundFallback: false,
    suggestSimilar: false,
    suggestMaxDistance: 2,
    welcomeMessage: { pt: "Bem-vindo ao bot! Use {prefix}help para o menu.", en: "Welcome! Use {prefix}help." },
    welcomeWindowDays: 3,
    pageSize: 2,
  };

  return buildCommandRegistry(null, plugins, undefined, menu, categories);
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
      const overview = renderOverview(registry, "en");

      assert.match(overview, /Help menu/);
    });

    test("renders categorized menu overview", () => {
      const registry = createTestRegistry();
      const overview = renderOverview(registry, "pt");

      assert.match(overview, /ManyBot — Menu/);
      assert.match(overview, /📁 \*Utilitários\*/);
      assert.match(overview, /!ping — Testa a latência/);
      assert.match(overview, /!info — Informações do bot/);
    });

    test("filters out category when outside defined scope", () => {
      const registry = createTestRegistry();
      const overviewGroup = renderOverview(registry, "pt", undefined, "group");
      assert.match(overviewGroup, /📁 \*Administração\*/);

      const overviewDm = renderOverview(registry, "pt", undefined, "dm");
      assert.doesNotMatch(overviewDm, /📁 \*Administração\*/);
    });

    test("handles flat command list with pagination", () => {
      const plugins = new Map<string, PluginEntry>([
        [
          "utilPlugin",
          {
            name: "utilPlugin",
            status: "active",
            manifest: { name: "utilPlugin", version: "1.0.0" },
            commands: {
              cmd1: { cmd: "c1", aliases: [], desc: "desc 1" },
              cmd2: { cmd: "c2", aliases: [], desc: "desc 2" },
              cmd3: { cmd: "c3", aliases: [], desc: "desc 3" },
            },
          } as unknown as PluginEntry,
        ],
      ]);
      const menu = {
        title: "Flat",
        intro: null,
        footer: null,
        cmd: "help",
        aliases: ["help"],
        notFoundFallback: false,
        suggestSimilar: false,
        suggestMaxDistance: 2,
        welcomeMessage: null,
        welcomeWindowDays: 3,
        pageSize: 2,
      };
      const flatRegistry = buildCommandRegistry(null, plugins, undefined, menu, {});

      const page1 = renderOverview(flatRegistry, "en", 1);
      assert.match(page1, /!c1/);
      assert.match(page1, /!c2/);
      assert.doesNotMatch(page1, /!c3/);

      const page2 = renderOverview(flatRegistry, "en", 2);
      assert.match(page2, /!c3/);
      assert.doesNotMatch(page2, /!c1/);
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

    test("respects scope filtering in renderCategory", () => {
      const registry = createTestRegistry();
      const dmOutput = renderCategory(registry, "adminCat", "pt", "dm");
      assert.equal(dmOutput, null);

      const groupOutput = renderCategory(registry, "adminCat", "pt", "group");
      assert.ok(groupOutput);
      assert.match(groupOutput, /Categoria: Administração/);
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

    test("handles page number argument", () => {
      const plugins = new Map<string, PluginEntry>([
        [
          "utilPlugin",
          {
            name: "utilPlugin",
            status: "active",
            manifest: { name: "utilPlugin", version: "1.0.0" },
            commands: {
              cmd1: { cmd: "c1", aliases: [] },
              cmd2: { cmd: "c2", aliases: [] },
              cmd3: { cmd: "c3", aliases: [] },
            },
          } as unknown as PluginEntry,
        ],
      ]);
      const menu = {
        title: null,
        intro: null,
        footer: null,
        cmd: "help",
        aliases: ["help"],
        notFoundFallback: false,
        suggestSimilar: false,
        suggestMaxDistance: 2,
        welcomeMessage: null,
        welcomeWindowDays: 3,
        pageSize: 1,
      };
      const flatRegistry = buildCommandRegistry(null, plugins, undefined, menu, {});
      const result = handleMenuCommand("help", "page 2", flatRegistry, "pt");
      assert.match(result, /!c2/);
      assert.doesNotMatch(result, /!c1/);
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

  describe("checkAndTriggerWelcomeMessage", () => {
    test("triggers welcome message for new user and tracks seen timestamp", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_1";
      const settings = buildSettingsApi("kernel", userId);
      settings.delete("last_welcome_seen");

      const msg = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "oi", timestamp: Date.now() },
        "pt"
      );
      assert.ok(msg);
      assert.match(msg, /Bem-vindo ao bot! Use !help para o menu\./);

      // Immediately checking again returns null
      const secondCheck = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "oi", timestamp: Date.now() },
        "pt"
      );
      assert.equal(secondCheck, null);
    });

    test("does not fire when the incoming message has no body (offline-flush receipt misclassification)", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_empty_body";
      buildSettingsApi("kernel", userId).delete("last_welcome_seen");

      const msg = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "", timestamp: Date.now() }
      );
      assert.equal(msg, null, "no welcome for a body-less message");

      const msg2 = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "   ", timestamp: Date.now() }
      );
      assert.equal(msg2, null, "no welcome for a whitespace-only body either");
    });

    test("does not fire when the incoming message is older than the freshness window (offline-flush delayed replay)", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_stale_replay";
      buildSettingsApi("kernel", userId).delete("last_welcome_seen");

      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const msg = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "oi", timestamp: twoHoursAgo }
      );
      assert.equal(msg, null, "no welcome for a 2-hour-old replay");
    });

    test("does fire for a fresh in-window message (control case for the new gates)", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_fresh";
      buildSettingsApi("kernel", userId).delete("last_welcome_seen");

      const msg = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "oi", timestamp: Date.now() }
      );
      assert.ok(msg, "welcome fires for a current, non-empty message");
    });

    test("does not fire when the msg envelope is missing (defensive — caller must always pass one)", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_no_envelope";
      buildSettingsApi("kernel", userId).delete("last_welcome_seen");

      const msg = checkAndTriggerWelcomeMessage(userId, registry);
      assert.equal(msg, null);
    });

    test("uses the prefix override in the {prefix} placeholder instead of the global default", () => {
      const registry = createTestRegistry();
      const userId = "test_user_welcome_custom_prefix";
      buildSettingsApi("kernel", userId).delete("last_welcome_seen");

      const msg = checkAndTriggerWelcomeMessage(
        userId,
        registry,
        { body: "oi", timestamp: Date.now() },
        "pt",
        "#"
      );
      assert.ok(msg);
      assert.match(msg, /Use #help para o menu\./);
    });
  });

  describe("hiddenOutsideScope (group/dm suppression)", () => {
    function buildScopeRegistry() {
      const noop = async () => {};
      const plugins = new Map<string, PluginEntry>([
        [
          "scopePlugin",
          {
            name: "scopePlugin",
            status: "active",
            manifest: { name: "scopePlugin", version: "1.0.0" },
            commands: {
              groupOnlyFn: {
                cmd: "g",
                aliases: [],
                desc: "Group-only command",
                category: "utils",
                permissions: { groupOnly: true },
                handler: noop,
              },
              dmOnlyFn: {
                cmd: "d",
                aliases: [],
                desc: "DM-only command",
                category: "utils",
                permissions: { dmOnly: true },
                handler: noop,
              },
              bothFn: {
                cmd: "b",
                aliases: [],
                desc: "Both-scopes command",
                category: "utils",
                handler: noop,
              },
            },
          } as unknown as PluginEntry,
        ],
      ]);

      const menu = {
        title: "Scope",
        intro: null,
        footer: null,
        cmd: "help",
        aliases: ["help"],
        notFoundFallback: false,
        suggestSimilar: false,
        suggestMaxDistance: 2,
        welcomeMessage: null,
        welcomeWindowDays: 3,
        pageSize: 10,
      };

      return buildCommandRegistry(null, plugins, undefined, menu, {
        utils: { label: "Utils", order: 1 },
      });
    }

    test("hides group-only commands from DM overview", () => {
      const registry = buildScopeRegistry();
      const dmOverview = renderOverview(registry, "en", undefined, "dm");
      assert.doesNotMatch(dmOverview, /!g\b/);
      assert.match(dmOverview, /!d\b/);
      assert.match(dmOverview, /!b\b/);
    });

    test("hides DM-only commands from group overview", () => {
      const registry = buildScopeRegistry();
      const groupOverview = renderOverview(registry, "en", undefined, "group");
      assert.match(groupOverview, /!g\b/);
      assert.doesNotMatch(groupOverview, /!d\b/);
      assert.match(groupOverview, /!b\b/);
    });

    test("no-scope overview shows all commands", () => {
      const registry = buildScopeRegistry();
      const overview = renderOverview(registry, "en");
      assert.match(overview, /!g\b/);
      assert.match(overview, /!d\b/);
      assert.match(overview, /!b\b/);
    });

    test("renderCategory respects hiddenOutsideScope", () => {
      const registry = buildScopeRegistry();
      const dmCategory = renderCategory(registry, "utils", "en", "dm");
      assert.ok(dmCategory);
      assert.doesNotMatch(dmCategory, /!g\b/);
      assert.match(dmCategory, /!d\b/);
    });
  });
});

