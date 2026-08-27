/**
 * src/download/queue.ts
 *
 * Sequential execution queue for heavy jobs (downloads, conversions).
 * Ensures only one job runs at a time — without overloading yt-dlp or ffmpeg.
 *
 * Plugin passes a `workFn` that does everything: download, convert, send.
 * Queue only handles sequence and error handling.
 *
 * Usage:
 *   import { enqueue } from "#download";
 *   enqueue(async () => { ... all plugin logic ... }, onError);
 *
 * `errorFn` is optional — if omitted, a failure is still logged via
 * `logger.warn` so it's never silently swallowed.
 */

import { logger } from "#logger";
import { t }      from "#i18n";

interface Job {
  workFn:  () => Promise<void>;
  errorFn?: (err: Error) => Promise<void>;
}

let queue: Job[] = [];
let processing = false;

/**
 * Add a job to the queue and start processing if idle.
 * @param workFn  All plugin logic — runs exclusively until resolved.
 * @param errorFn Called with the thrown error if workFn rejects. If omitted,
 *                 the error is logged via `logger.warn` instead.
 */
export function enqueue(workFn: () => Promise<void>, errorFn?: (err: Error) => Promise<void>): void {
  queue.push({ workFn, errorFn });
  if (!processing) processQueue();
}

async function processQueue(): Promise<void> {
  processing = true;
  while (queue.length) {
    const job = queue.shift(); if (job) await processJob(job);
  }
  processing = false;
}

async function processJob({ workFn, errorFn }: Job): Promise<void> {
  try {
    await workFn();
  } catch (e) { const err = e instanceof Error ? e : new Error(String(e));
    logger.error(t("system.downloadJobFailed", { message: err.message }));
    if (errorFn) {
      try { await errorFn(err); } catch { }
    } else {
      logger.warn(t("system.downloadJobNoErrorFn"));
    }
  }
}

