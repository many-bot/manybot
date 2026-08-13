import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { runPlugin } from "#kernel/pluginGuard.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";

describe("kernel/pluginGuard", () => {
  test("runs handler successfully without modifying plugin error status", async () => {
    const plugin = {
      name: "safePlugin",
      status: "active",
      manifest: { name: "safePlugin", version: "1.0.0" },
    } as unknown as PluginEntry;

    let executed = false;
    const handler = async () => {
      executed = true;
    };

    await runPlugin(plugin, {}, handler);
    assert.equal(executed, true);
    assert.equal(plugin.status, "active");
    assert.equal(plugin.errorCount ?? 0, 0);
  });

  test("tracks errorCount and disables plugin after 3 failures", async () => {
    const plugin = {
      name: "failingPlugin",
      status: "active",
      manifest: { name: "failingPlugin", version: "1.0.0" },
    } as unknown as PluginEntry;

    const failingHandler = async () => {
      throw new Error("Crash");
    };

    await runPlugin(plugin, {}, failingHandler);
    assert.equal(plugin.errorCount, 1);
    assert.equal(plugin.status, "active");

    await runPlugin(plugin, {}, failingHandler);
    assert.equal(plugin.errorCount, 2);
    assert.equal(plugin.status, "active");

    await runPlugin(plugin, {}, failingHandler);
    assert.equal(plugin.errorCount, 3);
    assert.equal(plugin.status, "error");
  });
});
