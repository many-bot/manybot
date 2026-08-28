import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getChatPrefix, getChatLocale } from "#kernel/chatOverrides.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";
import { CMD_PREFIX } from "#config";

describe("kernel/chatOverrides", () => {
  // Already in normalized form ("@c.us") so writes and reads use the
  // exact same storage key without relying on normalizeJid to no-op.
  const chatId = "5511977776666@c.us";

  beforeEach(() => {
    buildSettingsApi("core", chatId).deleteAll();
  });

  afterEach(() => {
    buildSettingsApi("core", chatId).deleteAll();
  });

  describe("getChatPrefix", () => {
    test("returns the global CMD_PREFIX when no override is set", () => {
      assert.equal(getChatPrefix(chatId), CMD_PREFIX);
    });

    test("returns the chat's saved override once !config prefixo has set one", () => {
      buildSettingsApi("core", chatId).set("chat_prefix", "#");
      assert.equal(getChatPrefix(chatId), "#");
    });

    test("does not leak one chat's override into another chat", () => {
      buildSettingsApi("core", chatId).set("chat_prefix", "#");
      assert.equal(getChatPrefix("5511900000000@c.us"), CMD_PREFIX);
    });

    test("reads back a value written under the raw (non-normalized) wire jid form", () => {
      // buildApi()/buildMessageContext() scope ctx.settings with
      // normalizeJid(msg.chatId) — a raw "@s.whatsapp.net" jid (with a
      // device suffix, as WhatsApp sends it) must normalize to the same
      // key so a write from the live message path is visible here too.
      const rawJid = "5511977776666:12@s.whatsapp.net";
      buildSettingsApi("core", "5511977776666@c.us").set("chat_prefix", "$");
      assert.equal(getChatPrefix(rawJid), "$");
    });

    test("falls back to the global prefix for a blank saved override", () => {
      buildSettingsApi("core", chatId).set("chat_prefix", "");
      assert.equal(getChatPrefix(chatId), CMD_PREFIX);
    });
  });

  describe("getChatLocale", () => {
    test("returns undefined when no override is set, so callers fall back to the global language", () => {
      assert.equal(getChatLocale(chatId), undefined);
    });

    test("returns the chat's saved override once !config idioma has set one", () => {
      buildSettingsApi("core", chatId).set("chat_locale", "es");
      assert.equal(getChatLocale(chatId), "es");
    });

    test("does not leak one chat's override into another chat", () => {
      buildSettingsApi("core", chatId).set("chat_locale", "es");
      assert.equal(getChatLocale("5511900000000@c.us"), undefined);
    });

    test("falls back to undefined for a blank saved override", () => {
      buildSettingsApi("core", chatId).set("chat_locale", "");
      assert.equal(getChatLocale(chatId), undefined);
    });
  });
});

