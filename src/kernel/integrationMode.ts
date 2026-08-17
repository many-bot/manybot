/**
 * kernel/integrationMode.ts
 *
 * Toggles the "integration" mode that gates the WhatsApp integration
 * test suite. In integration mode the bot loads a private plugin
 * (`__manybot_integration__`) whose job is to drive real-WhatsApp
 * operations from the test harness, and refuse to act in any chat
 * other than the configured `TEST_CHAT`.
 *
 * Activation requires BOTH signals (mirrors `testConfig`):
 *   - `MANYBOT_RUN_WHATSAPP_TESTS=1`  (explicit opt-in)
 *   - a configured `TEST_CHAT`        (env or manybot.toml)
 *
 * Production code never imports this module in its hot path. The
 * integration plugin loader is the only consumer; the production bot
 * does not load the integration plugin and is not affected by the
 * opt-in flag.
 *
 * The reserved plugin name uses a `__manybot_*__` double-underscore
 * pattern so it cannot collide with a real plugin (the loader's
 * normal `~/.manybot/plugins/<name>/` path does not create a
 * directory starting with `__` on user machines, and the test setup
 * installs it into a separate, non-user-controlled location).
 */

import path from "path";
import { getTestConfig, requireTestConfig } from "#kernel/testConfig.js";
import { logger } from "#logger";

/**
 * Reserved plugin name. The leading and trailing `__` are
 * deliberate: this name is documented as reserved by the runtime,
 * so no real plugin directory should ever be created with it.
 * Plugins loaded from `~/.manybot/plugins/` with names that match
 * this pattern are NOT auto-loaded by `loadPlugins()`; the
 * integration harness has to ask for them explicitly.
 */
export const INTEGRATION_PLUGIN_NAME = "__manybot_integration__";

/**
 * Absolute path to the integration plugin's source directory inside
 * the project. The plugin ships with the repo (not with the user's
 * `~/.manybot/plugins/`) and is loaded directly from `src/`.
 *
 * Resolved relative to this module so the path survives the build
 * (the plugin source is part of the published `src/` tree today;
 * if/when the integration plugin gets moved into `dist/`, only
 * this single constant needs to change).
 */
const INTEGRATION_PLUGIN_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "plugins",
  INTEGRATION_PLUGIN_NAME,
);

/** True only when the operator has set the explicit opt-in flag. */
export function isIntegrationOptIn(): boolean {
  return process.env.MANYBOT_RUN_WHATSAPP_TESTS === "1";
}

/**
 * Resolve the test config and report whether integration mode is
 * fully ready to run. Returned shape mirrors {@link getTestConfig}
 * but adds the convenience `ready` flag and a `reason` for "not
 * ready" — both `null` when the suite can run.
 */
export interface IntegrationModeStatus {
  ready: boolean;
  reason: string | null;
  chat:  string | null;
  source: import("#kernel/testConfig.js").TestChatSource;
}

export async function getIntegrationModeStatus(): Promise<IntegrationModeStatus> {
  const cfg = await getTestConfig();
  if (!isIntegrationOptIn()) {
    return {
      ready: false,
      reason: `MANYBOT_RUN_WHATSAPP_TESTS=1 is required to enable integration mode`,
      chat:   cfg.chat,
      source: cfg.source,
    };
  }
  if (cfg.chat === null) {
    return {
      ready: false,
      reason: cfg.skipReason,
      chat:   null,
      source: null,
    };
  }
  return { ready: true, reason: null, chat: cfg.chat, source: cfg.source };
}

/**
 * Hard version: throws if integration mode is not fully ready. Use
 * this at the entry point of every test that touches the real bot.
 */
export async function requireIntegrationMode(): Promise<{
  chat: string;
  source: import("#kernel/testConfig.js").TestChatSource;
}> {
  if (!isIntegrationOptIn()) {
    throw new Error(
      `[integrationMode] cannot run: MANYBOT_RUN_WHATSAPP_TESTS=1 is required. ` +
      `Set it explicitly to opt in to the real-WhatsApp test suite.`
    );
  }
  const cfg = await requireTestConfig();
  logger.info(
    `[integrationMode] enabled — chat=${cfg.chat} source=${cfg.source}`
  );
  return { chat: cfg.chat, source: cfg.source };
}

/** Absolute path of the integration plugin's source directory. */
export function getIntegrationPluginDir(): string {
  return INTEGRATION_PLUGIN_DIR;
}
