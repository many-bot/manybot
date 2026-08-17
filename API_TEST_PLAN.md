# API Test Suite Plan

## Objective

Create a suite that covers all endpoints and methods exposed by the ManyBot plugin API, separating local and deterministic tests from flows that depend on a real WhatsApp connection.

---

## API Surface Inventory and Classification

Each plugin API facet and method has been categorized according to its dependencies:
- **Local**: Runs purely in memory, local disk, filesystem, or configuration, with no driver or network dependency.
- **Mockable**: Interacts with `WaContract` and `BotStore`, but can be 100% exercised and verified in deterministic unit tests with fake/mocked contracts.
- **WhatsApp**: Depends on real connectivity, network protocol, and remote state with WhatsApp servers; exercised opt-in via a `TEST_CHAT`.

| Facet / Module | Items / Methods | Classification | Main Test File | Description & Coverage Strategy |
|---|---|---|---|---|
| **Storage** | `storage.dir`, `storage.resolve(path)` | **Local** | `src/kernel/pluginApi.test.ts` | Data sandbox per plugin in `~/.manybot/data/<plugin>`, path traversal validation (`..`, `/`, `\`), and automatic subdirectory creation. |
| **Config** | `config.get(key, default)` | **Local** | `src/kernel/pluginApi.test.ts` | Safe, read-only access to top-level configuration parameters (`manybot.toml`). |
| **i18n** | `i18n.t`, `createT`, `reload`, `getCurrentLang` | **Local** | `src/kernel/pluginApi.test.ts` | Localized string resolution, scoped translator for plugins, and catalog reload. |
| **Utils** | `utils.emptyFolder(path)` | **Local** | `src/kernel/pluginApi.test.ts` | Filesystem utilities. |
| **Download** | `download.enqueue(work, err)` | **Local** | `src/kernel/pluginApi.test.ts` | Sequential async queue for heavy background downloads. |
| **Scheduler** | `scheduler.schedule(cron, fn)` | **Local** | `src/kernel/pluginApi.test.ts` | Cron job registration and cancellation per plugin. |
| **Plugins** | `plugins.get`, `require`, `exists` | **Local** | `src/kernel/pluginApi.test.ts` | Invocation and dependency verification between registered plugins. |
| **Log** | `log.info`, `warn`, `error`, `success` | **Local** | `src/kernel/pluginApi.test.ts` | Structured logging facet. |
| **Settings** | `settings.get`, `set`, `forChat`, `global` | **Local** | `src/kernel/pluginApi.test.ts` | Key-value SQLite persistence isolated per plugin and per chat. |
| **Events** | `events.on`, `once`, `cleanupPluginEvents` | **Mockable / Local** | `src/kernel/pluginApi.test.ts` | Typed event subscription on `WaContract` and cleanup on unload. |
| **Status HTTP** | `startStatusServer`, `getStatus`, `setStatus` | **Local / HTTP** | `src/kernel/statusServer.test.ts` | Minimal REST HTTP server (configurable port) returning JSON with online/offline state, `since` timestamp, `lastError`, and CORS headers. |
| **Chats** | `chats.all()` | **Mockable** | `src/kernel/pluginApi.test.ts` | List of known chats from in-memory cache `BotStore.chats`. |
| **Contacts** | `contacts.get`, `getPfpUrl`, `getPfpPath`, `getAbout`, `block`, `unblock` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` / `src/kernel/whatsappIntegration.integration.test.ts` | JID normalization (@s.whatsapp.net, @c.us, @lid), LID↔PN resolution, profile picture, status/about message, and blocking. |
| **Send** | `send.text`, `image`, `video`, `gif`, `audio`, `sticker`, `file`, `poll`, `to` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` / `src/kernel/whatsappIntegration.integration.test.ts` | Message sending with throttle (`sendGuard`), fallback (`sendFallbackGuard`), quoted messages, and chainable `MessageHandle` (`.reply()`, `.react()`, `.edit()`, `.delete()`, `.pin()`). |
| **Message Ctx** | `msg.body`, `msg.sender`, `msg.getContact`, `msg.getMediaBuffer`, `msg.reply.*` | **Mockable** | `src/kernel/pluginApi.test.ts` | Neutral `BotMessage` envelope provided to `plugin.default(ctx)`. |
| **Chat Ctx** | `chat.getParticipants`, `isAdmin`, `isSenderAdmin`, `isBotAdmin`, `history` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` / `src/kernel/whatsappIntegration.integration.test.ts` | Chat participants and permission checks with TTL cache and LID/PN support. |
| **Admin** | `admin.add`, `kick`, `promote`, `demote`, `setSubject`, `setDescription`, `getInviteLink`, `revokeInvite` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` / `src/kernel/whatsappIntegration.integration.test.ts` | Group administration actions on the current chat or redirected via `.to(groupJid)`. |
| **Me** | `me.setName`, `me.setAbout`, `me.setProfilePic` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` / `src/kernel/whatsappIntegration.integration.test.ts` | Bot profile management. |
| **Poll** | `poll.create`, `poll.get` | **Mockable & WhatsApp** | `src/kernel/pluginApi.test.ts` | Poll creation and vote tallying (`PollHandle`). |
| **WA Escape Hatch** | `ctx.wa.contract`, `store`, `msg`, `downloadMedia` | **Mockable** | `src/kernel/pluginApi.test.ts` | Controlled access to `WaContract` and `BotStore` without leaking driver specifics. |
| **Integration Harness** | `__manybot_integration__` | **WhatsApp** | `src/kernel/whatsappIntegration.integration.test.ts` | Integration-only test plugin, `TEST_CHAT` filtering, `waitForMarker`, timeouts, and cleanup. |

---

## Scope & Suite Execution

### 1. Local & HTTP Tests (`npm test`)

Always executed in CI and standard development workflow:

```bash
npm test
```

- Covers the status HTTP endpoint (`/status`), response headers, JSON payload, status codes, and state mutations.
- Covers all plugin API facets and methods (`buildApi`, `buildSetupApi`, `buildStorageApi`) using full mocks for `WaContract` and `BotStore`.
- Validates contracts, error handling, invalid path resilience, and permissions.
- Requires no internet connectivity, active WhatsApp session, credentials, or external chat.

### 2. WhatsApp Integration Tests (`npm run test:integration`)

Explicitly invoked and isolated from the default suite:

```bash
npm run test:integration
# or specifying a temporary chat via environment variable:
TEST_CHAT="5516999999999" npm run test:integration
```

- Reuses existing active WhatsApp session if authenticated.
- Loads the integration-only plugin (`__manybot_integration__`).
- Strictly limits all interactions to the configured `TEST_CHAT`.
- Uses run identifiers (`[MANYBOT-ITEST:<runId>]`) to correlate messages and perform cleanup (`deleteMessage`).
- Enforces explicit timeouts and gracefully skips the suite with diagnostic reporting if prerequisites are not met.

---

## `TEST_CHAT` Configuration

The target test chat is defined as a phone number or full JID.

Precedence order:
1. `TEST_CHAT` environment variable (e.g. `TEST_CHAT="5516999999999"`).
2. `TEST_CHAT` key in `manybot.toml` (e.g. `TEST_CHAT = "5516999999999@s.whatsapp.net"`).
3. If no value is provided, the integration suite is automatically skipped with an explanation message.

The explicit opt-in flag `MANYBOT_RUN_WHATSAPP_TESTS=1` is required to trigger real WhatsApp operations (set automatically in the `npm run test:integration` script).

---

## Integration-Only Plugin (`__manybot_integration__`)

- Loaded strictly when running in integration mode (`src/kernel/integrationMode.ts`).
- Rejects any incoming messages outside of `TEST_CHAT`.
- Exposes test helpers to the suite:
  - `isTestChat(jid)`: verifies if the JID matches the configured test chat.
  - `waitForMarker(marker, timeoutMs)`: waits for a message containing a given textual marker.
  - `recentBodies()`: recent message history in the test chat.
- Completely passive on the incoming message flow (`default(ctx)` does not emit unwanted automatic responses).
