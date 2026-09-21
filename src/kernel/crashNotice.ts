/**
 * kernel/crashNotice.ts
 *
 * Tells a chat that its command did not finish, so the user can send it again.
 *
 * This is deliberately a notice and not an automatic retry: plugins have side
 * effects (stickers, bans, deletions, paid API calls), and a message that
 * crashes the bot would otherwise be replayed into the next crash.
 *
 * Two entry points share one delivery path:
 *   - noticeRunFailure():      the run failed inside this process
 *   - recoverInterruptedRuns(): a previous process died with the run in flight
 *
 * A failure only reaches the chat when the run was demonstrably answering that
 * chat's command (see runState.ts). Background/event-handler errors and
 * fire-and-forget rejections never do.
 */

import { CONFIG } from "#config";
import { logger } from "#logger";
import { tFor } from "#i18n";
import { getChatLocale } from "./chatOverrides.js";
import { sendActiveDriverText } from "./activeDriverSend.js";
import {
  claimNotice, isEngaged, pruneNotices, takeInterruptedRuns,
  type RunHandle, type RunTarget,
} from "./runState.js";

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

export function renderNotice(target: RunTarget, plugin: string): string {
  const vars = { command: target.command, plugin };
  const custom = CONFIG.CRASH_NOTICE_MESSAGE.trim();
  if (custom) return interpolate(custom, vars);
  return tFor(getChatLocale(target.chatId), "crashNotice.message", vars);
}

async function deliver(target: RunTarget, plugin: string): Promise<boolean> {
  if (target.key?.id && !claimNotice(target.chatId, target.key.id)) return false;
  await sendActiveDriverText(target.chatId, renderNotice(target, plugin), { quoted: target.key });
  return true;
}

/**
 * Reports a failed run to its chat. Never rejects — the caller is a catch
 * block that must not be disturbed. Resolves to whether a notice was sent.
 */
export async function noticeRunFailure(run: RunHandle): Promise<boolean> {
  const { origin } = run;
  if (!CONFIG.CRASH_NOTICE_ENABLED || !origin || !isEngaged(run)) return false;

  try {
    return await deliver(origin, run.plugin);
  } catch (e) {
    logger.warn(`[crashNotice] could not notify ${origin.chatId}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Notifies the chats whose runs a previous process left unfinished. Call once
 * after the driver is connected. Rows older than CRASH_NOTICE_MAX_AGE_SECONDS
 * are dropped silently: the user has moved on. Returns how many chats were told.
 */
export async function recoverInterruptedRuns(now = Date.now()): Promise<number> {
  pruneNotices();
  const interrupted = takeInterruptedRuns();
  if (!CONFIG.CRASH_NOTICE_ENABLED) return 0;

  const maxAgeMs = CONFIG.CRASH_NOTICE_MAX_AGE_SECONDS * 1000;
  let sent = 0;

  for (const run of interrupted) {
    if (now - run.startedAt > maxAgeMs) continue;
    try {
      if (await deliver(run, run.plugin)) sent++;
    } catch (e) {
      logger.warn(`[crashNotice] could not notify ${run.chatId}: ${(e as Error).message}`);
    }
  }

  if (sent > 0) logger.info(`[crashNotice] told ${sent} chat(s) about commands interrupted by the previous shutdown`);
  return sent;
}
