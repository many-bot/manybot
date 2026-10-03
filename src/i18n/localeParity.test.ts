import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAvailableLocales } from "#i18n";

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "locales");

function flatten(obj: Record<string, unknown>, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      for (const [k, v] of flatten(value as Record<string, unknown>, full)) out.set(k, v);
    } else {
      out.set(full, String(value));
    }
  }
  return out;
}

const placeholders = (text: string): string =>
  [...new Set(text.match(/\{\{\w+\}\}/g) ?? [])].sort().join(",");

const locales = new Map(
  getAvailableLocales().map((lang) => [
    lang,
    flatten(JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), "utf8"))),
  ]),
);
const reference = locales.get("en");

describe("core locale parity", () => {
  test("English reference exists", () => {
    assert.ok(reference && reference.size > 0);
  });

  for (const [lang, entries] of locales) {
    if (lang === "en" || !reference) continue;

    test(`${lang} has exactly the same keys as en`, () => {
      const missing = [...reference.keys()].filter((k) => !entries.has(k));
      const extra = [...entries.keys()].filter((k) => !reference.has(k));
      assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
    });

    test(`${lang} uses the same {{placeholders}} as en`, () => {
      const mismatched = [...reference]
        .filter(([key, text]) => entries.has(key) && placeholders(text) !== placeholders(entries.get(key) as string))
        .map(([key]) => key);
      assert.deepEqual(mismatched, []);
    });
  }
});
