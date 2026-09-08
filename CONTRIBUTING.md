# Contributing to ManyBot

Thank you for wanting to help! This doc covers the essentials before contributing contributing

## Table of Contents

-   [Ways to contribute](#ways-to-contribute)
-   [Requirements](#requirements)
-   [Setting up](#setting-up)
-   [Project layout](#project-layout)
-   [Architectural Invariants](#architectural-invariants-read-before-editing-kernel-or-drivers)
-   [Code style](#code-style)
-   [Translations](#translations)
-   [AI-assisted contributions](#ai-assisted-contributions)
-   [Commit messages](#commit-messages)
-   [Before you open a PR](#before-you-open-a-pr)
-   [Submitting your change](#submitting-your-change)
-   [Troubleshooting](#troubleshooting)
-   [Reporting security issues](#reporting-security-issues)
-   [CI/CD](#cicd)
-   [Releases and the changelog](#releases-and-the-changelog)
-   [License](#license)

## Ways to contribute

- **Bugs & feature requests**: open an issue on [GitHub](https://github.com/many-bot/manybot) or [Codeberg](https://codeberg.org/many-bot/manybot). Issue templates are provided for both bugs and features.
- **Code**: open your pull requests on GitHub or Codeberg. Patches by email (`manybot@pm.me`) are very welcome too.
- **Plugins**: plugins live in their own repos, not here. [This doc](https://manybot.org/docs/how-to-make-a-plugin/) covers everything you need to know when creating a plugin and publishing it.
- **Ideas**: [email us](mailto:manybot@pm.me) or open a issue in the repositories.
- **Translations**: very welcome, mainly for documentation. See [Translations](#translations).

## Requirements

- Node.js >= 24
- npm >= 9
- An interactive terminal for first-time WhatsApp login

## Setting up

```bash
git clone https://git.stxerr.dev/manybot.git
cd manybot
npm install
npm run build
npm start
```

`npm run build` compiles TypeScript to `dist/` and copies locale files. `npm start` then runs the compiled output.


On first run ManyBot creates `~/.manybot/manybot.toml`. Edit that file for local config instead of committing changes to it.

There's no watch/hot-reload dev script yet, so re-run `npm run build && npm start` after changes to see them take effect.

## Project layout

A quick map so you know where to look:

```text
src/
├── client/   - persistent bot state (store, cache) and the banner -- very important.
├── download/ - sequential execution queue for plugins that needs heavy jobs.
├── drivers/  - the WhatsApp backend implementation, behind a shared WaContract interface.
├── i18n/     - internationalization system for the framework and for the plugins.
├── kernel/   - core bot logic: plugin loading, driver management, scheduling, guards.
├── locales/  - all the translations from the framework.
├── logger/   - standard style for logs.
├── plugins/  - this only have a test plugin to test if the framework is really working.
├── utils/    - utilities for specific tasks, like number normalization.
└── config.ts - config loading and path resolution.

scripts/        - some scripts for testing or building.
packages/types/ - @manybot/types, types for plugin API
```

I organized `drivers/` this way because I can change the WhatsApp backend in the future, like I already did migrating from whatsapp-web.js to Baileys. `i18n/` covers both the framework and plugins (`pluginT`, `createPluginT`). If you want to help with translations, `locales/` is the way.

Before touching `kernel/` or the driver layer, read the relevant file headers (every file in `src/kernel/` opens with a comment explaining its responsibility) and the `WaContract` interface in `src/kernel/waContract.ts`. Those notes capture design decisions (fallback/cooldown semantics, driver-neutral message types) that are easy to re-derive the wrong way.

## Architectural Invariants (read before editing `kernel/` or `drivers/`)

Things that have broken before or are easy to reimplement incorrectly. See also `AGENTS.md` for a more detailed guide tailored for AI agents:

- **`WaContract` is the frontier between kernel and driver.** The kernel never imports a driver directly, and code outside `src/drivers/` must never touch a raw socket. Inside `src/drivers/baileys/`, the only legitimate use of `rawSocketOf(contract)` today is in `getGroupMetadataCached()` (it needs "Baileys-flavored" metadata that the neutral contract does not carry). Any other `sock.user`/`sock.ev` outside of that is a regression.
- **Debug logs are silent by default.** Use `logger.debug(...)` for operational telemetry/non-fatal failures -- it only prints when the binary is invoked with `--debug` (see `src/logger/logger.ts`). `info`/`warn`/`error` remain enabled. Never use `console.debug` or raw `console.log` for diagnostics. The goal is keeping production logs clean without losing call sites when verbose mode is needed.

## Code style

-   Files that hold non-obvious logic start with a header comment explaining what the file is responsible for (see any file in `src/kernel/` for examples). Do this for new files too.
-   Documentation and code comments must always be written in English only (except for localization resource files in `src/locales/` such as `pt.json` / `es.json`).
-   Imports use the `#alias/*` subpath imports defined in `package.json` / `tsconfig.json` (e.g. `#kernel/...`, `#drivers/...`) instead of long relative paths.
-   Prefer explaining _why_ in comments over _what_. The code is expected to say what it does.
-   Match the formatting of the file you're editing (indent, quote style, trailing commas). When in doubt, run `npm run check` and let the tooling be the tiebreaker.

## Translations

Translation is a great way to contribute without touching the framework code.

- **Docs**: the [documentation](https://github.com/many-bot/docs) doesn't have a formal translation guide yet -- for now, open a PR there translating a page (or a few) and we'll figure out the process as it comes up. Docs get more attention here than the framework's own strings, so they're the higher-priority target if you want to help.
- **Core (framework strings)**: bot-facing strings live in `src/locales/` (see [Project layout](#project-layout)). `en.json` is the source of truth -- match its keys when adding or updating a locale. Lower priority than docs, but still welcome.

## AI-assisted contributions

AI tools are fine to use, but you're responsible for what you submit.

-   **Documentation**: I write (almost) everything by hand, and that's still my preference for this project. If you use AI to help draft docs, review every line yourself and make sure it's accurate before opening a PR -- don't submit something you haven't actually checked.
-   **Code**: a passing `npm run check` isn't proof the change works. Actually run ManyBot and exercise the behavior you changed, not just the test suite -- especially for anything touching `kernel/` or the driver layer.

## Commit messages

We don't enforce a strict format, but PRs and patches are easier to review when commits are small and self-describing. A loose convention that works well here:

```
<area>: <one-line summary>

<optional body explaining *why*, not *what*>
```

`<area>` is usually one of `kernel`, `drivers/<name>`, `i18n`, `build`, `deps`, `docs`. If your change touches multiple areas, pick the dominant one. Squash commits before merging if the history is noisy.

Every commit must be self-contained and fully functional on its own. Never split changes across commits in a way that leaves intermediate commits uncompilable, failing checks, or with unresolved dependencies.

## Before you open a PR

```bash
npm run check
```

This script covers almost everything: typecheck, eslint, tests and check-types-drift.ts (our script to make sure that the `@manybot/types` package is syncronized to the plugin API).

Remeber that tests are part of the change: add or update focused coverage whenever behavior is added or changed. Treat a passing test as a check against the intended production contract, not as a reason to preserve an accidental implementation detail. If an existing expectation describes behavior that is correct in the code but wrong in production, fix production when that is the intended outcome; otherwise update the stale test expectation and cover the actual contract.

## Submitting your change

1.  Fork the repo and create a branch for your change.
2.  Keep the change focused, one change per contribution is much easier to review than several bundled together.
3.  Make sure npm run check passes cleanly.
4.  Fill in the PR template (if you want to send as a PR) it asks for a one-line description, a link to the issue it closes (if any), and a short note for the reviewer. Plugin-specific changes go to manyplug, not here.
5.  Submit your change using whichever contribution method works best for you:

-   Pull request: Open the PR against GitHub or Codeberg with a short description of what changed and why.
-   Git patch: Create a patch from your branch and send it by email. Include the same information as the PR template: a one-line description, a link to the issue it closes (if any), and a short note for the reviewer.

6.  Be ready for a long review round - especially for anything touching kernel/ or the driver contract.

## Troubleshooting

A few things that have caught people before:

-   **`tsc` complains about `#kernel/...` imports**: the `imports` map lives in `package.json`. If you add a new subpath, add it there too.

If something here is wrong or missing, please open an issue - this section grows from real gotchas.

## Reporting security issues

**Do not open a public GitHub/Codeberg issue for security bugs.** Send details to `manybot@pm.me` instead, with enough info to reproduce. You'll get a reply within a few hours or days; if not, follow up. We coordinate disclosure timing case by case.

## CI/CD

The scripts in `scripts/git-hooks/` (`post-receive`, `release.sh`, `github-release.sh`) run on the maintainer's server to build and publish releases when a `v*` tag is pushed. They're not part of the contributor workflow, you can ignore this folder unless you're helping with release infrastructure.

## Releases and the changelog

`CHANGELOG.md` is the source of truth for what changed between releases. Clean the file before every version, past versions are tracked by Git log only, grouped by _New Features_, _Improvements_, _Refactors_, _Build / CI_, _New Dependencies_, and _New Configuration Options_.

Two expectations for contributors:

-   **Anything user-visible that lands on `master` should show up in the next release's changelog entry.** That includes new config keys, new public APIs plugins can call, behavior changes, and dependency bumps that affect installs.
-   **The first section of `CHANGELOG.md` is the _in-development_ entry.** When you open a PR that adds a user-visible change, append a bullet to the current `## v… - In-Development` section in the same PR -- don't wait for the maintainer to do it during the release cut. Internal-only changes (test infra, refactors with no behavior delta, CI tweaks) can skip this.

The release itself is run by the maintainer; you don't need to handle versioning.

> Review note: this rule was broken once -- the `commands.yaml` system (command registration, permissions, deprecation, menu) reached the code without a corresponding entry in `CHANGELOG.md`. If you are closing a change visible to users or plugin developers, add the entry in the same PR/task, not later.

## License

ManyBot is licensed under GPL-3.0. By contributing, you agree your contribution is licensed under the same terms.