import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-integration-loader-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const {
  loadIntegrationPlugin,
  pluginRegistry,
  cleanupPlugins,
} = await import("#kernel/pluginLoader.js");
const { INTEGRATION_PLUGIN_NAME } = await import("#kernel/integrationMode.js");

const ORIGINAL_OPT_IN = process.env.MANYBOT_RUN_WHATSAPP_TESTS;

beforeEach(async () => {
  await cleanupPlugins();
  pluginRegistry.clear();
  // Force-clear and re-apply the opt-in between tests; each test sets
  // it explicitly so we know what the contract looks like.
  delete process.env.MANYBOT_RUN_WHATSAPP_TESTS;
});

after(async () => {
  await cleanupPlugins();
  pluginRegistry.clear();
  if (ORIGINAL_OPT_IN === undefined) delete process.env.MANYBOT_RUN_WHATSAPP_TESTS;
  else process.env.MANYBOT_RUN_WHATSAPP_TESTS = ORIGINAL_OPT_IN;
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/pluginLoader — loadIntegrationPlugin", () => {
  test("refuses to load without the opt-in flag", async () => {
    // opt-in explicitly NOT set
    await assert.rejects(
      loadIntegrationPlugin(),
      /MANYBOT_RUN_WHATSAPP_TESTS=1/,
    );
    assert.equal(pluginRegistry.has(INTEGRATION_PLUGIN_NAME), false);
  });

  test("registers the integration plugin when opt-in is set", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const entry = await loadIntegrationPlugin();
    assert.equal(entry.name, INTEGRATION_PLUGIN_NAME);
    assert.equal(entry.status, "active");
    assert.equal(typeof entry.run, "function");
    assert.equal(entry.commands, null, "integration plugin must not register user commands");
    assert.ok(pluginRegistry.has(INTEGRATION_PLUGIN_NAME));
  });

  test("is idempotent — second call returns the same entry without re-importing", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const first = await loadIntegrationPlugin();
    const second = await loadIntegrationPlugin();
    assert.equal(first, second);
    // Single registration, no duplicate.
    assert.equal(pluginRegistry.size, 1);
  });

  test("exports a public API object via plugin.exports", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const entry = await loadIntegrationPlugin();
    const api = entry.exports as {
      testChat: string;
      isTestChat: (jid: string | null | undefined) => boolean;
      waitForMarker: (marker: string, timeoutMs?: number) => Promise<string>;
      recentBodies: () => string[];
    } | null;
    assert.ok(api, "integration plugin must expose a public API");
    assert.equal(typeof api.isTestChat, "function");
    assert.equal(typeof api.waitForMarker, "function");
    assert.equal(typeof api.recentBodies, "function");
    // testChat is populated in setup(), not on registration.
    assert.equal(api.testChat, "");
  });

  test("loads the plugin from the source path shipped with the repo", async () => {
    process.env.MANYBOT_RUN_WHATSAPP_TESTS = "1";
    const entry = await loadIntegrationPlugin();
    // The plugin must be the real one (default export present).
    assert.equal(typeof entry.run, "function");
  });
});
