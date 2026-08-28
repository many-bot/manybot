import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-commands-config-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { loadCommandsConfig, parseLocalizedString, resolveFileRef } = await import("#kernel/commandsConfig.js");
const commandsFile = path.join(configDir, "commands.yaml");

beforeEach(async () => {
  await fs.rm(commandsFile, { force: true });
});

after(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/commandsConfig", () => {
  test("parses localized strings and preserves only usable values", () => {
    assert.equal(parseLocalizedString("  hello  "), "hello");
    assert.equal(parseLocalizedString("   "), null);
    assert.deepEqual(parseLocalizedString({ en: " Hello ", pt: " Olá ", invalid: 3 }), {
      en: "Hello",
      pt: "Olá",
    });
    assert.equal(parseLocalizedString([]), null);
  });

  test("returns null when commands.yaml does not exist", async () => {
    assert.equal(await loadCommandsConfig(), null);
  });

  test("uses defaults for an empty YAML document", async () => {
    await fs.writeFile(commandsFile, "null\n", "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.equal(config.defaults.notifyChanges, true);
    assert.equal(config.defaults.notifyPeriodDays, 7);
    assert.equal(config.menu.enabled, false);
    assert.deepEqual(config.menu.aliases, ["help", "man", "menu", "bot", "?"]);
    assert.deepEqual(config.specs, []);
  });

  test("rejects malformed and non-object YAML roots", async () => {
    await fs.writeFile(commandsFile, "commands: [unterminated", "utf8");
    assert.equal(await loadCommandsConfig(), null);

    await fs.writeFile(commandsFile, "- not\n- a mapping\n", "utf8");
    assert.equal(await loadCommandsConfig(), null);
  });

  test("loads defaults, menu, categories, manuals, file references and command permissions", async () => {
    await fs.writeFile(path.join(configDir, "reply.txt"), "Reply from file", "utf8");
    await fs.writeFile(path.join(configDir, "manual-pt.txt"), "Manual em português", "utf8");
    await fs.writeFile(commandsFile, `
defaults:
  notifyChanges: false
  notifyPeriodDays: 12.8
  notifyMessage: " Command changed "
  permissions:
    admin: true
    scope: GROUP
    cooldownSeconds: 4
    whitelist:
      groups: [ " group@g.us ", 1 ]
      users: [ " user@c.us " ]
  messages:
    cooldown: " Wait "
menu:
  title: { en: " Commands ", pt: " Comandos " }
  intro: " Intro "
  footer: " Footer "
  aliases: [ help, " ? ", 1 ]
  notFoundFallback: true
categories:
  fun:
    label: { en: " Fun " }
    order: 2
  uncategorized: {}
manuals:
  greeting: "file: manual-pt.txt"
hello:
  cmd: " hello "
  aliases: [ hi, " oi ", 3 ]
  plugin: " sample "
  function: " greet "
  text: "file: reply.txt"
  desc: { en: " Say hello ", pt: " Diga oi " }
  category: " fun "
  manual: { pt: "file: manual-pt.txt", en: " Plain manual " }
  deprecatedMessage: " Old command "
  notifyChanges: false
  permissions:
    botAdmin: true
    owner: false
    scope: dm
    cooldownSeconds: 0
    blacklist:
      users: [ blocked@c.us ]
  messages:
    ownerOnly: " Owners only "
invalid: "not a command"
missingCmd:
  aliases: [ no ]
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.deepEqual(config.defaults, {
      notifyChanges: false,
      notifyPeriodDays: 12,
      notifyMessage: "Command changed",
      permissions: {
        admin: true,
        botAdmin: undefined,
        owner: undefined,
        scope: "group",
        cooldownSeconds: 4,
        whitelist: { groups: ["group@g.us"], users: ["user@c.us"] },
        blacklist: undefined,
        dono: undefined,
        allowedChats: undefined,
        groupOnly: undefined,
        dmOnly: undefined,
        whitelistGroups: undefined,
        blacklistUsers: undefined,
        hiddenOutsideScope: undefined,
      },
      messages: {
        botNotAdmin: undefined,
        senderNotAdmin: undefined,
        ownerOnly: undefined,
        donoOnly: undefined,
        wrongScope: undefined,
        cooldown: "Wait",
        blacklist: undefined,
        allowedChats: undefined,
      },
      loading: null,
    });
    assert.deepEqual(config.menu, {
      enabled: true,
      title: { en: "Commands", pt: "Comandos" },
      intro: "Intro",
      footer: "Footer",
      cmd: "menu",
      aliases: ["help", "?"],
      notFoundFallback: true,
      suggestSimilar: false,
      suggestMaxDistance: 2,
      welcomeMessage: null,
      welcomeWindowDays: 3,
      pageSize: 15,
    });
    assert.deepEqual(config.categories, {
      fun: { label: { en: "Fun" }, order: 2, scope: null, hiddenInScope: null },
      uncategorized: { label: "uncategorized", order: 999, scope: null, hiddenInScope: null },
    });
    assert.deepEqual(config.manuals, { greeting: "Manual em português" });
    assert.equal(config.specs.length, 1);
    assert.deepEqual(config.specs[0], {
      id: "hello",
      cmd: "hello",
      aliases: ["hi", "oi"],
      plugin: "sample",
      functions: ["greet"],
      loading: null,
      text: "Reply from file",
      desc: { en: "Say hello", pt: "Diga oi" },
      category: "fun",
      group: null,
      manual: { pt: "Manual em português", en: "Plain manual" },
      deprecatedMessage: "Old command",
      notifyChanges: false,
      permissions: {
        admin: undefined,
        botAdmin: true,
        owner: false,
        scope: "dm",
        cooldownSeconds: 0,
        whitelist: undefined,
        blacklist: { groups: undefined, users: ["blocked@c.us"] },
        dono: undefined,
        allowedChats: undefined,
        groupOnly: undefined,
        dmOnly: undefined,
        whitelistGroups: undefined,
        blacklistUsers: undefined,
        hiddenOutsideScope: undefined,
      },
      messages: {
        botNotAdmin: undefined,
        senderNotAdmin: undefined,
        ownerOnly: "Owners only",
        donoOnly: undefined,
        wrongScope: undefined,
        cooldown: undefined,
        blacklist: undefined,
        allowedChats: undefined,
      },
      arguments: [],
      subcommands: [],
    });
  });

  test("keeps an unreadable file reference as the original text", async () => {
    assert.equal(await resolveFileRef("file: missing.txt"), "file: missing.txt");
    assert.deepEqual(await resolveFileRef({ en: "file: missing.txt", pt: "Texto" }), {
      en: "file: missing.txt",
      pt: "Texto",
    });
  });

  test("import: merges top-level sections from auxiliary files", async () => {
    await fs.writeFile(path.join(configDir, "menu.yaml"), `
menu:
  title: "Imported Menu"
  aliases: ["ajuda"]
`, "utf8");
    await fs.writeFile(path.join(configDir, "manual.yaml"), `
manuals:
  hello: "Imported manual"
`, "utf8");
    await fs.writeFile(commandsFile, `
import:
  - menu.yaml
  - manual.yaml
hello:
  cmd: hello
  plugin: sample
  function: greet
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.equal(config.menu.title, "Imported Menu");
    assert.deepEqual(config.menu.aliases, ["ajuda"]);
    assert.deepEqual(config.manuals, { hello: "Imported manual" });
    assert.equal(config.specs.length, 1);
    assert.equal(config.specs[0].id, "hello");
  });

  test("import: accepts a single path (not wrapped in a list)", async () => {
    await fs.writeFile(path.join(configDir, "menu.yaml"), `
menu:
  title: "Solo Import"
`, "utf8");
    await fs.writeFile(commandsFile, `
import: menu.yaml
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.equal(config.menu.title, "Solo Import");
  });

  test("import: a key already owned by the main file or an earlier import is kept, not overwritten", async () => {
    await fs.writeFile(path.join(configDir, "menu.yaml"), `
menu:
  title: "Should be ignored"
`, "utf8");
    await fs.writeFile(commandsFile, `
import:
  - menu.yaml
menu:
  title: "Main file wins"
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.equal(config.menu.title, "Main file wins");
  });

  test("import: a missing or malformed import file is skipped without failing the whole load", async () => {
    await fs.writeFile(path.join(configDir, "broken.yaml"), "not: [a, valid\n", "utf8");
    await fs.writeFile(commandsFile, `
import:
  - does-not-exist.yaml
  - broken.yaml
hello:
  cmd: hello
  plugin: sample
  function: greet
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.equal(config.specs.length, 1);
    assert.equal(config.specs[0].id, "hello");
  });

  // ── loading: snake_case flat-form props (reference yaml uses these) ──────
  describe("loading: snake_case flat-form props", () => {
    test("loading_presets accepts on_success/on_error (reaction) and interval_ms (spinner) — reference yaml's exact shape", async () => {
      await fs.writeFile(commandsFile, `
loading_presets:
  padrao:
    type: reaction
    icon: "⏳"
    on_success: "✅"
    on_error: "❌"
  spinner_classico:
    type: spinner
    frames: ["⠋", "⠙"]
    interval_ms: 1000
    on_success: "✅ Pronto!"
    on_error: "Erro: {erro}"
loading: padrao
`, "utf8");

      const config = await loadCommandsConfig();
      assert.ok(config);
      assert.deepEqual(config.loadingPresets.padrao, {
        type: "reaction",
        icon: "⏳",
        onSuccess: "✅",
        onError: "❌",
      });
      assert.deepEqual(config.loadingPresets.spinner_classico, {
        type: "spinner",
        frames: ["⠋", "⠙"],
        intervalMs: 1000,
        onSuccess: "✅ Pronto!",
        onError: "Erro: {erro}",
      });
    });

    test("camelCase and snake_case forms are equivalent, not additive (last one parsed wins, neither is required)", async () => {
      await fs.writeFile(commandsFile, `
loading_presets:
  onlyCamel:
    type: reaction
    onSuccess: "camel"
  onlySnake:
    type: reaction
    on_success: "snake"
`, "utf8");

      const config = await loadCommandsConfig();
      assert.ok(config);
      assert.equal(config.loadingPresets.onlyCamel.onSuccess, "camel");
      assert.equal(config.loadingPresets.onlySnake.onSuccess, "snake");
    });

    test("an actually-unknown property for the declared type is still fatal (malformed config)", async () => {
      await fs.writeFile(commandsFile, `
loading_presets:
  bad:
    type: reaction
    frames: ["not", "valid", "for", "reaction"]
`, "utf8");

      const config = await loadCommandsConfig();
      assert.ok(config);
      assert.equal(config.loadingPresets.bad, undefined, "malformed preset is dropped, not silently accepted");
    });
  });

  // ── top-level `loading:` global default overlays onto defaults.loading ──
  test("top-level loading: <preset-name> overlays onto defaults.loading, same as notify_*/permission_messages", async () => {
    await fs.writeFile(commandsFile, `
loading_presets:
  padrao:
    type: reaction
    icon: "⏳"
loading: padrao
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.deepEqual(config.defaults.loading, { type: "reaction", icon: "⏳" });
  });

  test("top-level loading: accepts an inline spec, not just a preset name", async () => {
    await fs.writeFile(commandsFile, `
loading:
  type: typing
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.deepEqual(config.defaults.loading, { type: "typing" });
  });

  test("top-level loading: wins over defaults.loading when both are present (overlay semantics)", async () => {
    await fs.writeFile(commandsFile, `
defaults:
  loading:
    type: typing
loading:
  type: none
`, "utf8");

    const config = await loadCommandsConfig();
    assert.ok(config);
    assert.deepEqual(config.defaults.loading, { type: "none" });
  });

  // ── plugin: registry-key normalization ───────────────────────────────
  // The caller passes the active pluginRegistry's keys via
  // loadCommandsConfig({ validPluginKeys }). parseEntry uses them to
  // resolve shorthand `plugin: <name>` entries to the canonical
  // `owner/repo` key (and to leave fully-qualified entries alone).
  describe("plugin: registry-key normalization", () => {
    test("keeps an exact owner/repo key verbatim", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: synt-xerror/welcome
  functions: [greet]
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["synt-xerror/welcome", "de/welcome-test"])
      );
      assert.ok(config);
      assert.equal(config.specs.length, 1);
      assert.equal(config.specs[0].plugin, "synt-xerror/welcome");
      assert.deepEqual(config.specs[0].functions, ["greet"]);
    });

    test("resolves a bare name to the unique matching owner/repo key", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: welcome
  functions: [greet]
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["synt-xerror/welcome", "de/welcome-test"])
      );
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "synt-xerror/welcome");
    });

    test("splits the inline owner/repo.fn form before normalization", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: synt-xerror/welcome.ping
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["synt-xerror/welcome", "de/welcome-test"])
      );
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "synt-xerror/welcome");
      assert.deepEqual(config.specs[0].functions, ["ping"]);
    });

    test("splits the inline bare-name.fn form before normalization", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: welcome.ping
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["synt-xerror/welcome"])
      );
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "synt-xerror/welcome");
      assert.deepEqual(config.specs[0].functions, ["ping"]);
    });

    test("splits core.fn items in functions lists", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  functions: [core.greet, core.reply]
`, "utf8");

      const config = await loadCommandsConfig(new Set(["core"]));
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "core");
      assert.deepEqual(config.specs[0].functions, ["greet", "reply"]);
    });

    test("splits canonical owner/plugin.fn items in subcommands", async () => {
      await fs.writeFile(commandsFile, `
figurinha:
  cmd: f
  subcommands:
    - cmd: criar
      functions: [synt-xerror/figurinha.validarMidia, synt-xerror/figurinha.criarFigurinha]
`, "utf8");

      const config = await loadCommandsConfig(new Set(["synt-xerror/figurinha"]));
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "synt-xerror/figurinha");
      assert.deepEqual(config.specs[0].subcommands[0].functions, [
        "validarMidia",
        "criarFigurinha",
      ]);
    });

    test("keeps an unknown bare name verbatim (caller surfaces the miss)", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: unknown-plugin
  functions: [greet]
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["synt-xerror/welcome", "de/welcome-test"])
      );
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "unknown-plugin");
    });

    test("keeps a name verbatim when more than one owner matches (ambiguity surfaces at dispatch)", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: shared
  functions: [greet]
`, "utf8");

      const config = await loadCommandsConfig(
        new Set(["alice/shared", "bob/shared"])
      );
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "shared");
    });

    test("without validPluginKeys the value is used verbatim (legacy path)", async () => {
      await fs.writeFile(commandsFile, `
hello:
  cmd: hello
  plugin: welcome
  functions: [greet]
`, "utf8");

      const config = await loadCommandsConfig();
      assert.ok(config);
      assert.equal(config.specs[0].plugin, "welcome");
    });
  });
});

