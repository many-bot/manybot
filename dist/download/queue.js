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
 */
import { logger } from "#logger";
import { t } from "#i18n";
let queue = [];
let processing = false;
/**
 * Add a job to the queue and start processing if idle.
 * @param workFn  All plugin logic — runs exclusively until resolved.
 * @param errorFn Called with the thrown error if workFn rejects.
 */
export function enqueue(workFn, errorFn) {
    queue.push({ workFn, errorFn });
    if (!processing)
        processQueue();
}
async function processQueue() {
    processing = true;
    while (queue.length) {
        const job = queue.shift();
        if (job)
            await processJob(job);
    }
    processing = false;
}
async function processJob({ workFn, errorFn }) {
    try {
        await workFn();
    }
    catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.error(t("system.downloadJobFailed", { message: err.message }));
        try {
            await errorFn(err instanceof Error ? err : new Error(String(err)));
        }
        catch { }
    }
}
