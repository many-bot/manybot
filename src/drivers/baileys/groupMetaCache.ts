import type { RawSocket } from "#drivers/baileys/sdk/baileysSock.js";

export type WAGroupMetadata = Awaited<ReturnType<RawSocket["groupMetadata"]>>;

const TTL_MS = 5 * 60 * 1000;

const cache    = new Map<string, { meta: WAGroupMetadata; at: number }>();
const inflight = new Map<string, Promise<WAGroupMetadata>>();

export function peekGroupMeta(jid: string): WAGroupMetadata | undefined {
  const entry = cache.get(jid);
  return entry && Date.now() - entry.at < TTL_MS ? entry.meta : undefined;
}

export function storeGroupMeta(jid: string, meta: WAGroupMetadata): void {
  cache.set(jid, { meta, at: Date.now() });
}

export function dropGroupMeta(jid: string): void {
  cache.delete(jid);
  inflight.delete(jid);
}

export function clearGroupMetaCache(): void {
  cache.clear();
  inflight.clear();
}

export function loadGroupMeta(
  jid: string,
  fetcher: (jid: string) => Promise<WAGroupMetadata>,
): Promise<WAGroupMetadata> {
  const hit = peekGroupMeta(jid);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(jid);
  if (pending) return pending;

  const request: Promise<WAGroupMetadata> = fetcher(jid)
    .then((meta) => {
      if (inflight.get(jid) === request) storeGroupMeta(jid, meta);
      return meta;
    })
    .finally(() => {
      if (inflight.get(jid) === request) inflight.delete(jid);
    });

  inflight.set(jid, request);
  return request;
}

