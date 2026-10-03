import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resolveCoreCommandHandler } from "#kernel/coreCommands.js";
import { getChatLocale, setChatLocale, clearChatLocale, resolveChatLang } from "#kernel/chatOverrides.js";
import { tFor, getCurrentLang, getAvailableLocales } from "#i18n";

const chatId = "5511955554444@c.us";

function makeCtx(overrides: { setChatLocale?: (lang: string) => string } = {}) {
  const sent: string[] = [];
  const ctx = {
    send: { text: async (text: string) => { sent.push(text); } },
    t: (key: string, vars?: Record<string, unknown>) => tFor(resolveChatLang(chatId), key, vars),
    i18n: {
      available: () => getAvailableLocales(),
      getCurrentLang,
      setChatLocale: overrides.setChatLocale ?? ((lang: string) => setChatLocale(chatId, lang)),
      clearChatLocale: () => clearChatLocale(chatId),
    },
  };
  return { ctx, sent };
}

const run = (ctx: unknown, ...args: string[]) =>
  resolveCoreCommandHandler("setChatLocale")(ctx as never, { args } as never);

describe("!config idioma", () => {
  beforeEach(() => clearChatLocale(chatId));

  test("confirms in the newly selected language", async () => {
    const { ctx, sent } = makeCtx();
    await run(ctx, "es");
    assert.equal(getChatLocale(chatId), "es");
    assert.deepEqual(sent, [tFor("es", "config.localeSaved", { lang: "es" })]);
  });

  test("accepts regional codes", async () => {
    const { ctx, sent } = makeCtx();
    await run(ctx, "PT-BR");
    assert.equal(getChatLocale(chatId), "pt");
    assert.deepEqual(sent, [tFor("pt", "config.localeSaved", { lang: "pt" })]);
  });

  test("`padrao` clears the override and reports the bot default", async () => {
    setChatLocale(chatId, "es");
    const { ctx, sent } = makeCtx();
    await run(ctx, "padrao");
    const botLang = getCurrentLang();
    assert.equal(getChatLocale(chatId), undefined);
    assert.deepEqual(sent, [tFor(botLang, "config.localeCleared", { lang: botLang })]);
  });

  test("unsupported or missing code replies with usage and keeps the current language", async () => {
    setChatLocale(chatId, "es");
    const usage = tFor("es", "config.localeUsage", { available: getAvailableLocales().join("|") });

    const bad = makeCtx();
    await run(bad.ctx, "xx");
    const missing = makeCtx();
    await run(missing.ctx);

    assert.deepEqual(bad.sent, [usage]);
    assert.deepEqual(missing.sent, [usage]);
    assert.equal(getChatLocale(chatId), "es");
  });

  test("errors other than RangeError propagate", async () => {
    const { ctx, sent } = makeCtx({
      setChatLocale: () => {
        throw new Error("settings.db is locked");
      },
    });
    await assert.rejects(run(ctx, "es"), /settings\.db is locked/);
    assert.deepEqual(sent, []);
  });
});
