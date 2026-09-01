import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-plugin-loader-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { cleanupPlugins, loadPlugin, loadPlugins, pluginRegistry, reloadCommandRegistry, reloadPlugin, syncPlugins } =
  await import("#kernel/pluginLoader.js");
const { getCommandRegistry } = await import("#kernel/commandRegistry.js");
const pluginsDir = path.join(configDir, "plugins");
const commandsFile = path.join(configDir, "commands.yaml");

async function writePlugin(name: string, manifest: string, source?: string): Promise<void> {
  const dir = path.join(pluginsDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manyplug.json"), manifest, "utf8");
  if (source !== undefined) await fs.writeFile(path.join(dir, "index.js"), source, "utf8");
}

async function waitFor<T>(label: string, read: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(async () => {
  await cleanupPlugins();
  pluginRegistry.clear();
  await fs.rm(pluginsDir, { recursive: true, force: true });
  await fs.rm(commandsFile, { force: true });
  await fs.rm(path.join(configDir, "menu.yaml"), { force: true });
});

after(async () => {
  await cleanupPlugins();
  await fs.rm(configDir, { recursive: true, force: true });
});

describe("kernel/pluginLoader", () => {
  test("marks a plugin without a manifest as disabled", async () => {
    await loadPlugin("missing");

    assert.deepEqual(pluginRegistry.get("missing"), {
      name: "missing",
      status: "disabled",
      run: null,
      setup: null,
      commands: null,
      exports: null,
      error: null,
      guardOptions: {},
      errorCount: 0,
    });
  });

  test("loads an ESM plugin with optional public exports", async () => {
    await writePlugin("hello", '{"main":"index.js"}', `
      export default async function run() {}
      export async function setup() {}
      export const commands = { greet: { cmd: "greet", handler: async () => "hello" } }
      export const api = { version: 1 }
      export const guardOptions = { retries: 2 }
    `);

    await loadPlugin("hello");

    const plugin = pluginRegistry.get("hello");
    assert.ok(plugin);
    assert.equal(plugin.status, "active");
    assert.equal(typeof plugin.run, "function");
    assert.equal(typeof plugin.setup, "function");
    assert.equal((plugin.commands?.greet as { cmd?: string })?.cmd, "greet");
    assert.deepEqual(plugin.exports, { version: 1 });
    assert.deepEqual(plugin.guardOptions, { retries: 2 });
    assert.equal(plugin.errorCount, 0);
  });

  test("records a load error when a plugin has no default handler", async () => {
    await writePlugin("invalid", "{}", "export const api = {};\n");

    await loadPlugin("invalid");

    const plugin = pluginRegistry.get("invalid");
    assert.ok(plugin);
    assert.equal(plugin.status, "error");
    assert.equal(plugin.run, null);
    assert.match(plugin.error?.message ?? "", /does not export a default function/);
    assert.equal(plugin.errorCount, 3);
  });

  test("reloads an active plugin", async () => {
    await writePlugin("reloadable", "{}", "export default async function run() {}\nexport const api = { version: 1 };\n");
    await loadPlugin("reloadable");
    assert.deepEqual(pluginRegistry.get("reloadable")?.exports, { version: 1 });

    await reloadPlugin("reloadable");

    const plugin = pluginRegistry.get("reloadable");
    assert.equal(plugin?.status, "active");
    assert.deepEqual(plugin?.exports, { version: 1 });
    assert.equal(plugin?.errorCount, 0);
  });

  // Regression test for the EADDRINUSE crash: a plugin that opens a local
  // server (or anything else) in setup() and releases it via its own
  // `api.events.cleanup()` export must have that cleanup run BEFORE the
  // module is reimported — otherwise the old instance is still holding
  // the port when the new instance's setup() tries to bind it again.
  test("reloadPlugin runs the plugin's own cleanup export before reimporting it", async () => {
    const logFile = path.join(configDir, "reload-cleanup.log");
    await fs.rm(logFile, { force: true });

    await writePlugin("server-plugin", "{}", `
      import fs from "fs";
      export default async function run() {}
      export const api = {
        events: {
          cleanup: async () => {
            fs.appendFileSync(${JSON.stringify(logFile)}, "cleanup\\n");
          }
        }
      };
    `);

    await loadPlugin("server-plugin");
    await fs.access(logFile).catch(() => {});
    assert.equal(await fs.readFile(logFile, "utf8").catch(() => ""), "");

    await reloadPlugin("server-plugin");

    assert.equal(await fs.readFile(logFile, "utf8"), "cleanup\n");
  });

  test("syncPlugins runs a removed plugin's own cleanup export before disabling it", async () => {
    const logFile = path.join(configDir, "disable-cleanup.log");
    await fs.rm(logFile, { force: true });

    await writePlugin("droppable", "{}", `
      import fs from "fs";
      export default async function run() {}
      export const api = {
        events: {
          cleanup: async () => {
            fs.appendFileSync(${JSON.stringify(logFile)}, "cleanup\\n");
          }
        }
      };
    `);

    await fs.writeFile(path.join(configDir, "manybot.toml"), `PLUGINS = ["droppable"]\n`, "utf8");
    await loadPlugins(["droppable"]);
    assert.equal(pluginRegistry.get("droppable")?.status, "active");

    await fs.writeFile(path.join(configDir, "manybot.toml"), `PLUGINS = []\n`, "utf8");
    await syncPlugins();

    assert.equal(pluginRegistry.get("droppable")?.status, "disabled");
    assert.equal(await fs.readFile(logFile, "utf8"), "cleanup\n");
  });
});

describe("kernel/pluginLoader — commands.yaml hot reload", () => {
  test("reloadCommandRegistry re-reads commands.yaml and rebuilds the registry", async () => {
    await writePlugin("reloaddummy", '{"main":"index.js"}', `
      export default async function run() {}
    `);
    await loadPlugins(["reloaddummy"]);

    await fs.writeFile(commandsFile, `
defaults:
  notifyChanges: false
helloReload:
  cmd: hello
  plugin: reloaddummy
  desc: "First version"
  functions: []
`, "utf8");
    await reloadCommandRegistry();

    const registry = getCommandRegistry();
    assert.ok(registry, "registry should be initialized after reload");
    assert.equal(registry.byInvocation.get("hello"), "helloReload");
    assert.equal(registry.byId.get("helloReload")?.desc, "First version");
    assert.equal(registry.defaults.notifyChanges, false);

    await fs.writeFile(commandsFile, `
helloReload:
  cmd: hello
  plugin: reloaddummy
  desc: "Second version"
  functions: []
`, "utf8");
    await reloadCommandRegistry();

    const registry2 = getCommandRegistry();
    assert.ok(registry2);
    assert.equal(registry2.byId.get("helloReload")?.desc, "Second version");
    assert.equal(registry2.defaults.notifyChanges, true, "defaults should reset to built-in when omitted");
  });

  test("config watcher reloads the registry when commands.yaml is edited", async () => {
    await writePlugin("watchdummy", '{"main":"index.js"}', `
      export default async function run() {}
    `);
    await loadPlugins(["watchdummy"]);

    assert.equal(getCommandRegistry()?.byInvocation.get("watch"), undefined);

    await fs.writeFile(commandsFile, `
helloWatch:
  cmd: watch
  plugin: watchdummy
  desc: "Watcher picks this up"
  functions: []
`, "utf8");

    const registry = await waitFor("registry to pick up commands.yaml change", () => {
      const r = getCommandRegistry();
      return r?.byId.get("helloWatch")?.desc === "Watcher picks this up" ? r : undefined;
    });
    assert.equal(registry.byInvocation.get("watch"), "helloWatch");
  });

  test("config watcher reloads the registry when an imported YAML file is edited", async () => {
    await writePlugin("importdummy", '{"main":"index.js"}', `
      export default async function run() {}
    `);
    await fs.writeFile(path.join(configDir, "menu.yaml"), `
helloImport:
  cmd: importcmd
  plugin: importdummy
  desc: "From menu.yaml (first)"
  functions: []
`, "utf8");
    await fs.writeFile(commandsFile, `import: menu.yaml\n`, "utf8");
    await loadPlugins(["importdummy"]);

    const first = await waitFor("initial import to be picked up", () => {
      const r = getCommandRegistry();
      return r?.byId.get("helloImport")?.desc === "From menu.yaml (first)" ? r : undefined;
    });
    assert.equal(first.byInvocation.get("importcmd"), "helloImport");

    await fs.writeFile(path.join(configDir, "menu.yaml"), `
helloImport:
  cmd: importcmd
  plugin: importdummy
  desc: "From menu.yaml (second)"
  functions: []
`, "utf8");

    const second = await waitFor("imported yaml change to be picked up", () => {
      const r = getCommandRegistry();
      return r?.byId.get("helloImport")?.desc === "From menu.yaml (second)" ? r : undefined;
    });
    assert.equal(second.byInvocation.get("importcmd"), "helloImport");
  });

  test("config watcher ignores non-yaml/non-toml files in PATHS.HOME", async () => {
    await writePlugin("ignoredummy", '{"main":"index.js"}', `
      export default async function run() {}
    `);
    await loadPlugins(["ignoredummy"]);

    const registryBefore = getCommandRegistry();

    await fs.writeFile(path.join(configDir, "README.md"), "unrelated", "utf8");
    await new Promise((r) => setTimeout(r, 800));

    const registryAfter = getCommandRegistry();
    assert.equal(registryAfter, registryBefore, "registry reference must be stable when no relevant file changed");
  });
});

