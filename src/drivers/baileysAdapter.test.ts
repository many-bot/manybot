import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createStore } from "#client/store.js";
import { createBaileysAdapter } from "#drivers/baileys/adapter.js";
import type { RawSocket } from "#drivers/baileys/sdk/baileysSock.js";

test("Baileys sends messages with the chat's disappearing-message timer", async () => {
  const store = createStore();
  const jid = "chat@s.whatsapp.net";
  store.setChatEphemeralExpiration(jid, 86400);
  store.messages.set(jid, new Map([["quoted", {
    key: { id: "quoted", remoteJid: jid, fromMe: false },
    message: { conversation: "original" },
  } as never]]));

  const calls: unknown[][] = [];
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    sendMessage: async (...args: unknown[]) => {
      calls.push(args);
      return { key: { id: `sent-${calls.length}`, remoteJid: args[0] } };
    },
    groupMetadata: async () => ({ subject: "Group", participants: [], ephemeralDuration: 604800 }),
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const quoted = { id: "quoted", remoteJid: jid, fromMe: false };
  await contract.sendText(jid, "text", { quoted });
  await contract.sendImage(jid, Buffer.from("image"));
  await contract.sendVideo(jid, Buffer.from("video"));
  await contract.sendAudio(jid, Buffer.from("audio"));
  await contract.sendSticker(jid, Buffer.from("sticker"));
  await contract.sendDocument(jid, Buffer.from("document"), "file.txt", "text/plain");
  await contract.sendPoll(jid, { name: "Poll", values: ["one"] });

  for (const call of calls) {
    assert.equal((call[2] as { ephemeralExpiration?: number } | undefined)?.ephemeralExpiration, 86400);
  }
  assert.ok((calls[0]?.[2] as { quoted?: unknown }).quoted, "quoted and ephemeral options are merged");

  await contract.react(jid, quoted, "👍");
  assert.equal(calls.at(-1)?.length, 2, "reactions do not receive ephemeral send options");

  await contract.groupMetadata("group@g.us");
  await contract.sendText("group@g.us", "group text");
  assert.equal((calls.at(-1)?.[2] as { ephemeralExpiration?: number }).ephemeralExpiration, 604800);
});

test("Baileys adapter getBusinessProfile handles success and failure", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    getBusinessProfile: async () => ({ name: "Test Corp", id: "12345678" }),
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.getBusinessProfile(jid);
  assert.deepStrictEqual(result, { name: "Test Corp", id: "12345678" });

  const sockFail = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    getBusinessProfile: async () => { throw new Error("API error"); },
  } as unknown as RawSocket;
  const { contract: contractFail } = createBaileysAdapter({ sock: sockFail, store });
  const resultFail = await contractFail.getBusinessProfile(jid);
  assert.strictEqual(resultFail, null);
});

test("Baileys adapter profilePictureUrl retrieves URL and handles error", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    profilePictureUrl: async () => "https://example.com/profile.jpg",
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.profilePictureUrl(jid);
  assert.strictEqual(result, "https://example.com/profile.jpg");

  const sockFail = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    profilePictureUrl: async () => { throw new Error("API error"); },
  } as unknown as RawSocket;
  const { contract: contractFail } = createBaileysAdapter({ sock: sockFail, store });
  const resultFail = await contractFail.profilePictureUrl(jid);
  assert.strictEqual(resultFail, null);
});

test("Baileys adapter fetchStatus retrieves status and handles error", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    fetchStatus: async () => [{ id: jid, status: { status: "available" } }],
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.fetchStatus(jid);
  assert.strictEqual(result, "available");

  const sockNoArray = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    fetchStatus: async () => ({ status: "away" }),
  } as unknown as RawSocket;
  const { contract: contractNoArray } = createBaileysAdapter({ sock: sockNoArray, store });
  const resultNoArray = await contractNoArray.fetchStatus(jid);
  assert.strictEqual(resultNoArray, "away");

  const sockFail = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    fetchStatus: async () => { throw new Error("API error"); },
  } as unknown as RawSocket;
  const { contract: contractFail } = createBaileysAdapter({ sock: sockFail, store });
  const resultFail = await contractFail.fetchStatus(jid);
  assert.strictEqual(resultFail, null);
});

test("Baileys adapter updateBlockStatus calls the underlying method", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    updateBlockStatus: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  await contract.updateBlockStatus(jid, "block");
  assert.ok(true, "updateBlockStatus did not throw");

  await contract.updateBlockStatus(jid, "unblock");
  assert.ok(true, "updateBlockStatus remove did not throw");
});

test("Baileys adapter addOrEditContact calls the underlying method", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const info = { fullName: "Test User", firstName: "Test", saveOnPrimaryAddressbook: true };
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    addOrEditContact: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  await contract.addOrEditContact(jid, info);
  assert.ok(true, "addOrEditContact did not throw");

  await contract.addOrEditContact(jid, { fullName: "Another User" });
  assert.ok(true, "addOrEditContact second call did not throw");
});

test("Baileys adapter removeContact calls the underlying method", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    removeContact: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  await contract.removeContact(jid);
  assert.ok(true, "removeContact did not throw");
});

test("Baileys adapter groupParticipantsUpdate calls the underlying method", async () => {
  const store = createStore();
  const jid = "group@g.us";
  const users = ["user1@s.whatsapp.net", "user2@s.whatsapp.net"];
  const action = "add" as const;
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    groupParticipantsUpdate: async () => [{ status: "success" }],
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.groupParticipantsUpdate(jid, users, action);
  assert.deepStrictEqual(result, [{ status: "success" }]);

  await contract.groupParticipantsUpdate(jid, ["user3@s.whatsapp.net"], "remove" as const);
  assert.ok(true, "groupParticipantsUpdate remove did not throw");
});

test("Baileys adapter groupUpdateSubject and groupUpdateDescription call underlying methods", async () => {
  const store = createStore();
  const jid = "group@g.us";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    groupUpdateSubject: async () => {},
    groupUpdateDescription: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  await contract.groupUpdateSubject(jid, "New Subject");
  assert.ok(true, "groupUpdateSubject did not throw");

  await contract.groupUpdateDescription(jid, "New Description");
  assert.ok(true, "groupUpdateDescription did not throw");
});

test("Baileys adapter groupInviteCode and groupRevokeInvite call underlying methods", async () => {
  const store = createStore();
  const jid = "group@g.us";
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    groupInviteCode: async () => "https://chat.whatsapp.com/AAAA",
    groupRevokeInvite: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const code = await contract.groupInviteCode(jid);
  assert.strictEqual(code, "https://chat.whatsapp.com/AAAA");

  await contract.groupRevokeInvite(jid);
  assert.ok(true, "groupRevokeInvite did not throw");
});

test("Baileys adapter updateProfilePicture, updateProfileName, updateProfileStatus call underlying methods", async () => {
  const store = createStore();
  const buffer = Buffer.from("fake-image-data");
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
    updateProfilePicture: async () => {},
    updateProfileName: async () => {},
    updateProfileStatus: async () => {},
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  await contract.updateProfilePicture("12345678@s.whatsapp.net", buffer);
  assert.ok(true, "updateProfilePicture did not throw");

  await contract.updateProfileName("New Name");
  assert.ok(true, "updateProfileName did not throw");

  await contract.updateProfileStatus("Available");
  assert.ok(true, "updateProfileStatus did not throw");
});

test("Baileys adapter me returns user info", async () => {
  const store = createStore();
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net", lid: "12345678@lid" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const me = await contract.me();
  assert.strictEqual(me.id, "bot@s.whatsapp.net");
  assert.strictEqual(me.lid, "12345678@lid");
});

test("Baileys adapter getHistory returns messages from store", async () => {
  const store = createStore();
  const jid = "12345678@s.whatsapp.net";
  store.messages.set(jid, new Map([
    ["msg1", { key: { id: "msg1", remoteJid: jid, fromMe: false }, message: { conversation: "hello" } as never }],
    ["msg2", { key: { id: "msg2", remoteJid: jid, fromMe: true }, message: { conversation: "world" } as never }],
  ]));
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const history = await contract.getHistory?.(jid, { limit: 2 });
  assert.strictEqual(history?.length, 2);
  assert.ok(history?.some((m) => m.body === "hello"));
  assert.ok(history?.some((m) => m.body === "world"));
});

test("Baileys adapter downloadMedia returns null when no raw message", async () => {
  const store = createStore();
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.downloadMedia({ chatId: "123", id: "msg1" } as never, {});
  assert.strictEqual(result, null);
});

test("Baileys adapter decryptPollVote returns null when no vote data", async () => {
  const store = createStore();
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = await contract.decryptPollVote?.({
    voteKey: { remoteJid: "123", id: "msg1" } as never,
    pollKey: { remoteJid: "123", id: "msg1" } as never,
    pollEncKey: Buffer.alloc(0),
  } as never);
  assert.strictEqual(result, null);
});

test("Baileys adapter aggregatePollVotes returns empty array when no poll data", async () => {
  const store = createStore();
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const result = contract.aggregatePollVotes?.({
    pollKey: { remoteJid: "123", id: "msg1" } as never,
    selfJid: undefined,
    votes: [] as never,
  } as never);
  assert.deepStrictEqual(result, []);
});
