/**
 * src/download/queue.js
 *
 * Sequential execution queue for heavy jobs (downloads, conversions).
 * Ensures only one job runs at a time — without overloading yt-dlp or ffmpeg.
 *
 * Plugin passes a `workFn` that does everything: download, convert, send.
 * Queue only handles sequence and error handling.
 *
 * Usage:
 *   import { enqueue } from "../../src/download/queue.js";
 *   enqueue(async () => { ... all plugin logic ... }, onError);
 */

import { logger } from "../logger/logger.js";
import { t }      from "../i18n/index.js";

/**
 * @typedef {{
 *   workFn:   () => Promise<void>,
 *   errorFn:  (err: Error) => Promise<void>,
 * }} Job
 */

/** @type {Job[]} */
let queue = [];
let processing = false;

/**
 * Add job to queue and start processing if idle.
 *
 * @param {Function} workFn   — async () => void  — all plugin logic
 * @param {Function} errorFn  — async (err) => void  — called if workFn throws
 */
export function enqueue(workFn, errorFn) {
  queue.push({ workFn, errorFn });
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (queue.length) {
    await processJob(queue.shift());
  }
  processing = false;
}

async function processJob({ workFn, errorFn }) {
  try {
    await workFn();
  } catch (err) {
    logger.error(t("system.downloadJobFailed", { message: err.message }));
    try { await errorFn(err); } catch { }
  }
}