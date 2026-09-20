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
- Banner: corrected ASCII art alignment for version string.
- `i18n`: corrected pairing code path.
- `ctx.admin.promote()` / `ctx.admin.demote()` now work on Communities: when the target JID is a Community (not a regular group or one of its linked groups), the driver uses the dedicated community operation instead of `groupParticipantsUpdate`. Adds the optional `WaContract.communityParticipantsUpdate()`.
- Bulk message deletion (e.g. admin `cleanmsg`) no longer applies only partially:
  - Baileys' default `cachedGroupMetadata` hook always returned `undefined`, so every group send queried WhatsApp for metadata and hit `rate-overlimit` (429). The socket now sets its own hook, backed by a shared cache (`groupMetaCache.ts`) that is also used by the API lookups, invalidated on `group-participants.update` / `groups.update` and cleared on every new socket.
  - `ctx.msg.react()`, `ctx.msg.unreact()` and `ctx.msg.delete()` (also on `MessageHandle`) now wait for a send slot like every other outbound action. `sendMessage({delete})` resolves once written to the socket, so tight loops had part of the burst silently dropped server-side.
  - `ctx.chat.history.from()` now matches by sender LID **or** phone number. Entries received before Baileys learned the contact's LID (`sender = null`) were being skipped.

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

### Build / CI

- Added `prepare` npm script (`scripts/install-local-hooks.sh`) that points the clone's git hooks at `scripts/local-hooks/` on `npm install`.
- New local `pre-commit` hook: auto-bumps `packages/types/package.json` minor version when staged changes touch the published `@manybot/types` definitions (`packages/types/{en,pt}`).
- Renamed `hooks/` to `scripts/git-hooks/` (server-side release infra, no contributor impact).
- Updated `sharp`, `nodemailer` and `emoji-regex` dependencies.

