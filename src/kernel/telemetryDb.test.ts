import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  getGroupInfo,
  getInstanceInfo,
  getPluginInfo,
  getUserInfo,
  recordGroupJoin,
  recordGroupLeave,
  recordInstanceStartup,
  setPluginEnabled,
  touchUser,
  upsertPlugin,
} from "#kernel/telemetryDb.js";

describe("telemetryDb", () => {
  describe("instance", () => {
    test("is null before startup is recorded", () => {
      assert.equal(getInstanceInfo(), null);
    });

    test("recordInstanceStartup keeps instance_id and updates version/backend", () => {
      recordInstanceStartup("1.0.0", "baileys", "6.0.0");
      const first = getInstanceInfo();
      assert.ok(first);
      assert.equal(first.manybotVersion, "1.0.0");

      recordInstanceStartup("1.1.0", "whatsmeow", "0.2.0");
      const second = getInstanceInfo();
      assert.equal(second?.instanceId, first.instanceId);
      assert.equal(second?.manybotVersion, "1.1.0");
      assert.equal(second?.backend, "whatsmeow");
      assert.equal(second?.backendVersion, "0.2.0");
    });
  });

  describe("user", () => {
    test("touchUser creates the row and is idempotent", () => {
      touchUser("lid-a");
      const first = getUserInfo("lid-a");
      assert.ok(first);
      assert.equal(first.firstSeen, first.lastSeen);

      touchUser("lid-a");
      const second = getUserInfo("lid-a");
      assert.equal(second?.firstSeen, first.firstSeen);
      assert.ok(second!.lastSeen >= first.lastSeen);
    });

    test("exposes a salted hash as id, never the raw lid", () => {
      touchUser("lid-hash");
      const info = getUserInfo("lid-hash");
      assert.match(info!.id, /^[0-9a-f]{64}$/);
      assert.notEqual(info!.id, "lid-hash");
      assert.notEqual(info!.id, getUserInfo("lid-a")!.id);
    });

    test("returns null for unknown lid", () => {
      assert.equal(getUserInfo("lid-unknown"), null);
    });
  });

  describe("group", () => {
    test("recordGroupJoin is idempotent for a group already joined", () => {
      recordGroupJoin("g-idem");
      const first = getGroupInfo("g-idem");
      recordGroupJoin("g-idem");
      assert.deepEqual(getGroupInfo("g-idem"), first);
      assert.equal(first?.leftAt, null);
    });

    test("exposes a salted hash as id, never the raw jid", () => {
      recordGroupJoin("g-hash@g.us");
      const info = getGroupInfo("g-hash@g.us");
      assert.match(info!.id, /^[0-9a-f]{64}$/);
      assert.notEqual(info!.id, "g-hash@g.us");
    });

    test("recordGroupLeave sets leftAt and keeps the row", () => {
      recordGroupJoin("g-leave");
      recordGroupLeave("g-leave");
      assert.notEqual(getGroupInfo("g-leave")?.leftAt, null);
    });

    test("rejoin after leave clears leftAt", () => {
      recordGroupJoin("g-rejoin");
      recordGroupLeave("g-rejoin");
      recordGroupJoin("g-rejoin");
      assert.equal(getGroupInfo("g-rejoin")?.leftAt, null);
    });

    test("leave without a prior join still records a row", () => {
      recordGroupLeave("g-orphan-leave");
      assert.notEqual(getGroupInfo("g-orphan-leave")?.leftAt, null);
    });
  });

  describe("plugin", () => {
    test("upsertPlugin registers as enabled and updates version", () => {
      upsertPlugin("synt-xerror/p1", "1.0.0");
      assert.deepEqual(getPluginInfo("synt-xerror/p1"), { key: "synt-xerror/p1", version: "1.0.0", enabled: true });

      upsertPlugin("synt-xerror/p1", "1.1.0");
      assert.equal(getPluginInfo("synt-xerror/p1")?.version, "1.1.0");
    });

    test("setPluginEnabled toggles the flag", () => {
      upsertPlugin("synt-xerror/p2", "1.0.0");
      setPluginEnabled("synt-xerror/p2", false);
      assert.equal(getPluginInfo("synt-xerror/p2")?.enabled, false);
      setPluginEnabled("synt-xerror/p2", true);
      assert.equal(getPluginInfo("synt-xerror/p2")?.enabled, true);
    });

    test("setPluginEnabled on an unknown key does not create a row", () => {
      setPluginEnabled("missing", false);
      assert.equal(getPluginInfo("missing"), null);
    });
  });
});
