import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getChatPrefix, getChatLocale, setChatLocale, clearChatLocale, resolveChatLang } from "#kernel/chatOverrides.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";
import { CMD_PREFIX } from "#config";
import { getCurrentLang } from "#i18n";

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

  describe("setChatLocale / clearChatLocale / resolveChatLang", () => {
    test("stores the locale and getChatLocale reads it back", () => {
      assert.equal(setChatLocale(chatId, "es"), "es");
      assert.equal(getChatLocale(chatId), "es");
      assert.equal(resolveChatLang(chatId), "es");
    });

    test("normalizes case and regional codes", () => {
      assert.equal(setChatLocale(chatId, "PT_br"), "pt");
      assert.equal(getChatLocale(chatId), "pt");
    });

    test("rejects unsupported locales without touching the stored value", () => {
      setChatLocale(chatId, "es");
      assert.throws(() => setChatLocale(chatId, "xx"), RangeError);
      assert.equal(getChatLocale(chatId), "es");
    });

    test("ignores a stored locale that no longer has a translation file", () => {
      buildSettingsApi("core", chatId).set("chat_locale", "xx");
      assert.equal(getChatLocale(chatId), undefined);
    });

    test("clearChatLocale falls back to the default language", () => {
      setChatLocale(chatId, "es");
      clearChatLocale(chatId);
      assert.equal(getChatLocale(chatId), undefined);
      assert.equal(resolveChatLang(chatId), getCurrentLang());
    });

    test("resolveChatLang without a chat returns the default language", () => {
      assert.equal(resolveChatLang(undefined), getCurrentLang());
    });

    test("does not leak one chat's locale into another", () => {
      setChatLocale(chatId, "es");
      assert.equal(getChatLocale("5511900000000@c.us"), undefined);
    });
  });
});

