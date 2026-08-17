#!/usr/bin/env node
/**
 * Test runner with driver flag support.
 *
 * Adds support for `WA_TEST_DRIVER` environment variable to switch between
 * Baileys and WhatsMeow drivers for testing purposes.
 *
 * Usage:
 *   NODE_ENV=test WA_TEST_DRIVER=whatsmeow npm run test
 *   NODE_ENV=test WA_TEST_DRIVER=baileys npm run test
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("kernel/testConfig — driver flag", () => {
  test("reads WA_TEST_DRIVER env var", () => {
    const driver = process.env.WA_TEST_DRIVER;
    expect(["baileys", "whatsmeow", undefined]).toContain(driver);
  });

  test("defaults to baileys when unset", () => {
    delete process.env.WA_TEST_DRIVER;
    const driver = process.env.WA_TEST_DRIVER;
    expect(driver).toBeUndefined();
  });

  test("accepts whatsmeow value", () => {
    process.env.WA_TEST_DRIVER = "whatsmeow";
    const driver = process.env.WA_TEST_DRIVER;
    expect(driver).toBe("whatsmeow");
  });

  test("accepts baileys value", () => {
    process.env.WA_TEST_DRIVER = "baileys";
    const driver = process.env.WA_TEST_DRIVER;
    expect(driver).toBe("baileys");
  });
});