import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";

import { createStore } from "#client/store.js";
import type { BotMessage, WaContract, GroupParticipantsUpdateEvent, BotGroupMetadata } from "#kernel/waContract.js";
import { buildChatFromMsg, buildApi, __resetGroupMetaCacheForTests } from "#drivers/baileys/api/index.js";
import { normalizeJid } from "#drivers/jid.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";

const RAW_SOCK = Symbol.for("manybot.baileys.rawSocket");
const GROUP_JID = "120363000000000000@g.us";
const ADMIN_JID = "5511999999999@s.whatsapp.net";
const BOT_JID   = "5511900000000@s.whatsapp.net";

/** Raw Baileys `groupMetadata()` participant shape — `admin` is a string
 *  enum (`"admin" | "superadmin" | null`), NOT the neutral boolean
 *  `isAdmin`/`isSuperAdmin` pair `WaContract.groupMetadata()` (the neutral,
 *  cross-driver method) exposes. `getGroupMetadataCached()`/
 *  `getGroupMetadataFresh()` both go through the raw sock (via the
 *  `RAW_SOCK` symbol, see `fakeContract` below) and return this raw shape
 *  untouched — only `getParticipants()` maps it to the neutral one. Any
 *  mock feeding `isAdmin()`/`isSenderAdmin()`/`isBotAdmin()` must use
 *  `admin`, not `isAdmin`.
 */
interface RawGroupMetadata {
  subject: string;
  participants: Array<{ id: string; admin: "admin" | "superadmin" | null }>;
}

function fakeMsg(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    id: "m1",
    chatId: GROUP_JID,
    fromMe: false,
    contentHash: "h",
    timestamp: Date.now(),
    type: "text",
    body: "hi",
    fromPn: ADMIN_JID,
    ...overrides,
  } as BotMessage;
}

/** Fake contract with a real listener registry (unlike a no-op mock) so we
 *  can actually exercise bindGroupMetaInvalidation's subscription.
 *
 *  Two DIFFERENT `groupMetadata` implementations are wired in deliberately:
 *  - `contract.groupMetadata` satisfies `WaContract`'s neutral interface
 *    method (isAdmin/isSuperAdmin booleans) — required for the type, but
 *    NOT the path `getGroupMetadataFresh`/`getGroupMetadataCached` call.
 *    It returns an obviously-different, always-empty result so the test
 *    fails loudly if code under test ever starts reading it by mistake.
 *  - `[RAW_SOCK].groupMetadata` returns the raw Baileys shape (`admin`
 *    string enum) — this is the ONE actually read by isAdmin() and friends
 *    (via `rawSocketOf(contract)`), and the one tests should configure.
 */
function fakeContract(rawGroupMetadata: () => Promise<RawGroupMetadata>): {
  contract: WaContract;
  emitParticipantsUpdate: (evt: GroupParticipantsUpdateEvent) => void;
} {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  const neverCalledNeutralGroupMetadata = async (): Promise<BotGroupMetadata> => {
    throw new Error(
      "contract.groupMetadata() (the neutral interface method) was called — " +
      "isAdmin()/isSenderAdmin()/isBotAdmin() are expected to read " +
      "[RAW_SOCK].groupMetadata() instead, via rawSocketOf(contract)."
    );
  };

  const contract = {
    name: "baileys" as const,
    connect: async () => {},
    disconnect: async () => {},
    isReady: () => true,
    on: (event: string, handler: (payload: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    sendText: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendImage: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendVideo: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendAudio: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendSticker: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendDocument: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    sendPoll: async () => ({ id: "x", chatId: GROUP_JID, timestamp: Date.now() }),
    react: async () => {},
    deleteMessage: async () => {},
    editMessage: async () => {},
    sendPresenceUpdate: async () => {},
    readMessages: async () => {},
    onWhatsApp: async () => [{ exists: true }],
    getBusinessProfile: async () => null,
    profilePictureUrl: async () => null,
    fetchStatus: async () => null,
    updateBlockStatus: async () => {},
    addOrEditContact: async () => {},
    removeContact: async () => {},
    groupMetadata: neverCalledNeutralGroupMetadata,
    groupParticipantsUpdate: async () => [],
    groupUpdateSubject: async () => {},
    groupUpdateDescription: async () => {},
    groupInviteCode: async () => "",
    groupRevokeInvite: async () => "",
    updateProfilePicture: async () => {},
    updateProfileName: async () => {},
    updateProfileStatus: async () => {},
    me: () => ({ id: BOT_JID }),
    downloadMedia: async () => null,
    getHistory: async () => [],
  } as unknown as WaContract;

  (contract as unknown as Record<symbol, unknown>)[RAW_SOCK] = { groupMetadata: rawGroupMetadata };

  return {
    contract,
    emitParticipantsUpdate: (evt) => {
      for (const h of handlers.get("group-participants.update") ?? []) h(evt);
    },
  };
}

async function buildCtx(contract: WaContract, msg: BotMessage = fakeMsg()) {
  const store = createStore();
  const wachat = await buildChatFromMsg(msg, store, contract);
  return buildApi({
    msg,
    chat: wachat,
    contract,
    store,
    pluginRegistry: new Map<string, PluginEntry>(),
    pluginName: "testPlugin",
  });
}

describe("drivers/baileys/api — group metadata cache invalidation", () => {
  beforeEach(() => {
    __resetGroupMetaCacheForTests();
  });

  test("isAdmin() reflects a demote immediately, even without an invalidating event", async () => {
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: ADMIN_JID, admin }],
    }));

    const ctx = await buildCtx(contract);

    assert.equal(await ctx.chat.isAdmin(ADMIN_JID), true);

    // isAdmin()/isSenderAdmin()/isBotAdmin() bypass the group-metadata TTL
    // cache entirely (they gate the `admin:`/`botAdmin:` command
    // permission), so a demote is reflected on the very next call —
    // no reliance on `group-participants.update` actually firing.
    admin = null;
    assert.equal(await ctx.chat.isAdmin(ADMIN_JID), false);
  });

  test("isAdmin() still correct if a group-participants.update happens to fire too (regression only — the event is NOT required)", async () => {
    // This is a pure regression/documentation test: since isAdmin() no
    // longer reads the cache at all, this exercises the exact same
    // getGroupMetadataFresh() path as the test above — an event firing
    // in between changes nothing. It exists only to pin down that wiring
    // bindGroupMetaInvalidation's listener doesn't somehow interfere with
    // (e.g. double-fetch, throw on) a fresh-path call. It does NOT prove
    // isAdmin() depends on the event — it doesn't, by design.
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract, emitParticipantsUpdate } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: ADMIN_JID, admin }],
    }));

    const ctx = await buildCtx(contract);

    assert.equal(await ctx.chat.isAdmin(ADMIN_JID), true);

    admin = null;
    emitParticipantsUpdate({
      id: GROUP_JID,
      author: BOT_JID,
      participants: [ADMIN_JID],
      action: "demote",
    });

    assert.equal(await ctx.chat.isAdmin(ADMIN_JID), false);
  });

  test("isSenderAdmin() matches when the sender is only known by PN (no LID in the message)", async () => {
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: ADMIN_JID, admin }],
    }));

    // Only fromPn is set — no fromLid/participantAlt/remoteJidAlt at all —
    // and the participant list is keyed by the same PN form. This forces
    // isSenderAdmin() through its PN path rather than its LID path.
    const ctx = await buildCtx(contract, fakeMsg({ fromPn: ADMIN_JID, fromLid: undefined, participantAlt: undefined }));

    assert.equal(await ctx.chat.isSenderAdmin(), true);

    admin = null;
    assert.equal(await ctx.chat.isSenderAdmin(), false);
  });

  test("isSenderAdmin() matches when the sender is only known by LID (no PN in the message)", async () => {
    const SENDER_LID = "234567890123456@lid";
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: SENDER_LID, admin }],
    }));

    // Only fromLid is set — no fromPn at all — and the participant list is
    // keyed by that same LID form. This forces isSenderAdmin() through its
    // LID path rather than its PN path.
    const ctx = await buildCtx(contract, fakeMsg({ fromPn: undefined, fromLid: SENDER_LID, participantAlt: undefined }));

    assert.equal(await ctx.chat.isSenderAdmin(), true);

    admin = null;
    assert.equal(await ctx.chat.isSenderAdmin(), false);
  });

  test("isSenderAdmin() is false for a sender absent from the participant list", async () => {
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: "5511888888888@s.whatsapp.net", admin: "admin" }],
    }));

    const ctx = await buildCtx(contract, fakeMsg({ fromPn: ADMIN_JID }));

    assert.equal(await ctx.chat.isSenderAdmin(), false);
  });

  test("isBotAdmin() reflects the bot's own demote", async () => {
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: BOT_JID, admin }],
    }));

    const ctx = await buildCtx(contract);

    assert.equal(await ctx.chat.isBotAdmin(), true);

    admin = null;
    assert.equal(await ctx.chat.isBotAdmin(), false);
  });

  test("isBotAdmin() is false when the bot has no usable id (empty candidates guard)", async () => {
    // Reuses fakeContract (same full shape exercised everywhere else in
    // this file) instead of a hand-rolled partial contract, so a missing
    // method surfaces as an actual bug in the guard/call path, not as an
    // incomplete mock. Only `me` is overridden afterward.
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: BOT_JID, admin: "admin" }],
    }));
    // fakeContract's default me() only ever returns `{ id }` (no `lid`
    // field). Confirmed by the assert below (not by this comment): with
    // id overridden to "", botCandidates ends up entirely empty in this
    // scenario, whatever botLid's real source in index.ts turns out to
    // be — this only needs both entries empty, not any specific mechanism.
    contract.me = () => ({ id: "" });

    const ctx = await buildCtx(contract);

    assert.equal(await ctx.chat.isBotAdmin(), false);
  });

  test("getParticipants() (informational, not a permission gate) may still serve cached data", async () => {
    let admin: "admin" | "superadmin" | null = "admin";
    const { contract } = fakeContract(async () => ({
      subject: "Group",
      participants: [{ id: ADMIN_JID, admin }],
    }));

    const ctx = await buildCtx(contract);

    // The first call is what populates groupMetaCache — that's the whole
    // point being tested here. If buildChatFromMsg or buildApi ever start
    // pre-warming the cache themselves before this point, this test would
    // need the cache seeded a different way; keep this call first.
    const first = await ctx.chat.getParticipants();
    assert.equal(first.find(p => p.id === normalizeJid(ADMIN_JID))?.isAdmin, true);

    // No invalidating event fired — this documents the intentional TTL
    // tradeoff for the informational (non-permission-gating) read path.
    admin = null;
    const second = await ctx.chat.getParticipants();
    assert.equal(second.find(p => p.id === normalizeJid(ADMIN_JID))?.isAdmin, true);
  });
});
