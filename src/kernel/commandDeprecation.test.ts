import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  syncCommandHistory,
  getActiveDeprecation,
  formatDeprecationMessage
} from "#kernel/commandDeprecation.js";
import type { CommandEntry } from "#kernel/commandRegistry.js";
import type { CommandDefaults, CommandSpec } from "#kernel/commandsConfig.js";

function createMockEntry(id: string, cmd: string): CommandEntry {
  return {
    id,
    cmd,
    aliases: [],
    desc: null,
    category: null,
    manual: null,
    source: "plugin",
    pluginName: "testPlugin",
    handler: null,
    text: null,
    permissions: {
      admin: false,
      botAdmin: false,
      scope: "any",
      owner: false,
      cooldownSeconds: 0,
      whitelist: null,
      blacklist: null,
      messages: {} as any,
    },
  };
}

describe("kernel/commandDeprecation", () => {
  const defaults: CommandDefaults = {
    notifyChanges: true,
    notifyPeriodDays: 7,
    notifyMessage: null,
  };

  test("silently inserts history on first sync", () => {
    const byId = new Map<string, CommandEntry>([
      ["plugin::cmd1", createMockEntry("plugin::cmd1", "oldname")],
    ]);

    syncCommandHistory(byId, defaults, []);

    // First sighting should not create an active deprecation for oldname
    assert.equal(getActiveDeprecation("oldname"), null);
  });

  test("records deprecation when command is renamed across syncs", () => {
    const byId1 = new Map<string, CommandEntry>([
      ["plugin::cmd1", createMockEntry("plugin::cmd1", "oldname")],
    ]);
    syncCommandHistory(byId1, defaults, []);

    // Sync 2: cmd name changed to newname
    const byId2 = new Map<string, CommandEntry>([
      ["plugin::cmd1", createMockEntry("plugin::cmd1", "newname")],
    ]);
    syncCommandHistory(byId2, defaults, []);

    const deprecation = getActiveDeprecation("oldname");
    assert.ok(deprecation);
    assert.equal(deprecation?.old_cmd, "oldname");
    assert.equal(deprecation?.new_cmd, "newname");

    const formatted = formatDeprecationMessage(deprecation!, defaults);
    assert.ok(formatted.length > 0);
  });

  test("records deprecation when command is removed from registry", () => {
    const byId1 = new Map<string, CommandEntry>([
      ["plugin::cmdRem", createMockEntry("plugin::cmdRem", "removedcmd")],
    ]);
    syncCommandHistory(byId1, defaults, []);

    // Sync 2: command removed
    const byId2 = new Map<string, CommandEntry>();
    syncCommandHistory(byId2, defaults, []);

    const deprecation = getActiveDeprecation("removedcmd");
    assert.ok(deprecation);
    assert.equal(deprecation?.old_cmd, "removedcmd");
    assert.equal(deprecation?.new_cmd, null);
  });

  test("respects notifyChanges = false opt-out", () => {
    const byId1 = new Map<string, CommandEntry>([
      ["plugin::optOut", createMockEntry("plugin::optOut", "alpha")],
    ]);
    const specs1: CommandSpec[] = [{
      id: "plugin::optOut",
      plugin: "plugin",
      function: "optOut",
      cmd: "alpha",
      aliases: [],
      desc: null,
      category: null,
      manual: null,
      text: null,
      deprecatedMessage: null,
      notifyChanges: false,
      permissions: null,
      messages: null,
    }];
    syncCommandHistory(byId1, defaults, specs1);

    // Rename with notifyChanges = false
    const byId2 = new Map<string, CommandEntry>([
      ["plugin::optOut", createMockEntry("plugin::optOut", "beta")],
    ]);
    syncCommandHistory(byId2, defaults, specs1);

    assert.equal(getActiveDeprecation("alpha"), null);
  });
});
