import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendWithFallback, SendFailedError } from "#kernel/sendFallbackGuard.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import type { WaContract, SentMessageRef } from "#kernel/waContract.js";

function createMockDriver(name: "baileys" | "whatsmeow", ready = true, failsSend = false, failsVerify = false): WaContract {
  const mockRef = (id: string): SentMessageRef => ({ id, chatId: "123@c.us", timestamp: Date.now() });

  return {
    name,
    isReady: () => ready,
    sendText: async (jid: string, text: string) => {
      if (failsSend) throw new Error(`${name} sendText failed`);
      return mockRef(`msg_${name}`);
    },
    getHistory: async () => {
      if (failsVerify) return [];
      return [{ id: `msg_${name}`, fromMe: true } as any];
    },
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

  test("delivers text via primary driver when healthy", async () => {
    const dm = getDriverManager();
    const primary = createMockDriver("baileys");
    dm.register(primary, { isPrimary: true });

    const ref = await sendWithFallback("5511999999999@c.us", "hello");
    assert.equal(ref.id, "msg_baileys");
  });

  test("falls back to secondary driver when primary fails send", async () => {
    const dm = getDriverManager();
    const primaryFailing = createMockDriver("baileys", true, true);
    const secondaryOk = createMockDriver("whatsmeow", true);

    dm.register(primaryFailing, { isPrimary: true });
    dm.register(secondaryOk, { isPrimary: false });

    const ref = await sendWithFallback("5511999999999@c.us", "hello fallback");
    assert.equal(ref.id, "msg_whatsmeow");
    assert.equal(dm.isDegraded("baileys"), true);
  });

  test("throws SendFailedError when no fallback driver is available", async () => {
    const dm = getDriverManager();
    const primaryFailing = createMockDriver("baileys", true, true);

    dm.register(primaryFailing, { isPrimary: true });

    await assert.rejects(
      async () => sendWithFallback("5511999999999@c.us", "no fallback"),
      (err: any) => err instanceof SendFailedError && err.reason === "no_fallback"
    );
  });
});
