import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";

// settingsDb.ts uses an in-memory DB under NODE_ENV=test, which would hide
// the lazy-open behavior we're testing here. Force the real on-disk path,
// give it its own temp CONFIG_DIR, and import the module fresh so the
// "no file until first use" assertion reflects a true cold start.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-test-settingsdb-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { buildSettingsApi, getPluginSetting } = await import("#settingsdb");

const dbPath = path.join(configDir, "settings.db");

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
