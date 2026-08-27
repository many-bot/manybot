# Changelog

## v5.9.0 - In-Development

### New Features
- **Phone-number enrichment on `IContact`** (`src/utils/phoneNumber.ts`, exposed via `ContactsApi.get`) — contacts now carry `number` (E.164 with leading `+`), `numberRaw` (digits, no `+`), `numberPretty` (international format), `country` (ISO 3166-1 alpha-2), and `countryCallingCode` (ITU). All five are `null` for groups, broadcast lists, status updates, or when the input isn't a parseable phone number. Powered by `libphonenumber-js`.
- **LID-aware integration test suite** (`src/drivers/baileys/api/contacts.integration.test.ts`) — opt-in real-WhatsApp tests that round-trip marker messages into `TEST_CHAT` and assert the new `IContact` shape against a live account. Skips cleanly (reports `skipped: N`, not `pass: N`) when the integration gate isn't satisfied. Pair it with `scripts/probe-contacts.mjs` for a manual smoke probe that prints the contact fields without the full test runner.
- **`getGlobalKernelRefs()`** (`src/kernel/pluginLoader.ts`) — small escape hatch used only by the integration harness: returns the live `WaContract` + `BotStore` the kernel most recently wired through `setupPlugins()`, or `null` when the bot hasn't connected yet. Production code paths keep going through `ctx.wa.contract` / `ctx.store`.

### Changed
- **`IContact.id` is now nullable** — when a real user's LID can't be resolved, `id` is `null` instead of falling back to the phone JID. Group contacts keep `@g.us` as their `id`. Plugins that previously assumed `id` was always a stable per-user identifier must now treat `null` as "identity not yet known". Phone number fields (`number` etc.) remain the best-effort fallback for outbound addressing.
- **LID is the canonical contact identifier** — `ContactsApi.get(jid)`/`ContactsApi.getNumber(...)` (and the underlying `normalizeContact`) prefers the LID when one is known, persists the LID↔PN mapping into a new `pnMap` cache (`src/client/store.ts`), and is fed passively by message events, `groupMetadata` lookups, and join-request events. The cache is hydrated from `lidMap` on startup so existing sessions keep their mappings.
- **`mentionedJid` normalized** — outbound message processing rewrites `@s.whatsapp.net`/`@c.us` mentions into the LID form when one is known, keeping mention rendering consistent with the new canonical-id invariant.
- **`GroupParticipantsUpdateEvent.action` accepts `"modify"`** — Baileys v7 added a new participant-state action ("modify"); the event type now includes it so plugins listening on this event receive v7 payloads without a cast.
- **`buildContactsApi` is now exported** (`src/drivers/baileys/api/index.ts`) — needed by the integration suite to call `contacts.get(...)` from outside the plugin context. Was previously module-local.
- **Integration plugin auto-loads in opt-in mode** (`src/drivers/baileys/index.ts`) — when `MANYBOT_RUN_WHATSAPP_TESTS=1` is set, `loadIntegrationPlugin()` runs right after `setupPlugins()` so the harness's `waitForMarker` / `testChat` API is available the moment the bot connects. Production runs (no opt-in flag) are unaffected.

### New Dependencies
- `@whiskeysockets/baileys@^7.0.0-rc14` (was v6).
- `libphonenumber-js@^1.13.11`.

---

Previous releases are tracked via Git tags.

