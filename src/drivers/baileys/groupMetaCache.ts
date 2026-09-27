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
  communityGroupsCache.clear();
  communityGroupsInflight.clear();
}

// ── Community groups cache ──────────────────────────────────────────────────
//
// `ctx.chat.getGroups()` (Community objects only) needs the full account
// group list (`groupFetchAllParticipating()`) filtered by `linkedParent` —
// there's no cheaper native way to list a Community's linked groups. That
// full-account scan is expensive, so cache the filtered result per
// Community jid with the same TTL as group metadata, deduped in-flight the
// same way as `loadGroupMeta`.

export type WACommunityGroup = { id: string; name: string };

const communityGroupsCache    = new Map<string, { groups: WACommunityGroup[]; at: number }>();
const communityGroupsInflight = new Map<string, Promise<WACommunityGroup[]>>();

export function peekCommunityGroups(communityJid: string): WACommunityGroup[] | undefined {
  const entry = communityGroupsCache.get(communityJid);
  return entry && Date.now() - entry.at < TTL_MS ? entry.groups : undefined;
}

/** Drops every cached Community's group list — used when a new group is
 *  linked (`groups.upsert`), since we don't cheaply know which Community
 *  it joined without re-fetching. Coarser than per-jid invalidation, but
 *  `groups.upsert` is rare enough that this is not a concern. */
export function clearCommunityGroupsCache(): void {
  communityGroupsCache.clear();
  communityGroupsInflight.clear();
}

export function loadCommunityGroups(
  communityJid: string,
  fetcher: (communityJid: string) => Promise<WACommunityGroup[]>,
): Promise<WACommunityGroup[]> {
  const hit = peekCommunityGroups(communityJid);
  if (hit) return Promise.resolve(hit);

  const pending = communityGroupsInflight.get(communityJid);
  if (pending) return pending;

  const request: Promise<WACommunityGroup[]> = fetcher(communityJid)
    .then((groups) => {
      if (communityGroupsInflight.get(communityJid) === request) {
        communityGroupsCache.set(communityJid, { groups, at: Date.now() });
      }
      return groups;
    })
    .finally(() => {
      if (communityGroupsInflight.get(communityJid) === request) communityGroupsInflight.delete(communityJid);
    });

  communityGroupsInflight.set(communityJid, request);
  return request;
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

