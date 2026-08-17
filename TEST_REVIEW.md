# Test Suite Review

Goal: identify tests that validate the *current* behavior of the code rather than the *intended* behavior (per project design decisions), as well as branches and edge cases missing coverage.

Read file by file, not all at once. Whenever reviewing one, update this file and the index.

Status: review completed, now improving tests.

---

## src/kernel/commandRegistry.ts (`commandRegistry.test.ts`)

Risk: HIGH — new feature under active construction (stage 3 of command redesign).

Missing coverage for:
- Invocation collision: two commands with the same `cmd`/alias → must log a warning and the "loser" must not overwrite the winner in `byInvocation`. Not tested.
- Spec with `plugin`+`function` that does not exist in `pluginRegistry` ("orphan entry" path, logs `system.commandRegistryOrphanEntry`). Not tested.
- Spec without `plugin` and without `text` ("invalid entry" path, logs `system.commandRegistryInvalidEntry`). Not tested.
- `registerInvocationWithDeprecationGuard` blocking registration of text reserved by an active deprecation. Not tested (neither here nor in `commandDeprecation.test.ts` — verify).
- Decided business rule: overriding `desc`/`category`/`permissions` WITHOUT touching `aliases` must preserve the plugin's default aliases. Only the inverse path (overwritten aliases) has a test. Not tested.
- Collision of `menu.aliases` with an already-registered `cmd`/alias (logs `system.commandRegistryMenuAliasCollision`, removes from `menuAliases`). Not tested.
- `subcommands:` (nested structure decided in design) — does not exist in the code yet. This is a pending feature, not a test failure.

## src/kernel/sendGuard.ts (`sendGuard.test.ts`)

Risk: HIGH — anti-detection mechanism; project has previously suffered account bans.

- `waitForSendSlot` is tested with `{ cooldown: false, jitter: false }` — disables the two core mechanisms the guard exists to provide, only verifying that the promise resolves without throwing. Tests "does not crash", not that "the throttle throttles".
- No test verifying that per-chat cooldown is actually respected (2nd call on the same `jid` within the window must wait).
- No test verifying that jitter falls within the range configured by `SECURITY_LEVEL`.
- No test verifying that the global token bucket gets exhausted and blocks/delays sends when multiple chats send concurrently.
- `acquireChatSlot` only tests `SECURITY_LEVEL=high` (concurrency=1). Does not test `low` (unlimited) or `medium` (2), which have different behavior and represent project defaults.

## src/kernel/commandDeprecation.ts (`commandDeprecation.test.ts`)

Risk: MEDIUM.

Status: CLOSED (4 → 8 tests) — opt-out of `notifyChanges` on removal, custom `deprecatedMessage` with precedence over fallback, expiration via `notifyPeriodDays` window, multiple concurrent deprecations in the same sync. Remaining gaps: none.

## src/kernel/commandPermissions.ts (`commandPermissions.test.ts`)

Risk: MEDIUM-HIGH — controls who can execute what.

Status: CLOSED (9 → 10 tests) — only the default error message fallback was missing (without custom `messages` at any level), now tested for the 5 message types using real i18n. Remaining gaps: none.

## src/kernel/commandMenu.ts (`commandMenu.test.ts`)

Risk: LOW — mostly a presentation/text surface.

Status: CLOSED (13 → 17 tests) — "es" language, category with no commands in `renderCategory` (returns `null`), command without `desc`/`manual` in `renderManual` (omits description, uses i18n fallback). Remaining gaps: none.

## src/kernel/driverManager.ts (`driverManager.test.ts`)

Risk: MEDIUM — strictly 1 active driver at a time is a core project invariant (decided: no fallback between drivers).

Status: CLOSED (3 → 9 tests) — re-registration of the same `name`, multiple drivers without `isPrimary`, active driver swap via `isPrimary`, `isReady()` for unregistered driver, reverse disconnect order on `shutdown()`, and `shutdown()` not propagating errors from failing drivers. Remaining gaps: none.

## src/kernel/whatsappIntegration.ts (`whatsappIntegration.integration.test.ts`)

Risk: MEDIUM — but different nature: integration suite against real WhatsApp, opt-in via `MANYBOT_RUN_WHATSAPP_TESTS=1` + `TEST_CHAT`. Without opt-in, all tests trigger `t.skip`, contributing ~0 coverage in standard CI. Real risk is "assuming coverage exists because the file exists".

- `isTestChat`: the two "wrong chat" assertions are tautological — `assert.equal(api.isTestChat(x), testChat === x)` compares the function against the same string equality it is supposed to compute. Does not test actual JID normalization logic.
- `waitForMarker`: only the timeout path is tested. No test for the happy path (marker received resolving promise) — understandable in real integration, but leaves the happy path unvalidated automatically.
- TEST_CHAT boundary (design decision: integration plugin must only act inside the test chat) is only tested in the pure `isTestChat` function, not enforced in runtime (e.g. message handler refusing actions outside TEST_CHAT).
- Cleanup `deleteMessage`: failure is swallowed with `logger.warn` and the test passes regardless; cleanup success is not asserted, only logged.

## src/kernel/pluginApi.ts (`pluginApi.test.ts`)

Risk: MEDIUM — full contract exposed to all plugins (`PluginContext`/`SetupContext`), broad surface (~30 facets). Expanded coverage: `settings`, `poll`, `events.once`/`cleanup`, `config.get`, `i18n.t`, `download.enqueue`, `scheduler.schedule`, `plugins.get/require/exists`, `chats.all`, `contacts.getPfpUrl/getPfpPath/getAbout/unblock`, `admin.demote/setSubject/setDescription/setProfilePic/revokeInvite`, `send.gif`/`send.poll`, and `contacts.get()` via `contract.resolveLid` (`@lid` route without `participantAlt`) are now tested.

Remaining gaps:
- `ITargetableAction`: only `.to()` is tested; `.then`/`.catch`/`.finally` (direct usage as thenable without `.to()`) lack tests.
- `guardOptions: { cooldown: false, jitter: false }` is used in every `buildApi(...)` across the file — tests never exercise sending through the real guard.
- Note: `getAbout()` in `pluginApi.ts` has dead branches handling array/object formats, but `WaContract.fetchStatus` is typed `Promise<string|null>` — no compliant driver can produce those formats. Flagged, not covered (no real assertion value).

## src/kernel/pluginGuard.ts (`pluginGuard.test.ts`)

Risk: MEDIUM — last line of defense against plugins hanging or crashing the bot.

Status: CLOSED (6 → 9 tests) — real timeout tested with mock timers (`t.mock.timers`, without waiting 120s); failure with `errorCount < 3` confirming `pluginRegistry.set(...)` and that fire-and-forget reload failure is only logged, never propagated (checked via `unhandledRejection` listener); distinction between timeout and regular error logging.

**Known bug found, intentionally kept (as requested — documented for now):** in `withTimeout()`, the rejection message is `` `[${pluginName}] timed out after ${ms}ms` ``, but in `runPlugin` the check is `error.message?.startsWith("timed out")` — never matches due to the `[pluginName]` prefix. Result: `isTimeout` is **always `false`**, and stack traces are never omitted on timeouts. Timeout test documents this current behavior with a `KNOWN BUG` comment.

Remaining gaps: none identified in this review (aside from the production bug above).

## src/config.test.ts (`config.test.ts`)

Risk: LOW (previously HIGH) — `config.ts` handles bot bootstrap.
Status: CLOSED (2 → 19 tests, including `process.exit(1)` and `detectSystemLang()` tested via isolated `tsx` subprocess). Remaining gaps: none, except a theoretical race condition in `reloadConfig()` (in-place mutation of `PLUGINS`/`CHATS`) untestable without real concurrency.

**Real bug found and fixed:** `npm test` was using `sh` (not bash) for the `src/**/*.test.ts` glob — `**` was not expanding recursively, so `src/config.test.ts` (0 levels) and `src/plugins/__manybot_integration__/index.test.ts` (2 levels) were never executed in CI/`npm test`. Fixed by enforcing `bash -O globstar` across test scripts in `package.json`.

**Finding, not fixed (product decision):** `legacyLayer` in `config.ts` is `const legacyLayer = {}` never reassigned — top-level file comment does not reflect current runtime. Dead code, no observable impact; flagged for cleanup decision.

## src/kernel/testConfig.test.ts (`testConfig.test.ts`)

Risk: LOW — config reading + normalization function. Existing coverage is the most comprehensive among reviewed modules. Gaps are validation edge cases.

- Strong coverage: 22 tests across 4 describes, including env-vs-toml precedence, trim/whitespace, suffix normalization, 4-value opt-in, cache, malformed TOML, missing TOML. Test 178 ("result is cached across calls") locks down the cache contract.
- `normalizeTestChat` (`testConfig.ts:87`): suffix coverage (`@s.whatsapp.net`, `@c.us`, `@lid`, `@g.us`, bare, `+`) is solid.
  - JID with valid suffix but empty local part (e.g. `"@s.whatsapp.net"`): not tested.
  - JID with valid suffix but spaces in local part (e.g. `"5516 999@g.us"`): not tested.
  - Multiple `+` (e.g. `"++5516999999999"`): not tested.
  - `+` in the middle (e.g. `"55+1699999999"`): not tested.
  - Control characters stripped by `.trim()`: covered implicitly, tests only use spaces.
  - LID with alphanumeric characters: not explicitly tested.
  - Bare number with leading zero (e.g. `"05516999999999"`): not tested.
- `readTomlTestChat` (`testConfig.ts:120`):
  - ENOENT covered (test 190). Not covered: other read errors (EACCES, EISDIR).
  - Valid TOML without `TEST_CHAT` key: not tested with other keys present.
  - TOML value as `boolean` or `array`: falls back to `null`, only numeric `42` tested.
  - TOML value with internal whitespace: double trim behavior not explicitly tested.
- `getTestConfig`:
  - `raw !== null` and `normalizeTestChat` throwing: covered for TOML, not covered via direct env var.
- `requireTestConfig`:
  - Message when BOTH are missing (`chat === null && !runWhatsApp`): order of precedence not explicitly asserted.
- `_resetTestConfigForTests`: cache reset verified.

## src/kernel/statusServer.test.ts (`statusServer.test.ts`)

Risk: LOW — read-only HTTP surface, module-global status reset in `afterEach`.

- `let status` in `statusServer.ts:17` is module-global state. `afterEach` calls `setStatus(false)`, resetting `online` while preserving `since`.
- `setStatus` is a no-op when `status.online === online && status.lastError === lastError`. Path for updating error without changing `online` is untested.
- `setStatus(false, "")` empty string falsy behavior untested.
- `since` invariant coverage: partially covered across state transitions.
- `startStatusServer`:
  - CORS preflight unsupported and untested (`OPTIONS` method).
  - Handler returns the same response regardless of path and method (no routing).
  - `server.on("error", ...)` path untested.
  - Concurrency safety during `getStatus()` JSON serialization untested.

## src/kernel/contactAutoSave.test.ts (`contactAutoSave.test.ts`)

Risk: MEDIUM-HIGH — anti-detection code tied to persistence and randomized counters.

- `store` in `contactAutoSave.ts:64` is module-level. Tests use different JIDs to avoid collision.
- Test sets up and isolates via direct store seeding (`buildSettingsApi("__contactAutoSave__", "_global")`).
- Expanded coverage:
  - Hot path `saved === true && !pendingRefresh` (never re-saves).
  - `pendingRefresh` completing on qualifying message and skipping silent group messages.
  - `addContact` failure handling.
  - Independence of `dmCount`/`groupCount` counters.
  - `runContactRefreshSweep`: empty store, recent contacts, sample limits (`REFRESH_SWEEP_SAMPLE = 2`), and non-blocking removal failures.
  - `toWireJid` resolution.

## src/kernel/commandsConfig.test.ts (`commandsConfig.test.ts`)

Risk: MEDIUM — `commands.yaml` is the primary configuration point for the command system.

- Monster test canonical structure verified.
- Error handling on ENOENT covered.
- Empty YAML documents and default fallbacks tested.
- `parseCategories` fallback to `order: 999` tested.
- Subcommand permission overrides tested.
- Deprecation tracking and notification settings tested.

## src/kernel/integrationMode.test.ts (`integrationMode.test.ts`)

Risk: LOW-MEDIUM — gate separating production from the integration test suite.

- Coverage across `isIntegrationOptIn`, `getIntegrationModeStatus`, and `requireIntegrationMode`.
- Verification of `INTEGRATION_PLUGIN_NAME` and path resolution.

## src/kernel/loadIntegrationPlugin.test.ts (`loadIntegrationPlugin.test.ts`)

Risk: HIGH — safety net for integration plugin loading.

- Enforces opt-in requirement with `MANYBOT_RUN_WHATSAPP_TESTS=1`.
- Verified idempotent loading to prevent ring buffer resetting.

## src/kernel/pluginLoader.ts (`pluginLoader.test.ts`)

Risk: HIGH — plugin lifecycle management (load, hot-reload, sync, cleanup).

- Covers plugin loading and registration.
- Error handling and consecutive failure thresholds (3-strike disable).
- Hot reload and directory watching mechanics.

## src/client/store.ts (`store.test.ts`)

Risk: MEDIUM-HIGH — in-memory store shared across reconnections, contact caching, and message history.

- Verified `ephemeralExpiration` tracking and serialization round-trips.
- LID resolution and contact pushName mapping covered.
