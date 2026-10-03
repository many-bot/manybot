import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";

import { createStore } from "#client/store.js";
import type { BotMessage, WaContract } from "#kernel/waContract.js";
import { buildChatFromMsg, buildApi, __resetGroupMetaCacheForTests } from "#drivers/baileys/api/index.js";
import type { PluginEntry } from "#kernel/pluginLoader.js";

const RAW_SOCK = Symbol.for("manybot.baileys.rawSocket");
const GROUP_JID = "120363000000000000@g.us";
const DM_JID    = "5511999999999@s.whatsapp.net";
const ADMIN_JID = "5511999999999@s.whatsapp.net";
const BOT_JID   = "5511900000000@s.whatsapp.net";

interface RawGroupMetadata {
  subject: string;
  participants: Array<{ id: string; admin: "admin" | "superadmin" | null }>;
}

function fakeMsg(chatId: string): BotMessage {
  return {
    id: "m1",
    chatId,
    fromMe: false,
    contentHash: "h",
    timestamp: Date.now(),
    type: "text",
    body: "hi",
    fromPn: ADMIN_JID,
  } as BotMessage;
}

/** Same shape as groupMeta.test.ts's fakeContract — kept local/minimal
 *  since it's not exported. `groupSettingUpdate` is wired separately so
 *  each test can assert on the exact setting passed, or omit it to
 *  exercise the "unsupported" path. */
function fakeContract(opts: {
  rawGroupMetadata: () => Promise<RawGroupMetadata>;
  groupSettingUpdate?: (jid: string, setting: string) => Promise<void>;
}): WaContract {
  const contract = {
    name: "baileys" as const,
    connect: async () => {},
    disconnect: async () => {},
    isReady: () => true,
    on: () => () => {},
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
    groupMetadata: async () => {
      throw new Error("neutral groupMetadata() should not be called by close()/open()");
    },
    groupParticipantsUpdate: async () => [],
    groupSettingUpdate: opts.groupSettingUpdate,
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

  (contract as unknown as Record<symbol, unknown>)[RAW_SOCK] = { groupMetadata: opts.rawGroupMetadata };
  return contract;
}

async function buildCtx(contract: WaContract, chatId: string) {
  const msg   = fakeMsg(chatId);
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

describe("drivers/baileys/api — ctx.chat.close()/open()", () => {
  beforeEach(() => {
    __resetGroupMetaCacheForTests();
  });

  test("resolves chat_is_not_group on a DM, without touching group metadata", async () => {
    const contract = fakeContract({
      rawGroupMetadata: async () => {
        throw new Error("should not be called for a DM");
      },
    });
    const ctx = await buildCtx(contract, DM_JID);

    const closeResult = await ctx.chat.close();
    assert.equal(closeResult.status, "chat_is_not_group");
    assert.match((closeResult as { message: string }).message, /is not a group chat/);

    const openResult = await ctx.chat.open();
    assert.equal(openResult.status, "chat_is_not_group");
  });

  test("resolves unsupported when the driver has no groupSettingUpdate()", async () => {
    const contract = fakeContract({
      rawGroupMetadata: async () => ({
        subject: "Group",
        participants: [{ id: BOT_JID, admin: "admin" }],
      }),
      // groupSettingUpdate intentionally omitted
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    const result = await ctx.chat.close();
    assert.equal(result.status, "unsupported");
  });

  test("resolves not_authorized when the bot is not a group admin", async () => {
    const contract = fakeContract({
      rawGroupMetadata: async () => ({
        subject: "Group",
        participants: [{ id: BOT_JID, admin: null }],
      }),
      groupSettingUpdate: async () => {
        throw new Error("should not be called when the bot isn't admin");
      },
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    const result = await ctx.chat.close();
    assert.equal(result.status, "not_authorized");
  });

  test("close() calls groupSettingUpdate with \"announcement\" when the bot is admin", async () => {
    const calls: Array<{ jid: string; setting: string }> = [];
    const contract = fakeContract({
      rawGroupMetadata: async () => ({
        subject: "Group",
        participants: [{ id: BOT_JID, admin: "admin" }],
      }),
      groupSettingUpdate: async (jid, setting) => {
        calls.push({ jid, setting });
      },
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    assert.deepEqual(await ctx.chat.close(), { status: "ok" });
    assert.deepEqual(calls, [{ jid: GROUP_JID, setting: "announcement" }]);
  });

  test("open() calls groupSettingUpdate with \"not_announcement\" when the bot is admin", async () => {
    const calls: Array<{ jid: string; setting: string }> = [];
    const contract = fakeContract({
      rawGroupMetadata: async () => ({
        subject: "Group",
        participants: [{ id: BOT_JID, admin: "superadmin" }],
      }),
      groupSettingUpdate: async (jid, setting) => {
        calls.push({ jid, setting });
      },
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    assert.deepEqual(await ctx.chat.open(), { status: "ok" });
    assert.deepEqual(calls, [{ jid: GROUP_JID, setting: "not_announcement" }]);
  });

  test("resolves failed (not not_authorized) when groupSettingUpdate itself rejects", async () => {
    const contract = fakeContract({
      rawGroupMetadata: async () => ({
        subject: "Group",
        participants: [{ id: BOT_JID, admin: "admin" }],
      }),
      groupSettingUpdate: async () => {
        throw new Error("rate-limited");
      },
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    const result = await ctx.chat.close();
    assert.equal(result.status, "failed");
    assert.match((result as { message: string }).message, /rate-limited/);
  });

  test("resolves failed (not not_authorized) when the metadata fetch itself rejects", async () => {
    const contract = fakeContract({
      rawGroupMetadata: async () => {
        throw new Error("timeout");
      },
      groupSettingUpdate: async () => {
        throw new Error("should not be reached — metadata fetch fails first");
      },
    });
    const ctx = await buildCtx(contract, GROUP_JID);

    const result = await ctx.chat.close();
    assert.equal(result.status, "failed");
    assert.match((result as { message: string }).message, /timeout/);
  });
});
