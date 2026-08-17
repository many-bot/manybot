import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, describe, test } from "node:test";
import http from "node:http";
import { getStatus, setStatus, startStatusServer } from "#kernel/statusServer.js";

describe("kernel/statusServer", () => {
  let activeServer: http.Server | null = null;

  afterEach(async () => {
    if (activeServer) {
      await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
      activeServer = null;
    }
    // Reset status back to offline
    setStatus(false);
  });

  test("getStatus returns initial state", () => {
    const status = getStatus();
    assert.equal(typeof status.online, "boolean");
    assert.equal(typeof status.since, "string");
  });

  test("setStatus updates online state and timestamps", async () => {
    setStatus(false, "Initial error");
    const initial = getStatus();
    assert.equal(initial.online, false);
    assert.equal(initial.lastError, "Initial error");

    // Allow timestamp to advance
    await new Promise((r) => setTimeout(r, 10));

    setStatus(true);
    const updated = getStatus();
    assert.equal(updated.online, true);
    assert.equal(updated.lastError, undefined);
    assert.notEqual(updated.since, initial.since);

    // Setting same status is a no-op for since timestamp
    const sinceBefore = updated.since;
    setStatus(true);
    assert.equal(getStatus().since, sinceBefore);
  });

  test("setStatus captures error message when going offline", () => {
    setStatus(true);
    setStatus(false, "Stream closed");
    const status = getStatus();
    assert.equal(status.online, false);
    assert.equal(status.lastError, "Stream closed");
  });

  test("startStatusServer responds with JSON status and CORS headers", async () => {
    setStatus(true);
    activeServer = startStatusServer(0);

    // Wait until the server is listening
    await new Promise<void>((resolve) => {
      if (activeServer!.listening) resolve();
      else activeServer!.once("listening", () => resolve());
    });

    const addr = activeServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}/status`;

    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");

    const body = (await res.json()) as { online: boolean; since: string; lastError?: string };
    assert.equal(body.online, true);
    assert.equal(typeof body.since, "string");
    assert.equal(body.lastError, undefined);

    // Mutate status and verify dynamic response on subsequent request
    setStatus(false, "Socket hung up");
    const res2 = await fetch(url);
    const body2 = (await res2.json()) as { online: boolean; since: string; lastError?: string };
    assert.equal(body2.online, false);
    assert.equal(body2.lastError, "Socket hung up");
  });
});
