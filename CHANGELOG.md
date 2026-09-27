# Changelog

## v5.12.0 - In-development

### New Features

- `ctx.chat.getChat(jid)`: look up any other chat (group or DM) by JID, returning a new `ChatContext` with the same shape (itself `getChat()`-able). Useful for groups discovered via `ctx.chats.all()` or stored earlier by a plugin.
- `ctx.chat.getMsg(msgId)`: look up any message by ID alone, the owning chat's JID is resolved automatically via a new `msgId -> jid` store index, so `.reply()`/`.react()` work on an old/stored message ID.
- `ctx.unreact()`: new method to remove a reaction from a message.
- Added validation for reaction emoji fields.
- Added `--logout` command line argument to remove the current session (`~/.manybot/sessions/<CLIENT_ID>`).
- Native normalization added to commands. Source: [normalizeText.ts](src/utils/normalizeText.ts).
- Added `AUTO_READ_MESSAGES` config option -- it makes ManyBot mark all the messages it receives "as read".
- Added config option HISTORY_MAX_PER_CHAT -- allows configure how much messages ctx.chat.history can save per chat (before was fixed on 200).
- Crash notices: when a plugin fails, or the whole bot goes down, while answering a command, the chat now gets a message asking the user to try again instead of silence. Source: [crashNotice.ts](src/kernel/crashNotice.ts).
  - Each run has a `running`/`idle` state ([runState.ts](src/kernel/runState.ts)). Runs answering a command are journaled in `settings.db` until they finish, so anything still there after a restart was interrupted.
  - It is a notice, not an automatic retry, because plugins have side effects. To avoid false positives, only commands routed through the command registry, or legacy `run(ctx)` plugins that worked for over a second on a prefixed message the registry doesn't know, are reported. Background/event-handler errors are not.
  - Each message is reported at most once, even across restarts.
- `ctx.chat.getGroups()`: lists every group linked to a Community (Baileys-only). Chat contexts also gain `isCommunity`, `isAnnounces` and `community` (parent JID, or own JID when the chat itself is the Community) fields.
- `ctx.chat.acceptInvite(urlOrCode)`: joins a group via invite link or code, resolving `{status: "joined", groupId}` / `{status: "requested"}` (pending admin approval), or throwing `GroupInviteError` with a `.reason` (`not_found`/`invalid_code`/`already_member`/`unknown`).
- Sending directly to a Community's own JID is now rejected early with a translated error (`communitySendBlocked`) instead of resolving silently without delivering the message.
- `downloadMedia()` now resolves `isAnimated` via a byte-level check (WhatsApp reports all stickers as `image/webp`), and accepts `{ asFrames }` to return decoded animated-webp frames with per-frame `delayMs`.
- Oversized message bodies are now capped at 4096 characters (`MAX_BODY_LENGTH`), with truncation metadata (`big`, `bodyLength`) exposed on `BotMessage` and `WAMessageContext`, including quoted messages.
- New `msg.type: "invite"` and `ctx.chat.acceptInvite()` now also accept a `WAMessageContext` (in addition to a string) to accept a group invite message directly. Adds `BotGroupInvite` (`groupJid`, `inviteCode`, `inviteExpiration`, `groupName?`, `caption?`) and the optional `WaContract.groupAcceptInviteV4()` (Baileys-only; omitted on drivers without support, e.g. whatsmeow), mapping Boom errors to `GroupInviteError` (`already_member`/`not_found`/`invalid_code`/`unknown`).
- `ctx.chat.mention`: new getter for community group mentions (`BotGroupMention`), threaded through `sendText`/`sendFallbackGuard` (Baileys-only).

### Fixed

- Pairing code instructions now show the correct full path.
- `i18n`: removed non-existent `connect()` option.
- Plugins: a crash can no longer take the whole bot down, even when it escapes the plugin's own `await` chain (fire-and-forget promise rejections). A new async-context tracker (`pluginContext.ts`) attributes these back to the responsible plugin instead of triggering a full process shutdown.
  - Fixed a bug where a successful reload silently reset the 3-strike error counter to 0, so a plugin that kept failing-then-reloading successfully never actually reached 3 strikes and got disabled.
  - Owner alerts (WhatsApp/email) now fire for crash paths that previously only reached the local log -- e.g. a legacy plugin or a background/event-handler crash with no command involved.
  - Alerts now distinguish a genuinely fatal bot crash from a survivable plugin crash (`fatal` flag), with an occurred-at timestamp and running/fatal status footer on WhatsApp and email sinks.
- `pluginLoader`: safely reinitialize command registry.
- Event handlers: async rejections in plugin event handlers are now captured.
- `i18n`: resolved plugin root directory instead of assuming entry directory.
- `i18n`: `II18n["t"]` in `pluginApi.ts` is now a single `(key, context?) => string` signature. It still declared the old `string | Record` overload left over from the removed `returnObjects` option, which had drifted from the runtime and from `@manybot/types`.
- Banner: corrected ASCII art alignment for version string.
- `i18n`: corrected pairing code path.
- `ctx.admin.promote()` / `ctx.admin.demote()` now work on Communities: when the target JID is a Community (not a regular group or one of its linked groups), the driver uses the dedicated community operation instead of `groupParticipantsUpdate`. Adds the optional `WaContract.communityParticipantsUpdate()`.
- Bulk message deletion (e.g. admin `cleanmsg`) no longer applies only partially:
  - Baileys' default `cachedGroupMetadata` hook always returned `undefined`, so every group send queried WhatsApp for metadata and hit `rate-overlimit` (429). The socket now sets its own hook, backed by a shared cache (`groupMetaCache.ts`) that is also used by the API lookups, invalidated on `group-participants.update` / `groups.update` and cleared on every new socket.
  - `ctx.msg.react()`, `ctx.msg.unreact()` and `ctx.msg.delete()` (also on `MessageHandle`) now wait for a send slot like every other outbound action. `sendMessage({delete})` resolves once written to the socket, so tight loops had part of the burst silently dropped server-side.
  - `ctx.chat.history.from()` now matches by sender LID **or** phone number. Entries received before Baileys learned the contact's LID (`sender = null`) were being skipped.
- Menu command no longer activates when `commands.yaml` declares no commands (or only a `menu:` block).
- `scheduler.db` / `settings.db` are now opened lazily on first real use instead of unconditionally at import time, and get periodic WAL checkpointing (`PRAGMA wal_checkpoint(TRUNCATE)` every 10min) plus a checkpoint on shutdown -- fixes unbounded `*-wal` growth on bots that never use scheduling/settings.
- Group metadata lookups now go through cache to avoid WhatsApp rate-limit errors. Promoting members to admin in Communities now works correctly by reusing the linked announce group's member list, since the Community itself only returns admins as participants.
- `WAMessageSender` file methods: renamed the `filePath` param to `source` in types.
- Baileys: `badSession` now retries up to 3x (clear session + reconnect) before halting, instead of halting on the first occurrence; an alert is still sent on the eventual halt.

### New Configuration Options

- `CRASH_NOTICE_ENABLED` (default `true`): turns crash notices on/off.
- `CRASH_NOTICE_MESSAGE` (default empty = built-in message in the chat's language): custom notice text, accepts `{{command}}` and `{{plugin}}`.
- `CRASH_NOTICE_MAX_AGE_SECONDS` (default `600`): after a restart, interrupted commands older than this are dropped silently.

### Removed

- Automatic "as read" mark in every message. You can enable it again with `AUTO_READ_MESSAGES = true` in `~/.manybot/manybot.toml`.
- Removing reactions using `ctx.msg.react("")` won't work anymore. Use `ctx.msg.unreact()` instead.

### Docs

- Reviewed README, `CONTRIBUTING.md` and issue/PR templates for clarity and contributor onboarding.
- README: fixed OS badge label and linked `CONTRIBUTING.md` from the Contributing section.
- `CONTRIBUTING.md`: removed inconsistencies and outdated information.
- Removed outdated `PROJECT_GUIDE.md`.

### Refactors

- Fixed config/`commands.yaml` reload debounce timers (`configReloadTimeout` / `yamlReloadTimeout`) not being cleared on `cleanupPlugins()`, which could leave a dangling timer after shutdown.
- `i18n`: removed `returnObjects` option from `t()`.
- Dropped the dual-driver fallback path; ManyBot now runs Baileys-only. Removed `verifyDelivery`/`sendVia` fallback in `sendFallbackGuard` and degradation tracking (`isDegraded`/`markDegraded`/`switchTo`) in `driverManager`, simplified `Config.drivers` (dropped `fallbackCooldownMs`/`verifyWindowMs`), consolidated `send_failed_no_fallback`/`send_failed_both_drivers` into a single `send_failed` event, and added `AlertEvent.sinks` to route alerts to specific channels.

### Build / CI

- Added `prepare` npm script (`scripts/install-local-hooks.sh`) that points the clone's git hooks at `scripts/local-hooks/` on `npm install`.
- New local `pre-commit` hook: auto-bumps `packages/types/package.json` minor version when staged changes touch the published `@manybot/types` definitions (`packages/types/{en,pt}`).
- Renamed `hooks/` to `scripts/git-hooks/` (server-side release infra, no contributor impact).
- Updated `sharp`, `nodemailer` and `emoji-regex` dependencies.
- Updated TypeScript and ESLint.
- Added the types drift check script to `package.json`.

