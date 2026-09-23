import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendWithFallback, SendFailedError } from "#kernel/sendFallbackGuard.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import type { WaContract, SentMessageRef } from "#kernel/waContract.js";

function createMockDriver(name: "baileys", failsSend = false): WaContract {
  const mockRef = (id: string): SentMessageRef => ({ id, chatId: "123@c.us", timestamp: Date.now() });

  return {
    name,
    isReady: () => true,
    sendText: async (jid: string, text: string) => {
      if (failsSend) throw new Error(`${name} sendText failed`);
      return mockRef(`msg_${name}`);
    },
    getHistory: async () => [{ id: `msg_${name}`, fromMe: true } as any],
    connect: async () => {},
    disconnect: async () => {},
    me: () => ({ id: "123@c.us" }),
    sendImage: async () => mockRef("image"),
    sendVideo: async () => mockRef("video"),
    sendAudio: async () => mockRef("audio"),
    sendDocument: async () => mockRef("doc"),
    sendSticker: async () => mockRef("sticker"),
    sendLocation: async () => mockRef("loc"),
    sendContact: async () => mockRef("contact"),
    sendReaction: async () => {},
    sendPoll: async () => mockRef("poll"),
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
    addOrEditContact: async () => {},
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
  } as unknown as WaContract;
}

describe("kernel/sendFallbackGuard", () => {
  beforeEach(() => {
    _resetDriverManagerForTests();
  });

  test("delivers text via active driver", async () => {
    const dm = getDriverManager();
    dm.register(createMockDriver("baileys"), { isPrimary: true });

    const ref = await sendWithFallback("5511999999999@c.us", "hello");
    assert.equal(ref.id, "msg_baileys");
  });

  test("throws SendFailedError when the driver's sendText rejects", async () => {
    const dm = getDriverManager();
    dm.register(createMockDriver("baileys", true), { isPrimary: true });

    await assert.rejects(
      async () => sendWithFallback("5511999999999@c.us", "will fail"),
      (err: any) => err instanceof SendFailedError && err.jid === "5511999999999@c.us"
    );
  });
});
