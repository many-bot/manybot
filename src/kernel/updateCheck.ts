/**
 * updateCheck.ts
 *
 * Compares the locally installed manybot version against the latest
 * GitHub Release and fires an "info" alert (via alerts.ts) when a
 * newer version is available. Runs once on startup and then on a
 * schedule — both configurable (UPDATE_CHECK_ENABLED,
 * UPDATE_CHECK_INTERVAL_HOURS).
 *
 * GitHub Releases is the source of truth for distribution: release
 * candidate tags (-rc.N) skip npm entirely, and stable releases stay
 * in "staged" on npm until a manual 2FA approval lands, so reading
 * registry.npmjs.org here would either miss an already-published
 * version or notify about one only after a long delay.
 *
 * Never throws — a failed check (offline, GitHub down) is logged at
 * debug level and silently skipped; it'll just try again next cycle.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { UPDATE_CHECK_ENABLED, UPDATE_CHECK_INTERVAL_HOURS } from "#config";
import { sendAlert } from "#kernel/alerts.js";
import { logger } from "#logger";
import { t } from "#i18n";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const pkg = JSON.parse(
  readFileSync(path.join(__dirname, "../../package.json"), "utf8")
) as { name: string; version: string };

const GITHUB_RELEASES_LATEST =
  "https://api.github.com/repos/many-bot/manybot/releases/latest";

/** Naive semver compare — good enough for x.y.z, no pre-release handling. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * GitHub tags come prefixed with "v" (e.g. "v5.7.0"). Strip it so we
 * can compare against pkg.version directly and render the upgrade
 * command without the prefix.
 */
function stripTagPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

let alreadyNotifiedFor: string | null = null;

/**
 * Runs a single check. Safe to call anytime (startup, interval, manual
 * trigger) — never throws.
 */
export async function checkForUpdate(): Promise<void> {
  if (!UPDATE_CHECK_ENABLED) return;

  try {
    const res = await fetch(GITHUB_RELEASES_LATEST);
    if (!res.ok) {
      logger.debug(`[updateCheck] GitHub Releases responded ${res.status}`);
      return;
    }
    const data = await res.json() as { tag_name?: string };
    const rawTag = data.tag_name;
    if (!rawTag) return;
    const latest = stripTagPrefix(rawTag);
    if (!isNewer(latest, pkg.version)) return;

    // Don't re-alert every cycle for the same version once already notified.
    if (alreadyNotifiedFor === latest) return;
    alreadyNotifiedFor = latest;

    const releaseUrl = `https://github.com/many-bot/manybot/releases/tag/${rawTag}`;
    await sendAlert({
      level:   "info",
      title:   t("alerts.updateAvailableTitle"),
      message: t("alerts.updateAvailableMessage", {
        installed: pkg.version,
        available: latest,
        url: releaseUrl,
      }) as string,
    });
  } catch (e) {
    logger.debug(`[updateCheck] check failed (non-fatal): ${(e as Error).message}`);
  }
}

let intervalTimer: NodeJS.Timeout | null = null;

/**
 * Runs one check immediately, then schedules recurring checks every
 * UPDATE_CHECK_INTERVAL_HOURS. Safe to call multiple times — a second
 * call is a no-op while a schedule is already running.
 */
export function startUpdateCheckSchedule(): void {
  if (!UPDATE_CHECK_ENABLED || intervalTimer) return;

  checkForUpdate().catch(() => {});

  intervalTimer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, UPDATE_CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function stopUpdateCheckSchedule(): void {
  if (!intervalTimer) return;
  clearInterval(intervalTimer);
  intervalTimer = null;
}
