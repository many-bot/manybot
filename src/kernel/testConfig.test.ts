import test, { describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-test-config-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const {
  getTestConfig,
  requireTestConfig,
  normalizeTestChat,
  _resetTestConfigForTests,
  TEST_CHAT_ENV,
  RUN_WHATSAPP_TESTS_ENV,
  TEST_CHAT_TOML_KEY,
} = await import("#kernel/testConfig.js");
const { TOML_CONFIG_FILE } = await import("#config");

const tomlPath = path.join(configDir, "manybot.toml");

async function writeToml(contents: string): Promise<void> {
  await fs.writeFile(tomlPath, contents, "utf8");
}

function clearEnv(): void {
  delete process.env[TEST_CHAT_ENV];
  delete process.env[RUN_WHATSAPP_TESTS_ENV];
}

before(async () => {
  await fs.writeFile(tomlPath, "", "utf8");
});

beforeEach(async () => {
  clearEnv();
  await writeToml("");
  _resetTestConfigForTests();
});

after(async () => {
  clearEnv();
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/testConfig — normalizeTestChat", () => {
  test("accepts a bare number and normalizes to @s.whatsapp.net", () => {
    assert.equal(normalizeTestChat("5516999999999"), "5516999999999@s.whatsapp.net");
  });

  test("accepts a leading + on bare numbers", () => {
    assert.equal(normalizeTestChat("+5516999999999"), "5516999999999@s.whatsapp.net");
  });

  test("preserves @c.us", () => {
    assert.equal(normalizeTestChat("5516999999999@c.us"), "5516999999999@c.us");
  });

  test("preserves @s.whatsapp.net", () => {
    assert.equal(normalizeTestChat("5516999999999@s.whatsapp.net"), "5516999999999@s.whatsapp.net");
  });

  test("preserves @lid", () => {
    assert.equal(normalizeTestChat("12345@lid"), "12345@lid");
  });

  test("preserves @g.us", () => {
    assert.equal(normalizeTestChat("120363012345678@g.us"), "120363012345678@g.us");
  });

  test("trims surrounding whitespace", () => {
    assert.equal(normalizeTestChat("  5516999999999  "), "5516999999999@s.whatsapp.net");
  });

  test("rejects empty string", () => {
    assert.throws(() => normalizeTestChat(""), /empty/);
  });

  test("rejects non-string input", () => {
    assert.throws(() => normalizeTestChat(undefined as unknown as string), /string/);
  });

  test("rejects unknown suffix", () => {
    assert.throws(() => normalizeTestChat("foo@example.com"), /JID/);
  });

  test("rejects JID with bad chars in the local part", () => {
    assert.throws(() => normalizeTestChat("5516!@c.us"), /local part/);
  });
});

describe("kernel/testConfig — getTestConfig", () => {
  test("returns null chat and skipReason when nothing is configured", async () => {
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
    assert.equal(cfg.source, null);
    assert.equal(cfg.runWhatsApp, false);
    assert.match(cfg.skipReason!, /TEST_CHAT is not set/);
  });

  test("env wins over TOML", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = "5516000000001"\n`);
    process.env[TEST_CHAT_ENV] = "5516000000002";
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, "5516000000002@s.whatsapp.net");
    assert.equal(cfg.source, "env");
  });

  test("falls back to TOML when env is unset", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = "5516000000003"\n`);
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, "5516000000003@s.whatsapp.net");
    assert.equal(cfg.source, "toml");
  });

  test("empty string in TOML is treated as absent", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = ""\n`);
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
  });

  test("whitespace-only env is treated as absent", async () => {
    process.env[TEST_CHAT_ENV] = "   ";
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
  });

  test("invalid value in TOML is ignored (warning logged, not thrown)", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = "not-a-valid-jid@x.com"\n`);
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
  });

  test("non-string TOML value is ignored", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = 42\n`);
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
  });

  test("runWhatsApp is true only when env equals '1'", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000004";
    process.env[RUN_WHATSAPP_TESTS_ENV] = "1";
    const on = await getTestConfig();
    assert.equal(on.runWhatsApp, true);

    _resetTestConfigForTests();
    process.env[RUN_WHATSAPP_TESTS_ENV] = "true";
    const off1 = await getTestConfig();
    assert.equal(off1.runWhatsApp, false);

    _resetTestConfigForTests();
    process.env[RUN_WHATSAPP_TESTS_ENV] = "0";
    const off2 = await getTestConfig();
    assert.equal(off2.runWhatsApp, false);

    _resetTestConfigForTests();
    delete process.env[RUN_WHATSAPP_TESTS_ENV];
    const off3 = await getTestConfig();
    assert.equal(off3.runWhatsApp, false);
  });

  test("skipReason explains the missing opt-in even when TEST_CHAT is set", async () => {
    await writeToml(`${TEST_CHAT_TOML_KEY} = "5516000000005"\n`);
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, "5516000000005@s.whatsapp.net");
    assert.equal(cfg.runWhatsApp, false);
    assert.match(cfg.skipReason!, /MANYBOT_RUN_WHATSAPP_TESTS=1/);
  });

  test("skipReason is null when everything is configured", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000006";
    process.env[RUN_WHATSAPP_TESTS_ENV] = "1";
    const cfg = await getTestConfig();
    assert.equal(cfg.skipReason, null);
  });

  test("result is cached across calls within the same process", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000007";
    const first = await getTestConfig();
    process.env[TEST_CHAT_ENV] = "5516000000008";
    const second = await getTestConfig();
    assert.equal(first.chat, second.chat, "cache must not re-read env");

    _resetTestConfigForTests();
    const third = await getTestConfig();
    assert.equal(third.chat, "5516000000008@s.whatsapp.net");
  });

  test("missing manybot.toml is treated as 'no value'", async () => {
    await fs.rm(tomlPath, { force: true });
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
    assert.equal(cfg.source, null);
  });

  test("malformed TOML is logged and treated as 'no value'", async () => {
    await fs.writeFile(tomlPath, "this is not valid = = toml =", "utf8");
    const cfg = await getTestConfig();
    assert.equal(cfg.chat, null);
  });
});

describe("kernel/testConfig — requireTestConfig", () => {
  test("returns config when fully configured", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000009";
    process.env[RUN_WHATSAPP_TESTS_ENV] = "1";
    const cfg = await requireTestConfig();
    assert.equal(cfg.chat, "5516000000009@s.whatsapp.net");
    assert.equal(cfg.runWhatsApp, true);
  });

  test("throws when TEST_CHAT is missing", async () => {
    process.env[RUN_WHATSAPP_TESTS_ENV] = "1";
    await assert.rejects(
      requireTestConfig(),
      /TEST_CHAT is not set/,
    );
  });

  test("throws when opt-in is missing", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000010";
    await assert.rejects(
      requireTestConfig(),
      /MANYBOT_RUN_WHATSAPP_TESTS=1/,
    );
  });
});

// smoke: TOML_CONFIG_FILE should point inside the temp config dir
describe("kernel/testConfig — wiring", () => {
  test("TOML_CONFIG_FILE respects MANYBOT_CONFIG_DIR", () => {
    assert.equal(TOML_CONFIG_FILE, tomlPath);
  });
});
