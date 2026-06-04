/**
 * i18n/index.js
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
const translations = new Map();

/**
 * Loads a translation JSON file
 * @param {string} lang - language code (en, pt, es)
 * @returns {object|null}
 */
function loadLocale(lang) {
  if (translations.has(lang)) {
    return translations.get(lang);
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
  } catch (err) {
    console.error(`[i18n] Failed to load locale ${lang}:`, err.message);
    return null;
  }
}

/**
 * Gets configured language or default
 * @returns {string}
 */
function getConfiguredLang() {
  const lang = CONFIG.LANGUAGE?.trim().toLowerCase();
  if (!lang) return DEFAULT_LANG;

  // Check if file exists
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[i18n] Language "${lang}" not found, falling back to "${DEFAULT_LANG}"`);
    return DEFAULT_LANG;
  }

  return lang;
}

// Load languages
const currentLang = getConfiguredLang();
const currentTranslations = loadLocale(currentLang) || {};
const fallbackTranslations = loadLocale(DEFAULT_LANG) || {};

/**
 * Gets a nested value from an object using dot path
 * @param {object} obj
 * @param {string} key - path like "system.connected"
 * @returns {string|undefined}
 */
function getNestedValue(obj, key) {
  const parts = key.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Replaces placeholders {{key}} with values from context
 * @param {string} str
 * @param {object} context
 * @returns {string}
 */
function interpolate(str, context = {}) {
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
export function t(key, context = {}) {
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
 *   import { createPluginT } from "../../i18n/index.js";
 *   const { t } = createPluginT(import.meta.url);
 *
 * Folder structure:
 *   myPlugin/
 *     index.js
 *     locale/
 *       en.json
 *       es.json
 *       pt.json
 *
 * @param {string} pluginMetaUrl - import.meta.url from the plugin
 * @returns {{ t: Function, lang: string }}
 */
export function createPluginT(pluginMetaUrl) {
  const pluginDir = path.dirname(fileURLToPath(pluginMetaUrl));
  const pluginLocaleDir = path.join(pluginDir, "locale");

  // Get bot's configured language
  const targetLang = currentLang;

  // Load plugin translations
  let pluginTranslations = {};
  let pluginFallback = {};

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
  function pluginT(key, context = {}) {
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
export function reloadTranslations() {
  translations.clear();
  const lang = getConfiguredLang();
  const newTranslations = loadLocale(lang) || {};
  const newFallback = loadLocale(DEFAULT_LANG) || {};

  // Update references
  Object.assign(currentTranslations, newTranslations);
  Object.assign(fallbackTranslations, newFallback);

  console.log(`[i18n] Translations reloaded for language: ${lang}`);
}

/**
 * Returns current language
 * @returns {string}
 */
export function getCurrentLang() {
  return currentLang;
}

export default { t, createPluginT, reloadTranslations, getCurrentLang };
