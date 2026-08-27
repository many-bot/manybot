#!/usr/bin/env node
// scripts/probe-contacts.mjs
//
// Manual smoke-test for the LID-aware contact API. Connects to
// WhatsApp (using your saved session like a normal `node dist/main.js`
// run), waits for the bot to come up, then drives a series of
// marker-prefixed round-trips against the configured TEST_CHAT and
// prints the resulting `IContact` shape — `id`, `number`,
// `numberRaw`, `numberPretty`, `country`, `countryCallingCode`.
//
// Print output looks like:
//   ┌─ round-trip #1 (ICONTACT-ID-…): PASS
//   │  id                     = "128570…@lid"
//   │  number                 = "+5516994620899"
//   │  numberRaw              = "5516994620899"
//   │  numberPretty           = "+55 16 99462-0899"
//   │  country                = "BR"
//   │  countryCallingCode     = "55"
//   └─
//
// Use this when you don't want to spin up the full `node:test`
// integration suite but want to verify the new IContact shape is
// returning the expected fields against your real WhatsApp account.
//
//   MANYBOT_RUN_WHATSAPP_TESTS=1 TEST_CHAT="5516994620899" \
//     node --import ./src/main.ts scripts/probe-contacts.mjs
//
// Or with the built `dist/`:
//   MANYBOT_RUN_WHATSAPP_TESTS=1 TEST_CHAT="5516994620899" \
//     node --import ./dist/main.js scripts/probe-contacts.mjs

import { setTimeout as wait } from "node:timers/promises";

const PROBE_TIMEOUT_MS = 60_000;
const ROUND_TRIP_TIMEOUT_MS = 30_000;

const { getGlobalKernelRefs } = await import("../src/kernel/pluginLoader.js");
const { INTEGRATION_PLUGIN_NAME, requireIntegrationMode } = await import(
  "../src/kernel/integrationMode.js"
);
const { pluginRegistry } = await import("../src/kernel/pluginLoader.js");
const { buildContactsApi } = await import("../src/drivers/baileys/api/index.js");

const cfg = await requireIntegrationMode();
console.log(`[probe] TEST_CHAT=${cfg.chat} (source=${cfg.source})`);

// Wait for the global refs (Baileys connected) + integration plugin
// loaded. With `--import ./src/main.ts`, main.ts kicks off the
// connection on import; we just wait for it to resolve.
let refs = null;
const deadline = Date.now() + PROBE_TIMEOUT_MS;
while (Date.now() < deadline) {
  refs = getGlobalKernelRefs();
  if (refs) break;
  await wait(250);
}
if (!refs) {
  console.error("[probe] ERROR: bot did not connect within 60s — check main.ts preload output");
  process.exit(1);
}
console.log(`[probe] bot connected — store + contract available`);

const integrationEntry = pluginRegistry.get(INTEGRATION_PLUGIN_NAME);
if (!integrationEntry || integrationEntry.status !== "active") {
  console.error(`[probe] ERROR: integration plugin "${INTEGRATION_PLUGIN_NAME}" not active`);
  process.exit(1);
}
const api = integrationEntry.exports;
if (!api?.testChat || typeof api.waitForMarker !== "function") {
  console.error(`[probe] ERROR: integration plugin API missing waitForMarker/testChat`);
  process.exit(1);
}
console.log(`[probe] integration API ready — testChat=${api.testChat}`);

const { contract, store } = refs;
const contactsApi = buildContactsApi(contract, store, null);

async function roundTrip(label, fn) {
  const marker = `${label}-${Date.now()}-`;
  console.log(`\n┌─ round-trip #${label}`);
  console.log(`│  sending marker "${marker}"…`);
  await contract.sendText(api.testChat, marker);
  await api.waitForMarker(marker, ROUND_TRIP_TIMEOUT_MS);
  console.log(`│  round-trip complete`);
  try {
    await fn();
    console.log(`└─ ${label}: PASS`);
  } catch (e) {
    console.log(`└─ ${label}: FAIL — ${e.message}`);
    process.exitCode = 1;
  }
}

const me = await contactsApi.get(api.testChat);
if (!me) {
  console.error("[probe] ERROR: contacts.get(testChat) returned null");
  process.exit(1);
}

await roundTrip("ICONTACT-SHAPE", async () => {
  const me = await contactsApi.get(api.testChat);
  console.log(`│  id                  = ${JSON.stringify(me.id)}`);
  console.log(`│  number              = ${JSON.stringify(me.number)}`);
  console.log(`│  numberRaw           = ${JSON.stringify(me.numberRaw)}`);
  console.log(`│  numberPretty        = ${JSON.stringify(me.numberPretty)}`);
  console.log(`│  country             = ${JSON.stringify(me.country)}`);
  console.log(`│  countryCallingCode  = ${JSON.stringify(me.countryCallingCode)}`);
  console.log(`│  pushname            = ${JSON.stringify(me.pushname)}`);
  console.log(`│  isUser              = ${me.isUser}`);
  console.log(`│  isGroup             = ${me.isGroup}`);
  console.log(`│  isWAAccount         = ${me.isWAAccount}`);

  if (!me.id?.endsWith("@lid") && !me.id?.endsWith("@g.us")) {
    throw new Error(`expected id to end with @lid or @g.us, got ${me.id}`);
  }
  if (me.number !== null && !me.number.startsWith("+")) {
    throw new Error(`expected number to start with +, got ${me.number}`);
  }
  if (me.country !== null && !/^[A-Z]{2}$/.test(me.country)) {
    throw new Error(`expected country to be ISO alpha-2, got ${me.country}`);
  }
  if (me.countryCallingCode !== null && !/^\d{1,4}$/.test(me.countryCallingCode)) {
    throw new Error(`expected countryCallingCode to be ITU digits, got ${me.countryCallingCode}`);
  }
});

await roundTrip("PNMAP-CACHE", async () => {
  const lid = store.resolvePn(api.testChat);
  console.log(`│  store.resolvePn(testChat) = ${JSON.stringify(lid)}`);
  if (!lid) {
    throw new Error(`pnMap did not learn the LID for ${api.testChat}`);
  }
  if (!lid.endsWith("@lid")) {
    throw new Error(`expected LID form, got ${lid}`);
  }
});

await roundTrip("CONTACT-FROM-PN", async () => {
  const me = await contactsApi.get(api.testChat);
  if (!me.id?.endsWith("@lid")) {
    throw new Error(`expected LID form for id after cache warmup, got ${me.id}`);
  }
  console.log(`│  contacts.get(testChat).id = ${JSON.stringify(me.id)}`);
});

console.log(`\n[probe] done (exit=${process.exitCode ?? 0})`);
process.exit(process.exitCode ?? 0);