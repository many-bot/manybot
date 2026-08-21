# Changelog

## Unreleased

### Removed
- **Driver fallback support** — Fallback between drivers was removed entirely. Driver selection is now mutually exclusive: if `driver_primary` is disabled or its supervisor fails to start, the bot exits with an error instead of silently switching to Baileys. WhatsMeow remains an optional, experimental driver; Baileys is the only driver in production. The idea was sound on paper but introduced complexity and reliability issues in practice.
- Dead config keys `driver_fallback_cooldown_ms` / `driver_verify_window_ms`, and the now-unreachable `AlertKind`s / i18n strings tied to fallback (`sendFailedNoFallback`, `sendFailedBothDrivers`, `alerts.noFallback`, `alerts.bothDriversFailed`) across `en`/`pt`/`es` locales.


### New Features

- **`commands.yaml` system** — centralized command configuration, replacing the hardcoded definition in the menu plugin:
  - Command registration (`src/kernel/commandRegistry.ts`) with a per-command schema: `cmd`, `aliases`, `plugin`, `function`, `text` (literal, inline, or `file:./path`), `desc`, `category`, `manual`, `deprecatedMessage`.
  - Per-command permissions (`src/kernel/commandPermissions.ts`): `admin`, `botAdmin`, `scope` (`group`/`dm`/`any`), `owner`, `cooldownSeconds`, `whitelist`/`blacklist` (group and user separated, blacklist wins over whitelist). Customizable warning messages per case (`botNotAdmin`, `senderNotAdmin`, `ownerOnly`, `wrongScope`, `cooldown`).
  - Automatic command deprecation (`src/kernel/commandDeprecation.ts`): detects rename or removal of a `cmd` already in use and blocks reuse of the old name for a configurable period (`notifyPeriodDays`, default 7 days), with a global toggle plus per-command override (`notifyChanges`).
  - Native menu (`src/kernel/commandMenu.ts`): overview, per-category listing, per-command manual, pagination, a configurable welcome message (`menu.welcomeMessage`, fires on a user's first message within a configurable time window — default 3 days), and a "command not found" fallback — configurable via `menu.title`/`intro`/`footer`/`aliases`.
  - i18n support in every text field of the schema (`desc`, `manual`, `title`, `intro`, `footer`) via `LocalizedString`, reusing the same `src/i18n` / `src/locales` infra.
  - Unified command dispatch (`src/kernel/runCommand.ts`, exposed as `ctx.runCommand`): every command execution — real inbound messages and plugin-to-plugin calls alike — goes through the same pipeline (permission check → subcommand routing → required-argument validation → handler dispatch → crash alert on throw), scoped to the target command's owning plugin, not the caller's.
  - Nested `subcommands:` (e.g. `f criar`/`f extrair`/`f parar`): inherit the parent's permissions by default, individually overridable; appear grouped under the parent in the menu.
  - Required-argument validation with a kernel-generated "missing argument" error and usage hint.
  - Read-only command registry queries (`ctx.commands`): `exists`, `desc`, `manual`, `list`, `isMenuAlias` — lets a plugin check another command's existence/description without `ctx.plugins.require()`'ing its owning plugin.
  - `import:` — split `commands.yaml` across auxiliary files (e.g. `menu.yaml`, `manual.yaml`) via a root-level `import:` (a path or list of paths). Each file exclusively owns its own top-level sections: no deep merge, and a key already defined elsewhere (the main file or an earlier import) is kept as-is with an error logged if a later import redefines it.
- **Exclusive chat session** (`src/kernel/chatSession.ts`, exposed as `ctx.session`) — a kernel-level lock scoped to the current chat, so two plugins can't run an interactive flow (games, a timed prompt, a music-download wait, ...) in the same chat at once. The kernel only tracks who holds the lock; all flow state (timeout, collected input, turn logic) stays inside the plugin. Runtime-only — not present on `SetupContext` (no current chat at setup time). Deliberately not persisted across restarts: a session lock only makes sense for the life of the running process.
- **Plugin crash alerts** — every command execution is wrapped in a central `try`/`catch` (`runCommand.ts`), so a plugin throwing (or timing out) fires an alert through the existing alert system instead of failing silently and going unnoticed. Explicitly distinguishes an unhandled exception from a timeout.
- **Configurable startup log levels** — `LOG_LEVEL` in `manybot.toml`: `normal` (default, everything), `clean` (drops routine `info` chatter), `minimal` (only `warn`/`error`). The noisy per-plugin `"Plugin Loaded: <name>"` line is demoted to `debug` (still visible with `--debug`). The startup ASCII banner now respects this too — shown only at `normal`, and only once per process instead of reprinting on every reconnect.
- **`@manybot/types` package** (`packages/types/`) — standalone TypeScript types for the plugin `ctx` surface, published separately from `@manybot/manybot` so plugin authors get autocomplete without depending on the whole framework. Covers `PluginContext`, `SetupContext`, and every sub-API, including the new `ctx.commands`/`ctx.session`/`ctx.runCommand`. English and Portuguese locales.
- **Test infrastructure & ESLint tooling**:
  - Automated unit-test runner via `node:test` + `tsx` with conditional subpath-import resolution (`development` -> `src/*`, `default` -> `dist/*`).
  - In-memory SQLite (`:memory:`) in `settingsDb.ts` and `commandDeprecation.ts` when `NODE_ENV === "test"`.
  - Unit test suite covering `drivers/jid`, `sendGuard`, `driverManager`, `commandRegistry`, `commandMenu`, `commandDeprecation`, `config`, `sendFallbackGuard`, `contactAutoSave`, and `pluginGuard`.
  - ESLint flat config with `eslint-plugin-import-x` (`import-x/no-cycle`) to prevent circular imports.

### Fixes

- **Internationalization coverage** — menu labels and defaults, command permission messages, operational alerts, and Baileys group/poll errors now use the active locale. The configured/system locale selection remains unchanged; test defaults continue to use English.
- **`hasBotMention`/`getContact` reverted to using `contract.me()`** instead of reaching into `sock.user`/`sock.user?.lid` directly — a regression from the pattern already used elsewhere in `src/drivers/baileys/api/index.ts`. After the fix, `rawSocketOf` is restricted to a single legitimate use (`getGroupMetadataCached`).
- **`updateCheck.ts` migrated from `registry.npmjs.org` to the GitHub Releases API**, matching the pattern already used in `src/drivers/whatsmeow/installer.ts`. Fixes the case where the update notice never fires for RC tags (which skip npm publication) or is delayed for stable releases stuck in `staged` waiting for 2FA approval.

### Removed

- **WhatsMeow driver removed** — the experimental Go + gRPC subprocess fallback (`src/drivers/whatsmeow/`, `whatsmeow-service/`, the `build-whatsmeow*` / `smoke-whatsmeow*` scripts) never reached a stable release and was carrying ongoing maintenance cost with no shipped benefit. Baileys is now the only supported driver. Specifically:
  - `CONFIG.drivers.whatsmeow`, the `CONFIG.drivers.primary` discriminator (now hardcoded to `"baileys"`), and all flat `driver_whatsmeow_*` keys are gone — legacy keys still present in `manybot.toml` are silently dropped by `normalize()`.
  - `MANYBOT_SMOKE=1` (force-enable of whatsmeow) no longer exists.
  - `--install-whatsmeow` (CLI flag) no longer exists.
  - The `whatsmeow_subprocess_halted` alert kind is removed from `alerts.ts` and from all three locales.
  - `DriverManager` lost its fallback path — `pickSecondary()` returns `undefined`, and `sendWithFallback` reports `no_fallback` instead of trying a secondary.
  - `Go >= 1.23` and `protoc` are dropped from the prerequisites in `README.md` / `CONTRIBUTING.md`; the cross-compile step in `hooks/release.sh` and the binary-asset upload in `hooks/github-release.sh` are removed.
  - `npm run build` no longer compiles the Go service or copies the `.proto`.

### Known limitations

- "Every command must be declared in `commands.yaml`" is not enforced yet — the registry still auto-registers and routes a plugin's default commands even without a YAML entry, for backward compatibility. Enforcement lands once YAML becomes the primary path rather than opt-in.
- No kernel warning yet for a function referenced both in `commands.yaml` and called directly by another plugin (dual-use/conflict detection).

### Improvements
- Added rule to `CONTRIBUTING.md` stating that documentation and code comments must be written in English only (except for `src/locales/` files).
- Translated project documentation, guides, release hooks, and design documents to English.

### Refactors
- `sendFallbackGuard.ts` renamed to `activeDriverSend.ts` (`sendWithFallback()` → `sendActiveDriverText()`); the unused `SendFailedError` class was removed.

---

Previous releases are tracked via Git tags.