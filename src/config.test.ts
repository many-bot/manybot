import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { CONFIG_DIR, CONFIG } from "#config";

describe("config", () => {
  test("CONFIG_DIR defaults to ~/.manybot or respects env override", () => {
    if (process.env.MANYBOT_CONFIG_DIR) {
      assert.equal(CONFIG_DIR, process.env.MANYBOT_CONFIG_DIR);
    } else {
      assert.equal(CONFIG_DIR, path.join(os.homedir(), ".manybot"));
    }
  });

  test("CONFIG has required structure and default fallback values", () => {
    assert.ok(typeof CONFIG.CMD_PREFIX === "string");
    assert.ok(typeof CONFIG.CLIENT_ID === "string");
    assert.ok(Array.isArray(CONFIG.CHATS));
    assert.ok(Array.isArray(CONFIG.EXCLUDE_CHATS));
    assert.ok(["low", "medium", "high"].includes(CONFIG.SECURITY_LEVEL));
    assert.ok(["normal", "clean", "minimal"].includes(CONFIG.LOG_LEVEL));
    assert.ok(CONFIG.drivers);
    assert.ok(CONFIG.drivers.primary === "baileys");
    assert.ok(typeof CONFIG.drivers.baileys.enabled === "boolean");
  });
});

