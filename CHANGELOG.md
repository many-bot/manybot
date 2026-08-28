# Changelog

## v5.9.0 - In-Development

### New Features
- **Full `commands.yaml` v6 config support** — every field exercised by the reference `~/.manybot/commands.yaml` now parses, validates, and runs end-to-end (not parse-only):
  - `loading:` / `loading_presets:` — per-command "processando..." indicator with five kinds (`reaction`, `typing`, `recording_audio`, `spinner`, `none`), inherited defaults → category → command → subcommand. Strict validation: an unknown property for the declared type is a fatal, malformed-config error.
  - `functions:` — a command's handler list runs as an ordered chain; a plugin can short-circuit the remaining chain by returning `STOP_CHAIN` (exported from `commandsConfig.ts`) — a deliberate, non-error stop, not a crash.
  - `dono` (specific-owner JID permission, independent of the global `OWNER_NUMBER`), `allowed_chats` (closed list of chats a command may run in), and `hidden_outside_scope` (menu visibility tied to `groupOnly`/`dmOnly`/`scope`, derivable without an explicit flag).
  - Top-level `notify_changes` / `notify_period_days` / `deprecation_message` / `permission_messages` now overlay onto `defaults:` instead of being command-local only.
  - `commands:` top-level wrapper is optional — bare-key and wrapped forms both parse identically.
  - Flat-form permission shorthands (`group_only`/`dm_only` etc. as siblings of `permissions:` rather than nested) and an `args:` alias for argument declarations.
  - New `optional:` argument modifier and `media_direct_or_reply` argument type.
- **`ResolvedPermissions`** consolidated into a single definition in `commandRegistry.ts` (`dono`, `allowedChats`, `hiddenOutsideScope`, all 8 message keys) — `resolvePermissions()` merges spec and plugin sources field-by-field (spec wins), including deriving `hiddenOutsideScope` from `groupOnly`/`dmOnly`/`scope` when not set explicitly.
- **9-step permission evaluation order** (`commandPermissions.ts`): dono → owner → scope → allowedChats → blacklist → whitelist → botAdmin → admin → cooldown. Cooldown keys are now `<pluginName>:<cmd>` (previously included a subcommand id, which fragmented buckets unnecessarily).

### Changed
- **`pluginGuard.ts`'s `runPlugin()` now returns `Promise<unknown>`** instead of `Promise<void>` — the chain dispatcher in `runCommand.ts` needs the handler's return value to detect `STOP_CHAIN`.
- **`commandMenu.ts`'s scope filtering fixed to use `!==`, not `===`** — `hiddenOutsideScope` means "the scope outside of which this command is hidden", so all four menu-filter call sites (overview categorized/uncategorized/flat, category render) now correctly hide an entry when `hiddenOutsideScope !== "any" && hiddenOutsideScope !== currentScope`; the previous `===` comparison had the condition inverted.
- **`plugin:` accepts both `owner/repo` and bare `name` references** — `commandsConfig.ts`'s `parseEntry` now resolves the shorthand `name` against the live `pluginRegistry` (keys passed in by `initCommandRegistry`), normalizing to the canonical `owner/repo` key when there's exactly one match. Multiple matches (same `name` under different owners) are kept verbatim so the ambiguity surfaces at dispatch instead of being silently resolved. Without `validPluginKeys` (tests, callers that don't pass it) the value is used verbatim — same behavior as before. Pure helper, no `pluginLoader.ts` import from `commandsConfig.ts` (would close an import cycle: `commandsConfig → pluginLoader → commandRegistry → commandsConfig`).

### Fixed
- **`@manybot/types` was missing `senderPn` and `mentionedJid` on the published `WAMessageContext`**, and still typed `sender` as non-nullable `string` — all three diverged from the real `IMsg`/`WAMessageContext` (`src/drivers/baileys/api/index.ts`) as part of the earlier LID/PN work, but were never back-ported to the hand-maintained package. `scripts/check-types-drift.ts` caught the divergence structurally; both `en` and `pt` locale files fixed to match (`pt` kept in English pending a separate translation pass — see package README). `@manybot/types` bumped **1.8.0 → 2.0.0** (major: the `sender` nullability change is breaking for any plugin code that dereferenced it without a null check).

### Tests
- Added coverage for the loading-indicator dispatch wiring (`messageHandler.test.ts`): reaction drop/clear + `onSuccess` override, typing composing/paused presence, spinner frame send + edit-on-completion, and a `none` spec adding zero presence calls beyond the two independent pre-existing legacy paths (per-plugin `useTyping`, and `simulateState()` inside `ctx.send.text()`).
- Added `functions:` chain + `STOP_CHAIN` short-circuit tests, and `hiddenOutsideScope` group/DM menu-suppression tests.
- Added `dono` and `allowed_chats` permission tests (`commandPermissions.test.ts`), including an evaluation-order test confirming `dono` is checked before `allowedChats`/blacklist.
- Added `plugin:` registry-key normalization tests (`commandsConfig.test.ts`): exact `owner/repo` kept verbatim, bare `name` resolved to the unique matching key, inline `owner/repo.fn` and `name.fn` forms split correctly, unknown names kept verbatim, ambiguous multi-owner matches kept verbatim (so dispatch can surface them), and the legacy no-`validPluginKeys` path unaffected.
- **281/281 tests pass**, 10 integration tests skipped (require `MANYBOT_RUN_WHATSAPP_TESTS=1` + live session), 0 fail. `typecheck`, `lint`, `build:types`, and `check-types-drift` all clean.

---

## v5.9.0 - In-Development

### New Features
- **Published plugin types synchronized with the runtime contract** — `@manybot/types` 1.8.0 now covers the expanded WhatsApp contract and is checked structurally against both English and Portuguese declarations.
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

### Fixed
- **`GroupParticipantsUpdateEvent` payload shape regressed in v5.8.0, now restored** — the adapter had been reconstructing the event as `{ id, participants: Array<{ id, action }> }`, dropping `author` entirely and putting `action` on each participant instead of the batch — an accidental regression from v5.8.0's correct `{ id, author, participants: string[], action }` shape. Baileys emits `action` once per event, not per participant; plugins reading `ctx.events.on("group-participants.update", ...)` were getting `action: undefined`. Restored the pre-regression shape.
- **`ConfigApi.get` / `ScopedAccessor.get` regained their generic parameter** — the v5.9.0 types sync had accidentally widened both to `get(key, default?: unknown): unknown`. Restored `get<T = unknown>(key: string, defaultValue?: T): T` in `@manybot/types` (en/pt) and the matching kernel interfaces (`IConfig`, `ScopedAccessor`).
- **`DownloadApi.enqueue`'s `errorFn` is now actually optional** — the JSDoc claimed it was optional-at-the-type-level with a `console.warn` fallback, but the signature still required it and no such fallback existed; an omitted `errorFn` silently swallowed the error. `errorFn` is now `errorFn?` in both the kernel type and `@manybot/types`, and `src/download/queue.ts` logs via `logger.warn` when it's omitted.
- **`fromLid`/`fromPn` could be silently swapped under `addressingMode: "lid"`** — both `toBotMessage()` implementations (`src/drivers/baileys/adapter.ts` and the mirrored one in `src/drivers/baileys/index.ts`) assumed `key.participant` was always the PN and `key.participantAlt` always the LID. That's only true under the legacy `addressingMode: "pn"`; under the modern default `"lid"` mode the roles are reversed (`key.participant` is already the LID, `key.participantAlt` carries the PN — see baileys.wiki/concepts/jids). In that default mode, `ctx.msg.sender`/`senderPn` — and everything built on them (command permissions, cooldown keys, `history.from()`, contact auto-save) — could receive a PN where a LID was expected and vice versa. Fixed by resolving LID vs. PN from the actual JID suffix (`splitLidPn()` in `src/drivers/jid.ts`) instead of trusting field position or `addressingMode` itself (which has been observed inconsistent across Baileys rc builds).

### New Dependencies
- `@whiskeysockets/baileys@^7.0.0-rc14` (was v6).
- `libphonenumber-js@^1.13.11`.

### Build / CI
- **Structural type-drift checking** — `npm run check` now validates the hand-maintained package against `pluginApi.ts` without nominal false positives.
- **Release hook publishes `@manybot/types`** — stable tag releases stage both the bot package and the plugin-types package for npm approval.

---

Previous releases are tracked via Git tags.
