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
      },
      messages: { botNotAdmin: undefined, senderNotAdmin: undefined, ownerOnly: undefined, wrongScope: undefined, cooldown: "Wait" },
    });
    assert.deepEqual(config.menu, {
      title: { en: "Commands", pt: "Comandos" },
      intro: "Intro",
      footer: "Footer",
      aliases: ["help", "?"],
      notFoundFallback: true,
    });
    assert.deepEqual(config.categories, {
      fun: { label: { en: "Fun" }, order: 2 },
      uncategorized: { label: "uncategorized", order: 999 },
    });
    assert.deepEqual(config.manuals, { greeting: "Manual em português" });
    assert.equal(config.specs.length, 1);
    assert.deepEqual(config.specs[0], {
      id: "hello",
      cmd: "hello",
      aliases: ["hi", "oi"],
      plugin: "sample",
      function: "greet",
      text: "Reply from file",
      desc: { en: "Say hello", pt: "Diga oi" },
      category: "fun",
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
      },
      messages: { botNotAdmin: undefined, senderNotAdmin: undefined, ownerOnly: "Owners only", wrongScope: undefined, cooldown: undefined },
    });
  });

  test("keeps an unreadable file reference as the original text", async () => {
    assert.equal(await resolveFileRef("file: missing.txt"), "file: missing.txt");
    assert.deepEqual(await resolveFileRef({ en: "file: missing.txt", pt: "Texto" }), {
      en: "file: missing.txt",
      pt: "Texto",
    });
  });
});
