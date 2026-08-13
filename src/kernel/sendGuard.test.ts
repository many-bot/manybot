import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "#config";
import {
  typingDuration,
  mediaDuration,
  acquireChatSlot,
  simulateState,
  waitForSendSlot
} from "#kernel/sendGuard.js";
import type { WaContract } from "#kernel/waContract.js";

describe("kernel/sendGuard", () => {
  beforeEach(() => {
    CONFIG.SECURITY_LEVEL = "medium";
  });

  describe("typingDuration", () => {
    test("returns 0 for empty or invalid text", () => {
      assert.equal(typingDuration(""), 0);
      assert.equal(typingDuration(null as unknown as string), 0);
    });

    test("calculates duration based on CPS and caps at profile typingMaxMs", () => {
      CONFIG.SECURITY_LEVEL = "medium"; // typingMaxMs = 4000
      // 90 chars at 90 CPS = 1000 ms
      const text90 = "a".repeat(90);
      assert.equal(typingDuration(text90), 1000);

      // 900 chars at 90 CPS = 10000 ms -> capped at 4000 ms
      const text900 = "a".repeat(900);
      assert.equal(typingDuration(text900), 4000);
    });

    test("respects SECURITY_LEVEL profile caps", () => {
      const text900 = "a".repeat(900);
      CONFIG.SECURITY_LEVEL = "low"; // cap = 2000
      assert.equal(typingDuration(text900), 2000);

      CONFIG.SECURITY_LEVEL = "high"; // cap = 8000
      assert.equal(typingDuration(text900), 8000);
    });
  });

  describe("mediaDuration", () => {
    test("returns base jitter range when no caption is provided", () => {
      const duration = mediaDuration();
      assert.ok(duration >= 400 && duration <= 1000);
    });

    test("adds typing duration when caption is provided", () => {
      CONFIG.SECURITY_LEVEL = "medium";
      const text90 = "a".repeat(90); // 1000ms typing
      const duration = mediaDuration(text90);
      assert.ok(duration >= 1400 && duration <= 2000);
    });
  });

  describe("acquireChatSlot (concurrency gate)", () => {
    test("allows up to profile concurrency before blocking", async () => {
      CONFIG.SECURITY_LEVEL = "high"; // concurrency = 1

      const release1 = await acquireChatSlot("chat1");
      let slot2Acquired = false;

      const promise2 = acquireChatSlot("chat2").then(rel => {
        slot2Acquired = true;
        return rel;
      });

      // Give microtask tick to verify slot2 is waiting
      await new Promise(r => setImmediate(r));
      assert.equal(slot2Acquired, false);

      // Release slot 1 allows slot 2 to proceed
      release1();
      const release2 = await promise2;
      assert.equal(slot2Acquired, true);
      release2();
    });
  });

  describe("simulateState", () => {
    test("sends presence update composing/recording, waits, then sends paused", async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const updates: Array<{ state: string; jid: string }> = [];
      const mockContract: Partial<WaContract> = {
        sendPresenceUpdate: async (state, jid) => {
          updates.push({ state, jid });
        }
      };

      const simPromise = simulateState(mockContract as WaContract, "123@c.us", 1000, "typing");
      // simulateState awaits the first presence update before scheduling its
      // timeout, so let that continuation run before advancing mock time.
      await Promise.resolve();
      t.mock.timers.tick(1000);
      await simPromise;

      assert.deepEqual(updates, [
        { state: "composing", jid: "123@c.us" },
        { state: "paused", jid: "123@c.us" }
      ]);
    });

    test("handles non-fatal contract errors gracefully", async () => {
      const failingContract: Partial<WaContract> = {
        sendPresenceUpdate: async () => {
          throw new Error("Network error");
        }
      };

      // Should not throw exception
      await assert.doesNotReject(async () => {
        await simulateState(failingContract as WaContract, "123@c.us", 100, "typing");
      });
    });
  });

  describe("waitForSendSlot", () => {
    test("completes send throttle without errors", async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
      const sendPromise = waitForSendSlot("123@c.us", { cooldown: false, jitter: false });
      t.mock.timers.tick(500);
      await sendPromise;
    });
  });
});
