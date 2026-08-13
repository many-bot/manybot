/**
 * plugins/__manybot_integration__/index.ts
 *
 * Internal integration plugin for the WhatsApp test suite. NOT a
 * user-facing plugin — only the test harness loads it, and only when
 * integration mode is enabled (see `kernel/integrationMode.ts`).
 *
 * Responsibilities:
 *   - Refuse to act on any chat other than the configured TEST_CHAT.
 *     Anything arriving in another chat is dropped with a warning,
 *     never replied to.
 *   - Expose a small public API the test harness drives:
 *       - `testChat`        — the JID we will respond in.
 *       - `isTestChat(jid)` — true iff `jid` matches the test chat.
 *       - `waitForMarker(marker, timeoutMs)`
 *                            — resolves with the message id of the
 *                              first inbound message in the test chat
 *                              whose body starts with `marker`. Used
 *                              by tests to observe real round-trips
 *                              (e.g. "send a message, wait until the
 *                              contact echoes it back").
 *   - Keep a bounded ring buffer of recent message bodies in the
 *     test chat so tests can also assert on what was sent earlier
 *     in the same run.
 *
 * This plugin is intentionally minimal — it does NOT register user
 * commands, does NOT participate in the `commands.yaml` registry,
 * and shuts down cleanly via the normal plugin cleanup path
 * (cleanupPluginEvents is driven by the kernel, not by us).
 *
 * Imports are restricted to types and the `events` module from the
 * kernel — never a driver package, never the raw socket. The
 * `ctx.wa.contract` neutral access is the only driver surface used
 * (and only for `me()` and any helper the test harness invokes).
 */

import { EventEmitter } from "node:events";
import { logger } from "#logger";
import { INTEGRATION_PLUGIN_NAME } from "#kernel/integrationMode.js";
import type { PluginContext, SetupContext } from "#kernel/pluginApi.js";

const RING_BUFFER_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

interface IntegrationPublicApi {
  testChat: string;
  isTestChat(jid: string | null | undefined): boolean;
  waitForMarker(marker: string, timeoutMs?: number): Promise<string>;
  recentBodies(): string[];
}

interface RecentEntry {
  body:  string;
  from:  string;
  ts:    number;
}

let configuredTestChat: string | null = null;
const recent = new Map<number, RecentEntry>();
let recentSeq = 0;
const waiter = new EventEmitter();

function pushRecent(body: string, from: string): void {
  const id = ++recentSeq;
  recent.set(id, { body, from, ts: Date.now() });
  // Cap the ring buffer; eviction keeps insertion order.
  while (recent.size > RING_BUFFER_LIMIT) {
    const firstKey = recent.keys().next().value;
    if (firstKey === undefined) break;
    recent.delete(firstKey);
  }
}

function findByMarker(marker: string): RecentEntry | null {
  for (const entry of recent.values()) {
    if (entry.body.startsWith(marker)) return entry;
  }
  return null;
}

export const api: IntegrationPublicApi = {
  testChat: "", // populated in setup()
  isTestChat(jid) {
    if (!jid) return false;
    if (!configuredTestChat) return false;
    return jid === configuredTestChat;
  },
  async waitForMarker(marker, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const existing = findByMarker(marker);
    if (existing) {
      // Return a synthetic id; tests that need the real id should
      // observe the `messages.upsert` payload directly.
      return `recent:${existing.ts}`;
    }
    return new Promise<string>((resolve, reject) => {
      const onHit = (entry: RecentEntry) => {
        if (!entry.body.startsWith(marker)) return;
        waiter.off("hit", onHit);
        clearTimeout(timer);
        resolve(`recent:${entry.ts}`);
      };
      const timer = setTimeout(() => {
        waiter.off("hit", onHit);
        reject(new Error(
          `[${INTEGRATION_PLUGIN_NAME}] waitForMarker("${marker}") timed out after ${timeoutMs}ms`
        ));
      }, timeoutMs);
      waiter.on("hit", onHit);
    });
  },
  recentBodies() {
    return [...recent.values()].map((e) => e.body);
  },
};

/**
 * setup() runs once after the bot connects. We capture the test
 * chat here so the runtime API can refuse any other chat.
 */
export async function setup(ctx: SetupContext): Promise<void> {
  // The integration chat is decided by the harness BEFORE
  // setupPlugins() is called. Historically the harness set
  // MANYBOT_TEST_CHAT, but users often set TEST_CHAT (per docs).
  // Accept either, normalizing the value to the canonical JID form.
  // Keep behavior strict: if neither is set, fail.
  const rawEnv = process.env.MANYBOT_TEST_CHAT ?? process.env.TEST_CHAT;
  if (!rawEnv) {
    throw new Error(
      `[${INTEGRATION_PLUGIN_NAME}] setup() called without MANYBOT_TEST_CHAT or TEST_CHAT — ` +
      `set MANYBOT_TEST_CHAT (preferred) or TEST_CHAT before setupPlugins().`
    );
  }

  // Normalize and validate the provided chat identifier.
  let normalized: string;
  try {
    // Importing normalizeTestChat here keeps the module load cheap
    // when the plugin isn't used in production code paths.
    // eslint-disable-next-line import/no-extraneous-dependencies
    const { normalizeTestChat } = await import("#kernel/testConfig.js");
    normalized = normalizeTestChat(rawEnv);
  } catch (e) {
    throw new Error(
      `[${INTEGRATION_PLUGIN_NAME}] invalid test chat provided: ${(e as Error).message}`
    );
  }

  configuredTestChat = normalized;
  api.testChat = normalized;

  // Subscribe to the relevant events so waitForMarker works
  // without requiring a polling loop. `messages.upsert` is the
  // single source of truth for any new incoming message; `on()`
  // returns an unsubscribe handle, but cleanupPluginEvents takes
  // care of it for us.
  ctx.events.on("messages.upsert", (payload: unknown) => {
    const p = payload as { messages?: Array<{ chatId?: string; body?: string; from?: string }> };
    const messages = p.messages ?? [];
    for (const m of messages) {
      if (!m.chatId || m.chatId !== configuredTestChat) continue;
      const body = m.body ?? "";
      const from = m.from ?? "";
      pushRecent(body, from);
      waiter.emit("hit", { body, from, ts: Date.now() });
    }
  });

  logger.info(
    `[${INTEGRATION_PLUGIN_NAME}] loaded — locked to test chat ${configuredTestChat}`
  );
  // ctx reserved for future use (e.g. registering a scheduler)
  return void ctx;
}

/**
 * default(ctx) runs on every inbound message. We are deliberately
 * quiet outside the test chat so a stray message in a production
 * chat never gets a reply from the test plugin; we never throw,
 * because throwing would propagate up to messageHandler and
 * potentially break unrelated plugins.
 */
export default async function handle(ctx: PluginContext): Promise<void> {
  if (!configuredTestChat) {
    logger.warn(
      `[${INTEGRATION_PLUGIN_NAME}] default() called before setup() — ignoring`
    );
    return;
  }
  if (ctx.chat.id !== configuredTestChat) {
    logger.warn(
      `[${INTEGRATION_PLUGIN_NAME}] ignoring message from non-test chat ${ctx.chat.id}`
    );
    return;
  }
  // No automatic reply: the test harness drives every send through
  // `ctx.send.*` or `contract.send*` and waits on `waitForMarker`
  // for the round-trip. Keeping the plugin passive here is what
  // makes the suite easy to reason about.
}
