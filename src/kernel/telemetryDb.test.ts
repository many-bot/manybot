import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  getGroupInfo,
  getGroupSyncedAt,
  getInstanceInfo,
  getPluginInfo,
  getUserInfo,
  markGroupSynced,
  recordGroupJoin,
  recordGroupLeave,
  recordInstanceStartup,
  setPluginEnabled,
  syncGroups,
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

    test("leave without a prior join still records a row with unknown joinedAt", () => {
      recordGroupLeave("g-orphan-leave");
      assert.notEqual(getGroupInfo("g-orphan-leave")?.leftAt, null);
      assert.equal(getGroupInfo("g-orphan-leave")?.joinedAt, null);
    });
  });

  describe("group sync", () => {
    const nowS = (): number => Math.floor(Date.now() / 1000);
    const future = (): number => nowS() + 3600;
    const past = (): number => nowS() - 3600;

    test("adds unknown groups as active with unknown joinedAt", () => {
      const r = syncGroups(["s-add-1", "s-add-2"], nowS());
      assert.equal(r.added, 2);
      assert.equal(r.skipped, false);
      assert.deepEqual(
        [getGroupInfo("s-add-1")?.joinedAt, getGroupInfo("s-add-1")?.leftAt],
        [null, null],
      );
    });

    test("is idempotent on a repeated scan", () => {
      syncGroups(["s-idem"], nowS());
      const before = getGroupInfo("s-idem");
      const r = syncGroups(["s-idem"], nowS());
      assert.equal(r.added, 0);
      assert.equal(r.reactivated, 0);
      assert.deepEqual(getGroupInfo("s-idem"), before);
    });

    test("closes active groups missing from the scan", () => {
      syncGroups(["s-keep", "s-gone"], nowS());
      const r = syncGroups(["s-keep"], future());
      assert.ok(r.closed >= 1);
      assert.equal(getGroupInfo("s-keep")?.leftAt, null);
      assert.notEqual(getGroupInfo("s-gone")?.leftAt, null);
    });

    test("reactivates a closed group present in the scan", () => {
      recordGroupJoin("s-react");
      recordGroupLeave("s-react");
      const r = syncGroups(["s-react"], future());
      assert.equal(r.reactivated, 1);
      assert.equal(getGroupInfo("s-react")?.leftAt, null);
      assert.equal(getGroupInfo("s-react")?.joinedAt, null);
    });

    test("ignores an empty scan while groups are active", () => {
      recordGroupJoin("s-empty");
      const r = syncGroups([], future());
      assert.equal(r.skipped, true);
      assert.equal(r.closed, 0);
      assert.equal(getGroupInfo("s-empty")?.leftAt, null);
    });

    test("race-join: a group joined after the snapshot is not closed", () => {
      const snapshotAt = past();
      recordGroupJoin("s-race-join");
      syncGroups(["s-some-other"], snapshotAt);
      assert.equal(getGroupInfo("s-race-join")?.leftAt, null);
    });

    test("race-leave: a group left after the snapshot is not reactivated", () => {
      recordGroupJoin("s-race-leave");
      const snapshotAt = past();
      recordGroupLeave("s-race-leave");
      const r = syncGroups(["s-race-leave"], snapshotAt);
      assert.equal(r.reactivated, 0);
      assert.notEqual(getGroupInfo("s-race-leave")?.leftAt, null);
    });

    test("reports the active count after the changes", () => {
      const r = syncGroups(["s-count-a", "s-count-b"], future());
      assert.equal(r.active, 2);
    });

    test("markGroupSynced persists and overwrites the last sync time", () => {
      markGroupSynced(100);
      assert.equal(getGroupSyncedAt(), 100);
      markGroupSynced(200);
      assert.equal(getGroupSyncedAt(), 200);
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
