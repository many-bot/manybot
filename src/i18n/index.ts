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
 * Detects the OS locale without depending on a single env var, since LANG
 * isn't reliably set on macOS GUI sessions or Windows. Used as a fallback
 * when CONFIG.LANGUAGE isn't available yet (e.g. circular import during
 * config bootstrap) or isn't set.
 */
function detectSystemLang(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale.split("-")[0].toLowerCase();
  } catch {
    // Intl unavailable — fall through to env vars
  }

  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
  if (envLocale) return envLocale.split(/[_.]/)[0].toLowerCase();

  return DEFAULT_LANG;
}

/**
 * Gets configured language or falls back to system locale, then English.
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
    lang = detectSystemLang();
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

  // Try current language first
  let value = getNestedValue(currentTranslations, key);

  // Fallback to English if not found
  if (value === undefined) {
    value = getNestedValue(fallbackTranslations, key);
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
 * @returns {{ t: Function, lang: string }}
 */
export function createPluginT(pluginMetaUrl: string) {
  const pluginDir = path.dirname(fileURLToPath(pluginMetaUrl));
  const pluginLocaleDir = path.join(pluginDir, "locale");

  ensureLoaded();

  // Get bot's configured language
  const targetLang = currentLang;

  // Load plugin translations
  let pluginTranslations: Record<string, unknown> = {};
  let pluginFallback: Record<string, unknown> = {};

  try {
    // Try to load the configured language
    const targetPath = path.join(pluginLocaleDir, `${targetLang}.json`);
    if (fs.existsSync(targetPath)) {
      pluginTranslations = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    }

    // Always load English as fallback
    const fallbackPath = path.join(pluginLocaleDir, `${DEFAULT_LANG}.json`);
    if (fs.existsSync(fallbackPath)) {
      pluginFallback = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
    }
  } catch (err) {
    // Silent fail - plugin may not have translations
  }

  /**
   * Plugin-specific translation function
   * @param {string} key
   * @param {object} context
   * @returns {string}
   */
  function pluginT(key: string, context: Record<string, unknown> = {}): string {
    // Try plugin's target language first
    let value = getNestedValue(pluginTranslations, key);

    // Fallback to plugin's English
    if (value === undefined) {
      value = getNestedValue(pluginFallback, key);
    }

    // If still not found, return the key
    if (value === undefined) {
      return key;
    }

    if (typeof value !== "string") {
      return String(value);
    }

    return interpolate(value, context);
  }

  return { t: pluginT, lang: targetLang };
}

/**
 * Reloads translations (useful for hot-reload)
 */
export function reloadTranslations(): void {
  translations.clear();
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

export default { t, createPluginT, reloadTranslations, getCurrentLang };
