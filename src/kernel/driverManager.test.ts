import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import type { WaContract, SentMessageRef } from "#kernel/waContract.js";

function createFakeDriver(name: "baileys", ready = true): WaContract & { disconnected: boolean } {
  const state = { disconnected: false };
  const mockRef = (id: string): SentMessageRef => ({ id, chatId: "123@c.us", timestamp: Date.now() });

  return {
    name,
    isReady: () => ready,
    disconnect: async () => {
      state.disconnected = true;
    },
    get disconnected() {
      return state.disconnected;
    },
    connect: async () => {},
    me: () => ({ id: "123@c.us" }),
    sendText: async () => mockRef("msg1"),
    sendImage: async () => mockRef("msg2"),
    sendVideo: async () => mockRef("msg3"),
    sendAudio: async () => mockRef("msg4"),
    sendSticker: async () => mockRef("msg5"),
    sendDocument: async () => mockRef("msg6"),
    sendLocation: async () => mockRef("msg7"),
    sendContact: async () => mockRef("msg8"),
    sendReaction: async () => {},
    sendPoll: async () => mockRef("msg9"),
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
    getContact: async () => null,
    getProfilePictureUrl: async () => null,
    on: () => () => {},
  } as unknown as WaContract & { disconnected: boolean };
}

describe("kernel/driverManager", () => {
  beforeEach(() => {
    _resetDriverManagerForTests();
  });

  test("registers driver and returns active instance", () => {
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");

    dm.register(baileys, { isPrimary: true });

    assert.equal(dm.activeName_(), "baileys");
    assert.equal(dm.active(), baileys);
    assert.equal(dm.get("baileys"), baileys);
    assert.equal(dm.isReady("baileys"), true);
  });

  test("throws if active() called with no drivers registered", () => {
    const dm = getDriverManager();
    assert.throws(() => dm.active(), /no active driver registered/);
  });

  test("tracks degradation with expiration", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");

    dm.register(baileys, { isPrimary: true });
    assert.equal(dm.isDegraded("baileys"), false);

    dm.markDegraded("baileys", 1000);
    assert.equal(dm.isDegraded("baileys"), true);

    t.mock.timers.tick(1001);
    assert.equal(dm.isDegraded("baileys"), false);
  });

  test("shutdown disconnects all drivers", async () => {
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");
    dm.register(baileys, { isPrimary: true });

    await dm.shutdown();
    assert.equal(baileys.disconnected, true);
  });
});