# Contributing to ManyBot

Thank you for contributing to ManyBot. This guide describes the conventions,
architecture boundaries, local commands and review expectations that keep the
framework safe to extend.

## Table of Contents

- [Requirements](#requirements)
- [Getting Started](#getting-started)
- [Project Layout](#project-layout)
- [Coding Standards](#coding-standards)
- [Architecture Boundaries](#architecture-boundaries)
- [Documentation](#documentation)
- [Testing](#testing)
- [Security](#security)
- [Performance and Reliability](#performance-and-reliability)
- [Git Workflow](#git-workflow)
- [Changelog](#changelog)
- [Before You Open a PR](#before-you-open-a-pr)

## Requirements

- Node.js >= 24
- npm >= 9
- Git
- An interactive terminal for first-time WhatsApp QR or phone-code login

ManyBot is an open-source WhatsApp automation framework. Use it responsibly
and in accordance with WhatsApp's terms, local law and the consent of people
you contact.

## Getting Started

```bash
git clone https://github.com/many-bot/manybot.git
cd manybot
npm install
npm run build
npm start
```

`npm run build` compiles TypeScript to `dist/`, copies framework locale files,
and verifies the public plugin types. After changing source files, rebuild
before running the compiled application.

The first run creates `~/.manybot/manybot.toml`. Use that file, or set
`MANYBOT_CONFIG_DIR`, for local configuration. Do not commit personal config,
WhatsApp session data, plugin data or logs.

## Project Layout

```text
src/
├── client/       # Persistent bot state, cache, store and banner
├── download/     # Sequential queue for heavy plugin jobs
├── drivers/      # WhatsApp driver implementations and adapters
├── i18n/         # Framework and plugin translation helpers
├── kernel/       # Plugin loading, commands, guards, scheduling and runtime
├── locales/      # Framework translations (en, es and pt)
├── logger/       # Application logging
└── utils/        # Focused shared utilities

packages/types/   # Published TypeScript surface for plugin authors
scripts/          # Build checks, probes, hooks and release helpers
```

Keep a file focused on one responsibility. Use descriptive filenames that
match the surrounding directory and existing naming style. New files with
non-obvious logic should begin with a short English header explaining their
responsibility.

## Coding Standards

### General Principles

1. Prefer readable, simple code over clever abstractions.
2. Preserve existing public APIs and local patterns unless the change requires
   an intentional contract update.
3. Fix behavior at the owning abstraction instead of patching each caller.
4. Keep changes focused and avoid unrelated formatting or refactors.
5. Use `const` by default and `let` only when reassignment is required.

### TypeScript and Modules

- Use strict TypeScript types; do not silence a type error without a clear
  reason.
- Use the `#...` import aliases defined in `package.json`, such as
  `#kernel/...`, `#drivers/...` and `#logger`.
- Include the `.js` extension in relative ESM imports.
- Prefer named exports and explicit types for public contracts.
- Avoid one-letter names and unexplained abbreviations.
- Match the file's existing indentation, quote style and trailing commas.

```ts
import { logger } from '#logger';
import type { WaContract } from '#kernel/waContract.js';

export async function refreshContact(contract: WaContract, jid: string) {
  try {
    return await contract.getContact(jid);
  } catch (error) {
    logger.debug('Contact refresh failed', { jid, error });
    return null;
  }
}
```

### Errors and Logging

- Handle expected failures at the boundary that can recover or report them.
- Preserve useful context without exposing credentials, message contents or
  other sensitive data.
- Use `logger.debug(...)` for operational telemetry and non-fatal diagnostics.
  Debug output is silent unless ManyBot runs with `--debug`.
- Use `info`, `warn` and `error` for messages that should remain visible in
  normal operation. Do not use raw `console.log` or `console.debug` for
  diagnostics.

### Comments and TODOs

Explain why a non-obvious decision exists, not what an obvious line does.
Keep comments current, write them in English, and use TODO/FIXME sparingly;
open an issue when work needs to be tracked beyond the current change.

## Architecture Boundaries

### The `WaContract` Frontier

`src/kernel/waContract.ts` is the boundary between the kernel and WhatsApp
drivers. Kernel code, the plugin API, guards and message handling consume the
driver-neutral contract and must not import Baileys or another raw driver.

Inside `src/drivers/baileys/`, translate driver-specific payloads at the
adapter boundary. The only current exception for `rawSocketOf(contract)` is
`getGroupMetadataCached()`, which needs Baileys-shaped metadata. Accessing
`sock.user`, `sock.ev` or another raw socket surface elsewhere is a regression.

Before changing `src/kernel/` or `src/drivers/`:

1. Read the relevant file header.
2. Read the `WaContract` interface and nearby tests.
3. Keep driver-neutral types in the kernel-facing contract.
4. Add or update focused tests for the changed behavior.

### Plugins and Public Types

The plugin API in `src/kernel/pluginApi.ts` is the source of truth for the
runtime context. The published declarations in `packages/types/` must remain
in sync; `npm run check` runs `scripts/check-types-drift.ts` for this purpose.
When changing plugin-visible behavior, update the API types, implementation,
tests and documentation together.

### Configuration and Runtime Data

Configuration is loaded by `src/config.ts` and runtime state belongs under the
configured ManyBot data directory. Do not make tests depend on a developer's
home directory or on a real WhatsApp session. Use the existing test
configuration helpers and temporary paths.

## Documentation

Update documentation when a change affects users or plugin authors. This
includes configuration keys, public APIs, commands, behavior, setup steps and
runtime requirements. Keep examples executable and consistent with the
current TypeScript and ESM setup.

Documentation and code comments are English-only. Translation resource files
under `src/locales/` are the exception.

## Testing

Tests use Node's built-in test runner with `tsx`; they are not Jest tests.
Place focused tests beside the implementation using the `.test.ts` suffix.
Use descriptive names that state the behavior being protected and cover both
success and relevant failure or boundary cases.

```bash
npm test
```

`npm test` runs `src/**/*.test.ts` with test coverage enabled. Integration
tests that require WhatsApp are opt-in:

```bash
npm run test:integration
npm run test:integration:local
```

The local integration command imports `src/main.ts`; use it only when a
configured test account and suitable local environment are available.

When behavior changes, update the existing expectation if it describes an
incorrect contract, then add coverage for the intended production behavior.
Do not preserve an accidental implementation detail just to keep a test green.

## Security

- Never commit credentials, auth state, private phone numbers, tokens, SMTP
  passwords or generated runtime data.
- Validate and normalize user-controlled JIDs, phone numbers, command input,
  file paths and configuration values at their boundaries.
- Check command permissions before performing privileged actions. Respect
  owner, admin, scope, allowlist, blacklist and cooldown rules.
- Do not include message contents or secrets in logs or thrown errors.
- Treat plugin code and plugin configuration as external input; avoid granting
  new capabilities without an explicit API and permission boundary.
- Report security vulnerabilities privately to `manybot@pm.me`. Do not open a
  public issue with exploit details.

## Performance and Reliability

- Keep WhatsApp calls asynchronous and handle rejected promises.
- Use the existing cache and sequential download queue for their intended
  workloads instead of creating competing concurrency controls.
- Avoid unbounded listeners, timers, retries or in-memory collections.
- Make reconnect, plugin reload and cleanup paths idempotent. Resources opened
  by plugins must be released by their cleanup exports.
- Keep non-critical sinks and diagnostics from blocking message handling.
- Preserve fallback and cooldown semantics in the existing guards; they are
  part of the runtime reliability contract.

## Git Workflow

Create a focused branch for each change. Branch names such as
`feature/short-description`, `fix/short-description` and
`docs/short-description` are easy to scan.

Write commits with one coherent intent and an imperative subject. A scope is
useful when it clarifies the area:

```text
kernel: preserve command cooldown during fallback
drivers/baileys: normalize contact identifiers
docs: refresh contributor workflow
```

Explain the reason and important tradeoffs in the body when the subject is not
enough. Do not commit generated `dist/` output unless the release workflow
specifically requires it.

## Changelog

`CHANGELOG.md` is the source of truth for released changes. The first section
is the in-development release entry. Add a bullet there in the same change for
anything user-visible or plugin-author-visible, including:

- New or changed configuration keys
- Public API or command behavior
- User-facing fixes and features
- Dependency changes that affect installation or runtime

Internal-only tests, refactors and CI changes may omit a changelog entry.

## Before You Open a PR

Run the full project gate:

```bash
npm run check
```

This runs, in order:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`
4. `npx tsx scripts/check-types-drift.ts`

Also confirm that focused tests cover the change, documentation and
`CHANGELOG.md` are updated when needed, and no runtime data or secrets are in
the diff. Pull requests should explain what changed, why it changed, how it
was tested, and any configuration or migration steps reviewers need to know.

## Questions and Contributions

For bugs and feature requests, use the issue templates on
[GitHub](https://github.com/many-bot/manybot) or
[Codeberg](https://codeberg.org/many-bot/manybot). Plugins belong in their own
repositories; see the [plugin development documentation](https://manybot.org/docs/how-to-make-a-plugin/).
Translations, documentation fixes and art contributions are welcome too.
