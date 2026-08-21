import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "manybot-plugin-loader-"));
process.env.MANYBOT_CONFIG_DIR = configDir;

const { cleanupPlugins, loadPlugin, pluginRegistry, reloadPlugin } = await import("#kernel/pluginLoader.js");
const pluginsDir = path.join(configDir, "plugins");

async function writePlugin(name: string, manifest: string, source?: string): Promise<void> {
  const dir = path.join(pluginsDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manyplug.json"), manifest, "utf8");
  if (source !== undefined) await fs.writeFile(path.join(dir, "index.js"), source, "utf8");
}

beforeEach(async () => {
  await cleanupPlugins();
  pluginRegistry.clear();
  await fs.rm(pluginsDir, { recursive: true, force: true });
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
});

