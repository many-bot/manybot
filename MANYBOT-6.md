# ManyBot 6 Implementation Plan

> [!WARNING] We are moving toward 5.8, not directly to 6.0. Everything must continue working exactly as it does now; the new architecture remains experimental until it matures enough to become the default in 6.0.

> Based on the decisions already finalized (as of 08/17). The order is based on technical dependencies — each phase assumes the previous one is already in place.

Important: Everything you change, update MANYBOT-6-STATUS.md
Delete thing that we don't need, the file need to be smaller, not bigger

## Quick Context

* ManyBot 6 is a **separate** version from 5.x, not an evolution/backport — both will be maintained in parallel.
* Work starts in the **5.8.0** roadmap cycle.
* "Lib mode" and a custom REST API: discarded for now (Evolution API is the recommended option for external integration).
* The project remains WhatsApp-first, using Baileys only (WhatsMeow was removed).

## Scope of This Iteration

1. `commands.yaml` parser/loader
2. Central command registry (`ctx.commands`)
3. Unified command/function model + `api` object + `ctx.plugins`
4. Permission system (chain inheritance)
5. Automatic deprecation/rename
6. Native menu (reusing v5.7.0 Stage 7)
7. Exclusive chat session (kernel primitive)
8. Plugin crash alerts (expanded beyond many-ai)
9. Kernel startup logs (per-plugin log removal, configurable levels)
10. Automatic `@manybot/types` generation

Items explicitly out of scope are listed at the end — they do not block this iteration.

---

> [!NOTE] Overall status (08/26) — see `MANYBOT-6-STATUS.md` for full session history. Phases 1-11 complete (the v6 architecture is shipped and stable in production; the gate is green at 233 pass / 10 integration skipped / 0 fail). The two v6-specific loose ends remain intentionally deferred (see `MANYBOT-6-STATUS.md` → Pending): Phase 3 hard-enforcement of "every command in `commands.yaml`" (deliberately non-breaking for the 5.x line), and Phase 3 dual-use conflict warning (additive but needs a design pass).

## Phase 1 — `commands.yaml` Schema and Parser

Foundation for everything: it must load and validate before any execution logic.

* [x] Global `prefix` + `commands:` map (key = stable internal ID, decoupled from `cmd:`)
* [x] Per-command fields: `cmd`, `aliases`, `plugin`, `function` OR `text` (`file:./path` or inline), `category`, `desc` (optional), `manual` (optional, `file:./...` or `manuals[id]` fallback), `group`, `permissions:`, `subcommands:`
* [x] Nested `subcommands`: inherit the parent's `permissions` (overridable); explicitly setting `aliases` clears the default; changing `cmd` triggers rename tracking; appear grouped under the parent in the menu
* [x] Import of auxiliary files (`menu.yaml`, `manual.yaml`): each exclusively owns its top-level sections, with no deep merge — clear error on key conflict — root-level `import:` (string or list), resolved in `commandsConfig.ts`'s `resolveImports()`; first owner of a top-level key wins, later collisions logged and skipped
* [x] i18n for `desc`/`manual` via the existing `src/i18n`/`src/locales`
* [x] Validation: missing required field (`cmd`) -> warning + command is not loaded; missing optional field passively (`desc`) -> omitted; actively requested optional field (`manual`) -> kernel placeholder
* [x] Registrable argument types: `mention`, `url`, `media_direct`, `media_reply` (two distinct types, not unified), `number`, `duration`, `choice`, `boolean`, `quoted_text`, `reply` — free-form text parsing remains the plugin's responsibility
* [x] Automatic usage example generation from the declared argument type (`renderUsage` in `runCommand.ts`)

## Phase 2 — Central Command Registry

* [x] `ctx.commands` exposes registry queries: existence, desc, manual — both point queries and listing (`commandAccess.ts`, exposed through `pluginApi.ts`/`drivers/baileys/api/index.ts`)
* [x] Main purpose: allowing plugins (especially many-ai) to verify another plugin's command without hallucinating
* [x] Foundation for the native "command not found" fallback (reuse v5.7.0 Stage 7)

## Phase 3 — Unified Command/Function Model

Central architectural decision (08/14) — the core of the v6 architecture.

* [ ] Every command must be declared in `commands.yaml`, without exception (nothing should auto-enable a plugin's default command) — **not enforced yet**: `buildCommandRegistry` still registers and routes plugin default commands even without a YAML entry (intentional compatibility with the warning at the top of this file — 5.8 must continue working exactly as it does now). Enforcement will happen once YAML becomes the primary path, rather than opt-in.
* [x] Command function: receives `ctx`, runs as a side effect, and is the same function that can be referenced via `function:` in YAML OR called directly by another plugin — pipeline in `runCommand.ts` (not wired to the message handler yet, see overall status note)
* [x] `ctx.plugins.require("name")` -> throws if it does not exist (already existed in v5)
* [x] `ctx.plugins.get("name")` -> returns `null` if it does not exist (already existed in v5)
* [x] `ctx.plugins.exists("name")` -> boolean (already existed in v5)
* [x] `api` object (already the real standard in v5, retained): `export const api = { async myFunction(args) {...} }` — `api` functions NEVER receive `ctx`; **08/19**: fixed a bug in `runCommand.ts` that confused this facet (`ctx.plugins.require` -> `PluginEntry.exports`) with the command handler facet (`PluginEntry.commands[fn].handler`, always with `ctx`) — subcommand dispatch was resolving the wrong function. `lookupPluginHandler` now reads `pluginRegistry` (pluginLoader.ts) directly.
* [x] No `has_api` flag in the manifest — consumers simply attempt `ctx.plugins.require(...)` and handle the error
* [ ] Kernel warning when the same function is referenced in YAML AND called directly by another plugin (conflict/dual-use detection) — not implemented
* [x] Free-form output: functions retain full freedom for side effects through `ctx` — same model for commands and direct calls
* [x] Direct-call entry point (`ctx.plugins.require`): no kernel validation/enforcement — documented as a known exception (comment in `pluginApi.ts`)

## Phase 4 — Permissions

* [x] Chain inheritance: category -> command -> subcommand — **08/19**: closed the missing link (`categoryHiddenInScope` was calculated in the registry but never affected the resolved `scope`). `resolvePermissions` (`commandRegistry.ts`) gained a `fallbackScope` parameter: top-level commands fall back to the category's `scope` when they do not define their own; subcommands fall back to the parent's already-resolved `scope`. `categoryHiddenInScope` remains separate for future menu use (Phase 6).
* [x] Fields: `admin` (bot and/or user), `group_only`/`dm_only` (with an option to hide from the menu outside the scope), `dono` (specific number), per-user `cooldown`, group/user whitelist/blacklist (global or per-command; blacklist takes priority)
* [x] Customizable warning messages by block type
* [x] Hidden categories in the menu use the same mechanism (not a separate `hidden` field) — `categoryHiddenInScope` is consumed at 4 call sites in `commandMenu.ts` (lines 97, 124, 146, 215), filtering entries from the categorized list, uncategorized list, flat pagination, and per-category views. Same gating shape as `scope` resolution in `commandRegistry.ts` — no separate `hidden` field needed.
* [x] Discarded: custom roles beyond admin/owner; group-size restrictions

## Phase 5 — Automatic Deprecation / Rename

* [x] Automatically triggered when `cmd` changes or the key disappears from YAML
* [x] Marks the command as deprecated for `notify_period_days` (default 7), blocking reuse of the old name during that period
* [x] Customizable message (`{old}/{new}/{days}`), global `notify_changes` toggle + per-command override
* [x] ALWAYS a kernel feature — no plugin implements it independently (legacy to migrate: `figurinha currently hardcodes this manually) — migration of `figurinha` itself has not been done yet

## Phase 6 — Native Menu

* [x] Native kernel feature, not a separate plugin
* [x] `menu:` block (title/intro/footer interpolating `{prefix}`; aliases: help/man/menu/bot/?)
* [x] `categories:` map (label + order); sections/categories are 100% optional (can be a single list)
* [x] Pagination is 100% optional
* [x] Welcome message based on a configurable time window (default 3 days), not "first time ever"
* [x] Base: reuse/adapt Stage 7 already implemented in v5.7.0 (marked unstable in 5.x — it was a v6 component that ended up there by mistake)

> Schema has been ready since Phase 1 (`menu.welcomeMessage/welcomeWindowDays/pageSize`, `categories:`) — only the dispatcher/rendering itself is missing.

## Phase 7 — Exclusive Chat Session (Kernel Primitive)

* [x] Kernel prevents another plugin from opening a session in the same chat while one is already open (used by games, figurinha, music downloads, etc.) — `src/kernel/chatSession.ts` (`acquireSession`/`releaseSession`/`isSessionLocked`/`getSessionHolder`), exposed to plugins as `ctx.session` (`pluginApi.ts` `ISession` + `buildSessionApi()` in `drivers/baileys/api/index.ts`, runtime `PluginContext` only — no current chat at setup time, so `SetupContext` does not get `session`)
* [x] Passive continuation window of many-ai does NOT count toward this lock (separate category) — this module is never called by many-ai's own continuation mechanism; no special-casing needed since the two systems simply don't interact
* [x] Session/state logic (timeout, media collection from history) remains entirely inside the plugin — YAML only registers commands, never internal flows — the kernel primitive only tracks the (chatId → pluginName) holder, nothing about *why* a plugin wants the lock or for how long

> **08/19**: Deliberately not persisted (no settingsDb/SQLite) — a session lock only makes sense for the life of the running process; a restart should never leave a chat "stuck" locked by a plugin that no longer remembers opening it. `acquire()` is idempotent for the current holder (safe to call again on a later message of the same flow); `release()` is a no-op for anyone who isn't the current holder (a plugin can never release someone else's lock).

## Phase 8 — Plugin Crash Alerts

Motivated by a real-world case: many-ai crashing while attempting multiple tools during a search without generating any alert.

* [x] Initial scope: plugin crashes in general, not just many-ai
* [ ] Does not aim for 100% coverage — first cover the cases already detectable with the current effort
* [x] Natural capture point in v6: since every command execution goes through the unified function (called via `function:` in YAML), the kernel can wrap the call in a central try/catch without requiring each plugin to handle it manually — `try/catch` in `runCommand.ts` around `runPlugin(...)`
* [x] Explicitly define what counts as a "crash": unhandled exception + timeout (`err.message.startsWith("timed out")` distinguishes the two `kind`s in the alert)
* [x] Reuse the existing alert system — expand the trigger, do not recreate it from scratch (`fireAlert("plugin_crash", ...)`)
* [x] When implementing Phase 3 (unified function), put the error-capture hook in the correct place from the start — avoids having to come back later

> **Update (08/19)**: `runCommand` is now wired into `messageHandler.ts` — this alert is **active in production** for any matched command whose plugin is dispatched through the unified pipeline. `runCommand.test.ts` (pipeline-level) and `messageHandler.test.ts` (real dispatch path, incl. crash-swallow behavior) both exist and pass — this phase now has full test coverage.

## Phase 9 — Kernel Startup Logs

* [x] Remove messages such as `"INFO Plugin Loaded: <>"` — demoted to `logger.debug` (`pluginLoader.ts`), still available with `--debug`
* [x] Three configurable log levels: `normal`/`clean`/`minimal` — `LOG_LEVEL` in `manybot.toml`, gating in `logger.ts` (`normal`=all, `clean`=drops `info`, `minimal`=only `warn`/`error`), applied via `setLogLevel()` in `main.ts`
* [x] ASCII art of the logo/mascot on startup, as an optional feature that can be disabled for users who prefer clean logs — existing `printBanner()` (`src/client/banner.ts`) now gated on `LOG_LEVEL === "normal"` (silent at `clean`/`minimal`) and guarded to fire once per process instead of on every reconnect (`bannerShown` in `drivers/baileys/index.ts`)

## Phase 10 — `@manybot/types`

* [x] Package generated automatically during the ManyBot build — **superseded same-session**: a real, hand-maintained `@manybot/types` package already existed (v1.5.0 — real Baileys types via peer-dep, curated public names, en+pt locales, `@example`s, README). Adopted as-is; the auto-generator (`scripts/generate-types.ts`, opaque driver-type stubs) is removed.
* [x] Endpoints + `@param`s covered, human JSDoc intact — the hand-maintained package already does this natively; no generator needed
* [x] JSDoc shows up in autocomplete for API consumers — same
* [x] ~~Marker/anchor preservation~~ — moot once generation isn't automatic; N/A
* [x] Gap closed by hand: `ctx.commands` (`CommandsApi`+`CommandInfo`), `ctx.session` (`SessionApi`, runtime-only), `ctx.runCommand` (`RunCommandResult` + method on `PluginContext`) added to both `en/index.d.ts` and `pt/index.d.ts`, matching existing style. Version 1.5.0 → 1.6.0.
* [x] `npm run build:types` now validates (`tsc --noEmit -p packages/types/tsconfig.json`) rather than regenerates

## Phase 11 — Release Readiness Fixes (found in 08/20 pre-release review)

Not new features — the working tree drifted from what Phase 10's log claims. Fix before shipping.

* [x] `CHANGELOG.md` "Known limitations": remove the `categoryHiddenInScope` line — already consumed in `commandMenu.ts` (4 call sites filtering by scope), limitation no longer exists
* [x] i18n: `runCommand.ts`'s "Unknown subcommand" reply (unmatched sub-token path) is hardcoded English — added `commandRun.unknownSubcommand` (`{{sub}}`/`{{cmd}}`/`{{valid}}`) to `en`/`pt`/`es` locales, routed through `t()`

---

## Out of Scope (Does Not Block This Iteration)

* `ctx.triggers.onReply/onWord/onFallback` and activation without a prefix (`without_prefix`)
* `registerTool` (plugin registering a handler inside another plugin)
* `guardOptions` as a manifest field
* API versioning between plugins
* Standardized per-plugin logging (`[pluginName:debug/info/error]`) as a kernel feature
* "Mini-plugins" that only extend another plugin
* Optional return value from command functions beyond side effects
* `manyplug rebuild --reconcile`
* Pipelines between plugins

## Quick Reference — Finalized Decisions

* v6 is a separate version, not an evolution of 5.x
* Every command must be in YAML, with no auto-activation
* `api` object without `ctx` = pure function; command function always receives `ctx`
* No shape enforcement for direct calls between plugins
* No pipelines for now (free-form output through `ctx` makes them impractical)
* Menu and pagination: native to the kernel, but optional
* Exclusive session is a kernel primitive, but internal logic belongs to the plugin
