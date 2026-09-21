import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import { CONFIG } from "#config";
import {
  LEGACY_ENGAGED_AFTER_MS, beginRun, claimNotice, isEngaged, pluginState,
  takeInterruptedRuns, _startNewBootForTests, type RunOrigin,
} from "#kernel/runState.js";

const key = { id: "MSG1", remoteJid: "chat@g.us", fromMe: false, participant: "sender@lid" };
const origin = (kind: RunOrigin["kind"]): RunOrigin => ({ chatId: "chat@g.us", key, command: "!sticker", kind });

describe("kernel/runState — plugin state", () => {
  test("is idle by default, running while a run is in flight, idle again after it finishes", () => {
    assert.equal(pluginState("p1"), "idle");
    const run = beginRun("p1");
    assert.equal(pluginState("p1"), "running");
    run.finish();
    assert.equal(pluginState("p1"), "idle");
  });

  test("stays running until every concurrent run of the plugin has finished", () => {
    const a = beginRun("p2");
    const b = beginRun("p2");
    a.finish();
    assert.equal(pluginState("p2"), "running");
    b.finish();
    assert.equal(pluginState("p2"), "idle");
  });

  test("finish() is idempotent", () => {
    const a = beginRun("p3");
    const b = beginRun("p3");
    a.finish();
    a.finish();
    assert.equal(pluginState("p3"), "running");
    b.finish();
  });
});

describe("kernel/runState — journal", () => {
  afterEach(() => {
    mock.timers.reset();
    CONFIG.CRASH_NOTICE_ENABLED = true;
    _startNewBootForTests();
    takeInterruptedRuns();
  });

  test("a finished command run leaves nothing behind", () => {
    beginRun("j1", origin("command")).finish();
    _startNewBootForTests();
    assert.deepEqual(takeInterruptedRuns(), []);
  });

  test("a command run still in flight at restart comes back with its chat and message key", () => {
    beginRun("j2", origin("command"));
    _startNewBootForTests();

    const [run, ...rest] = takeInterruptedRuns();
    assert.equal(rest.length, 0);
    assert.equal(run.plugin, "j2");
    assert.equal(run.chatId, "chat@g.us");
    assert.equal(run.command, "!sticker");
    assert.deepEqual(run.key, key);
  });

  test("rows are handed out once", () => {
    beginRun("j3", origin("command"));
    _startNewBootForTests();
    assert.equal(takeInterruptedRuns().length, 1);
    assert.equal(takeInterruptedRuns().length, 0);
  });

  test("runs from the current boot are not reported as interrupted", () => {
    beginRun("j4", origin("command"));
    assert.deepEqual(takeInterruptedRuns(), []);
  });

  test("a legacy run is only journaled once it has been running long enough", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const quick = beginRun("j5", origin("legacy"));
    mock.timers.tick(LEGACY_ENGAGED_AFTER_MS - 1);
    _startNewBootForTests();
    assert.deepEqual(takeInterruptedRuns(), [], "too quick to be real work");
    quick.finish();

    beginRun("j5", origin("legacy"));
    mock.timers.tick(LEGACY_ENGAGED_AFTER_MS);
    _startNewBootForTests();
    assert.equal(takeInterruptedRuns().length, 1);
  });

  test("a legacy run that finishes before the threshold never touches the journal", () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"] });
    beginRun("j6", origin("legacy")).finish();
    mock.timers.tick(LEGACY_ENGAGED_AFTER_MS * 2);
    _startNewBootForTests();
    assert.deepEqual(takeInterruptedRuns(), []);
  });

  test("runs without an origin never reach the journal", () => {
    beginRun("j7");
    _startNewBootForTests();
    assert.deepEqual(takeInterruptedRuns(), []);
  });

  test("nothing is journaled when crash notices are disabled", () => {
    CONFIG.CRASH_NOTICE_ENABLED = false;
    beginRun("j8", origin("command"));
    _startNewBootForTests();
    assert.deepEqual(takeInterruptedRuns(), []);
  });
});

describe("kernel/runState — isEngaged", () => {
  test("a command run is engaged immediately, a legacy run only after the threshold, an origin-less run never", () => {
    const now = Date.now();
    const command = beginRun("e1", origin("command"));
    const legacy  = beginRun("e2", origin("legacy"));
    const passive = beginRun("e3");

    assert.equal(isEngaged(command, now), true);
    assert.equal(isEngaged(legacy, now), false);
    assert.equal(isEngaged(legacy, now + LEGACY_ENGAGED_AFTER_MS), true);
    assert.equal(isEngaged(passive, now + 60_000), false);

    command.finish(); legacy.finish(); passive.finish();
  });
});

describe("kernel/runState — claimNotice", () => {
  test("is true the first time for a (chat, message) pair and false after", () => {
    assert.equal(claimNotice("c1@g.us", "A"), true);
    assert.equal(claimNotice("c1@g.us", "A"), false);
    assert.equal(claimNotice("c1@g.us", "B"), true);
    assert.equal(claimNotice("c2@g.us", "A"), true);
  });
});
