# Changelog

## v5.8.0 — In Development

> This entry covers work that is already in the codebase but has never appeared in a changelog, plus items planned to close out the current cycle (see `plano-final-manybot.md`). Items marked `[planned]` have not been applied to the code yet — they live here as a draft so they aren't forgotten when the change lands.

### New Features

- **`commands.yaml` system** — centralized command configuration, replacing the hardcoded definition in the menu plugin:
  - Command registration (`src/kernel/commandRegistry.ts`) with a per-command schema: `cmd`, `aliases`, `plugin`, `function`, `text` (literal, inline, or `file:./path`), `desc`, `category`, `manual`, `deprecatedMessage`.
  - Per-command permissions (`src/kernel/commandPermissions.ts`): `admin`, `botAdmin`, `scope` (`group`/`dm`/`any`), `owner`, `cooldownSeconds`, `whitelist`/`blacklist` (group and user separated, blacklist wins over whitelist). Customizable warning messages per case (`botNotAdmin`, `senderNotAdmin`, `ownerOnly`, `wrongScope`, `cooldown`).
  - Automatic command deprecation (`src/kernel/commandDeprecation.ts`): detects rename or removal of a `cmd` already in use and blocks reuse of the old name for a configurable period (`notifyPeriodDays`, default 7 days), with a global toggle plus per-command override (`notifyChanges`).
  - Native menu (`src/kernel/commandMenu.ts`): overview, per-category listing, per-command manual, and a "command not found" fallback — configurable via `menu.title`/`intro`/`footer`/`aliases`.
  - i18n support in every text field of the schema (`desc`, `manual`, `title`, `intro`, `footer`) via `LocalizedString`, reusing the same `src/i18n` / `src/locales` infra.
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

- `subcommands:` (nested structure for sub-commands of a single plugin) and `group:` (grouping different commands under one menu item) were decided in the `commands.yaml` design but do not exist in the schema yet.
- Configurable welcome message for new users (`menu.welcomeMessage`) is not implemented yet.

---

Previous releases are tracked via Git tags.
