import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test, beforeEach, after, mock } from "node:test";

// Same pattern as pluginLoader.test.ts: MANYBOT_CONFIG_DIR must be set
// BEFORE the first import of #config / anything that reads it (alerts.ts
// resolves ALERTS_LOG_FILE once at module-load time), so every module
// under test here shares one isolated temp dir for the whole file.
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-pluginguard-core-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { pluginRegistry, loadPlugin, reloadPlugin, cleanupPlugins } = await import("#kernel/pluginLoader.js");
const { recordPluginFailure, runPlugin } = await import("#kernel/pluginGuard.js");

const pluginsDir = path.join(configDir, "plugins");
const alertsLogFile = path.join(configDir, "alerts.log");

async function writePlugin(name: string, source: string): Promise<void> {
  const dir = path.join(pluginsDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manyplug.json"), "{}", "utf8");
  await fs.writeFile(path.join(dir, "index.js"), source, "utf8");
}

async function readAlertsLog(): Promise<string> {
  try {
    return await fs.readFile(alertsLogFile, "utf8");
  } catch {
    return "";
  }
}

beforeEach(async () => {
  await cleanupPlugins();
  pluginRegistry.clear();
  await fs.rm(pluginsDir, { recursive: true, force: true });
  await fs.rm(alertsLogFile, { force: true });
});

after(async () => {
  await cleanupPlugins();
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/pluginGuard — recordPluginFailure bookkeeping", () => {
  test("increments errorCount and disables the plugin on the 3rd failure", async () => {
    await writePlugin("flaky", "export default async function () {}\n");
    await loadPlugin("flaky");

    recordPluginFailure("flaky", new Error("boom 1"));
    assert.equal(pluginRegistry.get("flaky")?.errorCount, 1);
    assert.equal(pluginRegistry.get("flaky")?.status, "active");

    recordPluginFailure("flaky", new Error("boom 2"));
    assert.equal(pluginRegistry.get("flaky")?.errorCount, 2);
    assert.equal(pluginRegistry.get("flaky")?.status, "active");

    recordPluginFailure("flaky", new Error("boom 3"));
    assert.equal(pluginRegistry.get("flaky")?.errorCount, 3);
    assert.equal(pluginRegistry.get("flaky")?.status, "error", "plugin must be disabled on the 3rd strike");
  });

  test("returns false for a plugin name not in the registry", () => {
    assert.equal(recordPluginFailure("does-not-exist", new Error("x")), false);
  });

  test("resets errorCount when the last failure is older than the 5min window", async () => {
    await writePlugin("recovers", "export default async function () {}\n");
    await loadPlugin("recovers");

    mock.timers.enable({ apis: ["Date"] });
    try {
      recordPluginFailure("recovers", new Error("boom 1"));
      recordPluginFailure("recovers", new Error("boom 2"));
      assert.equal(pluginRegistry.get("recovers")?.errorCount, 2);

      mock.timers.tick(5 * 60_000 + 1);

      recordPluginFailure("recovers", new Error("boom after quiet period"));
      assert.equal(pluginRegistry.get("recovers")?.errorCount, 1);
      assert.equal(pluginRegistry.get("recovers")?.status, "active");
    } finally {
      mock.timers.reset();
    }
  });

  test("keeps accumulating errorCount when failures happen within the 5min window", async () => {
    await writePlugin("still-flaky", "export default async function () {}\n");
    await loadPlugin("still-flaky");

    mock.timers.enable({ apis: ["Date"] });
    try {
      recordPluginFailure("still-flaky", new Error("boom 1"));
      mock.timers.tick(60_000);
      recordPluginFailure("still-flaky", new Error("boom 2"));
      assert.equal(pluginRegistry.get("still-flaky")?.errorCount, 2, "failures inside the window must still accumulate");
    } finally {
      mock.timers.reset();
    }
  });
});

describe("kernel/pluginLoader — errorCount must survive a successful reload", () => {
  // Regression test for the bug found via manual testing: recordPluginFailure()
  // triggers a fire-and-forget reloadPlugin() after every non-disabling
  // failure. loadPlugin()'s success path used to hardcode `errorCount: 0`
  // on the fresh registry entry, silently wiping the count the guard had
  // just recorded — so a plugin that fails-then-successfully-reloads every
  // time (the common case for a transient error) never actually reached
  // the 3-strike disable threshold, no matter how many times it failed.
  test("a successful loadPlugin() reload preserves the existing errorCount instead of resetting it to 0", async () => {
    await writePlugin("reload-keeps-count", "export default async function () {}\n");
    await loadPlugin("reload-keeps-count");
    assert.equal(pluginRegistry.get("reload-keeps-count")?.errorCount, 0);

    // Simulate two prior failures, as recordPluginFailure() would.
    recordPluginFailure("reload-keeps-count", new Error("first failure"));
    recordPluginFailure("reload-keeps-count", new Error("second failure"));
    assert.equal(pluginRegistry.get("reload-keeps-count")?.errorCount, 2);

    // reloadPlugin() re-imports successfully (the file didn't change) —
    // this must NOT reset the count back to 0.
    await reloadPlugin("reload-keeps-count");
    assert.equal(
      pluginRegistry.get("reload-keeps-count")?.errorCount,
      2,
      "a successful reload must preserve the errorCount from before the reload"
    );

    // A third failure after that reload must now actually disable it.
    recordPluginFailure("reload-keeps-count", new Error("third failure"));
    assert.equal(pluginRegistry.get("reload-keeps-count")?.status, "error");
  });

  test("a genuinely fresh load (no prior entry) still starts errorCount at 0", async () => {
    await writePlugin("brand-new", "export default async function () {}\n");
    await loadPlugin("brand-new");
    assert.equal(pluginRegistry.get("brand-new")?.errorCount, 0);
  });
});

describe("kernel/pluginGuard — plugin_crash alerting reaches the owner outside the command path", () => {
  // Regression test for the second bug found via manual testing:
  // fireAlert("plugin_crash", ...) used to be called ONLY from
  // runCommand.ts's catch block (source: "command"). A plugin crashing
  // through the legacy run(ctx) path (runPlugin() called with no
  // `rethrow` option, e.g. from messageHandler.ts's non-command branch)
  // or through main.ts's global uncaughtException/unhandledRejection
  // listeners never produced any owner-facing alert (WhatsApp/email) at
  // all — only the local log knew. recordPluginFailure() now fires the
  // alert itself for every caller that is NOT about to rethrow (which
  // would otherwise double-alert once runCommand.ts's own catch fires
  // its richer, command-aware alert).
  test("recordPluginFailure fires a plugin_crash alert when NOT rethrowing (legacy/global path)", async () => {
    await writePlugin("legacy-crasher", "export default async function () {}\n");
    await loadPlugin("legacy-crasher");

    recordPluginFailure("legacy-crasher", new Error("legacy crash"));

    // sendAlert()'s log sink is async (mkdir + appendFile); give it a
    // moment to land rather than asserting immediately.
    await new Promise((r) => setTimeout(r, 50));
    const log = await readAlertsLog();
    assert.match(log, /legacy-crasher/);
    assert.match(log, /WARNING/); // first strike: level "warning", not yet disabled
  });

  test("recordPluginFailure does NOT alert when rethrow is set (runCommand.ts's own catch will)", async () => {
    await writePlugin("command-crasher", "export default async function () {}\n");
    await loadPlugin("command-crasher");

    recordPluginFailure("command-crasher", new Error("command-path crash"), { rethrow: true });

    await new Promise((r) => setTimeout(r, 50));
    const log = await readAlertsLog();
    assert.doesNotMatch(log, /command-crasher/, "the command path must alert exactly once, from runCommand.ts — not here too");
  });

  test("runPlugin()'s own catch (legacy call, no options) ends up alerting via recordPluginFailure", async () => {
    await writePlugin("throws-in-run", "export default async function () { throw new Error('sync throw'); }\n");
    await loadPlugin("throws-in-run");
    const plugin = pluginRegistry.get("throws-in-run")!;

    const result = await runPlugin(plugin, {});
    assert.equal(result, undefined, "runPlugin must swallow the error for the legacy caller (never crashes the bot)");

    await new Promise((r) => setTimeout(r, 50));
    const log = await readAlertsLog();
    assert.match(log, /throws-in-run/);
  });
});

