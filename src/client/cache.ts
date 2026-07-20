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
import type { StoreSnapshot, BotStore } from "./store.js";

export const DEFAULT_MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheFile {
  savedAt:  number;
  snapshot: StoreSnapshot;
}

function cacheFilePath(clientId: string = CLIENT_ID): string {
  return path.join(CONFIG_DIR, "cache", `${clientId}.chats.json`);
}

async function readCacheFile(clientId: string): Promise<CacheFile | null> {
  try {
    const raw = await fs.readFile(cacheFilePath(clientId), "utf-8");
    return JSON.parse(raw) as CacheFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`[cache] Failed to read chat cache: ${(e as Error).message}`);
    }
    return null;
  }
}

/** Loads the last saved snapshot, or null if none exists / it's corrupt. */
export async function loadChatCache(clientId: string = CLIENT_ID): Promise<StoreSnapshot | null> {
  const file = await readCacheFile(clientId);
  return file?.snapshot ?? null;
}

/** Whether the cache on disk was saved within `maxAgeMs`. Informational only — never gates hydration. */
export async function isCacheFresh(
  clientId: string = CLIENT_ID,
  maxAgeMs: number = DEFAULT_MAX_CACHE_AGE_MS,
): Promise<boolean> {
  const file = await readCacheFile(clientId);
  if (!file) return false;
  return Date.now() - file.savedAt < maxAgeMs;
}

/** Writes the store's current snapshot to disk (atomic write via tmp + rename). */
export async function saveChatCache(store: BotStore, clientId: string = CLIENT_ID): Promise<void> {
  const target: string = cacheFilePath(clientId);
  const tmp: string = `${target}.tmp`;
  const file: CacheFile = { savedAt: Date.now(), snapshot: store.toJSON() };

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(file), "utf-8");
    await fs.rename(tmp, target);
  } catch (e) {
    logger.warn(`[cache] Failed to save chat cache: ${(e as Error).message}`);
  }
}
