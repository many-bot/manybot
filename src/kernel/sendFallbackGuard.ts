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

/**
 * Thrown by sendWithFallback when the message could not be delivered
 * through any available driver. `reason` distinguishes between
 * "primary failed and no secondary was available" vs "both failed".
 */
export class SendFailedError extends Error {
  readonly jid:    string;
  readonly driver: "baileys" | "whatsmeow";
  readonly reason: "no_fallback" | "both_failed";

  constructor(jid: string, driver: "baileys" | "whatsmeow", reason: "no_fallback" | "both_failed") {
    super(`send failed: ${reason} (jid=${jid}, lastDriver=${driver})`);
    this.name   = "SendFailedError";
    this.jid    = jid;
    this.driver = driver;
    this.reason = reason;
  }
}

/**
 * Try the active driver, then the other one if the active one failed to
 * confirm the send. Honors `drivers.fallbackCooldownMs` (skip the active
 * if it's currently degraded) and uses `drivers.verifyWindowMs` to decide
 * how long to wait for confirmation before giving up on a given attempt.
 *
 * Resolves with the SentMessageRef of the driver that actually delivered
 * the message. Rejects with SendFailedError if neither driver confirmed
 * the send (or if the only driver that could have been tried was the
 * active one and it wasn't ready).
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

  // if the primary is in cooldown, skip straight to the secondary
  // (don't repeat the same failing call message after message). Same
  // try/catch as the normal path so a failing secondary here also fires
  // send_failed_both_drivers — observability stays consistent across
  // the degraded and fresh-primary paths.
  if (dm.isDegraded(primaryKey)) {
    const secondary = pickSecondary(dm, primaryKey);
    if (secondary && secondary.isReady()) {
      try {
        return await sendVia(secondary, jid, text, opts, drivers.verifyWindowMs, /*skipGuard=*/false);
      } catch (err) {
        fireAlert("send_failed_both_drivers", { jid, primary: primaryKey, secondary: secondary.name, error: String(err) });
        throw err;
      }
    }
    logger.warn({ jid, primary: primaryKey }, "send skipped primary (degraded) and no fallback ready");
    fireAlert("send_failed_no_fallback", { jid, primary: primaryKey });
    throw new SendFailedError(jid, primaryKey, "no_fallback");
  }

  // Normal path: try primary, verify, fall back if verification fails.
  // waitForSendSlot is the same throttle the rest of the senders use
  // (fallback must respect rate-limit too).
  await waitForSendSlot(jid, { cooldown: true, jitter: true });

  let primaryRef: SentMessageRef | null = null;
  let primarySendFailed = false;
  try {
    primaryRef = await primary.sendText(jid, text, opts);
  } catch (err) {
    primarySendFailed = true;
    logger.warn({ driver: primaryKey, jid, error: String(err) }, "send threw on primary");
  }

  if (!primarySendFailed) {
    if (await verifyDelivery(primary, jid, primaryRef!, drivers.verifyWindowMs)) {
      return primaryRef!;
    }
    logger.warn({ driver: primaryKey, jid, messageId: primaryRef!.id }, "send not confirmed by primary");
  }

  dm.markDegraded(primaryKey, drivers.fallbackCooldownMs);

  const secondary = pickSecondary(dm, primaryKey);
  if (!secondary || !secondary.isReady()) {
    fireAlert("send_failed_no_fallback", { jid, primary: primaryKey });
    throw new SendFailedError(jid, primaryKey, "no_fallback");
  }

  try {
    const fallbackRef = await sendVia(secondary, jid, text, opts, drivers.verifyWindowMs, /*skipGuard=*/true);
    logger.info({ driver: secondary.name, jid, messageId: fallbackRef.id, reason: primarySendFailed ? "send threw" : "primary verification failed" }, "message sent via fallback");
    return fallbackRef;
  } catch (err) {
    fireAlert("send_failed_both_drivers", { jid, primary: primaryKey, secondary: secondary.name, error: String(err) });
    throw err;
  }
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

function pickSecondary(dm: DriverManagerShim, primaryKey: "baileys" | "whatsmeow"): WaContract | undefined {
  const other: "baileys" | "whatsmeow" = primaryKey === "baileys" ? "whatsmeow" : "baileys";
  return dm.get(other);
}

// Minimal structural type so we don't have to import the DriverManager
// class directly (keeps this module dependency-light and test-friendly).
interface DriverManagerShim {
  get(name: "baileys" | "whatsmeow"): WaContract | undefined;
}
