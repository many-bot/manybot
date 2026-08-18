/**
 * sendFallbackGuard.ts
 *
 * The only place in the codebase that knows more than one WhatsApp
 * driver exists. Every outbound text send from a plugin flows through
 * sendWithFallback(): try the primary, verify the message actually
 * appeared in the driver's history, and if it didn't, swap to the
 * secondary and try again. See "flow", "verification",
 * and cooldown).
 *
 * Why a guard instead of inlining the logic in the sender: every
 * downstream caller (makeSender, buildSendApi, buildSetupSendApi) gets
 * the same fallback behavior for free, and a future change in policy
 * (e.g. "after N consecutive fallbacks, drop to system queue") touches
 * one file.
 *
 * The guard is intentionally text-only in this phase. sendMedia and
 * react go straight to the active driver — media fallback is
 * marked as out of scope until the path is designed.
 */

import { CONFIG } from "#config";
import { logger } from "#logger";
import { waitForSendSlot } from "./sendGuard.js";
import { getDriverManager } from "./driverManager.js";
import { fireAlert } from "./alerts.js";
import type { WaContract, SentMessageRef, BotQuotedRef } from "#kernel/waContract.js";
import type { BotMessage } from "#drivers/types.js";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class SendFailedError extends Error {
  readonly jid:    string;
  readonly driver: string;
  readonly reason: "no_fallback" | "both_failed";

  constructor(jid: string, driver: string, reason: "no_fallback" | "both_failed") {
    super(`send failed: ${reason} (jid=${jid}, lastDriver=${driver})`);
    this.name   = "SendFailedError";
    this.jid    = jid;
    this.driver = driver;
    this.reason = reason;
  }
}

/**
 * Try the active driver and verify the send. Honors `drivers.fallbackCooldownMs`
 * (though with only one driver, degradation doesn't skip attempts) and uses
 * `drivers.verifyWindowMs` to decide how long to wait for confirmation.
 *
 * Resolves with the SentMessageRef of the driver that actually delivered
 * the message. Rejects with SendFailedError with reason "no_fallback" if the
 * send could not be confirmed.
 */
export async function sendWithFallback(
  jid:  string,
  text: string,
  opts: { quoted?: BotQuotedRef; mentions?: string[] } = {}
): Promise<SentMessageRef> {
  const dm         = getDriverManager();
  const drivers    = CONFIG.drivers;
  const primary    = dm.active();
  const primaryKey = primary.name;

  // Mark as not degraded before attempting (degradation only lasts for cooldown period)
  // With only one driver, we don't actually skip attempts when degraded - we just track
  // that the last attempt failed so we can alert appropriately
  if (dm.isDegraded(primaryKey)) {
    logger.debug({ driver: primaryKey }, "driver in degradation period but attempting send anyway (single driver mode)");
  }

  await waitForSendSlot(jid, { cooldown: true, jitter: true });

  let primaryRef: SentMessageRef | null = null;
  let primarySendFailed = false;
  try {
    primaryRef = await primary.sendText(jid, text, opts);
  } catch (err) {
    primarySendFailed = true;
    logger.warn({ driver: primaryKey, jid, error: String(err) }, "send threw on primary");
    dm.markDegraded(primaryKey, drivers.fallbackCooldownMs);
    fireAlert("send_failed_no_fallback", { jid, primary: primaryKey });
    throw new SendFailedError(jid, primaryKey, "no_fallback");
  }

  if (!primarySendFailed) {
    if (await verifyDelivery(primary, jid, primaryRef!, drivers.verifyWindowMs)) {
      // Successful send - clear any degradation state
      dm.clearDegraded(primaryKey);
      return primaryRef!;
    }
    logger.warn({ driver: primaryKey, jid, messageId: primaryRef!.id }, "send not confirmed by primary");
    dm.markDegraded(primaryKey, drivers.fallbackCooldownMs);
    fireAlert("send_failed_no_fallback", { jid, primary: primaryKey });
    throw new SendFailedError(jid, primaryKey, "no_fallback");
  }

  // Should not reach here
  throw new SendFailedError(jid, primaryKey, "no_fallback");
}

/**
 * Send through a specific driver and verify the result. Throws if the
 * driver itself rejects (network error, rate-limit, etc.) or if no
 * verification window matched. `skipGuard=true` skips waitForSendSlot —
 * used by the secondary path, where the primary already consumed the
 * slot and the secondary is best-effort.
 */
async function sendVia(
  driver:      WaContract,
  jid:         string,
  text:        string,
  opts:        { quoted?: BotQuotedRef; mentions?: string[] },
  windows:     number[],
  skipGuard:   boolean,
): Promise<SentMessageRef> {
  if (!skipGuard) await waitForSendSlot(jid, { cooldown: true, jitter: true });

  const ref = await driver.sendText(jid, text, opts);
  if (await verifyDelivery(driver, jid, ref, windows)) return ref;

  throw new SendFailedError(jid, driver.name, "both_failed");
}

/**
 * Pull recent history from the driver and look for `ref.id` among the
 * fromMe messages. Returns true on the first hit; false if every check
 * came up empty (including the final window, which acts as the overall
 * timeout).
 *
 * The first check happens IMMEDIATELY (no sleep). For Baileys this is
 * the common case: `sock.sendMessage` resolves after the message is
 * already in the in-memory store (the `messages.upsert` listener runs
 * synchronously off the same ack), so a 0ms lookup hits and the send
 * completes with no extra latency. Only if that immediate lookup
 * misses (driver lag, history sync delay, ...) do we start the
 * time-windowed rechecks — `windows` are interpreted as delays
 * BETWEEN successive checks, last one being the final timeout.
 *
 * id is the primary signal. We match against ALL
 * fromMe messages in the slice, not just the newest — the secondary
 * path skips `waitForSendSlot` (skipGuard=true) so two concurrent
 * sends to the same jid can both be in flight at once, and "newest
 * only" would let the second one mask the first.
 *
 * If the driver doesn't implement `getHistory?` (pure fire-and-forget
 * transports), verification can't happen — return false and let the
 * caller fall through. Both real drivers in scope today (Baileys,
 * whatsmeow) implement it, so this is just defensive.
 */
async function verifyDelivery(
  driver:  WaContract,
  jid:     string,
  ref:     SentMessageRef,
  windows: number[]
): Promise<boolean> {
  if (!driver.getHistory) return false;

  // Check at t=0 first; only enter the window loop if that misses.
  if (await historyContains(driver, jid, ref)) return true;

  for (const delayMs of windows) {
    await sleep(delayMs);
    if (await historyContains(driver, jid, ref)) return true;
  }
  return false;
}

async function historyContains(
  driver: WaContract,
  jid:    string,
  ref:    SentMessageRef,
): Promise<boolean> {
  let history: BotMessage[];
  try {
    history = await driver.getHistory!(jid, { limit: 5 });
  } catch (e) {
    logger.debug({ driver: driver.name, jid, err: String(e) }, "getHistory failed during verify (non-fatal)");
    return false;
  }
  return history.some(m => m.fromMe && m.id === ref.id);
}

function pickSecondary(dm: DriverManagerShim, primaryKey: string): WaContract | undefined {
  // Currently Baileys is the only supported driver; returns undefined unless a test registers a secondary
  return dm.get(primaryKey === "baileys" ? "secondary" : "baileys");
}

// Minimal structural type so we don't have to import the DriverManager
// class directly (keeps this module dependency-light and test-friendly).
interface DriverManagerShim {
  get(name: string): WaContract | undefined;
  isDegraded(name: string): boolean;
  markDegraded(name: string, durationMs: number): void;
  clearDegraded(name: string): void;
}
