import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";

import {
  loadGroupMeta,
  storeGroupMeta,
  dropGroupMeta,
  clearGroupMetaCache,
  peekGroupMeta,
  type WAGroupMetadata,
} from "#drivers/baileys/groupMetaCache.js";

const GROUP = "120363000000000000@g.us";

function meta(subject: string): WAGroupMetadata {
  return { id: GROUP, subject, participants: [] } as unknown as WAGroupMetadata;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("drivers/baileys/groupMetaCache", () => {
  beforeEach(() => clearGroupMetaCache());

  test("fetches once and serves later loads from the cache", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return meta("a"); };

    await loadGroupMeta(GROUP, fetcher);
    await loadGroupMeta(GROUP, fetcher);

    assert.equal(calls, 1);
  });

  test("concurrent loads for the same group share one fetch", async () => {
    let calls = 0;
    const gate = deferred<WAGroupMetadata>();
    const fetcher = () => { calls++; return gate.promise; };

    const loads = Promise.all([
      loadGroupMeta(GROUP, fetcher),
      loadGroupMeta(GROUP, fetcher),
      loadGroupMeta(GROUP, fetcher),
    ]);
    gate.resolve(meta("a"));
    await loads;

    assert.equal(calls, 1);
  });

  test("dropGroupMeta forces the next load to fetch again", async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return meta("a"); };

    await loadGroupMeta(GROUP, fetcher);
    dropGroupMeta(GROUP);
    await loadGroupMeta(GROUP, fetcher);

    assert.equal(calls, 2);
  });

  test("a fetch that was in flight when the group was invalidated is not cached", async () => {
    const stale = deferred<WAGroupMetadata>();
    const first = loadGroupMeta(GROUP, () => stale.promise);

    dropGroupMeta(GROUP);
    stale.resolve(meta("stale"));
    await first;

    assert.equal(peekGroupMeta(GROUP), undefined);
  });

  test("a failed fetch is not cached and does not block the next attempt", async () => {
    await assert.rejects(loadGroupMeta(GROUP, async () => { throw new Error("rate-overlimit"); }));

    const result = await loadGroupMeta(GROUP, async () => meta("ok"));

    assert.equal(result.subject, "ok");
  });

  test("storeGroupMeta makes a fresh fetch result visible to later loads", async () => {
    storeGroupMeta(GROUP, meta("fresh"));

    const result = await loadGroupMeta(GROUP, async () => { throw new Error("should not fetch"); });

    assert.equal(result.subject, "fresh");
  });
});

