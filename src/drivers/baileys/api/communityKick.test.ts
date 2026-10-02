import assert from "node:assert/strict";
import { describe, test, beforeEach, afterEach } from "node:test";

import { createStore } from "#client/store.js";
import { buildSetupApi, cleanupPluginEvents } from "#kernel/pluginApi.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import { __setAdminActionTimingForTests } from "#kernel/sendGuard.js";
import { CommunityKickError, type WaContract, type GroupKickOutcome } from "#kernel/waContract.js";
import { __resetGroupMetaCacheForTests, __setKickCascadeDelayForTests } from "#drivers/baileys/api/index.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";

const RAW_SOCK = Symbol.for("manybot.baileys.rawSocket");

const COMMUNITY = "120363100000000001@g.us";
const ANNOUNCE  = "120363100000000002@g.us";
const GENERAL   = "120363100000000003@g.us";
const OFFTOPIC  = "120363100000000004@g.us";
const PLAIN     = "120363100000000009@g.us";

const BOT     = "5516999999999@s.whatsapp.net";
const OWNER   = "5516888888888@s.whatsapp.net";
const TARGET  = "5516777777777@s.whatsapp.net";
const OTHER   = "5516666666666@s.whatsapp.net";

type Role = "admin" | "superadmin" | null;
type Participant = { id: string; jid?: string; lid?: string; admin: Role };

interface RawGroup {
  id: string;
  subject: string;
  isCommunity?: boolean;
  isCommunityAnnounce?: boolean;
  linkedParent?: string;
  participants: Participant[];
}

function memberList(overrides: Partial<Record<"bot" | "target" | "other", Participant | null>> = {}): Participant[] {
  const list: Participant[] = [
    { id: OWNER, admin: "superadmin" },
    overrides.bot === undefined ? { id: BOT, admin: "admin" } : overrides.bot,
    overrides.target === undefined ? { id: TARGET, admin: null } : overrides.target,
    overrides.other === undefined ? { id: OTHER, admin: null } : overrides.other,
  ].filter((p): p is Participant => !!p);
  return list;
}

function buildCommunity(): Record<string, RawGroup> {
  return {
    // A Community's own metadata only ever lists its admins.
    [COMMUNITY]: {
      id: COMMUNITY, subject: "Community", isCommunity: true,
      participants: [{ id: OWNER, admin: "superadmin" }, { id: BOT, admin: "admin" }],
    },
    [ANNOUNCE]: {
      id: ANNOUNCE, subject: "Announcements", isCommunityAnnounce: true, linkedParent: COMMUNITY,
      participants: memberList(),
    },
    [GENERAL]: { id: GENERAL, subject: "General", linkedParent: COMMUNITY, participants: memberList() },
    [OFFTOPIC]: { id: OFFTOPIC, subject: "Off-topic", linkedParent: COMMUNITY, participants: memberList() },
    [PLAIN]: { id: PLAIN, subject: "Unrelated group", participants: memberList() },
  };
}

interface Harness {
  contract: WaContract;
  groups: Record<string, RawGroup>;
  removeCalls: Array<{ jid: string; users: string[] }>;
  communityCalls: Array<{ jid: string; users: string[]; action: string }>;
  metadataCalls: string[];
  fetchAllCalls: { count: number };
  respond: (jid: string, users: string[]) => Promise<Array<{ status: string; jid?: string }>>;
  setRespond(fn: Harness["respond"]): void;
}

function makeHarness(): Harness {
  const groups = buildCommunity();
  const h = {} as Harness;
  h.groups = groups;
  h.removeCalls = [];
  h.communityCalls = [];
  h.metadataCalls = [];
  h.fetchAllCalls = { count: 0 };
  h.respond = async (_jid, users) => users.map((u) => ({ status: "200", jid: u }));
  h.setRespond = (fn) => { h.respond = fn; };

  const contract = {
    name: "baileys" as const,
    connect: async () => {},
    disconnect: async () => {},
    isReady: () => true,
    on: () => () => {},
    me: () => ({ id: BOT, lid: "99999@lid" }),
    groupMetadata: async () => { throw new Error("neutral groupMetadata() must not be used"); },
    groupParticipantsUpdate: async (jid: string, users: string[], action: string) => {
      assert.equal(action, "remove");
      h.removeCalls.push({ jid, users });
      return h.respond(jid, users);
    },
    communityParticipantsUpdate: async (jid: string, users: string[], action: string) => {
      h.communityCalls.push({ jid, users, action });
      return users.map((u) => ({ status: "200", jid: u }));
    },
  } as unknown as WaContract;

  (contract as unknown as Record<symbol, unknown>)[RAW_SOCK] = {
    groupMetadata: async (jid: string) => {
      h.metadataCalls.push(jid);
      const g = groups[jid];
      if (!g) throw new Error(`item-not-found: ${jid}`);
      return g;
    },
    groupFetchAllParticipating: async () => {
      h.fetchAllCalls.count++;
      return groups;
    },
  };

  h.contract = contract;
  return h;
}

describe("drivers/baileys/api — admin.kick() Community cascade", () => {
  let h: Harness;
  let admin: ReturnType<typeof buildSetupApi>["admin"];

  beforeEach(() => {
    _resetDriverManagerForTests();
    __resetGroupMetaCacheForTests();
    __setKickCascadeDelayForTests(0);
    __setAdminActionTimingForTests({ gapMs: 0, retryBaseMs: 1 });
    h = makeHarness();
    getDriverManager().register(h.contract, { isPrimary: true });
    admin = buildSetupApi(h.contract, createStore(), new Map<string, PluginEntry>(), "kick_plugin").admin;
  });

  afterEach(() => {
    cleanupPluginEvents("kick_plugin", h.contract);
    _resetDriverManagerForTests();
    __setKickCascadeDelayForTests(null);
    __setAdminActionTimingForTests(null);
  });

  const removedIn = () => h.removeCalls.map((c) => c.jid);

  describe("scope", () => {
    test("kick in the announcements group removes from every linked group, announcements last", async () => {
      const outcomes = (await admin.kick(TARGET).to(ANNOUNCE)) as GroupKickOutcome[];

      assert.deepEqual(removedIn(), [GENERAL, OFFTOPIC, ANNOUNCE]);
      assert.ok(h.removeCalls.every((c) => c.users.length === 1 && c.users[0] === TARGET));
      assert.deepEqual(outcomes.map((o) => o.status), ["removed", "removed", "removed"]);
      assert.equal(outcomes.at(-1)?.isAnnounce, true);
    });

    test("kick on the Community itself does the same, even though it only lists admins", async () => {
      await admin.kick(TARGET).to(COMMUNITY);

      assert.deepEqual(removedIn(), [GENERAL, OFFTOPIC, ANNOUNCE]);
      assert.ok(!removedIn().includes(COMMUNITY), "the Community jid is not a real chat — never a target");
    });

    test("never uses the Community-level protocol operation for a kick", async () => {
      await admin.kick(TARGET).to(COMMUNITY);
      await admin.kick(TARGET).to(ANNOUNCE);
      assert.equal(h.communityCalls.length, 0);
    });

    test("kick in an ordinary linked group (General) stays local", async () => {
      const outcomes = (await admin.kick(TARGET).to(GENERAL)) as GroupKickOutcome[];

      assert.deepEqual(removedIn(), [GENERAL]);
      assert.equal(outcomes.length, 1);
      assert.equal(outcomes[0].status, "removed");
      assert.equal(h.fetchAllCalls.count, 0, "no Community scan for a local kick");
    });

    test("kick in a group that belongs to no Community stays local", async () => {
      await admin.kick(TARGET).to(PLAIN);
      assert.deepEqual(removedIn(), [PLAIN]);
    });

    test("local kick still throws a plain Error when WhatsApp rejects it", async () => {
      h.setRespond(async (_j, users) => users.map((u) => ({ status: "403", jid: u })));

      await assert.rejects(
        async () => { await admin.kick(TARGET).to(PLAIN); },
        (err: unknown) => err instanceof Error && !(err instanceof CommunityKickError) && /rejected/.test(err.message),
      );
    });
  });

  describe("member resolution", () => {
    test("skips groups the target is not in (not_member) without an error or a request", async () => {
      h.groups[OFFTOPIC].participants = memberList({ target: null });

      const outcomes = (await admin.kick(TARGET).to(ANNOUNCE)) as GroupKickOutcome[];

      assert.deepEqual(removedIn(), [GENERAL, ANNOUNCE]);
      const off = outcomes.find((o) => o.groupId === OFFTOPIC);
      assert.equal(off?.status, "not_member");
    });

    test("resolves the member per group — LID-addressed in one group, phone-addressed in another", async () => {
      h.groups[OFFTOPIC].participants = memberList({ target: { id: "777001@lid", jid: TARGET, admin: null } });

      await admin.kick(TARGET).to(ANNOUNCE);

      assert.deepEqual(h.removeCalls.find((c) => c.jid === OFFTOPIC)?.users, ["777001@lid"]);
      assert.deepEqual(h.removeCalls.find((c) => c.jid === GENERAL)?.users, [TARGET]);
    });

    test("accepts a bare phone number", async () => {
      await admin.kick("5516777777777").to(ANNOUNCE);
      assert.deepEqual(removedIn(), [GENERAL, OFFTOPIC, ANNOUNCE]);
    });

    test("removes several members in one request per group", async () => {
      await admin.kick([TARGET, OTHER]).to(ANNOUNCE);

      assert.equal(h.removeCalls.length, 3);
      for (const call of h.removeCalls) assert.deepEqual([...call.users].sort(), [OTHER, TARGET].sort());
    });

    test("nobody found anywhere is not an error — every group is not_member", async () => {
      const outcomes = (await admin.kick("5511000000000").to(ANNOUNCE)) as GroupKickOutcome[];

      assert.equal(h.removeCalls.length, 0);
      assert.ok(outcomes.length > 0 && outcomes.every((o) => o.status === "not_member"));
    });
  });

  describe("stale metadata", () => {
    test("a 404 on remove (already gone, cache stale) is not_member, not a failure", async () => {
      h.setRespond(async (jid, users) =>
        users.map((u) => ({ status: jid === GENERAL ? "404" : "200", jid: u })),
      );

      const outcomes = (await admin.kick(TARGET).to(ANNOUNCE)) as GroupKickOutcome[];

      assert.equal(outcomes.find((o) => o.groupId === GENERAL)?.status, "not_member");
      assert.deepEqual(outcomes.filter((o) => o.status === "removed").map((o) => o.groupId), [OFFTOPIC, ANNOUNCE]);
    });

    test("drops cached metadata of every group it tried to remove from", async () => {
      await admin.kick(TARGET).to(ANNOUNCE);
      h.metadataCalls.length = 0;

      await admin.kick(TARGET).to(ANNOUNCE);

      assert.deepEqual([...h.metadataCalls].sort(), [ANNOUNCE, GENERAL, OFFTOPIC].sort());
    });
  });

  describe("partial failure", () => {
    test("throws CommunityKickError carrying every group's outcome", async () => {
      h.setRespond(async (jid, users) =>
        users.map((u) => ({ status: jid === OFFTOPIC ? "403" : "200", jid: u })),
      );

      await assert.rejects(
        async () => { await admin.kick(TARGET).to(ANNOUNCE); },
        (err: unknown) => {
          assert.ok(err instanceof CommunityKickError);
          assert.equal(err.name, "CommunityKickError");
          assert.equal(err.results.length, 3);
          assert.deepEqual(err.removed.map((r) => r.groupId), [GENERAL, ANNOUNCE]);
          assert.deepEqual(err.failed.map((r) => r.groupId), [OFFTOPIC]);
          assert.match(err.message, /Removed from 2 of 3/);
          assert.match(err.message, /Off-topic \(not_admin\)/);
          return true;
        },
      );
    });

    test("a failure does not stop the remaining groups — announcements is still processed", async () => {
      h.setRespond(async (jid, users) =>
        users.map((u) => ({ status: jid === GENERAL ? "403" : "200", jid: u })),
      );

      await assert.rejects(async () => { await admin.kick(TARGET).to(COMMUNITY); }, CommunityKickError);

      assert.deepEqual(removedIn(), [GENERAL, OFFTOPIC, ANNOUNCE]);
    });

    test("a thrown request error becomes a failed outcome and the loop continues", async () => {
      h.setRespond(async (jid, users) => {
        if (jid === GENERAL) throw new Error("connection closed");
        return users.map((u) => ({ status: "200", jid: u }));
      });

      const err = await admin.kick(TARGET).to(ANNOUNCE).then(
        () => null,
        (e: unknown) => e as CommunityKickError,
      );

      assert.ok(err instanceof CommunityKickError);
      const failed = err.failed[0];
      assert.equal(failed.groupId, GENERAL);
      assert.equal(failed.reason, "unknown");
      assert.match(failed.message ?? "", /connection closed/);
      assert.deepEqual(err.removed.map((r) => r.groupId), [OFFTOPIC, ANNOUNCE]);
    });

    test("maps WhatsApp status codes to a reason and keeps the raw code", async () => {
      const statusByGroup: Record<string, string> = { [GENERAL]: "401", [OFFTOPIC]: "408", [ANNOUNCE]: "429" };
      h.setRespond(async (jid, users) => users.map((u) => ({ status: statusByGroup[jid], jid: u })));

      const err = await admin.kick(TARGET).to(ANNOUNCE).then(
        () => null,
        (e: unknown) => e as CommunityKickError,
      );

      assert.ok(err instanceof CommunityKickError);
      const byGroup = Object.fromEntries(err.failed.map((r) => [r.groupId, r]));
      assert.deepEqual(
        [byGroup[GENERAL].reason, byGroup[GENERAL].code],
        ["not_admin", "401"],
      );
      assert.deepEqual([byGroup[OFFTOPIC].reason, byGroup[OFFTOPIC].code], ["timeout", "408"]);
      assert.deepEqual([byGroup[ANNOUNCE].reason, byGroup[ANNOUNCE].code], ["rate_limited", "429"]);
    });

    test("an unrecognised status code is reported as unknown", async () => {
      h.setRespond(async (_j, users) => users.map((u) => ({ status: "500", jid: u })));

      const err = await admin.kick(TARGET).to(ANNOUNCE).then(
        () => null,
        (e: unknown) => e as CommunityKickError,
      );

      assert.ok(err instanceof CommunityKickError);
      assert.ok(err.failed.every((r) => r.reason === "unknown" && r.code === "500"));
      assert.equal(err.removed.length, 0);
    });
  });

  describe("pre-checks that avoid pointless requests", () => {
    test("bot is not admin in a group → not_admin, and no request is sent there", async () => {
      h.groups[OFFTOPIC].participants = memberList({ bot: { id: BOT, admin: null } });

      const err = await admin.kick(TARGET).to(ANNOUNCE).then(
        () => null,
        (e: unknown) => e as CommunityKickError,
      );

      assert.ok(err instanceof CommunityKickError);
      assert.deepEqual(err.failed.map((r) => [r.groupId, r.reason]), [[OFFTOPIC, "not_admin"]]);
      assert.ok(!removedIn().includes(OFFTOPIC));
      assert.deepEqual(removedIn(), [GENERAL, ANNOUNCE]);
    });

    test("bot admin status is read from the LID too", async () => {
      h.groups[GENERAL].participants = memberList({ bot: { id: "99999@lid", admin: "admin" } });

      await admin.kick(TARGET).to(ANNOUNCE);

      assert.ok(removedIn().includes(GENERAL));
    });

    test("target is the group owner → target_superadmin, and no request is sent there", async () => {
      h.groups[GENERAL].participants = memberList({ target: { id: TARGET, admin: "superadmin" } });

      const err = await admin.kick(TARGET).to(ANNOUNCE).then(
        () => null,
        (e: unknown) => e as CommunityKickError,
      );

      assert.ok(err instanceof CommunityKickError);
      assert.deepEqual(err.failed.map((r) => [r.groupId, r.reason]), [[GENERAL, "target_superadmin"]]);
      assert.ok(!removedIn().includes(GENERAL));
      assert.deepEqual(removedIn(), [OFFTOPIC, ANNOUNCE]);
    });

    test("refuses to remove the bot itself, before sending any request", async () => {
      await assert.rejects(
        async () => { await admin.kick(BOT).to(ANNOUNCE); },
        /Refusing to remove the bot itself/,
      );
      assert.equal(h.removeCalls.length, 0);
    });
  });

  describe("cost", () => {
    test("reuses the metadata from the single account scan instead of one lookup per group", async () => {
      await admin.kick(TARGET).to(ANNOUNCE);

      assert.equal(h.fetchAllCalls.count, 1);
      assert.ok(!h.metadataCalls.includes(GENERAL), "General metadata should come from the scan");
      assert.ok(!h.metadataCalls.includes(OFFTOPIC), "Off-topic metadata should come from the scan");
    });

    test("pauses between removals, but not before the first one", async () => {
      __setKickCascadeDelayForTests(30);

      const started = Date.now();
      await admin.kick(TARGET).to(ANNOUNCE);
      const elapsed = Date.now() - started;

      assert.ok(elapsed >= 50, `expected ≥2 pauses of 30ms, got ${elapsed}ms`);
    });

    test("skipped groups do not add a pause", async () => {
      __setKickCascadeDelayForTests(200);
      h.groups[GENERAL].participants = memberList({ target: null });
      h.groups[OFFTOPIC].participants = memberList({ target: null });

      const started = Date.now();
      await admin.kick(TARGET).to(ANNOUNCE);

      assert.ok(Date.now() - started < 150, "a single removal needs no pause");
    });
  });
});
