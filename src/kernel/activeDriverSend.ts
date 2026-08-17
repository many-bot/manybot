/**
 * activeDriverSend.ts
 *
 * Driver-neutral send helper. Ensures rate-limiting and throttling
 * are applied to all outbound text sends from plugins, then sends
 * through whichever single driver is currently active in the
 * DriverManager. There is no fallback between drivers — driver
 * selection is mutually exclusive and decided once at boot (see
 * main.ts / driverManager.ts).
 */

import { waitForSendSlot } from "./sendGuard.js";
import { getDriverManager } from "./driverManager.js";
import type { SentMessageRef, BotQuotedRef } from "#kernel/waContract.js";

/**
 * Send text using the active driver, respecting the rate-limiting send guard.
 */
export async function sendActiveDriverText(
  jid:  string,
  text: string,
  opts: { quoted?: BotQuotedRef; mentions?: string[] } = {}
): Promise<SentMessageRef> {
  const dm     = getDriverManager();
  const driver = dm.active();

  await waitForSendSlot(jid, { cooldown: true, jitter: true });
  return await driver.sendText(jid, text, opts);
}
