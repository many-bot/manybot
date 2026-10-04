import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getGroupInfo, getGroupSyncedAt, recordGroupJoin } from "#kernel/telemetryDb.js";
import { GROUP_SYNC_MIN_INTERVAL_S, syncGroupTelemetry } from "#kernel/groupTelemetrySync.js";

describe("syncGroupTelemetry", () => {
  const base = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;

  test("an empty scan with no active groups does not mark the sync as done", async () => {
    const r = await syncGroupTelemetry(async () => [], () => base);
    assert.equal(r?.skipped, false);
    assert.equal(getGroupSyncedAt(), null);
  });

  test("a non-empty scan syncs and records the snapshot time", async () => {
    const r = await syncGroupTelemetry(async () => ["gs-1", "gs-2"], () => base);
    assert.equal(r?.added, 2);
    assert.equal(getGroupSyncedAt(), base);
    assert.equal(getGroupInfo("gs-1")?.leftAt, null);
  });

  test("is throttled inside the interval and does not call the fetcher", async () => {
    let calls = 0;
    const fetchJids = async (): Promise<string[]> => { calls++; return ["gs-1"]; };
    const r = await syncGroupTelemetry(fetchJids, () => base + GROUP_SYNC_MIN_INTERVAL_S - 1);
    assert.equal(r, null);
    assert.equal(calls, 0);
  });

  test("runs again once the interval has elapsed", async () => {
    const at = base + GROUP_SYNC_MIN_INTERVAL_S;
    const r = await syncGroupTelemetry(async () => ["gs-1"], () => at);
    assert.equal(r?.closed, 1);
    assert.equal(getGroupSyncedAt(), at);
  });

  test("a failing fetch returns null, keeps data and leaves the throttle untouched", async () => {
    recordGroupJoin("gs-keep");
    const at = base + 10 * GROUP_SYNC_MIN_INTERVAL_S;
    const before = getGroupSyncedAt();
    const r = await syncGroupTelemetry(async () => { throw new Error("boom"); }, () => at);
    assert.equal(r, null);
    assert.equal(getGroupSyncedAt(), before);
    assert.equal(getGroupInfo("gs-keep")?.leftAt, null);
  });

  test("an empty scan with active groups is skipped and does not mark synced", async () => {
    const at = base + 20 * GROUP_SYNC_MIN_INTERVAL_S;
    const before = getGroupSyncedAt();
    const r = await syncGroupTelemetry(async () => [], () => at);
    assert.equal(r?.skipped, true);
    assert.equal(getGroupSyncedAt(), before);
    assert.equal(getGroupInfo("gs-keep")?.leftAt, null);
  });
});
