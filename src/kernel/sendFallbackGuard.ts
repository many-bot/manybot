/**
 * sendFallbackGuard.ts
 *
 * Every outbound text send from a plugin flows through sendWithFallback():
 * wait for a send slot, then hand off to the active driver. manybot runs a
 * single WhatsApp driver (Baileys) — no delivery verification, no secondary
 * driver to escalate to. If sendText() resolves, the send is trusted.
 *
 * Why a guard instead of inlining this in the sender: every downstream
 * caller (makeSender, buildSendApi, buildSetupSendApi) gets the same
 * behavior for free, and a future policy change touches one file.
 *
 * Text-only. sendMedia and react go straight to the active driver.
 */

import { logger } from "#logger";
import { waitForSendSlot } from "./sendGuard.js";
import { getDriverManager } from "./driverManager.js";
import { fireAlert } from "./alerts.js";
import type { SentMessageRef, BotQuotedRef } from "#kernel/waContract.js";

export class SendFailedError extends Error {
  readonly jid:    string;
  readonly driver: string;

  constructor(jid: string, driver: string) {
    super(`send failed (jid=${jid}, driver=${driver})`);
    this.name   = "SendFailedError";
    this.jid    = jid;
    this.driver = driver;
  }
}

/**
 * Sends through the active driver. Resolves with the SentMessageRef on
 * success; rejects with SendFailedError if the driver itself throws.
 */
export async function sendWithFallback(
  jid:  string,
  text: string,
  opts: { quoted?: BotQuotedRef; mentions?: string[] } = {}
): Promise<SentMessageRef> {
  const dm         = getDriverManager();
  const primary    = dm.active();
  const primaryKey = primary.name;

  await waitForSendSlot(jid, { cooldown: true, jitter: true });

  try {
    return await primary.sendText(jid, text, opts);
  } catch (err) {
    logger.warn({ driver: primaryKey, jid, error: String(err) }, "send failed");
    fireAlert("send_failed", { jid, driver: primaryKey });
    throw new SendFailedError(jid, primaryKey);
  }
}
