# Contributing to ManyBot

Thanks for wanting to help! This doc covers everything you need to make a change and send it in.

## Ways to contribute

- **Bugs & feature requests** — open an issue on [GitHub](https://github.com/many-bot/manybot) or [Codeberg](https://codeberg.org/many-bot/manybot). Issue templates are provided for both [bugs](.github/ISSUE_TEMPLATE/bug_report.yml) and [features](.github/ISSUE_TEMPLATE/feature_request.yml).
- **Code** — pull requests on GitHub or Codeberg. Patches by email (`manybot@pm.me`) also work if you prefer not to use either platform.
- **Plugins** — plugins live in their own repos, not here. Submit yours to [manyplug-repo](https://github.com/many-bot/manyplug-repo), which has its own submission instructions.
- **Everything else** — translations, docs fixes, art, ideas: open an issue or email us.

## Requirements

- Node.js >= 24
- npm >= 9
- Go >= 1.23 — only needed if you're touching the `whatsmeow` driver or `whatsmeow-service/`. The build script (`scripts/build-whatsmeow.mjs`) skips it automatically if `go` isn't on your `PATH`, and the bot runs fine on Baileys alone.
- `protoc` — only needed if you're changing `whatsmeow-service/pb` (protobuf codegen).

## Setting up

```bash
git clone https://github.com/many-bot/manybot.git
cd manybot
npm install
npm run build
npm start
```

`npm run build` compiles TypeScript to `dist/`, copies locale files and the `.proto` schema, and (if Go is available) builds the `whatsmeow-service` binary. `npm start` then runs the compiled output.

> If you installed ManyBot from npm globally you don't need any of this — the package already ships with a built `dist/`. This section is only for working on the bot itself.

On first run ManyBot creates `~/.manybot/manybot.toml` — edit that file for local config instead of committing changes to it.

There's no watch/hot-reload dev script yet, so re-run `npm run build && npm start` after changes to see them take effect.

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm run test
```

Make sure all three checks pass cleanly with no errors before opening a PR:
- `npm run typecheck`: Checks TypeScript in `strict` mode.
- `npm run lint`: Runs ESLint flat config (`eslint.config.mjs`) with `eslint-plugin-import-x` to detect circular imports.
- `npm run test`: Runs the automated unit test suite (`src/**/*.test.ts`) using `node:test` and `tsx`.

## Project layout

A quick map so you know where to look:

- `src/kernel/` — core bot logic: plugin loading, driver management, scheduling, guards.
- `src/drivers/baileys/` and `src/drivers/whatsmeow/` — the two WhatsApp backend implementations, behind a shared `WaContract` interface.
- `src/client/` — persistent bot state (store, cache).
- `src/i18n/` + `src/locales/` — translations (`en`, `es`, `pt`).
- `src/config.ts` — config loading and path resolution.
- `whatsmeow-service/` — the Go gRPC service used by the `whatsmeow` driver.
- `scripts/` — build helper (`build-whatsmeow.mjs`) and smoke tests for the whatsmeow supervisor.
- `hooks/` — release infrastructure used on the maintainer's server; see *About `hooks/`* below.

Before touching `kernel/` or the driver layer, read the relevant file headers (every file in `src/kernel/` opens with a comment explaining its responsibility) and the `WaContract` interface in `src/kernel/waContract.ts`. Those notes capture design decisions (fallback/cooldown semantics, driver-neutral message types) that are easy to re-derive the wrong way.

## Architectural Invariants (read before editing `kernel/` or drivers)

Things that have broken before or are easy to reimplement incorrectly — see also `AGENTS.md` for a more detailed guide tailored for AI agents:

- **`WaContract` is the frontier between kernel and driver.** The kernel never imports a driver directly, and code outside `src/drivers/` must never touch a raw socket. Inside `src/drivers/baileys/`, the only legitimate use of `rawSocketOf(contract)` today is in `getGroupMetadataCached()` (it needs "Baileys-flavored" metadata that the neutral contract does not carry). Any other `sock.user`/`sock.ev` outside of that is a regression — it has already happened once with `hasBotMention`/`getContact`, which reverted to using `sock.user` directly instead of `contract.me()`.
- **New version check uses GitHub Releases, not npm.** RC tags skip npm publication and stable releases stay in `staged` until manual 2FA approval — so the npm registry is a delayed or incomplete source of truth for "is there a new version?". Any such check must follow the pattern used in `src/drivers/whatsmeow/installer.ts` (GitHub API), not `registry.npmjs.org`.
- **WhatsMeow platform lists must stay in sync.** `TARGETS` in `scripts/build-whatsmeow-release.mjs` (what is built) and `SUPPORTED` in `src/drivers/whatsmeow/installer.ts` (what the installer downloads) are two separate lists of the same thing. Adding a new platform requires updating both files.
- **Not everything "decided" in design discussions is implemented.** In particular for `commands.yaml`: `subcommands:`, `group:`, and the configurable welcome message were decided but do not exist in `src/kernel/commandsConfig.ts` today. Confirm in code before assuming a design piece exists.
- **Debug logs are silent by default.** Use `logger.debug(...)` for operational telemetry/non-fatal failures — it only prints when the binary is invoked with `--debug` (see `src/logger/logger.ts`). `info`/`warn`/`error` remain enabled. Never use `console.debug` or raw `console.log` for diagnostics — pass through `logger`. The goal is keeping production logs clean without losing call sites when verbose mode is needed.

## Code style

- Files that hold non-obvious logic start with a header comment explaining what the file is responsible for (see any file in `src/kernel/` for examples). Do this for new files too.
- Imports use the `#alias/*` subpath imports defined in `package.json` / `tsconfig.json` (e.g. `#kernel/...`, `#drivers/...`) instead of long relative paths.
- Prefer explaining *why* in comments over *what* — the code already says what it does.
- Match the formatting of the file you're editing (indent, quote style, trailing commas). When in doubt, run `npm run typecheck && npm run lint && npm run test` and let the tooling be the tiebreaker.

## Commit messages

We don't enforce a strict format, but PRs are easier to review when commits are small and self-describing. A loose convention that works well here:

```
<area>: <one-line summary>

<optional body explaining *why*, not *what*>
```

`<area>` is usually one of `kernel`, `drivers/<name>`, `i18n`, `build`, `deps`, `docs`. If your change touches multiple areas, pick the dominant one. Squash commits before merging if the history is noisy.

## Submitting your change

1. Fork the repo and create a branch for your change.
2. Keep the PR focused — one change per PR is much easier to review than several bundled together.
3. Make sure `npm run check` pass cleanly.
4. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) — it asks for a one-line description, a link to the issue it closes (if any), and a short note for the reviewer. Plugin-specific changes go to [manyplug](https://github.com/many-bot/manyplug), not here.
5. Open the PR against GitHub or Codeberg (or send a patch by email) with a short description of what changed and why.
6. Be ready for a review round — especially for anything touching `kernel/` or the driver contract, since that code is shared by both WhatsApp backends.

## Troubleshooting

A few things that have caught people before:

- **`npm start` says `Cannot find module '...dist/main.js'`** — you skipped `npm run build`. The `start` script runs the compiled output, it doesn't compile.
- **Build fails with `protoc: command not found`** — only relevant if you're regenerating the gRPC bindings in `whatsmeow-service/pb/`. A normal `npm run build` doesn't need `protoc`.
- **`go build` fails inside `npm run build`** — if you're on the whatsmeow path, run it manually with `cd whatsmeow-service && go build -o bin/whatsmeow-service .` to see the real error. If you don't need whatsmeow you can just delete `whatsmeow-service/` locally; the build script will skip it as long as `go` is missing from `PATH`.
- **`tsc` complains about `#kernel/...` imports** — the `imports` map lives in `package.json`. If you add a new subpath, add it there too.
- **My change works locally but CI flags it** — CI runs on the maintainer's self-hosted runner and *does* build whatsmeow. If your change breaks the Go side, expect a red build.

If something here is wrong or missing, please open an issue — this section grows from real gotchas.

## Reporting security issues

**Do not open a public GitHub/Codeberg issue for security bugs.** Send details to `manybot@pm.me` instead, with enough info to reproduce. You'll get a reply within a few days; if not, follow up. We coordinate disclosure timing case by case.

## About `hooks/`

The scripts in `hooks/` (`post-receive`, `release.sh`, `github-release.sh`) run on the maintainer's server to build and publish releases when a `v*` tag is pushed. They're not part of the contributor workflow — you can ignore this folder unless you're helping with release infrastructure.

## Releases and the changelog

`CHANGELOG.md` is the source of truth for what changed between releases. Cut a new top section under a `## vX.Y.Z — YYYY-MM-DD` heading for every version, grouped by *New Features*, *Improvements*, *Refactors*, *Build / CI*, *New Dependencies*, and *New Configuration Options* (mirror the existing layout — it's the format users and the website docs already parse).

Two expectations for contributors:

- **Anything user-visible that lands on `master` should show up in the next release's changelog entry.** That includes new config keys, new public APIs plugins can call, behavior changes, and dependency bumps that affect installs.
- **The first section of `CHANGELOG.md` is the *in-development* entry.** When you open a PR that adds a user-visible change, append a bullet to the current `## v… — In-Development` section in the same PR — don't wait for the maintainer to do it during the release cut. Internal-only changes (test infra, refactors with no behavior delta, CI tweaks) can skip this.

The release itself (tag push, `hooks/release.sh`) is run by the maintainer; you don't need to handle versioning.

> Review note: this rule was broken once — the `commands.yaml` system (command registration, permissions, deprecation, menu) reached the code without a corresponding entry in `CHANGELOG.md`. If you are closing a change visible to users or plugin developers, add the entry in the same PR/task, not later.

## License

ManyBot is licensed under [GPL-3.0](LICENSE). By contributing, you agree your contribution is licensed under the same terms.
