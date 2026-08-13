import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import type { WaContract, SentMessageRef } from "#kernel/waContract.js";

function createFakeDriver(name: "baileys" | "whatsmeow", ready = true): WaContract & { disconnected: boolean } {
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

  test("registers primary driver and returns active instance", () => {
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

  test("registers secondary driver as fallback without changing activeName", () => {
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");
    const whatsmeow = createFakeDriver("whatsmeow");

    dm.register(baileys, { isPrimary: true });
    dm.register(whatsmeow, { isPrimary: false });

    assert.equal(dm.activeName_(), "baileys");
    assert.equal(dm.get("whatsmeow"), whatsmeow);
  });

  test("supports manual switchTo driver", () => {
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");
    const whatsmeow = createFakeDriver("whatsmeow");

    dm.register(baileys, { isPrimary: true });
    dm.register(whatsmeow);

    dm.switchTo("whatsmeow");
    assert.equal(dm.activeName_(), "whatsmeow");
    assert.equal(dm.active(), whatsmeow);

    assert.throws(() => dm.switchTo("nonexistent" as unknown as "baileys"), /cannot switch to unregistered driver/);
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

  test("shutdown disconnects in reverse registration order", async () => {
    const dm = getDriverManager();
    const baileys = createFakeDriver("baileys");
    const whatsmeow = createFakeDriver("whatsmeow");

    const shutdownOrder: string[] = [];
    baileys.disconnect = async () => {
      shutdownOrder.push("baileys");
    };
    whatsmeow.disconnect = async () => {
      shutdownOrder.push("whatsmeow");
    };

    dm.register(baileys, { isPrimary: true });
    dm.register(whatsmeow, { isPrimary: false });

    await dm.shutdown();

    assert.deepEqual(shutdownOrder, ["whatsmeow", "baileys"]);
  });
});
