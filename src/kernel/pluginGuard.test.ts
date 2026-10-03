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
const {
  recordPluginFailure, runPlugin, isPluginTimeoutError,
  TIMEOUT_STRIKES_FOR_COOLDOWN, MAX_COOLDOWN_FAILURES,
} = await import("#kernel/pluginGuard.js");
const { pluginState } = await import("#kernel/runState.js");
const { getDriverManager, _resetDriverManagerForTests } = await import("#kernel/driverManager.js");

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
  test("increments errorCount on each exception but never auto-disables", async () => {
    await writePlugin("flaky", "export default async function () {}\n");
    await loadPlugin("flaky");

    for (let i = 1; i <= 3; i++) {
      recordPluginFailure("flaky", new Error(`boom ${i}`));
      assert.equal(pluginRegistry.get("flaky")?.errorCount, i);
      assert.equal(pluginRegistry.get("flaky")?.status, "active");
    }

    // Well past the old 3-strike threshold — exceptions alone must never disable.
    for (let i = 4; i <= 10; i++) {
      recordPluginFailure("flaky", new Error(`boom ${i}`));
    }
    assert.equal(pluginRegistry.get("flaky")?.errorCount, 10);
    assert.equal(pluginRegistry.get("flaky")?.status, "active", "exceptions must never auto-disable a plugin");
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

describe("kernel/pluginGuard — timeout classification and cooldown", () => {
  test("isPluginTimeoutError only matches an actual withTimeout() abort, not a message that merely mentions it", () => {
    assert.equal(isPluginTimeoutError(new Error("[p] timed out after 1ms")), false, "a look-alike message must NOT be misclassified");
    assert.equal(isPluginTimeoutError(new Error("some other error")), false);
  });

  test("a real withTimeout() abort is tagged and classified as a timeout, not counted as an exception", async () => {
    await writePlugin("slow", "export default async function () { await new Promise(() => {}); }\n");
    await loadPlugin("slow");
    const plugin = pluginRegistry.get("slow")!;

    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const run = runPlugin(plugin, {});
      mock.timers.tick(120_000);
      await run;
    } finally {
      mock.timers.reset();
    }

    assert.equal(plugin.timeoutStrikes, 1, "a real timeout must be classified as isTimeout");
    assert.equal(plugin.errorCount ?? 0, 0, "a timeout must not be counted as an exception");
  });

  test(`timeouts accumulate and pause the plugin into cooldown at ${TIMEOUT_STRIKES_FOR_COOLDOWN} strikes, never disabling directly`, async () => {
    await writePlugin("hangs", "export default async function () {}\n");
    await loadPlugin("hangs");

    for (let i = 1; i < TIMEOUT_STRIKES_FOR_COOLDOWN; i++) {
      recordPluginFailure("hangs", new Error(`hang ${i}`), { isTimeout: true });
      assert.equal(pluginRegistry.get("hangs")?.status, "active");
      assert.equal(pluginRegistry.get("hangs")?.timeoutStrikes, i);
    }

    recordPluginFailure("hangs", new Error("hang final"), { isTimeout: true });
    const plugin = pluginRegistry.get("hangs");
    assert.equal(plugin?.status, "cooldown", "must pause instead of disabling at the threshold");
    assert.equal(plugin?.timeoutStrikes, 0, "strikes reset on entering cooldown");
  });

  test(`a plugin is disabled only after ${MAX_COOLDOWN_FAILURES} cooldown cycles fail again right after resuming`, async () => {
    await writePlugin("loops", "export default async function () {}\n");
    await loadPlugin("loops");

    for (let i = 0; i < TIMEOUT_STRIKES_FOR_COOLDOWN; i++) {
      recordPluginFailure("loops", new Error("hang"), { isTimeout: true });
    }
    assert.equal(pluginRegistry.get("loops")?.status, "cooldown");

    for (let cycle = 1; cycle < MAX_COOLDOWN_FAILURES; cycle++) {
      // Simulate the cooldown timer elapsing (endCooldown()) without
      // waiting out the real COOLDOWN_MS in the test.
      const p = pluginRegistry.get("loops")!;
      p.status = "active";
      p.recoveringFromCooldown = true;
      pluginRegistry.set("loops", p);

      recordPluginFailure("loops", new Error(`hang after cooldown ${cycle}`), { isTimeout: true });
      assert.equal(pluginRegistry.get("loops")?.status, "cooldown", `cycle ${cycle}/${MAX_COOLDOWN_FAILURES} must still just re-enter cooldown`);
      assert.equal(pluginRegistry.get("loops")?.cooldownFailures, cycle);
    }

    const p = pluginRegistry.get("loops")!;
    p.status = "active";
    p.recoveringFromCooldown = true;
    pluginRegistry.set("loops", p);

    recordPluginFailure("loops", new Error("hang after final cooldown"), { isTimeout: true });
    assert.equal(pluginRegistry.get("loops")?.status, "error", "must disable as a last resort — this is the real signal of a stuck plugin");
  });

  test("a clean run after a cooldown clears recoveringFromCooldown, so the next timeout starts a fresh strike count", async () => {
    await writePlugin("recovers-ok", "export default async function () {}\n");
    await loadPlugin("recovers-ok");
    const plugin = pluginRegistry.get("recovers-ok")!;
    plugin.status = "active";
    plugin.recoveringFromCooldown = true;
    pluginRegistry.set("recovers-ok", plugin);

    await runPlugin(plugin, {}, async () => {}); // succeeds cleanly
    assert.equal(plugin.recoveringFromCooldown, false);

    recordPluginFailure("recovers-ok", new Error("hang"), { isTimeout: true });
    assert.equal(pluginRegistry.get("recovers-ok")?.status, "active", "must be a fresh strike (1/N), not a cooldown-failure disable");
    assert.equal(pluginRegistry.get("recovers-ok")?.timeoutStrikes, 1);
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

    // A third (and further) exception must keep the plugin active —
    // exceptions are the "light" severity and never auto-disable.
    recordPluginFailure("reload-keeps-count", new Error("third failure"));
    assert.equal(pluginRegistry.get("reload-keeps-count")?.status, "active");
    assert.equal(pluginRegistry.get("reload-keeps-count")?.errorCount, 3);
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


describe("kernel/pluginGuard — run state and crash notices", () => {
  let sent: Array<{ jid: string; text: string }>;

  beforeEach(() => {
    sent = [];
    _resetDriverManagerForTests();
    getDriverManager().register({
      name: "baileys",
      isReady: () => true,
      sendText: async (jid: string, text: string) => {
        sent.push({ jid, text });
        return { id: "sent", chatId: jid, timestamp: Date.now() };
      },
    } as never, { isPrimary: true });
  });

  after(() => _resetDriverManagerForTests());

  const origin = (id: string) => ({
    chatId: "chat@g.us",
    key: { id, remoteJid: "chat@g.us", fromMe: false },
    command: "!boom",
    kind: "command" as const,
  });

  test("a plugin is running while its handler is in flight and idle once it settles", async () => {
    await writePlugin("state-plugin", "export default async function () {}\n");
    await loadPlugin("state-plugin");
    const plugin = pluginRegistry.get("state-plugin")!;

    assert.equal(pluginState("state-plugin"), "idle");
    let during: string | undefined;
    await runPlugin(plugin, {}, async () => { during = pluginState("state-plugin"); });

    assert.equal(during, "running");
    assert.equal(pluginState("state-plugin"), "idle");
  });

  test("a plugin goes back to idle even when its run throws", async () => {
    await writePlugin("state-thrower", "export default async function () { throw new Error('x'); }\n");
    await loadPlugin("state-thrower");

    await runPlugin(pluginRegistry.get("state-thrower")!, {});
    assert.equal(pluginState("state-thrower"), "idle");
  });

  test("a failing run that answers a command tells that chat, and the error still propagates when asked to", async () => {
    await writePlugin("notice-thrower", "export default async function () {}\n");
    await loadPlugin("notice-thrower");
    const plugin = pluginRegistry.get("notice-thrower")!;

    await assert.rejects(
      () => runPlugin(plugin, {}, async () => { throw new Error("boom"); }, undefined, { rethrow: true, origin: origin("G-1") }),
      /boom/,
    );
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, "chat@g.us");
    assert.match(sent[0].text, /!boom/);
  });

  test("a failing run with no origin stays silent", async () => {
    await writePlugin("silent-thrower", "export default async function () { throw new Error('x'); }\n");
    await loadPlugin("silent-thrower");

    await runPlugin(pluginRegistry.get("silent-thrower")!, {});
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(sent.length, 0);
  });

  test("a successful run never notifies", async () => {
    await writePlugin("happy-plugin", "export default async function () {}\n");
    await loadPlugin("happy-plugin");

    await runPlugin(pluginRegistry.get("happy-plugin")!, {}, async () => {}, undefined, { origin: origin("G-2") });
    await new Promise((r) => setTimeout(r, 400));

    assert.equal(sent.length, 0);
  });
});
