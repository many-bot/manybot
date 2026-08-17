import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createStore } from "#client/store.js";

test("store tracks disappearing-message timers from chats and message context", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  ev.emit("chats.upsert", [{ id: "chat@s.whatsapp.net", name: "Chat", ephemeralExpiration: "86400" }]);
  assert.equal(store.chats.get("chat@s.whatsapp.net")?.ephemeralExpiration, 86400);

  ev.emit("chats.update", [{ id: "chat@s.whatsapp.net", ephemeralExpiration: null }]);
  assert.equal(store.chats.get("chat@s.whatsapp.net")?.ephemeralExpiration, 0);

  ev.emit("messages.upsert", {
    messages: [{
      key: { id: "message", remoteJid: "chat@s.whatsapp.net" },
      message: {
        ephemeralMessage: {
          message: { extendedTextMessage: { contextInfo: { expiration: "604800" } } },
        },
      },
    }],
  });
  assert.equal(store.chats.get("chat@s.whatsapp.net")?.ephemeralExpiration, 604800);
});

test("store keeps timers in snapshots and accepts a timer learned by metadata", () => {
  const store = createStore();
  store.setChatEphemeralExpiration("group@g.us", 7776000);

  const snapshot = store.toJSON();
  assert.equal(snapshot.chats[0]?.ephemeralExpiration, 7776000);

  const hydrated = createStore();
  hydrated.hydrate(snapshot);
  assert.equal(hydrated.chats.get("group@g.us")?.ephemeralExpiration, 7776000);
});

test("store learns, resolves, and forgets LID to PN mappings", () => {
  const store = createStore();

  // Invalid or identity mappings are ignored
  store.learnLid("invalid_jid", "551199999999@s.whatsapp.net");
  store.learnLid("123@lid", "456@lid");
  assert.equal(store.resolveJid("invalid_jid"), "invalid_jid");
  assert.equal(store.resolveJid("123@lid"), "123@lid");

  // Valid mapping is learned and resolved
  store.learnLid("123456789@lid", "551199999999@s.whatsapp.net");
  assert.equal(store.resolveJid("123456789@lid"), "551199999999@s.whatsapp.net");

  // Non-LID JIDs are returned untouched
  assert.equal(store.resolveJid("551188888888@s.whatsapp.net"), "551188888888@s.whatsapp.net");

  // Forget LID removes mapping
  store.forgetLid("123456789@lid");
  assert.equal(store.resolveJid("123456789@lid"), "123456789@lid");
});

test("store preserves rich contact fields during updates", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  // Initial contact with full details
  ev.emit("contacts.upsert", [
    { id: "user1@s.whatsapp.net", name: "Alice", notify: "Alice N", verifiedName: "Alice Verified" }
  ]);

  let contact = store.contacts["user1@s.whatsapp.net"];
  assert.equal(contact?.name, "Alice");
  assert.equal(contact?.notify, "Alice N");
  assert.equal(contact?.verifiedName, "Alice Verified");

  // Poorer update (e.g., from a stub) should not wipe out previous fields
  ev.emit("contacts.upsert", [
    { id: "user1@s.whatsapp.net" }
  ]);

  contact = store.contacts["user1@s.whatsapp.net"];
  assert.equal(contact?.name, "Alice");
  assert.equal(contact?.notify, "Alice N");
  assert.equal(contact?.verifiedName, "Alice Verified");
});

test("store captures pushName from messages and respects guards", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  ev.emit("messages.upsert", {
    messages: [
      // DM message from other person -> should capture
      {
        key: { id: "m1", remoteJid: "user2@s.whatsapp.net", fromMe: false },
        pushName: "Bob",
      },
      // Message fromMe -> should NOT capture
      {
        key: { id: "m2", remoteJid: "user3@s.whatsapp.net", fromMe: true },
        pushName: "SelfBot",
      },
      // Message in group -> captures participant
      {
        key: { id: "m3", remoteJid: "group1@g.us", participant: "user4@s.whatsapp.net", fromMe: false },
        pushName: "Charlie",
      },
    ],
  });

  assert.equal(store.contacts["user2@s.whatsapp.net"]?.notify, "Bob");
  assert.equal(store.contacts["user3@s.whatsapp.net"], undefined);
  assert.equal(store.contacts["user4@s.whatsapp.net"]?.notify, "Charlie");
});

test("store evicts oldest messages when exceeding MAX_MSGS_PER_CHAT (200)", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  const jid = "chat-flood@s.whatsapp.net";
  const messages = [];

  for (let i = 1; i <= 205; i++) {
    messages.push({
      key: { id: `msg-${i}`, remoteJid: jid },
      message: { conversation: `text ${i}` },
    });
  }

  ev.emit("messages.upsert", { messages });

  const chatMap = store.messages.get(jid);
  assert.ok(chatMap);
  assert.equal(chatMap?.size, 200);
  assert.equal(chatMap?.has("msg-1"), false); // evicted
  assert.equal(chatMap?.has("msg-5"), false); // evicted
  assert.equal(chatMap?.has("msg-6"), true);  // kept
  assert.equal(chatMap?.has("msg-205"), true); // kept
});

test("store accumulates poll updates on messages.update", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  const jid = "poll-chat@s.whatsapp.net";
  const msgId = "poll-1";

  // Initial poll message
  ev.emit("messages.upsert", {
    messages: [
      {
        key: { id: msgId, remoteJid: jid },
        message: { pollCreationMessage: { name: "Question?" } },
      }
    ]
  });

  // First vote update
  ev.emit("messages.update", [
    {
      key: { id: msgId, remoteJid: jid },
      update: { pollUpdates: [{ voter: "user1" }] },
    }
  ]);

  // Second vote update
  ev.emit("messages.update", [
    {
      key: { id: msgId, remoteJid: jid },
      update: { pollUpdates: [{ voter: "user2" }] },
    }
  ]);

  const stored = store.messages.get(jid)?.get(msgId) as any;
  assert.ok(stored);
  assert.equal(stored.pollUpdates?.length, 2);
  assert.deepEqual(stored.pollUpdates, [{ voter: "user1" }, { voter: "user2" }]);
});

test("store processes messaging-history.set backfill", () => {
  const store = createStore();
  const ev = new EventEmitter();
  store.bind(ev as never);

  ev.emit("messaging-history.set", {
    chats: [{ id: "hist-chat@s.whatsapp.net", name: "History Chat" }],
    contacts: [{ id: "hist-user@s.whatsapp.net", name: "Dave" }],
    messages: [
      {
        key: { id: "m-hist", remoteJid: "hist-chat@s.whatsapp.net", fromMe: false },
        pushName: "Dave Push",
      }
    ],
  });

  assert.equal(store.chats.get("hist-chat@s.whatsapp.net")?.name, "History Chat");
  assert.equal(store.contacts["hist-user@s.whatsapp.net"]?.name, "Dave");
  assert.equal(store.contacts["hist-chat@s.whatsapp.net"]?.notify, "Dave Push");
});
