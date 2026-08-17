import test, { describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-integration-mode-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const {
  getIntegrationModeStatus,
  requireIntegrationMode,
  isIntegrationOptIn,
  INTEGRATION_PLUGIN_NAME,
  getIntegrationPluginDir,
} = await import("#kernel/integrationMode.js");
const {
  _resetTestConfigForTests,
  TEST_CHAT_ENV,
  RUN_WHATSAPP_TESTS_ENV,
} = await import("#kernel/testConfig.js");

const tomlPath = path.join(configDir, "manybot.toml");

function clearEnv(): void {
  delete process.env[TEST_CHAT_ENV];
  delete process.env[RUN_WHATSAPP_TESTS_ENV];
  delete process.env.MANYBOT_RUN_WHATSAPP_TESTS;
}

before(async () => {
  await fs.writeFile(tomlPath, "", "utf8");
});

beforeEach(async () => {
  clearEnv();
  await fs.writeFile(tomlPath, "", "utf8");
  _resetTestConfigForTests();
});

after(async () => {
  clearEnv();
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/integrationMode — isIntegrationOptIn", () => {
  test("false when env is unset", () => {
    assert.equal(isIntegrationOptIn(), false);
  });

  test("false when env is anything other than '1'", () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "true";
    assert.equal(isIntegrationOptIn(), false);
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "0";
    assert.equal(isIntegrationOptIn(), false);
  });

  test("true only when env equals '1'", () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    assert.equal(isIntegrationOptIn(), true);
  });
});

describe("kernel/integrationMode — getIntegrationModeStatus", () => {
  test("not ready when opt-in is missing (even with TEST_CHAT set)", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000001";
    const status = await getIntegrationModeStatus();
    assert.equal(status.ready, false);
    assert.match(status.reason!, /MANYBOT_RUN_WHATSAPP_TESTS=1/);
    assert.equal(status.chat, "5516000000001@s.whatsapp.net");
  });

  test("not ready when TEST_CHAT is missing (even with opt-in)", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const status = await getIntegrationModeStatus();
    assert.equal(status.ready, false);
    assert.match(status.reason!, /TEST_CHAT is not set/);
    assert.equal(status.chat, null);
  });

  test("ready only when both opt-in and TEST_CHAT are configured", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000002";
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const status = await getIntegrationModeStatus();
    assert.equal(status.ready, true);
    assert.equal(status.reason, null);
    assert.equal(status.chat, "5516000000002@s.whatsapp.net");
    assert.equal(status.source, "env");
  });
});

describe("kernel/integrationMode — requireIntegrationMode", () => {
  test("returns chat and source when ready", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000003";
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const res = await requireIntegrationMode();
    assert.equal(res.chat, "5516000000003@s.whatsapp.net");
    assert.equal(res.source, "env");
  });

  test("throws when opt-in is missing", async () => {
    process.env[TEST_CHAT_ENV] = "5516000000004";
    await assert.rejects(requireIntegrationMode(), /MANYBOT_RUN_WHATSAPP_TESTS=1/);
  });

  test("throws when TEST_CHAT is missing", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    await assert.rejects(requireIntegrationMode(), /TEST_CHAT is not set/);
  });
});

describe("kernel/integrationMode — constants", () => {
  test("integration plugin name is reserved (double-underscore)", () => {
    assert.equal(INTEGRATION_PLUGIN_NAME, "__manybot_integration__");
    assert.ok(INTEGRATION_PLUGIN_NAME.startsWith("__"));
    assert.ok(INTEGRATION_PLUGIN_NAME.endsWith("__"));
  });

  test("integration plugin dir resolves under src/plugins/", () => {
    const dir = getIntegrationPluginDir();
    assert.ok(dir.endsWith(path.join("src", "plugins", "__manybot_integration__")));
  });
});
