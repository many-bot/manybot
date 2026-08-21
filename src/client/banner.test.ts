import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { printBanner } from "./banner.js";
import { setLogLevel } from "#logger";

describe("printBanner LOG_LEVEL gating", () => {
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

  test("prints at normal", () => {
    setLogLevel("normal");
    printBanner();
    assert.ok(lines.length > 0);
  });

  test("stays silent at clean", () => {
    setLogLevel("clean");
    printBanner();
    assert.equal(lines.length, 0);
  });

  test("stays silent at minimal", () => {
    setLogLevel("minimal");
    printBanner();
    assert.equal(lines.length, 0);
  });
});

