# AGENTS.md

Guide for AI agents (Claude Code, Antigravity, or similar) working on this repository. Does not replace `CONTRIBUTING.md` — it is a supplement with architectural invariants and pitfalls found during code reviews so they don't have to be rediscovered from scratch in every session.

## Golden Rule: `WaContract` is the frontier

The kernel (`src/kernel/*`) **never** imports a driver directly and **never** touches a driver's raw socket. All communication between kernel and driver goes through the `WaContract` interface (`src/kernel/waContract.ts`). If you are about to write `sock.` in any file outside `src/drivers/`, stop — that is a sign that a contract method is missing, not an excuse to pierce the frontier.

Inside `src/drivers/baileys/`, the raw socket should only be accessed via `rawSocketOf(contract)`, and that is acceptable in **a single place today**: `getGroupMetadataCached()` in `src/drivers/baileys/api/index.ts`, because it needs "Baileys-flavored" metadata (`pn`/`phoneNumber`) that the neutral contract does not carry. Any other use of `rawSocketOf`/`sock.user`/`sock.ev` outside of that is a regression, not a feature — it has already happened once (`hasBotMention`/`getContact` using `sock.user` instead of `contract.me()`, despite the pattern already existing in 5 other places in the same file). When touching `buildMessageContext` or neighboring functions, confirm that `contract.me()` is used for the bot's identity, never the socket.

## Source of Truth for "What is the latest version"

The project uses **GitHub Releases** as the distribution source of truth — not the npm registry. This is because:
- Release candidate tags (`-rc.N`) **skip npm publication entirely**;
- Stable releases remain in `staged` until someone manually approves with 2FA (`npm stage approve`), which may take time.

Any code needing to know "is there a newer version?" (e.g. `src/kernel/updateCheck.ts`, `src/drivers/whatsmeow/installer.ts`) must query `api.github.com/repos/many-bot/manybot/releases/latest`, using the same pattern already used by the WhatsMeow installer. If you find new code checking `registry.npmjs.org` for this purpose, it is a bug, not an alternative style.

## Platforms Supported by the WhatsMeow Driver

`TARGETS` in `scripts/build-whatsmeow-release.mjs` and `SUPPORTED` in `src/drivers/whatsmeow/installer.ts` **must stay in sync** — they are two independent lists of the same thing (one builds, the other downloads). Today they cover only `linux-x64`, `linux-arm64`, `windows-x64`; **macOS/darwin is not included in either**. If you add a platform, add it to both files, otherwise the binary exists in the release but the installer does not know it exists.

## `commands.yaml` — What Already Exists vs. What Has Only Been Decided

Before assuming a piece of the `commands.yaml` design is implemented just because it was decided in a previous conversation, **confirm in code** (`src/kernel/commandsConfig.ts`, `commandRegistry.ts`, `commandMenu.ts`, `commandDeprecation.ts`, `commandPermissions.ts`). In the last review:

- **Implemented**: command schema (`cmd`, `aliases`, `plugin`, `function`, `text`, `desc`, `category`, `manual`, `deprecatedMessage`), permissions (`admin`, `botAdmin`, `scope`, `owner`, `cooldownSeconds`, `whitelist`/`blacklist`), deprecation with configurable period, menu with overview/category/manual/fallback, `LocalizedString` (i18n) in text fields.
- **Decided but not yet implemented** (does not exist in schema): `subcommands:` (nested structure, parent permission inheritance with override), `group:` (grouping different commands under a single menu item), configurable welcome message (`menu.welcomeMessage` + configurable window). Do not build assuming these pieces exist — if a plugin or test depends on them, add them first.

## Automated Tests & ESLint

The repository includes automated unit tests via `node:test` + `tsx` and ESLint flat config (`eslint.config.mjs`).

- **Unit tests**: Located in `src/**/*.test.ts`. Run with `NODE_ENV=test` and `--conditions development` for live module resolution from `src/*`. Database operations in `settingsDb.ts` and `commandDeprecation.ts` switch to in-memory SQLite (`:memory:`) under test mode.
- **ESLint**: Uses `eslint-plugin-import-x` (`import-x/no-cycle`) with `maxDepth: Infinity` and `ignoreExternal: true` to prevent circular imports during refactoring and file splitting.

## Changelog Discipline

`CONTRIBUTING.md` requires this, but in practice it was not being followed: user-visible changes (the `commands.yaml` system above is an example) reached code without a corresponding entry in `CHANGELOG.md`. When finishing a change visible to users or plugin developers, add the entry to `CHANGELOG.md` **in the same task**, not later.

## Before Considering a Task Ready

```bash
npm run typecheck && npm run lint && npm run test
```

All three gates (`typecheck`, `lint`, `test`) must pass cleanly. Treat any failure in any of them as blocking.
