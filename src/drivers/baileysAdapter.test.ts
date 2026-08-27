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

test("toBotMessage resolves LID/PN by suffix, not by field position (addressingMode 'lid')", async () => {
  // Modern default WhatsApp addressing: `participant` is ALREADY the LID,
  // `participantAlt` carries the PN companion — the reverse of the legacy
  // "pn" mode. See https://baileys.wiki/concepts/jids.
  const store = createStore();
  const sock = { ev: new EventEmitter(), user: { id: "bot@s.whatsapp.net" } } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const received: unknown[] = [];
  contract.on("messages.upsert", (payload) => received.push(payload));

  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: {
        remoteJid:      "120363999999999999@g.us",
        fromMe:         false,
        id:             "MSG1",
        participant:    "98765@lid",                       // already LID
        participantAlt: "5511999999999@s.whatsapp.net",    // PN companion
        addressingMode: "lid",
      },
      messageTimestamp: 1700000000,
      pushName: "Alice",
      message: { conversation: "oi" },
    }],
  });

  const batch = received[0] as { messages: Array<{ fromLid?: string; fromPn?: string; participantAlt?: string }> };
  const msg = batch.messages[0];
  assert.equal(msg.fromLid, "98765@lid", "fromLid must be the value that's actually @lid, regardless of which field it came from");
  assert.equal(msg.fromPn, "5511999999999@s.whatsapp.net", "fromPn must be the value that's actually NOT @lid");
  assert.equal(msg.participantAlt, "98765@lid", "participantAlt (consumed directly by getMsgSender) must also be suffix-verified");
});

test("toBotMessage resolves LID/PN by suffix, not by field position (legacy addressingMode 'pn')", async () => {
  const store = createStore();
  const sock = { ev: new EventEmitter(), user: { id: "bot@s.whatsapp.net" } } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const received: unknown[] = [];
  contract.on("messages.upsert", (payload) => received.push(payload));

  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: {
        remoteJid:      "120363999999999999@g.us",
        fromMe:         false,
        id:             "MSG2",
        participant:    "5511999999999@s.whatsapp.net",  // PN
        participantAlt: "98765@lid",                     // LID companion
        addressingMode: "pn",
      },
      messageTimestamp: 1700000000,
      pushName: "Bob",
      message: { conversation: "oi" },
    }],
  });

  const batch = received[0] as { messages: Array<{ fromLid?: string; fromPn?: string }> };
  const msg = batch.messages[0];
  assert.equal(msg.fromLid, "98765@lid");
  assert.equal(msg.fromPn, "5511999999999@s.whatsapp.net");
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

test("Baileys adapter passes through the real group-participants.update shape (author/action, string[] participants) and feeds LID↔PN cache", async () => {
  const store = createStore();
  const sock = {
    ev: new EventEmitter(),
    user: { id: "bot@s.whatsapp.net" },
  } as unknown as RawSocket;
  const { contract } = createBaileysAdapter({ sock, store });

  const received: unknown[] = [];
  contract.on("group-participants.update", (payload) => received.push(payload));

  // Baileys v7 ships `participants` as GroupParticipant[] (Contact & { admin?… })
  // — each entry carries `id` (LID form, the addressing mode the group uses),
  // `lid?` (explicit LID alias), and `phoneNumber?` (PN form). The adapter
  // projects to a flat JID list for the kernel, but also feeds the LID↔PN
  // cache from the richer data while it has it. See BaileysEventMap.
  sock.ev.emit("group-participants.update", {
    id: "120363402117932687@g.us",
    author: "99999@lid",
    authorPn: "5516999999999@s.whatsapp.net",
    participants: [
      { id: "69119495901215@lid", phoneNumber: "5516111222333@s.whatsapp.net" },
      { id: "69119495901216@lid", phoneNumber: "5516111222444@s.whatsapp.net" },
    ],
    action: "add",
  });

  assert.deepStrictEqual(received, [{
    id: "120363402117932687@g.us",
    author: "99999@lid",
    participants: [
      "69119495901215@lid",
      "69119495901216@lid",
    ],
    action: "add",
  }]);

  // Passive LID↔PN cache filled from the richer payload — both directions
  // (resolveJid returns the PN, resolvePn returns the LID).
  assert.equal(store.resolveJid("69119495901215@lid"), "5516111222333@s.whatsapp.net");
  assert.equal(store.resolvePn("5516111222444@s.whatsapp.net"), "69119495901216@lid");
  assert.equal(store.resolveJid("99999@lid"), "5516999999999@s.whatsapp.net");
});

