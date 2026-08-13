import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { trackIncomingForContactSave } from "#kernel/contactAutoSave.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotMessage } from "#drivers/types.js";

function createMockContract(): WaContract & { savedContacts: Array<{ jid: string; name: string }> } {
  const saved: Array<{ jid: string; name: string }> = [];
  return {
    savedContacts: saved,
    addOrEditContact: async (jid: string, info: { fullName: string }) => {
      saved.push({ jid, name: info.fullName || "" });
    },
    name: "baileys",
    isReady: () => true,
    connect: async () => {},
    disconnect: async () => {},
    me: () => ({ id: "123@c.us" }),
    sendText: async () => ({ id: "msg", chatId: "123@c.us", timestamp: Date.now() }),
    sendImage: async () => ({ id: "img", chatId: "123@c.us", timestamp: Date.now() }),
    sendVideo: async () => ({ id: "vid", chatId: "123@c.us", timestamp: Date.now() }),
    sendAudio: async () => ({ id: "aud", chatId: "123@c.us", timestamp: Date.now() }),
    sendDocument: async () => ({ id: "doc", chatId: "123@c.us", timestamp: Date.now() }),
    sendSticker: async () => ({ id: "stk", chatId: "123@c.us", timestamp: Date.now() }),
    sendLocation: async () => ({ id: "loc", chatId: "123@c.us", timestamp: Date.now() }),
    sendContact: async () => ({ id: "cnt", chatId: "123@c.us", timestamp: Date.now() }),
    sendReaction: async () => {},
    sendPoll: async () => ({ id: "pll", chatId: "123@c.us", timestamp: Date.now() }),
    react: async () => {},
    deleteMessage: async () => {},
    editMessage: async () => {},
    sendPresenceUpdate: async () => {},
    readMessages: async () => {},
    onWhatsApp: async () => null,
    getBusinessProfile: async () => null,
    profilePictureUrl: async () => null,
    fetchStatus: async () => null,
    updateBlockStatus: async () => {},
    removeContact: async () => {},
    groupMetadata: async () => ({ subject: "Test Group", participants: [] }),
    groupParticipantsUpdate: async () => [],
    groupUpdateSubject: async () => {},
    groupUpdateDescription: async () => {},
    groupInviteCode: async () => "",
    groupRevokeInvite: async () => "",
    updateProfilePicture: async () => {},
    updateProfileName: async () => {},
    updateProfileStatus: async () => {},
    downloadMedia: async () => null,
    on: () => () => {},
  } as unknown as WaContract & { savedContacts: Array<{ jid: string; name: string }> };
}

describe("kernel/contactAutoSave", () => {
  test("accumulates DM messages and triggers addOrEditContact when target reached", async () => {
    const contract = createMockContract();
    const jid = "5511999991111@c.us";
    const msg = {
      id: "1",
      chatId: jid,
      fromMe: false,
      timestamp: Date.now(),
      text: "hello",
      pushName: "Alice",
      raw: {},
    } as unknown as BotMessage;

    // Send up to 6 DM messages (max target range is 3-6)
    for (let i = 0; i < 6; i++) {
      await trackIncomingForContactSave(contract as unknown as WaContract, msg, jid, false, false);
    }

    assert.ok(contract.savedContacts.length > 0);
    assert.equal(contract.savedContacts[0].name, "Alice");
  });

  test("ignores silent group messages (triggeredBot = false)", async () => {
    const contract = createMockContract();
    const jid = "5511999992222@c.us";
    const msg = {
      id: "2",
      chatId: "group1@g.us",
      fromMe: false,
      timestamp: Date.now(),
      text: "just chatting",
      pushName: "Bob",
      raw: {},
    } as unknown as BotMessage;

    for (let i = 0; i < 10; i++) {
      await trackIncomingForContactSave(contract as unknown as WaContract, msg, jid, true, false);
    }

    assert.equal(contract.savedContacts.length, 0);
  });
});
