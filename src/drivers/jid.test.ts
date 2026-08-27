import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeJid, denormalizeJid, toWireJid, splitLidPn } from "#drivers/jid.js";

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

  describe("splitLidPn", () => {
    test("addressingMode 'pn' (legacy): primary is PN, alt is LID", () => {
      const { lid, pn } = splitLidPn("5511999999999@s.whatsapp.net", "12345@lid");
      assert.equal(lid, "12345@lid");
      assert.equal(pn, "5511999999999@s.whatsapp.net");
    });

    test("addressingMode 'lid' (modern default): primary is LID, alt is PN — roles reversed", () => {
      const { lid, pn } = splitLidPn("12345@lid", "5511999999999@s.whatsapp.net");
      assert.equal(lid, "12345@lid");
      assert.equal(pn, "5511999999999@s.whatsapp.net");
    });

    test("only primary present, and it's a LID", () => {
      const { lid, pn } = splitLidPn("12345@lid", undefined);
      assert.equal(lid, "12345@lid");
      assert.equal(pn, undefined);
    });

    test("only primary present, and it's a PN", () => {
      const { lid, pn } = splitLidPn("5511999999999@s.whatsapp.net", undefined);
      assert.equal(lid, undefined);
      assert.equal(pn, "5511999999999@s.whatsapp.net");
    });

    test("neither present", () => {
      const { lid, pn } = splitLidPn(undefined, null);
      assert.equal(lid, undefined);
      assert.equal(pn, undefined);
    });

    test("group JID (@g.us) as primary with no alt is treated as pn-shaped, never as lid", () => {
      // Not a real person's PN, but callers only ever consume `.lid` from
      // this pairing for the group case — `.pn` is discarded there.
      const { lid, pn } = splitLidPn("120363999999999999@g.us", undefined);
      assert.equal(lid, undefined);
      assert.equal(pn, "120363999999999999@g.us");
    });
  });
});

