# Changelog

## 5.13.0 - Unreleased

### Changed (breaking)

- `ctx.admin.kick()` now follows the WhatsApp app's Community semantics. Targeting a Community (`chat.community`) or its announcements group removes the member from **every** group of the Community, announcements last (one group at a time, with a short pause between removals). Previously it removed the member from that single group only — so banning from the announcements group left them in the Community's other groups, and kicking the Community jid itself did nothing. Kicking from an ordinary linked group (e.g. "General") or from a group outside any Community is unchanged.
  - `kick()` now resolves with one `GroupKickOutcome` per group (`removed` / `not_member` / `failed`, with `reason` and the raw WhatsApp `code`). Groups the member isn't in are `not_member`, not errors.
  - If the removal fails in any group, `kick()` rejects with the new `CommunityKickError` (`results`, `removed`, `failed`). Every group is still attempted; nothing stops at the first failure. Reasons: `not_admin` (checked before sending anything), `target_superadmin` (group owner, checked before sending anything), `rate_limited`, `timeout`, `unknown`.
  - The member is resolved per group, so a member addressed by LID in one group and by phone number in another is handled. Kicking the Community jid no longer fails to find members, even though a Community's own metadata only lists admins.
  - Plugins that relied on "kick from the announcements group only" must target a linked group instead.
- `@manybot/types` 2.3.0: adds `GroupKickOutcome`, `GroupKickReason`, `CommunityKickError`; `AdminApi.kick()` returns `TargetableAction<GroupKickOutcome[]>`.

### New Features

- `ctx.settings` auto-prune: a chat's entire plugin-settings footprint is now deleted once nothing
  has touched it (via `ctx.settings`, read or write, by any plugin) for `SETTINGS_PRUNE_MAX_AGE_DAYS`
  (default 90), checked every `SETTINGS_PRUNE_INTERVAL_HOURS` (default 24). Covers the common case
  of a group removing the bot, whose settings would otherwise sit in `settings.db` forever. Runs
  once on startup and then on a schedule; disable with `SETTINGS_PRUNE_ENABLED = false`.
  Source: [settingsPrune.ts](src/kernel/settingsPrune.ts).
- `ctx.settings.allChats()`: lists every chat ID that has at least one stored setting for the
  calling plugin (excludes the synthetic `_global` chat ID). Lets a plugin discover which chats
  it's active in without keeping its own index.
- `SetupContext.settings` gains `forChat(targetChatId)`, alongside the existing `global` — reads
  and writes an explicit chat's settings with no current chat needed (`setup()` still has no
  `link`/`unlink`/`getCommunityId`/`getCommunityChats`, which are bound to a current chat).
- `ctx.chat.isSuperAdmin(contactId)` / `ctx.chat.isSenderSuperAdmin()`: check whether a contact (or
  the message sender) is the group's super-admin (owner/creator). Same always-fresh-metadata
  semantics as `isAdmin()`/`isSenderAdmin()`.
- `ctx.chat.mute(lid, { duration })` / `ctx.chat.unmute(lid)`: mutes a LID in the current chat for
  up to 1 month (`RangeError` on an invalid/out-of-range duration). A muted sender's messages are
  ignored before any other side effect (no read receipt, no plugin, nothing marked as processed).
  Persisted in `settings.db` (survives restart), with lazy expiry cleanup.
  Source: [chatMutes.ts](src/kernel/chatMutes.ts).
- Config: `manybot.toml`/`manyplug.toml` values can now reference `"env:KEY"`, resolved against
  `process.env` (warns and falls back to `""` if missing). `CONFIG_DIR/.env` is loaded into
  `process.env` on startup and on `reloadConfig()`, without overriding variables already set.
- `ctx.stats` (`PluginContext` + `SetupContext`, read-only): pseudonymous, aggregate-only
  telemetry — `instance()`, `messagesProcessed()`, `user(lid)`, `group(jid)`, `plugins()`. Backed
  by a new SQLite store (`telemetry.db`, WAL). No message content is ever persisted or exposed.
  Source: [telemetryDb.ts](src/kernel/telemetryDb.ts).
- Per-chat language. `LANGUAGE` in the config is now only the bot's default; each chat can have its own language, stored in `settings.db` (`core` / `chat_locale`, the key the `setChatLocale` core handler already used).
  - Core API ([chatOverrides.ts](src/kernel/chatOverrides.ts)): `setChatLocale(chatId, lang)`, `clearChatLocale(chatId)`, `getChatLocale(chatId)`, `resolveChatLang(chatId)`. Regional codes are accepted (`pt-BR` → `pt`); unsupported codes throw `RangeError`. Available languages are read from `src/locales/` instead of a hardcoded list.
  - Plugins: `ctx.i18n.setChatLocale(lang, chatId?)`, `getChatLocale(chatId?)`, `clearChatLocale(chatId?)`, `available()` and `lang`.
  - Core handler `setChatLocale` (`<code>`, or `padrao` to go back to the bot default) now uses the core API. It is ready, but no command is bound to it yet.
  - Built-in permission messages (admin only, cooldown, wrong scope, …) are now translated per chat when a command is checked, instead of being frozen in the bot language at load. Messages set in the commands YAML are unchanged.
- `@manybot/types`: `I18nApi` gains `lang`, `getChatLocale()`, `setChatLocale()`, `clearChatLocale()` and `available()`.

### Changed

- `ctx.chat.getGroups()` entries now include `mention` (`{ text, groupMentions }`), built inline
  since the group's Community membership is already established by its presence in the list —
  no extra `getChat()` lookup needed.
- `ctx.chat.close()`/`open()` now cascade to **every group linked to the Community** (announcements
  last) when called from a Community chat, instead of affecting only that single chat — mirrors
  `ctx.admin.kick()`'s existing Community cascade. Still never throws; `"partial"` is returned if
  any group didn't reach `"ok"`. Paced the same way as the kick cascade, including an extra cooldown
  after a rate-limited request.
- `ctx.chat.mute()` now also deletes the muted sender's message for everyone (best-effort — requires
  the bot to be a group admin; failures are swallowed).
- `sendGuard`: loosened `low`/`medium` `SECURITY_LEVEL` profile timings and raised `medium`
  concurrency (e.g. low `chatCooldownMs` 100→0ms, `typingMax` 2000→500ms; medium concurrency 2→3).
  No config keys changed, only the internal defaults.
- Telemetry: the `group` table is now reconciled with the account's real group list on connect (at most once per hour, persisted across restarts), so joins and leaves that happened while the bot was offline are no longer missed. Groups found this way have an unknown join time, so `ctx.stats.group(jid).joinedAt` is now `number | null` (`@manybot/types` updated).
  - An empty scan while groups are tracked as active is ignored instead of closing them all, and join/leave events recorded during the scan take precedence over it.
  - Existing `telemetry.db` files are migrated automatically (`group.joined_at` becomes nullable).
- `ctx.t`, `ctx.i18n.t` and `ctx.i18n.createT()` translators now resolve the **current chat's language** on every call in command contexts (previously always the bot's language). In `setup` contexts, and for logs/alerts, the bot default is still used. `createT().lang` is now a getter, so destructuring it captures the value at that moment.
- `ctx.i18n.getCurrentLang()` still returns the bot's default language; use `ctx.i18n.lang` for the chat's.

### Fixed

- Baileys: messages with a missing or zero timestamp are now treated as stale instead of fresh,
  so an event with unknown age can't bypass the backlog filter after a reconnect.
- Baileys: reactions, group stub events (member add/remove, subject change, etc.) and other
  non-content protocol entries that arrive in the `messages.upsert` stream with a real sender but
  no decodable content (`type: "other"`, empty body) are no longer dispatched to every plugin's
  `run(ctx)` — fixes "any message" handlers firing for events that aren't actual messages.
- i18n: `translate()`/`createPluginT()` now return array/object locale values as-is instead of
  coercing them to `String(value)` (which produced `"[object Object]"`). Only primitives are
  still stringified.
- Baileys: listing a Community's linked groups now seeds the shared group-metadata cache from the same account scan, so Community-wide admin actions no longer cost one extra `groupMetadata()` lookup per group.

---

Previous releases are tracked via Git tags.
