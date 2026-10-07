/**
 * settingsPrune.ts
 *
 * Deletes a chat's entire plugin-settings footprint once nothing has
 * touched it (read or written via ctx.settings, by any plugin) for
 * SETTINGS_PRUNE_MAX_AGE_DAYS. Covers the common case of a group
 * removing the bot: nobody calls ctx.settings for that chat_id again,
 * so its old config would otherwise sit in settings.db forever.
 *
 * The actual deletion lives in settingsDb.ts (pruneStaleChatSettings);
 * this module just owns the schedule. Runs once on startup and then on
 * a schedule — both configurable (SETTINGS_PRUNE_ENABLED,
 * SETTINGS_PRUNE_INTERVAL_HOURS, SETTINGS_PRUNE_MAX_AGE_DAYS). Mirrors
 * updateCheck.ts.
 */

import { pruneStaleChatSettings } from "#settingsdb";
import {
  SETTINGS_PRUNE_ENABLED,
  SETTINGS_PRUNE_MAX_AGE_DAYS,
  SETTINGS_PRUNE_INTERVAL_HOURS,
} from "#config";
import { logger } from "#logger";

/**
 * Runs a single prune pass. Safe to call anytime (startup, interval,
 * manual trigger) — never throws.
 */
export function runSettingsPrune(): void {
  if (!SETTINGS_PRUNE_ENABLED) return;

  try {
    const purged = pruneStaleChatSettings(SETTINGS_PRUNE_MAX_AGE_DAYS);
    if (purged.length > 0) {
      logger.info(
        `[settingsPrune] purged settings for ${purged.length} inactive chat(s) ` +
        `(no ctx.settings use in > ${SETTINGS_PRUNE_MAX_AGE_DAYS}d): ${purged.join(", ")}`
      );
    }
  } catch (e) {
    logger.warn(`[settingsPrune] prune failed (non-fatal): ${(e as Error).message}`);
  }
}

let intervalTimer: NodeJS.Timeout | null = null;

/**
 * Runs one prune pass immediately, then schedules recurring passes
 * every SETTINGS_PRUNE_INTERVAL_HOURS. Safe to call multiple times — a
 * second call is a no-op while a schedule is already running.
 */
export function startSettingsPruneSchedule(): void {
  if (!SETTINGS_PRUNE_ENABLED || intervalTimer) return;

  runSettingsPrune();

  intervalTimer = setInterval(runSettingsPrune, SETTINGS_PRUNE_INTERVAL_HOURS * 60 * 60 * 1000);
  intervalTimer.unref();
}

export function stopSettingsPruneSchedule(): void {
  if (!intervalTimer) return;
  clearInterval(intervalTimer);
  intervalTimer = null;
}
