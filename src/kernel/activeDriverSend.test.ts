import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sendActiveDriverText } from "#kernel/activeDriverSend.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import type { WaContract, SentMessageRef } from "#kernel/waContract.js";

function createMockDriver(name: "baileys", ready = true, failsSend = false): WaContract {
  const mockRef = (id: string): SentMessageRef => ({ id, chatId: "123@c.us", timestamp: Date.now() });

  return {
    name,
    isReady: () => ready,
    sendText: async (jid: string, text: string) => {
      if (failsSend) throw new Error(`${name} sendText failed`);
      return mockRef(`msg_${name}`);
    },
    connect: async () => {},
    disconnect: async () => {},
    me: () => ({ id: "123@c.us" }),
    sendImage: async () => mockRef("image"),
    sendVideo: async () => mockRef("image"),
    sendAudio: async () => mockRef("image"),
    sendDocument: async () => mockRef("image"),
    sendSticker: async () => mockRef("image"),
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

describe("kernel/activeDriverSend", () => {
  beforeEach(() => {
    _resetDriverManagerForTests();
  });

  test("delivers text via the active driver when healthy", async () => {
    const dm = getDriverManager();
    const driver = createMockDriver("baileys");
    dm.register(driver, { isPrimary: true });

    const ref = await sendActiveDriverText("5511999999999@c.us", "hello");
    assert.equal(ref.id, "msg_baileys");
  });

  test("propagates error when the active driver fails to send", async () => {
    const dm = getDriverManager();
    const failingDriver = createMockDriver("baileys", true, true);

    dm.register(failingDriver, { isPrimary: true });

    await assert.rejects(
      async () => sendActiveDriverText("5511999999999@c.us", "failing send"),
      /baileys sendText failed/
    );
  });

  test("passes quoted and mentions options through to the driver", async () => {
    const dm = getDriverManager();
    let receivedOpts: unknown = null;

    const driver: WaContract = {
      ...createMockDriver("baileys"),
      sendText: async (_jid: string, _text: string, opts: { quoted?: unknown; mentions?: string[] }) => {
        receivedOpts = opts;
        return { id: "msg1", chatId: _jid, timestamp: Date.now() };
      },
    } as unknown as WaContract;

    dm.register(driver, { isPrimary: true });

    const quotedRef = { id: "orig-msg", remoteJid: "123@s.whatsapp.net", fromMe: false };
    const ref = await sendActiveDriverText("5511999999999@c.us", "reply", { quoted: quotedRef, mentions: ["@user1"] });
    assert.equal(ref.id, "msg1");
    assert.deepStrictEqual(receivedOpts, { quoted: quotedRef, mentions: ["@user1"] });
  });

  test("throws when no driver is registered", async () => {
    const dm = getDriverManager();

    await assert.rejects(
      async () => sendActiveDriverText("5511999999999@c.us", "no driver"),
      /no active driver/i
    );
  });
});