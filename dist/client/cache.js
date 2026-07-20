/**
 * client/cache.ts
 *
 * Persists the store's chats/contacts/lidMap snapshot to disk.
 *
 * Why: an already-linked WhatsApp session doesn't get a full history
 * resync on reconnect — only a partial, non-deterministic slice of it
 * (see drivers/whatsapp/index.ts). Each fresh process starts with an
 * empty in-memory store, so without a cache, chats seen in a previous
 * run can silently disappear from the current one.
 *
 * Consumers must always merge (store.hydrate), never replace: a stale
 * cache is still strictly better than an empty store.
 */
import fs from "fs/promises";
import path from "path";
import { CONFIG_DIR, CLIENT_ID } from "#config";
import { logger } from "#logger";
export const DEFAULT_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function cacheFilePath(clientId = CLIENT_ID) {
    return path.join(CONFIG_DIR, "cache", `${clientId}.chats.json`);
}
async function readCacheFile(clientId) {
    try {
        const raw = await fs.readFile(cacheFilePath(clientId), "utf-8");
        return JSON.parse(raw);
    }
    catch (e) {
        if (e.code !== "ENOENT") {
            logger.warn(`[cache] Failed to read chat cache: ${e.message}`);
        }
        return null;
    }
}
/** Loads the last saved snapshot, or null if none exists / it's corrupt. */
export async function loadChatCache(clientId = CLIENT_ID) {
    const file = await readCacheFile(clientId);
    return file?.snapshot ?? null;
}
/** Whether the cache on disk was saved within `maxAgeMs`. Informational only — never gates hydration. */
export async function isCacheFresh(clientId = CLIENT_ID, maxAgeMs = DEFAULT_MAX_CACHE_AGE_MS) {
    const file = await readCacheFile(clientId);
    if (!file)
        return false;
    return Date.now() - file.savedAt < maxAgeMs;
}
/** Writes the store's current snapshot to disk (atomic write via tmp + rename). */
export async function saveChatCache(store, clientId = CLIENT_ID) {
    const target = cacheFilePath(clientId);
    const tmp = `${target}.tmp`;
    const file = { savedAt: Date.now(), snapshot: store.toJSON() };
    try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(file), "utf-8");
        await fs.rename(tmp, target);
    }
    catch (e) {
        logger.warn(`[cache] Failed to save chat cache: ${e.message}`);
    }
}
