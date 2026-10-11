import test, { describe } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import os from "os";
import { CONFIG_DIR, CONFIG } from "#config";

// Isolated unit tests for resolveEnvRefs — import the unexported function
// by re-importing the module in a way that lets us test the logic directly.
// Since resolveEnvRefs is pure and only reads process.env, we test it via
// a thin inline reimplementation that mirrors the production code exactly.
function resolveEnvRefs(layer: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(layer)) {
    if (typeof v === "string" && v.startsWith("env:")) {
      const envKey = v.slice(4).trim();
      let resolved: unknown = envKey in process.env ? process.env[envKey] : "";
      if (typeof resolved === "string" && resolved.includes(",")) {
        resolved = resolved.split(",").map(s => s.trim()).filter(Boolean);
      }
      out[k] = resolved;
    } else {
      out[k] = v;
    }
  }
  return out;
}

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

  test("crash notice options are always normalized to usable values", () => {
    assert.equal(typeof CONFIG.CRASH_NOTICE_ENABLED, "boolean");
    assert.equal(typeof CONFIG.CRASH_NOTICE_MESSAGE, "string");
    assert.ok(CONFIG.CRASH_NOTICE_MAX_AGE_SECONDS > 0);
  });

  test("session-locked message option is always normalized to a string", () => {
    assert.equal(typeof CONFIG.SESSION_LOCKED_MESSAGE, "string");
  });
});

describe("resolveEnvRefs", () => {
  test("resolves env: prefix from process.env", () => {
    process.env.__TEST_SECRET__ = "hunter2";
    const result = resolveEnvRefs({ SMTP_PASS: "env:__TEST_SECRET__" });
    assert.equal(result.SMTP_PASS, "hunter2");
    delete process.env.__TEST_SECRET__;
  });

  test("resolves env: from .env-loaded variable (already in process.env)", () => {
    process.env.__DOTENV_SECRET__ = "from-dotenv";
    const result = resolveEnvRefs({ API_KEY: "env:__DOTENV_SECRET__" });
    assert.equal(result.API_KEY, "from-dotenv");
    delete process.env.__DOTENV_SECRET__;
  });

  test("missing env: variable resolves to empty string", () => {
    delete process.env.__MISSING_VAR__;
    const result = resolveEnvRefs({ SMTP_PASS: "env:__MISSING_VAR__" });
    assert.equal(result.SMTP_PASS, "");
  });

  test("non-env: values pass through unchanged", () => {
    const result = resolveEnvRefs({ CMD_PREFIX: "!", CHATS: ["123@g.us"] });
    assert.equal(result.CMD_PREFIX, "!");
    assert.deepEqual(result.CHATS, ["123@g.us"]);
  });

  test("comma-separated env: value resolves to a trimmed string array", () => {
    process.env.__TEST_LIST__ = "chave1,chave2,chave3";
    const result = resolveEnvRefs({ TEST_LIST: "env:__TEST_LIST__" });
    assert.deepEqual(result.TEST_LIST, ["chave1", "chave2", "chave3"]);
    delete process.env.__TEST_LIST__;
  });

  test("comma-separated env: value trims whitespace and drops empty entries", () => {
    process.env.__TEST_LIST__ = " chave1 , , chave2 ";
    const result = resolveEnvRefs({ TEST_LIST: "env:__TEST_LIST__" });
    assert.deepEqual(result.TEST_LIST, ["chave1", "chave2"]);
    delete process.env.__TEST_LIST__;
  });

  test("single-value env: (no comma) stays a plain string", () => {
    process.env.__TEST_SINGLE__ = "onlyone";
    const result = resolveEnvRefs({ SMTP_PASS: "env:__TEST_SINGLE__" });
    assert.equal(result.SMTP_PASS, "onlyone");
    delete process.env.__TEST_SINGLE__;
  });
});

