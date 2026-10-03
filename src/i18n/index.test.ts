import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tFor, normalizeLocale, getAvailableLocales, createPluginT, reloadTranslations } from "#i18n";

describe("i18n", () => {
  test("lists core locales", () => {
    assert.deepEqual(getAvailableLocales(), ["en", "es", "pt"]);
  });

  test("normalizeLocale handles case, regions and unknown codes", () => {
    assert.equal(normalizeLocale("PT"), "pt");
    assert.equal(normalizeLocale("pt_BR"), "pt");
    assert.equal(normalizeLocale("es-MX"), "es");
    assert.equal(normalizeLocale("xx"), undefined);
    assert.equal(normalizeLocale(""), undefined);
    assert.equal(normalizeLocale(undefined), undefined);
  });

  test("tFor translates per language and falls back for unknown ones", () => {
    const key = "commandPermissions.ownerOnly";
    assert.notEqual(tFor("pt", key), tFor("en", key));
    assert.equal(tFor("pt-BR", key), tFor("pt", key));
    assert.equal(tFor("xx", key), tFor(undefined, key));
  });

  describe("createPluginT", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manybot-plugin-"));
    fs.mkdirSync(path.join(dir, "locale"));
    fs.writeFileSync(path.join(dir, "manyplug.json"), "{}");
    fs.writeFileSync(path.join(dir, "locale", "en.json"), JSON.stringify({ hi: "Hello {{n}}", only: "en only" }));
    fs.writeFileSync(path.join(dir, "locale", "pt.json"), JSON.stringify({ hi: "Olá {{n}}" }));
    const url = pathToFileURL(path.join(dir, "index.js")).href;

    test("resolves the language on every call", () => {
      let lang: string | undefined = "pt";
      const p = createPluginT(url, () => lang);
      assert.equal(p.t("hi", { n: "A" }), "Olá A");
      assert.equal(p.lang, "pt");
      lang = "en";
      assert.equal(p.t("hi", { n: "A" }), "Hello A");
      assert.equal(p.lang, "en");
    });

    test("falls back to the plugin's English, then to the key", () => {
      const p = createPluginT(url, () => "pt");
      assert.equal(p.t("only"), "en only");
      assert.equal(p.t("missing"), "missing");
    });

    test("reloadTranslations() drops cached plugin locales", () => {
      const file = path.join(dir, "locale", "pt.json");
      const original = fs.readFileSync(file, "utf8");
      const p = createPluginT(url, () => "pt");
      assert.equal(p.t("hi", { n: "A" }), "Olá A");
      fs.writeFileSync(file, JSON.stringify({ hi: "Oi {{n}}" }));
      try {
        assert.equal(p.t("hi", { n: "A" }), "Olá A");
        reloadTranslations();
        assert.equal(p.t("hi", { n: "A" }), "Oi A");
      } finally {
        fs.writeFileSync(file, original);
      }
    });

    test("does not cache a locale that failed to load", () => {
      const file = path.join(dir, "locale", "pt.json");
      const original = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, "{ broken");
      const p = createPluginT(url, () => "pt");
      try {
        assert.equal(p.t("hi", { n: "A" }), "Hello A");
      } finally {
        fs.writeFileSync(file, original);
      }
      assert.equal(p.t("hi", { n: "A" }), "Olá A");
    });
  });
});

