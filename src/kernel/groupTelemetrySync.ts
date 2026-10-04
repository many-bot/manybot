/**
 * kernel/groupTelemetrySync.ts
 *
 * Driver-agnostic reconciliation of the telemetry `group` table with the
 * account's real group list. Event hooks (groups.upsert / participants
 * remove) miss joins and leaves that happen while the bot is offline; this
 * catches up on connect. See `syncGroups` in telemetryDb.ts for the rules.
 */

import { logger } from "#logger";
import {
  getGroupSyncedAt,
  markGroupSynced,
  syncGroups,
  type GroupSyncResult,
} from "#kernel/telemetryDb.js";

export const GROUP_SYNC_MIN_INTERVAL_S = 60 * 60;

let running = false;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Runs at most once per `GROUP_SYNC_MIN_INTERVAL_S` (persisted, so frequent
 * restarts/reconnects don't repeat the expensive scan). Never throws.
 * Returns `null` when throttled, already running or the fetch failed.
 */
export async function syncGroupTelemetry(
  fetchJids: () => Promise<string[]>,
  now: () => number = nowSeconds,
): Promise<GroupSyncResult | null> {
  if (running) {
    logger.debug("[telemetry] group sync already in progress — skipped");
    return null;
  }

  // Captured before the fetch: events recorded during it are newer than the snapshot.
  const snapshotAt = now();
  const last = getGroupSyncedAt();
  if (last !== null && snapshotAt - last < GROUP_SYNC_MIN_INTERVAL_S) {
    logger.debug(`[telemetry] group sync throttled (last ran ${snapshotAt - last}s ago)`);
    return null;
  }

  running = true;
  try {
    const jids = await fetchJids();
    const result = syncGroups(jids, snapshotAt);

    if (result.skipped) {
      logger.warn("[telemetry] group scan returned no groups while some are active — ignored");
      return result;
    }

    // An empty scan is ambiguous (nothing to reconcile vs. a failed fetch), so it never counts as synced.
    if (jids.length > 0) markGroupSynced(snapshotAt);

    logger.debug(
      `[telemetry] group sync: +${result.added} new, ${result.reactivated} reactivated, ` +
      `${result.closed} closed, ${result.active} active`,
    );
    return result;
  } catch (err) {
    logger.warn(`[telemetry] group sync failed: ${(err as Error).message}`);
    return null;
  } finally {
    running = false;
  }
}
