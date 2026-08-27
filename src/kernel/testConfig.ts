/**
 * kernel/testConfig.ts
 *
 * Reads the configuration that gates the WhatsApp integration test suite.
 *
 * Two values are exposed:
 *
 *   1. `chat` — the JID (or bare phone number) of the chat the integration
 *      suite is allowed to exercise. Comes from, in precedence order:
 *        a. environment variable `TEST_CHAT`
 *        b. `TEST_CHAT` key in `manybot.toml`
 *        c. otherwise absent (`chat === null`) — integration tests skip
 *           with an explanatory message instead of crashing.
 *
 *      This module accepts any chat shape `normalizeTestChat()` allows,
 *      including a group (`@g.us`) — it has no opinion on what a given
 *      test file actually needs. Individual suites are the ones with
 *      that requirement: contacts.integration.test.ts, for instance,
 *      needs an individual chat (a phone number, or a JID ending in
 *      `@s.whatsapp.net`/`@c.us`/`@lid`) because it asserts on
 *      per-person contact fields (LID, number, country) that a group
 *      simply doesn't have — see that file's own header for details.
 *
 *   2. `runWhatsApp` — explicit opt-in flag (env `MANYBOT_RUN_WHATSAPP_TESTS=1`).
 *      A saved WhatsApp session plus a `TEST_CHAT` is NOT enough to fire real
 *      messages; this is the single, deliberate signal that the operator
 *      actually wants the integration suite to run.
 *
 * The module never throws on its own. `getTestConfig()` returns the
 * resolved state and lets the caller decide what to do (skip vs run vs
 * fail). `requireTestConfig()` is the hard version for code paths that
 * must not run without a configured chat + opt-in.
 *
 * Deliberately kept out of `CONFIG` — `TEST_CHAT` is a test-time
 * concern and shouldn't pollute the runtime config object's shape.
 */

import fs from "fs/promises";
import { parse as parseToml } from "smol-toml";
import { CONFIG_DIR, TOML_CONFIG_FILE } from "#config";
import { logger } from "#logger";

// ── Constants ───────────────────────────────────────────────────────────────

/** Env var that signals "yes, the integration suite should really run". */
export const RUN_WHATSAPP_TESTS_ENV = "MANYBOT_RUN_WHATSAPP_TESTS";

/** Env var that overrides any value set in manybot.toml. */
export const TEST_CHAT_ENV = "TEST_CHAT";

/** Key read from manybot.toml as a fallback when the env var is unset. */
export const TEST_CHAT_TOML_KEY = "TEST_CHAT";

// ── Types ───────────────────────────────────────────────────────────────────

export type TestChatSource = "env" | "toml" | null;

export interface TestConfig {
  /**
   * Normalized JID for the integration chat, or `null` when no
   * `TEST_CHAT` value is found in the env or `manybot.toml`.
   */
  chat:    string | null;
  /**
   * Where `chat` came from. `null` when `chat` is `null` — a
   * `source === null && chat === null` pair is the "skip me" signal.
   */
  source:  TestChatSource;
  /**
   * True only when the operator has set the explicit opt-in flag
   * (`MANYBOT_RUN_WHATSAPP_TESTS=1`). Defaults to false.
   */
  runWhatsApp: boolean;
  /**
   * Reasons each piece of the test config is missing — useful for
   * explaining skips in the test runner output.
   */
  skipReason: string | null;
}

// ── JID normalization ──────────────────────────────────────────────────────

/**
 * Acceptable chat-id shapes:
 *   - bare number:                 "5516999999999"
 *   - WhatsApp PN JID:             "5516999999999@s.whatsapp.net"
 *   - legacy framework PN JID:     "5516999999999@c.us"
 *   - LID JID:                     "1234@lid"
 *   - group JID:                   "120363…@g.us"
 *
 * Any other suffix is rejected so the integration plugin can rely on
 * `chat.endsWith(...)` checks and not silently mismatch. Bare numbers
 * are normalized to the WhatsApp PN JID form (the form the bot's own
 * contract uses to reach that contact).
 */
export function normalizeTestChat(raw: string): string {
  if (typeof raw !== "string") {
    throw new TypeError(`TEST_CHAT must be a string, got ${typeof raw}`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("TEST_CHAT is empty");
  }

  const ALLOWED_SUFFIXES = ["@s.whatsapp.net", "@c.us", "@lid", "@g.us"] as const;
  for (const suffix of ALLOWED_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      const local = trimmed.slice(0, -suffix.length);
      if (local === "" || /[^\dA-Za-z._-]/.test(local)) {
        throw new Error(`TEST_CHAT has invalid local part: "${raw}"`);
      }
      return trimmed;
    }
  }

  // Bare number — accept digits, plus, and the leading "+".
  if (/^\+?\d+$/.test(trimmed)) {
    return `${trimmed.replace(/^\+/, "")}@s.whatsapp.net`;
  }

  throw new Error(
    `TEST_CHAT must be a bare phone number or a JID with one of: ` +
    `${ALLOWED_SUFFIXES.join(", ")} — got "${raw}"`
  );
}

// ── Resolution ──────────────────────────────────────────────────────────────

async function readTomlTestChat(): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(TOML_CONFIG_FILE, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`[testConfig] could not read ${TOML_CONFIG_FILE}: ${(e as Error).message}`);
    }
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw) as Record<string, unknown>;
  } catch (e) {
    logger.warn(`[testConfig] invalid TOML in ${TOML_CONFIG_FILE}: ${(e as Error).message}`);
    return null;
  }

  const value = parsed[TEST_CHAT_TOML_KEY];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    logger.warn(`[testConfig] ${TEST_CHAT_TOML_KEY} in TOML is not a string, ignoring`);
    return null;
  }
  return value.trim() === "" ? null : value;
}

let cached: TestConfig | null = null;

/**
 * Resolve the test configuration. Result is cached after the first call
 * because the env and `manybot.toml` don't change mid-process; the
 * cache gives every test a stable view without re-reading disk.
 */
export async function getTestConfig(): Promise<TestConfig> {
  if (cached) return cached;

  const envValue = process.env[TEST_CHAT_ENV];
  let raw: string | null = null;
  let source: TestChatSource = null;

  if (typeof envValue === "string" && envValue.trim() !== "") {
    raw = envValue;
    source = "env";
  } else {
    const tomlValue = await readTomlTestChat();
    if (tomlValue) {
      raw = tomlValue;
      source = "toml";
    }
  }

  let chat: string | null = null;
  if (raw !== null) {
    try {
      chat = normalizeTestChat(raw);
    } catch (e) {
      logger.warn(`[testConfig] ${(e as Error).message}`);
    }
  }

  const runWhatsApp = process.env[RUN_WHATSAPP_TESTS_ENV] === "1";

  let skipReason: string | null = null;
  if (chat === null) {
    skipReason =
      `TEST_CHAT is not set (env ${TEST_CHAT_ENV} or key ` +
      `${TEST_CHAT_TOML_KEY} in ${TOML_CONFIG_FILE})`;
  } else if (!runWhatsApp) {
    skipReason =
      `${RUN_WHATSAPP_TESTS_ENV}=1 is required to run the WhatsApp ` +
      `integration suite (TEST_CHAT alone is not enough)`;
  }

  cached = { chat, source, runWhatsApp, skipReason };
  return cached;
}

/**
 * Hard version of {@link getTestConfig}: throws if the chat is not
 * configured or the opt-in flag is missing. Use this in code paths that
 * should never run unless the operator has consciously opted in.
 */
export async function requireTestConfig(): Promise<TestConfig & { chat: string }> {
  const cfg = await getTestConfig();
  if (cfg.chat === null) {
    throw new Error(
      `[testConfig] cannot run: ${cfg.skipReason}. ` +
      `Set ${TEST_CHAT_ENV} or add '${TEST_CHAT_TOML_KEY} = "…"' to ${TOML_CONFIG_FILE}.`
    );
  }
  if (!cfg.runWhatsApp) {
    throw new Error(
      `[testConfig] cannot run without opt-in: ${cfg.skipReason}. ` +
      `Re-run with ${RUN_WHATSAPP_TESTS_ENV}=1.`
    );
  }
  return cfg as TestConfig & { chat: string };
}

/**
 * Test-only — drops the cached value so the next `getTestConfig()`
 * call re-reads env and disk. Use this after mutating env vars in a
 * test; production code must not call it.
 */
export function _resetTestConfigForTests(): void {
  cached = null;
}

// Keep `CONFIG_DIR` referenced so this module participates in the
// project's path-resolution behavior the same way other kernel modules
// do, and so future test fixtures that need to point at a different
// config dir (e.g. MANYBOT_CONFIG_DIR) keep working.
void CONFIG_DIR;

