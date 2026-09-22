import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";

// Own temp CONFIG_DIR + fresh module import: this file must be the first
// thing to import #kernel/scheduler.js so the "no file until first use"
// assertion below reflects a true cold start, not a connection some other
// test already opened.
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-test-scheduler-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { schedule, cancelPlugin, getPersisted, stopAll } = await import("#kernel/scheduler.js");

const dbPath = path.join(configDir, "scheduler.db");

after(async () => {
  stopAll();
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/scheduler — lazy DB open", () => {
  test("importing the module does not open scheduler.db", () => {
    assert.equal(existsSync(dbPath), false);
  });

  test("getPersisted() opens the database on first real use", () => {
    assert.deepEqual(getPersisted(), []);
    assert.equal(existsSync(dbPath), true);
  });
});

describe("kernel/scheduler — schedule/cancel", () => {
  test("schedule() persists the task; cancelPlugin() removes it", () => {
    const handle = schedule("0 9 * * 1", async () => {}, "testPlugin");

    assert.ok(
      getPersisted().some(p => p.pluginName === "testPlugin" && p.expression === "0 9 * * 1")
    );

    cancelPlugin("testPlugin");
    assert.equal(getPersisted().some(p => p.pluginName === "testPlugin"), false);

    handle.stop();
  });
});
