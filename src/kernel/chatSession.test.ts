import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import {
  acquireSession,
  releaseSession,
  isSessionLocked,
  getSessionHolder,
  __resetSessionsForTests,
} from "#kernel/chatSession.js";

describe("kernel/chatSession — Phase 7 exclusive chat session", () => {
  beforeEach(() => {
    __resetSessionsForTests();
  });

  test("acquire on a free chat succeeds and locks it", () => {
    assert.equal(acquireSession("chat1", "gamePlugin"), true);
    assert.equal(isSessionLocked("chat1"), true);
    assert.equal(getSessionHolder("chat1"), "gamePlugin");
  });

  test("a different plugin cannot acquire an already-held session", () => {
    assert.equal(acquireSession("chat1", "gamePlugin"), true);
    assert.equal(acquireSession("chat1", "figurinhaPlugin"), false);
    assert.equal(getSessionHolder("chat1"), "gamePlugin", "holder unchanged");
  });

  test("the same plugin re-acquiring its own session is idempotent", () => {
    assert.equal(acquireSession("chat1", "gamePlugin"), true);
    assert.equal(acquireSession("chat1", "gamePlugin"), true);
    assert.equal(getSessionHolder("chat1"), "gamePlugin");
  });

  test("release only works for the plugin that holds the session", () => {
    acquireSession("chat1", "gamePlugin");

    assert.equal(releaseSession("chat1", "figurinhaPlugin"), false, "wrong plugin cannot release");
    assert.equal(isSessionLocked("chat1"), true, "still locked");

    assert.equal(releaseSession("chat1", "gamePlugin"), true);
    assert.equal(isSessionLocked("chat1"), false);
    assert.equal(getSessionHolder("chat1"), null);
  });

  test("releasing a chat with no session is a no-op", () => {
    assert.equal(releaseSession("neverLocked", "anyPlugin"), false);
  });

  test("sessions are independent per chat", () => {
    assert.equal(acquireSession("chatA", "gamePlugin"), true);
    assert.equal(acquireSession("chatB", "figurinhaPlugin"), true);
    assert.equal(getSessionHolder("chatA"), "gamePlugin");
    assert.equal(getSessionHolder("chatB"), "figurinhaPlugin");
  });

  test("a freed session can be acquired by a different plugin afterward", () => {
    acquireSession("chat1", "gamePlugin");
    releaseSession("chat1", "gamePlugin");
    assert.equal(acquireSession("chat1", "figurinhaPlugin"), true);
    assert.equal(getSessionHolder("chat1"), "figurinhaPlugin");
  });
});
