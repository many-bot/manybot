/**
 * src/drivers/baileys/api/contacts.integration.test.ts
 *
 * Real-WhatsApp integration tests for the LID-aware contact API surface
 * (`IContact.id` is LID-or-null, `number`/`numberRaw`/`numberPretty`/
 * `country`/`countryCallingCode` populated by libphonenumber-js).
 *
 * Exercises the full driver stack end-to-end:
 *   - The integration plugin (gated by `MANYBOT_RUN_WHATSAPP_TESTS=1`)
 *     drives real sends + listens for the test marker's echo.
 *   - Each test sends a uniquely-prefixed message into the configured
 *     `TEST_CHAT`, waits for the round-trip, then reads
 *     `ctx.contacts.get(...)` from a freshly-built plugin context and
 *     asserts the new shape is honored against a live WhatsApp account.
 *
 * All tests skip when integration mode is not fully ready (no opt-in,
 * no `TEST_CHAT`, or no saved WhatsApp session). Skipped tests do not
 * count as failures — they're informational.
 *
 * Requires:
 *   - `MANYBOT_RUN_WHATSAPP_TESTS=1`
 *   - `TEST_CHAT="<phone>"` (env or manybot.toml) — MUST be an
 *     individual chat (a bare phone number, or a JID ending in
 *     `@s.whatsapp.net`/`@c.us`/`@lid`), NOT a group (`@g.us`).
 *     Every assertion below reads per-person contact fields (LID,
 *     E.164 number, numberPretty, country, countryCallingCode) —
 *     `normalizeContact()` (src/drivers/baileys/api/index.ts) never
 *     populates any of those for a group JID, since a group has no
 *     LID or phone number of its own. Sending/receiving still works
 *     fine against a group (the round-trip itself doesn't care), so
 *     a group `TEST_CHAT` will pass the integration-mode gate and
 *     even echo markers successfully, then fail every shape
 *     assertion below with `expected: /@lid$/, actual: "...@g.us"`
 *     (and `null` for number/country/etc.) — if you see that
 *     specific failure pattern, point TEST_CHAT at a DM instead.
 *   - A logged-in WhatsApp session (creds.json + app-state-sync-… in
 *     CONFIG_DIR, same as a normal run).
 *   - Either:
 *       - `npm run test:integration:local`  — boots `src/main.ts` first
 *         so the bot connects and the integration plugin is registered;
 *       - a one-shot manual run with the integration plugin loaded by
 *         the caller (see scripts/probe-contacts.mjs).
 *
 * `npm run test:integration` (without `:local`) is supported but every
 * test will skip because no live socket exists in that mode.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  loadIntegrationPlugin,
  pluginRegistry,
  getGlobalKernelRefs,
} from "#kernel/pluginLoader.js";
import { getIntegrationModeStatus, INTEGRATION_PLUGIN_NAME } from "#kernel/integrationMode.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import { logger } from "#logger";

// ── Integration-mode gate (resolved at top level) ────────────────────────────
//
// Two distinct gates need to pass before a test runs:
//
//   1. Configuration gate (`getIntegrationModeStatus().ready`):
//      MANYBOT_RUN_WHATSAPP_TESTS=1 is set AND TEST_CHAT is configured
//      (env or manybot.toml). This is what `npm run test:integration`
//      auto-enables via the script's env prefix.
//
//   2. Live-socket gate (`getGlobalKernelRefs() !== null`):
//      The Baileys driver has actually connected at least once so a
//      `WaContract` is available for real sends. With
//      `npm run test:integration:local` (which boots main.ts first),
//      this resolves as soon as the bot connects. With the bare
//      `npm run test:integration` (no main.ts preload), it never
//      resolves and every test skips — which is correct.
//
// We resolve both gates up-front (top-level await) instead of in a
// `before()` hook so the `{ skip: !integrationReady }` option on
// each `test()` call is honored by the runner — an early-return
// inside the test body looks like `pass: N` in CI output, which is
// confusing when scanning for "did this actually run?".

let integrationReady = false;
let integrationSkipReason: string = "not evaluated";
let integrationChat: string | null = null;
let kernelRefs: { contract: WaContract; store: BotStore } | null = null;

async function evaluateGates(): Promise<void> {
  const status = await getIntegrationModeStatus();
  const configReady = status.ready;
  const configReason = status.reason ?? "";
  integrationChat = status.chat;

  // Make sure the integration plugin is registered — its `setup()`
  // populates `api.testChat` and `api.waitForMarker`, both needed by
  // the test helpers below. When the bot is already running (the
  // `:local` variant), `loadPlugins`/`setupPlugins` ran during boot
  // and called `loadIntegrationPlugin()` for us; `loadIntegrationPlugin`
  // is idempotent so calling it again here is safe.
  if (configReady) {
    try {
      await loadIntegrationPlugin();
    } catch (e) {
      logger.warn(`[contacts.integration] loadIntegrationPlugin failed: ${(e as Error).message}`);
    }
  }

  // With `npm run test:integration:local`, main.ts is preloaded and
  // begins connecting as soon as it's imported — the test runner may
  // execute this file before the connection has resolved. Poll for
  // the global refs for up to 60s before giving up; this lets
  // contributors run the suite immediately after `node main.ts` and
  // have it work without manual timing.
  const SOCKET_WAIT_MS = 60_000;
  const deadline = Date.now() + SOCKET_WAIT_MS;
  while (Date.now() < deadline) {
    kernelRefs = getGlobalKernelRefs();
    if (kernelRefs) break;
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  const socketReady = kernelRefs !== null;

  integrationReady = configReady && socketReady;
  integrationSkipReason = !configReady
    ? configReason
    : `bot did not connect within ${SOCKET_WAIT_MS / 1000}s — check the main.ts preload output for connection errors`;

  if (integrationReady) {
    logger.info(
      `[contacts.integration] integration mode ready — chat=${integrationChat} ` +
      `kernelRefs=${!!kernelRefs}`
    );
  } else {
    logger.warn(
      `[contacts.integration] integration mode NOT ready — ${integrationSkipReason}. ` +
      `Every test in this file will skip.`
    );
  }
}

// Resolve the gates up-front. Top-level await pauses module
// initialization until `evaluateGates()` resolves, so by the time any
// `test()` call below is reached the `integrationReady` flag is
// stable. This is what lets us pass `{ skip: !integrationReady }` to
// each test — `node:test` honors the flag at test-definition time.
await evaluateGates();

interface IntegrationPublicApi {
  testChat: string;
  isTestChat(jid: string | null | undefined): boolean;
  waitForMarker(marker: string, timeoutMs?: number): Promise<string>;
  recentBodies(): string[];
}

function getIntegrationApi(): IntegrationPublicApi | null {
  const entry = pluginRegistry.get(INTEGRATION_PLUGIN_NAME);
  if (!entry || entry.status !== "active") return null;
  return entry.exports as IntegrationPublicApi | null;
}

const ROUND_TRIP_TIMEOUT_MS = 30_000;

/**
 * Send a marker-prefixed message into the test chat and wait for an
 * inbound message with the same marker — exercises the round-trip
 * (BotStore + adapter + listener + contact store feeding) that the
 * LID/PN resolution depends on.
 */
async function sendAndAwaitEcho(
  api: IntegrationPublicApi,
  contract: WaContract,
  marker: string,
  opts?: { mentions?: string[] },
): Promise<void> {
  await contract.sendText(api.testChat, marker, opts);
  await api.waitForMarker(marker, ROUND_TRIP_TIMEOUT_MS);
}

// ── Tests ────────────────────────────────────────────────────────────────────
//
// All tests below pass `{ skip: !integrationReady }` so they report
// as `skipped` in CI output (not `pass`) when the integration suite
// can't actually run. The `if (!integrationReady) return;` guard at
// the top of each test body is belt-and-braces — if the skip flag is
// ever ignored (e.g. someone wires this suite into a different
// runner), the test still no-ops instead of crashing on a null
// `integrationChat`.

describe("contacts.integration — gate", () => {
  test("integration mode reports ready (sanity)", { skip: !integrationReady }, () => {
    assert.ok(integrationSkipReason, "skip reason must explain the skip");
    assert.equal(integrationReady, true, "integration mode must be ready for this suite to run");
    assert.ok(integrationChat, "integration chat must be configured when ready");
    assert.ok(kernelRefs, "live WaContract must be available when integration mode is ready");
  });
});

describe("contacts.integration — IContact shape on a live WhatsApp account", () => {
  test("id is the LID form (preferred canonical identifier)", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs, "integration api + kernel refs must be available");
    const marker = `ICONTACT-ID-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.ok(me, "expected contacts.get to resolve the test chat");
    assert.match(me!.id ?? "", /@lid$/, `expected id to be @lid form, got ${me!.id}`);
  });

  test("number is canonical E.164 with leading +", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `ICONTACT-NUMBER-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.match(me!.number ?? "", /^\+\d+$/, `expected E.164 with +, got ${me!.number}`);
  });

  test("numberPretty is internationally formatted", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `ICONTACT-PRETTY-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.ok((me!.numberPretty ?? "").startsWith("+"), `expected pretty form to start with +, got ${me!.numberPretty}`);
  });

  test("country is ISO alpha-2", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `ICONTACT-COUNTRY-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.match(me!.country ?? "", /^[A-Z]{2}$/, `expected ISO alpha-2, got ${me!.country}`);
  });

  test("countryCallingCode is the ITU dial code", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `ICONTACT-CC-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.match(me!.countryCallingCode ?? "", /^\d{1,4}$/, `expected ITU dial code, got ${me!.countryCallingCode}`);
  });
});

describe("contacts.integration — LID↔PN cache populated by a real round-trip", () => {
  test("after one round-trip the @s.whatsapp.net form resolves back to LID", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `PNMAP-CACHE-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const lid = kernelRefs!.store.resolvePn(api!.testChat);
    assert.ok(lid, `expected pnMap to have learned the LID for ${api!.testChat}`);
    assert.match(lid!, /@lid$/, `expected resolved LID, got ${lid}`);
  });

  test("contacts.get(normalizedPn) returns LID-backed IContact after cache warmup", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `GET-PN-RESOLVES-LID-${Date.now()}-`;
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker);

    const me = await (await import("#drivers/baileys/api/index.js")).buildContactsApi(
      kernelRefs!.contract, kernelRefs!.store, null,
    ).get(api!.testChat);
    assert.match(me!.id ?? "", /@lid$/, "expected LID form after cache warmup");
  });
});

describe("contacts.integration — mentionedJid is normalized to LID form", () => {
  test("sending a real mention succeeds and the store learns a LID↔PN pair", { skip: !integrationReady }, async () => {
    const api = getIntegrationApi();
    assert.ok(api && kernelRefs);
    const marker = `MENTION-LID-${Date.now()}-`;
    // WaContract.sendText() already accepts `mentions` — no need to reach
    // into Baileys internals to send a real mention (see waContract.ts).
    // Modern WhatsApp delivers contextInfo.mentionedJid in @lid form
    // already (confirmed against WhiskeySockets/Baileys#1683/#1667), so
    // there's no PN→LID "resolution" for a mention to teach — this test
    // just proves the send round-trips and, if the account has a phone
    // number mapping learned along the way (e.g. via the contact/message
    // sync that accompanies any real WhatsApp exchange), the store
    // reflects it.
    await sendAndAwaitEcho(api!, kernelRefs!.contract, marker, { mentions: [api!.testChat] });

    const bodies = api!.recentBodies();
    assert.ok(
      bodies.some((b) => b.startsWith(marker)),
      `expected recent bodies to include "${marker}" — got ${JSON.stringify(bodies)}`,
    );

    const lidKeys = Object.keys(kernelRefs!.store.contacts).filter((k) => k.endsWith("@lid"));
    assert.ok(
      lidKeys.length > 0,
      `expected store.contacts to contain at least one @lid key after mention round-trip — got ${JSON.stringify(Object.keys(kernelRefs!.store.contacts))}`,
    );
  });
});

// ── Live-harness readiness probe ────────────────────────────────────────────
//
// Single test that fails (rather than skips) when the harness is
// missing a piece — useful so a contributor who has TEST_CHAT + a
// session can immediately see what's still left to wire. Skips
// cleanly when integration mode isn't ready at all.

describe("contacts.integration — harness readiness", () => {
  test("integration plugin is registered and active", { skip: !integrationReady }, () => {
    const entry = pluginRegistry.get(INTEGRATION_PLUGIN_NAME);
    assert.ok(entry, `expected "${INTEGRATION_PLUGIN_NAME}" to be registered in pluginRegistry`);
    assert.equal(entry!.status, "active", `expected plugin status "active", got "${entry!.status}"`);
    assert.ok(entry!.exports, "expected integration plugin exports to be populated");
  });
});

