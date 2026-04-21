/**
 * src/utils/pluginI18n.js
 *
 * Independent i18n system for plugins.
 * Plugins load their own translations from locale/ folder.
 * Completely separate from bot core i18n.
 *
 * Usage in plugin:
 *   import { createPluginI18n } from "../utils/pluginI18n.js";
 *   const { t } = createPluginI18n(import.meta.url);
 *
 * Folder structure:
 *   myPlugin/
 *     index.js
 *     locale/
 *       en.json (required - fallback)
 *       pt.json
 *       es.json
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LANGUAGE } from "../config.js";

// Default/fallback language
const DEFAULT_LANG = "en";

/**
 * Gets a nested value from an object using dot path
 * @param {object} obj
 * @param {string} key - path like "error.notFound"
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
 * Load translations for a plugin
 * @param {string} localeDir - path to plugin's locale folder
 * @param {string} lang - target language
 * @returns {{ translations: object, fallback: object }}
 */
function loadTranslations(localeDir, lang) {
  let translations = {};
  let fallback     = {};

  try {
    const targetPath = path.join(localeDir, `${lang}.json`);
    if (fs.existsSync(targetPath)) {
      translations = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    }

    const fallbackPath = path.join(localeDir, `${DEFAULT_LANG}.json`);
    if (fs.existsSync(fallbackPath)) {
      fallback = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
    }
  } catch {
    // Silent fail - plugin may not have translations
  }

  return { translations, fallback };
}

/**
 * Creates an isolated translation function for a plugin.
 * Language priority: PLUGIN_LANG env var > manybot.conf LANGUAGE > en
 *
 * @param {string} pluginMetaUrl - import.meta.url from the plugin
 * @returns {{ t: Function, lang: string }}
 */
export function createPluginI18n(pluginMetaUrl) {
  const pluginDir = path.dirname(fileURLToPath(pluginMetaUrl));
  const localeDir = path.join(pluginDir, "locale");

  const targetLang =
    process.env.PLUGIN_LANG?.trim().toLowerCase() ||
    LANGUAGE?.trim().toLowerCase()                ||
    DEFAULT_LANG;

  const { translations, fallback } = loadTranslations(localeDir, targetLang);

  /**
   * Translation function
   * @param {string} key - translation key (e.g., "error.notFound")
   * @param {object} context - values to interpolate {{key}}
   * @returns {string}
   */
  function t(key, context = {}) {
    let value = getNestedValue(translations, key);

    if (value === undefined) {
      value = getNestedValue(fallback, key);
    }

    if (value === undefined) return key;

    if (typeof value !== "string") return String(value);

    return interpolate(value, context);
  }

  return { t, lang: targetLang };
}

export default { createPluginI18n };