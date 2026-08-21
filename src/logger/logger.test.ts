import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { logger, setLogLevel, getLogLevel } from "./logger.js";

describe("logger levels", () => {
  const originalLog = console.log;
  let lines: string[];

  beforeEach(() => {
    lines = [];
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  });

  afterEach(() => {
    console.log = originalLog;
    setLogLevel("normal");
  });

  test("defaults to normal", () => {
    assert.equal(getLogLevel(), "normal");
  });

  test("normal shows info, success, warn, error", () => {
    setLogLevel("normal");
    logger.info("a"); logger.success("b"); logger.warn("c"); logger.error("d");
    assert.equal(lines.length, 4);
  });

  test("clean hides info but keeps success, warn, error", () => {
    setLogLevel("clean");
    logger.info("a"); logger.success("b"); logger.warn("c"); logger.error("d");
    assert.equal(lines.length, 3);
    assert.ok(!lines.some(l => l.includes("a")));
  });

  test("minimal hides info and success, keeps warn and error", () => {
    setLogLevel("minimal");
    logger.info("a"); logger.success("b"); logger.warn("c"); logger.error("d");
    assert.equal(lines.length, 2);
    assert.ok(lines.some(l => l.includes("c")));
    assert.ok(lines.some(l => l.includes("d")));
  });
});

