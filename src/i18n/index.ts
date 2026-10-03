/**
 * i18n/index.ts
 *
 * Internationalization system for ManyBot.
 * Loads translations based on LANGUAGE configuration.
 * Fallback is always English (en).
 *
 * Plugins can use createPluginT() to have isolated i18n.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "#config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, "..", "locales");

// Default language (fallback)
const DEFAULT_LANG = "en";

// Cache of loaded translations
const translations = new Map<string, Record<string, unknown>>();

// Bumped by reloadTranslations(); plugin caches compare against it to drop stale locales
let translationsVersion = 0;

/**
 * Loads a translation JSON file
 * @param {string} lang - language code (en, pt, es)
 * @returns {object|null}
 */
function loadLocale(lang: string): Record<string, unknown> | null {
  if (translations.has(lang)) {
    return translations.get(lang) ?? null;
  }

  const filePath = path.join(LOCALES_DIR, `${lang}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    translations.set(lang, data);
    return data;
  } catch (e) {
    console.error(`[i18n] Failed to load locale ${lang}:`, (e as Error).message);
    return null;
  }
}

/**
 * Gets configured language or falls back to English. `CONFIG.LANGUAGE` is
 * the single source of truth (set from manybot.toml, defaulted to "en") —
 * this never guesses from the OS locale, so bot output language doesn't
 * depend on the host machine/CI environment it happens to run on.
 * @returns {string}
 */
function getConfiguredLang(): string {
  let lang: string | undefined;

  try {
    lang = CONFIG.LANGUAGE?.trim().toLowerCase();
  } catch {
    // CONFIG not initialized yet (e.g. this module was pulled in via a
    // circular import while #config is still bootstrapping)
  }

  if (!lang) {
    lang = DEFAULT_LANG;
  }

  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[i18n] Language "${lang}" not found, falling back to "${DEFAULT_LANG}"`);
    return DEFAULT_LANG;
  }

  return lang;
}

// Load languages
let currentLang: string | null = null;
let currentTranslations: Record<string, unknown> = {};
let fallbackTranslations: Record<string, unknown> = {};

function ensureLoaded(): void {
  if (currentLang !== null) return;
  currentLang = getConfiguredLang();
  currentTranslations = loadLocale(currentLang) || {};
  fallbackTranslations = loadLocale(DEFAULT_LANG) || {};
}

let availableLocales: string[] | null = null;

/**
 * Language codes with a core translation file (`src/locales/*.json`), sorted.
 */
export function getAvailableLocales(): string[] {
  if (availableLocales) return availableLocales;
  try {
    availableLocales = fs
      .readdirSync(LOCALES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
  } catch {
    availableLocales = [DEFAULT_LANG];
  }
  return availableLocales;
}

/**
 * Maps a user/plugin supplied code ("PT", "pt_BR", "es-MX") to a supported
 * locale ("pt", "pt", "es"), or `undefined` when nothing matches.
 */
export function normalizeLocale(lang: string | null | undefined): string | undefined {
  if (typeof lang !== "string") return undefined;
  const code = lang.trim().toLowerCase().replace(/_/g, "-");
  if (!code) return undefined;
  const available = getAvailableLocales();
  if (available.includes(code)) return code;
  const base = code.split("-")[0];
  return available.includes(base) ? base : undefined;
}

/**
 * Gets a nested value from an object using dot path
 * @param {object} obj
 * @param {string} key - path like "system.connected"
 * @returns {string|undefined}
 */
function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Replaces placeholders {{key}} with values from context
 * @param {string} str
 * @param {object} context
 * @returns {string}
 */
function interpolate(str: string, context: Record<string, unknown> = {}): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return context[key] !== undefined ? String(context[key]) : match;
  });
}

/**
 * Main translation function
 * @param {string} key - translation key (e.g., "system.connected")
 * @param {object} context - values to interpolate {{key}}
 * @returns {string}
 */
export function t(key: string, context: Record<string, unknown> = {}): string {
  ensureLoaded();

  return translate(currentTranslations, fallbackTranslations, key, context);
}

/**
 * Translates a key for an explicit language. This is useful for rendered
 * content that accepts a language override, such as the command menu.
 */
export function tFor(lang: string | undefined, key: string, context: Record<string, unknown> = {}): string {
  ensureLoaded();

  const targetLang = normalizeLocale(lang) ?? currentLang ?? DEFAULT_LANG;
  const targetTranslations = loadLocale(targetLang) || fallbackTranslations;
  return translate(targetTranslations, fallbackTranslations, key, context);
}

function translate(
  targetTranslations: Record<string, unknown>,
  englishTranslations: Record<string, unknown>,
  key: string,
  context: Record<string, unknown>
): string {

  // Try current language first
  let value = getNestedValue(targetTranslations, key);

  // Fallback to English if not found
  if (value === undefined) {
    value = getNestedValue(englishTranslations, key);
  }

  // If still not found, return the key
  if (value === undefined) {
    return key;
  }

  // If not string, convert
  if (typeof value !== "string") {
    return String(value);
  }

  // Interpolate values
  return interpolate(value, context);
}

/**
 * Resolves a plugin's root directory (the one containing manyplug.json)
 * starting from the entry file's directory. The manifest's `main` can point
 * into a build subfolder (e.g. "dist/main.js"), so the entry file's own
 * directory is not always the plugin root — `locale/` always lives next to
 * manyplug.json, not next to the compiled entry.
 * @param {string} startDir
 * @returns {string}
 */
function findPluginRoot(startDir: string): string {
  let dir = startDir;

  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "manyplug.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return startDir;
}

/**
 * Creates an isolated translation function for a plugin.
 * Plugins should have their own locale/ folder with en.json, es.json, etc.
 *
 * Usage in plugin:
 *   import { createPluginT } from "../../i18n/index.ts";
 *   const { t } = createPluginT(import.meta.url);
 *
 * Folder structure:
 *   myPlugin/
 *     index.ts
 *     locale/
 *       en.json
 *       es.json
 *       pt.json
 *
 * @param {string} pluginMetaUrl - import.meta.url from the plugin
 * @param {() => string|undefined} [getLang] - resolves the language per call (e.g. the chat's); defaults to the bot language
 * @returns {{ t: Function, lang: string }}
 */
export function createPluginT(pluginMetaUrl: string, getLang?: () => string | undefined) {
  const entryDir = path.dirname(fileURLToPath(pluginMetaUrl));
  const pluginDir = findPluginRoot(entryDir);
  const pluginLocaleDir = path.join(pluginDir, "locale");

  ensureLoaded();

  const cache = new Map<string, Record<string, unknown>>();
  let cacheVersion = translationsVersion;

  function loadPluginLocale(lang: string): Record<string, unknown> {
    if (cacheVersion !== translationsVersion) {
      cache.clear();
      cacheVersion = translationsVersion;
    }
    const cached = cache.get(lang);
    if (cached) return cached;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(pluginLocaleDir, `${lang}.json`), "utf8"));
      cache.set(lang, data);
      return data;
    } catch {
      // Missing or unreadable locale: not cached, so a later fix is picked up
      return {};
    }
  }

  function activeLang(): string {
    return normalizeLocale(getLang?.()) ?? (currentLang as string);
  }

  /**
   * Plugin-specific translation function. The language is resolved on every
   * call (chat language when bound to a chat, otherwise the bot default).
   */
  function pluginT(key: string, context: Record<string, unknown> = {}): string {
    let value = getNestedValue(loadPluginLocale(activeLang()), key);

    if (value === undefined) {
      value = getNestedValue(loadPluginLocale(DEFAULT_LANG), key);
    }

    if (value === undefined) {
      return key;
    }

    if (typeof value !== "string") {
      return String(value);
    }

    return interpolate(value, context);
  }

  return {
    t: pluginT,
    get lang(): string {
      return activeLang();
    },
  };
}

/**
 * Reloads translations (useful for hot-reload)
 */
export function reloadTranslations(): void {
  translations.clear();
  translationsVersion++;
  availableLocales = null;
  currentLang = null;
  ensureLoaded();

  console.log(`[i18n] Translations reloaded for language: ${currentLang}`);
}

/**
 * Returns current language
 * @returns {string}
 */
export function getCurrentLang(): string {
  ensureLoaded()
  return currentLang as string;
}

export default { t, tFor, createPluginT, reloadTranslations, getCurrentLang, getAvailableLocales, normalizeLocale };

