import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  getIntegrationModeStatus,
  isIntegrationOptIn,
  INTEGRATION_PLUGIN_NAME,
} from "#kernel/integrationMode.js";
import {
  loadIntegrationPlugin,
  pluginRegistry,
  cleanupPlugins,
} from "#kernel/pluginLoader.js";
import { getDriverManager } from "#kernel/driverManager.js";
import { logger } from "#logger";

async function waitForActiveDriver(
  timeoutMs = 20_000,
  intervalMs = 200,
): Promise<import("#kernel/waContract.js").WaContract | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const driver = getDriverManager().active();
      if (driver && driver.isReady()) return driver;
    } catch {
      // no active driver yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

describe("kernel/whatsappIntegration — Real WhatsApp Integration Suite", () => {
  const runId = `itest-${Date.now()}-${randomUUID().slice(0, 6)}`;
  let testChat: string | null = null;
  let isReady = false;

  before(async () => {
    const status = await getIntegrationModeStatus();
    if (!status.ready) {
      logger.info(
        `[whatsappIntegration] skipping real WhatsApp tests: ${status.reason ?? "not ready"}`
      );
      return;
    }
    testChat = status.chat;
    isReady = true;
    process.env.MANYBOT_TEST_CHAT = testChat!;
  });

  after(async () => {
    await cleanupPlugins();
    pluginRegistry.clear();
    delete process.env.MANYBOT_TEST_CHAT;

    // main.ts (loaded via --import) keeps the process alive after tests
    // finish (open driver connection, status server). Reuse its own
    // SIGTERM handler to disconnect and exit cleanly instead of
    // duplicating that shutdown logic here.
    if (isReady) {
      setImmediate(() => process.kill(process.pid, "SIGTERM"));
    }
  });

  test("integration mode gating and opt-in verification", async (t) => {
    if (!isIntegrationOptIn()) {
      t.skip("MANYBOT_RUN_WHATSAPP_TESTS is not set to 1");
      return;
    }
    const status = await getIntegrationModeStatus();
    assert.equal(typeof status.ready, "boolean");
    if (!status.ready) {
      t.skip(`Integration suite not ready: ${status.reason}`);
      return;
    }
    assert.ok(status.chat, "TEST_CHAT must be resolved");
    assert.ok(status.source, "TEST_CHAT source must be 'env' or 'toml'");
  });

  test("integration plugin loads and enforces TEST_CHAT boundary", async (t) => {
    if (!isReady || !testChat) {
      t.skip("Integration mode not fully configured (missing TEST_CHAT or opt-in)");
      return;
    }

    const entry = await loadIntegrationPlugin();
    assert.equal(entry.name, INTEGRATION_PLUGIN_NAME);
    assert.equal(entry.status, "active");

    const api = entry.exports as {
      testChat: string;
      isTestChat: (jid: string | null | undefined) => boolean;
      waitForMarker: (marker: string, timeoutMs?: number) => Promise<string>;
      recentBodies: () => string[];
    };

    if (entry.setup && !api.testChat) {
      await entry.setup({
        events: {
          on: () => () => {},
        },
      } as unknown as import("#kernel/pluginApi.js").SetupContext);
    }

    assert.ok(api, "Integration plugin must export public API");
    assert.equal(api.isTestChat(testChat), true);
    assert.equal(api.isTestChat("120363000000000@g.us"), testChat === "120363000000000@g.us");
    assert.equal(api.isTestChat("5516000000000@s.whatsapp.net"), testChat === "5516000000000@s.whatsapp.net");
    assert.equal(api.isTestChat(null), false);
  });

  test("waitForMarker times out when marker is never received", async (t) => {
    if (!isReady || !testChat) {
      t.skip("Integration mode not fully configured");
      return;
    }

    const entry = await loadIntegrationPlugin();
    const api = entry.exports as {
      waitForMarker: (marker: string, timeoutMs?: number) => Promise<string>;
    };

    const nonexistentMarker = `NONEXISTENT_MARKER_${runId}_${Date.now()}`;
    await assert.rejects(
      api.waitForMarker(nonexistentMarker, 200),
      /timed out/,
      "waitForMarker must reject after timeoutMs"
    );
  });

  test("sends message with marker and attempts cleanup when live driver is connected", async (t) => {
    if (!isReady || !testChat) {
      t.skip("Integration mode not fully configured");
      return;
    }

    const activeDriver = await waitForActiveDriver();

    if (!activeDriver) {
      t.skip("No live WhatsApp driver is connected/ready in this process");
      return;
    }

    const marker = `[MANYBOT-ITEST:${runId}]`;
    const messageText = `${marker} Automated integration test verification`;

    // Send marker message
    const ref = await activeDriver.sendText(testChat, messageText);
    assert.ok(ref.id, "Sent message must return a message reference id");

    // Clean up test message from chat if supported
    try {
      await activeDriver.deleteMessage(testChat, { id: ref.id, remoteJid: testChat, fromMe: true }, true);
      logger.info(`[whatsappIntegration] cleaned up test message ${ref.id}`);
    } catch (e) {
      logger.warn(`[whatsappIntegration] deleteMessage cleanup notice: ${(e as Error).message}`);
    }
  });
});

