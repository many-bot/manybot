import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeJid, denormalizeJid, toWireJid } from "#drivers/jid.js";

describe("drivers/jid", () => {
  describe("normalizeJid", () => {
    test("handles empty string or nullish input", () => {
      assert.equal(normalizeJid(""), "");
    });

    test("converts @s.whatsapp.net to @c.us", () => {
      assert.equal(normalizeJid("5511999999999@s.whatsapp.net"), "5511999999999@c.us");
    });

    test("removes device suffix e.g. :12@", () => {
      assert.equal(normalizeJid("5511999999999:12@s.whatsapp.net"), "5511999999999@c.us");
    });

    test("leaves group @g.us untouched", () => {
      assert.equal(normalizeJid("12036301234567890@g.us"), "12036301234567890@g.us");
    });
  });

  describe("denormalizeJid", () => {
    test("converts @c.us to @s.whatsapp.net", () => {
      assert.equal(denormalizeJid("5511999999999@c.us"), "5511999999999@s.whatsapp.net");
    });

    test("leaves already wire or non-c.us JIDs untouched", () => {
      assert.equal(denormalizeJid("12036301234567890@g.us"), "12036301234567890@g.us");
    });
  });

  describe("toWireJid", () => {
    test("returns wire format for @s.whatsapp.net, @lid, @g.us untouched", () => {
      assert.equal(toWireJid("5511999999999@s.whatsapp.net"), "5511999999999@s.whatsapp.net");
      assert.equal(toWireJid("12345@lid"), "12345@lid");
      assert.equal(toWireJid("12036301234567890@g.us"), "12036301234567890@g.us");
    });

    test("converts @c.us JID to @s.whatsapp.net", () => {
      assert.equal(toWireJid("5511999999999@c.us"), "5511999999999@s.whatsapp.net");
    });

    test("converts plain phone number / digits to @s.whatsapp.net", () => {
      assert.equal(toWireJid("+55 (11) 99999-9999"), "5511999999999@s.whatsapp.net");
    });
  });
});
