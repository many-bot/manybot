import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";

// settingsDb.ts uses an in-memory DB under NODE_ENV=test, which would hide
// the lazy-open behavior we're testing here. Force the real on-disk path,
// give it its own temp CONFIG_DIR, and import the module fresh so the
// "no file until first use" assertion reflects a true cold start.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-test-settingsdb-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { buildSettingsApi, getPluginSetting, pruneStaleChatSettings } = await import("#settingsdb");

const dbPath = path.join(configDir, "settings.db");

/** Backdates chat_id's activity (and, for chats that predate the
 *  feature, its plugin_settings rows) so pruneStaleChatSettings() sees
 *  it as stale without waiting real days. */
function backdate(chatId: string, daysAgo: number) {
  const db = new DatabaseSync(dbPath);
  const cutoff = Math.floor(Date.now() / 1000) - daysAgo * 86400;
  db.exec(`UPDATE chat_activity SET last_used_at = ${cutoff} WHERE chat_id = '${chatId}'`);
  db.exec(`UPDATE plugin_settings SET updated_at = ${cutoff} WHERE chat_id = '${chatId}'`);
  db.close();
}

after(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/settingsDb — lazy DB open", () => {
  test("importing the module does not open settings.db", () => {
    assert.equal(existsSync(dbPath), false);
  });

  test("a real read opens the database on first use", () => {
    assert.equal(getPluginSetting("testPlugin", "chat1", "missing"), undefined);
    assert.equal(existsSync(dbPath), true);
  });
});

describe("kernel/settingsDb — get/set roundtrip", () => {
  test("buildSettingsApi() reads back what it wrote", () => {
    const settings = buildSettingsApi("testPlugin", "chat1");
    settings.set("greeting", "hi");
    assert.equal(settings.get("greeting"), "hi");
    assert.equal(settings.get("missing", "fallback"), "fallback");
  });
});

describe("kernel/settingsDb — allChats()", () => {
  test("lists only chats with a stored setting for this plugin, excluding _global", () => {
    buildSettingsApi("allChatsPlugin", "chatA").set("enabled", true);
    buildSettingsApi("allChatsPlugin", "chatB").set("enabled", false);
    buildSettingsApi("allChatsPlugin", "chatB").global.set("shared", 1);
    buildSettingsApi("otherPlugin", "chatC").set("enabled", true);

    const chats = buildSettingsApi("allChatsPlugin", "chatA").allChats();
    assert.deepEqual([...chats].sort(), ["chatA", "chatB"]);
  });
});

describe("kernel/settingsDb — pruneStaleChatSettings()", () => {
  test("deletes settings only for chats untouched past maxAgeDays", () => {
    buildSettingsApi("pruneTestPlugin", "staleChat").set("enabled", true);
    buildSettingsApi("pruneTestPlugin", "freshChat").set("enabled", true);
    backdate("staleChat", 91);

    const purged = pruneStaleChatSettings(90);

    assert.deepEqual(purged, ["staleChat"]);
    assert.equal(buildSettingsApi("pruneTestPlugin", "staleChat").get("enabled"), undefined);
    assert.equal(buildSettingsApi("pruneTestPlugin", "freshChat").get("enabled"), true);
  });

  test("a chat with no activity record (pre-existing config) is still pruned via updated_at", () => {
    buildSettingsApi("legacyPrunePlugin", "legacyChat").set("enabled", true);
    backdate("legacyChat", 91);
    // Simulate config written before chat_activity existed.
    const db = new DatabaseSync(dbPath);
    db.exec(`DELETE FROM chat_activity WHERE chat_id = 'legacyChat'`);
    db.close();

    const purged = pruneStaleChatSettings(90);

    assert.ok(purged.includes("legacyChat"));
    assert.equal(buildSettingsApi("legacyPrunePlugin", "legacyChat").get("enabled"), undefined);
  });

  test("reading via ctx.settings refreshes activity, so the chat survives a later prune", () => {
    buildSettingsApi("touchPlugin", "touchedChat").set("enabled", true);
    backdate("touchedChat", 91);

    // A read right before the prune run should reset the clock.
    buildSettingsApi("touchPlugin", "touchedChat").get("enabled");

    const purged = pruneStaleChatSettings(90);

    assert.ok(!purged.includes("touchedChat"));
    assert.equal(buildSettingsApi("touchPlugin", "touchedChat").get("enabled"), true);
  });
});
