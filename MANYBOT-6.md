# ManyBot 6 — New Commands and Plugins Architecture

> Reference document consolidating all ideas, decisions, and open points discussed up to Aug 16. This is not a final implementation specification — it is design context.

## 1. General Scope

- This architecture enters as **ManyBot 6**, a separate major version — it is **not** an evolution/backport of 5.x.
- ManyBot 5.x will continue to be maintained and receive updates in parallel for a considerable time (similar to the Ubuntu model maintaining older and newer LTS versions concurrently). This is a release lifecycle decision, not an architectural one.
- Original motivation: in the current model (v5), plugin A may depend on plugin B, but B's default commands remain always active even if no one wants to use them — with no way to disable them. The reversal in Section 3 resolves this.
- **"Lib mode"** (ManyBot embedded as a dependency within another product's process, without `.manybot`/plugins scanned from disk) was **discarded for now** — considered too complex for the value confirmed so far (prompted only by a single unconfirmed email contact). A custom plugin importing another plugin as a dependency, but running inside the normal ManyBot runtime, is considered sufficient for the confirmed real use case (advanced users customizing their own bot).

## 2. Plugin Contract — v5 (Reference, Still Active)

For contrast with what changes in v6:

- Plugin exports `default async function run(ctx)`, called on every message (mandatory), and optionally `setup(ctx)`, called once after connecting.
- Loaded via `pluginLoader.ts`; plugins live in `~/.manybot/plugins/<name>/manyplug.json`, with hot-reload via `fs.watch`.
- Each plugin handles its own internal routing independently (e.g., sticker sub-actions routed via `msg.args[0]` inside a single function).

## 3. Unified Command/Function Model (Central Decision)

- **Reversal of previous decision**: it was previously considered that a plugin's default commands would auto-activate without touching `commands.yaml`. This was **reversed** — in v6, **every command must be explicitly declared** in `commands.yaml` to exist, without exception. Considered low effort ("95% is already done, only the command definition is missing").
  - This reversal cleanly solves the "plugin installed only as a dependency activating unwanted commands" problem without needing an extra flag like "installed as dependency".
- **Commands and services become a single concept.** There is no separate `api`/`services` object. The exact same function referenced by a command via `function:` in `commands.yaml` is the function another plugin calls directly.
  - Example: `manyai.question(query)`, consumed via `ctx.plugins.require("plugin-name")`.
  - The kernel resolves "managed" inputs (media, mentions, etc. — what cannot be declared in YAML) when the function is invoked via a message-triggered command.
  - A direct call from another plugin passes these inputs manually (the plugin author decides what to pass).
  - External visibility of a function as "callable from outside" is **implicit** — there is no manifest flag like `has_api`. Consumers simply attempt `ctx.plugins.require(...)` and handle errors if missing.
- **Conflict warning**: if the same function is referenced both as a command in `commands.yaml` and called directly by another plugin, the kernel may issue a warning — purely for detecting dual use/reference conflicts, not related to permission/cooldown/session bypass.

### Reference Example (Sticker Plugin)

```yaml
commands:
  figurinha:
    cmd: "f"
    aliases: ["sticker", "figu"]
    plugin: figurinha
    category: media
    desc: "Creates and manages stickers"
    manual: "file:./manuals/figurinha.md"
    permissions: { group_only: true, admin: false }
    subcommands:
      criar:   { cmd: "criar",   function: criarFigurinha }
      extrair: { cmd: "extrair", function: extrairFigurinha }
      parar:   { cmd: "parar",   function: pararFigurinha }
```

```js
// plugins/figurinha/index.js
export async function criarFigurinha(path) { /* ... */ }
export async function extrairFigurinha(...) { /* ... */ }
export async function pararFigurinha(...) { /* ... */ }
```

```js
// another plugin consuming directly
const figurinha = ctx.plugins.require("figurinha");
await figurinha.criarFigurinha(path);
```

### Related Future Feature (Out of Core)

- `manyplug rebuild` / `--reconcile` — Nix-inspired idea: reinstall/reconcile plugins strictly from what is declared in `commands.yaml`/`manyplug.json`, ensuring reproducibility (e.g. provisioning the bot from scratch on another machine with identical state). Tracked as a future feature, does not block initial v6.

## 4. `commands.yaml` Schema

- Global `prefix`.
- `commands:` as a **map** (key = stable internal ID), decoupled from the `cmd:` field (the trigger word typed by the user) — enables rename detection by comparing saved vs. current `cmd` under the same key without needing an explicit `replaces` field.
- Fields per command: `cmd`, `aliases`, `plugin` + `function` (exported function triggered by the command), **OR** `text:` (fixed response without a plugin — accepts inline or `file:./path`, read literally without parsing, native WhatsApp formatted), `category`, `desc` (optional — defaults to plugin's own description), `manual` (optional — `file:./path` or fallback to `manuals[id]`), `group` (groups DIFFERENT commands under a single menu item — dedicated field, not the role of `plugin`), `permissions:`, `subcommands:` (nested).

### Subcommands

- Nested structure (parent command with `subcommands:` block), not separate top-level entries.
- Inherit parent's `permissions` by default, but can override independently.
- Only setting `aliases` explicitly clears default aliases for that command — overriding other fields leaves aliases untouched.
- Only changing `cmd` triggers rename/deprecation tracking.
- Grouped automatically under the parent in menus (independent of the `group` field).

### Permissions (`permissions:`)

- Cascading inheritance: **category → command → subcommand**, each level can override above.
- Fields: `admin` (bot and/or user — overrides plugin internal default), `group_only`/`dm_only` (with option to hide from menu when out of allowed scope), owner (specific phone number), per-user cooldown, separate group and user whitelist/blacklist (configurable globally or per command — blacklist takes priority if coexisting with whitelist).
- All notification messages (must be admin, must be owner, cooldown active, etc.) are customizable.
- Categories can be hidden from menu using the same `permissions:` mechanism (not a dedicated `hidden` field).
- **Discarded**: custom roles beyond admin/owner; group size restrictions.

### Deprecation / Rename

- Automatic when `cmd` changes (same key) or key disappears from YAML (removal).
- Marks as deprecated for `notify_period_days` (default 7 days); during this window, registering a new command reusing the old name is blocked.
- Customizable message with `{old}`/`{new}`/`{days}` interpolation placeholders.
- `notify_changes` toggle across two levels: global (`defaults:`) + command override.
- **Always a kernel feature** — plugins never implement this independently (legacy cleanup: sticker plugin currently hardcodes this logic).

### Passive Plugins

- A fully passive plugin (listens to events without activation commands, e.g. antilink) **simply does not appear** in `commands.yaml` — not a special case, just the natural result of having no commands.
- If the plugin has activation/configuration commands (e.g. `!counting on`), those DO pass through `commands.yaml` normally with full permission engine support.

### Imports and i18n

- Central `commands.yaml` can import other files (`menu.yaml`, `manual.yaml`, etc.) via `import: [...]`.
- Each imported file **exclusively** owns entire top-level section(s) — no deep merging across files; duplicate key conflicts raise a clear load error rather than silently deciding a winner.
- `desc`/`manual` can have multi-language variants using the existing i18n system (`src/i18n`, `src/locales`).

### Central Command Query

- `ctx` exposes queries to the central command registry (existence, `desc`, `manual` — single lookup and full list) so plugins (especially AI plugins) do not hardcode/hallucinate other plugins' commands.

### Handling Missing Fields

- Mandatory field missing (`cmd`) → warning, command fails to load.
- Optional field missing displayed passively (`desc`) → omitted.
- Optional field actively requested (`manual`) → kernel placeholder.

### Argument Types

- Kernel-managed types remain declarable in YAML: mention, url, media_direct/media_reply, number, duration, choice, boolean, quoted_text, reply.
- Free-form text parsing remains the plugin's responsibility.
- Open question: whether the kernel should automatically generate the "missing required argument → error + usage" flow for these types.

### Administration

- "Administration" in the bot is broader than commands like ban — it covers link blocking, auto-banning, mass deletion. Should continue via plugins, not native to the kernel.

## 5. Menu (Decisions from Aug 16)

- Menu is a **native kernel feature**, not a separate plugin.
- Categories **and** pagination are **100% optional**.
- `menu:` block (title/intro/footer interpolating `{prefix}`; access aliases like `help`/`man`/`menu`/`bot`/`?`).
- `categories:` as a map (`label` + `order`), referenced by the `category` field of each command.
- Welcome message (menu + simple text) triggers for first-time users within a configurable time window (default 3 days) — not absolute first-ever contact.
- **Rework note**: "Stage 7" (native menu overview/category/manual + "command not found" fallback using `commandRegistry`) was already implemented and is in **v5.7.0 in production** — but this was considered a mistake (v6 piece leaked into v5) and marked unstable in v5. Decision: **reuse/adapt this existing code** as the foundation for v6 native menu, rather than rebuilding from scratch.
- Original idea (Aug 10) prompting native menu: currently a plugin (or AI) cannot reliably reference another plugin's command because the system does not validate its existence — resolved via central queries through `ctx.commands` (Section 4).

## 6. Confirmed Kernel Primitives as Foundation

- **Exclusive chat session**: used by games, stickers, music downloaders, etc. The kernel must **block** any other plugin from opening a session in the same chat while a session is already active. Considered part of the foundation, not a future feature.
  - The AI plugin's passive conversation continuation window (many-ai) **does not count** as a session for this block — separate behavioral category.
- A plugin's internal session/state logic (timeouts, historical media collection, etc.) remains **entirely within the plugin** — `commands.yaml` only registers commands, never internal flow/logic.

## 7. Outside Foundation — Future Features (Non-blocking for v6 Initial)

- **Generic activation beyond `cmd:` prefix** — API such as `ctx.triggers.onReply/onWord/onFallback`, along with "sent by which plugin" tracking (so a reply trigger doesn't hijack a reply meant for another plugin). Prompted by analyzing the real many-ai plugin (Section 8), which has 5 trigger types with only one (`command`) being an actual command today. Open question on whether this should be code API only or also declarable in manifest/yaml.
- **`without_prefix: true`** — commands triggered without requiring a prefix character. Undecided: fallback on "command not found" (must not trigger inadvertently), scope (DM vs. group), warnings for common trigger words.
- **`registerTool`** — mechanism for a plugin to register a handler INSIDE another (e.g., sticker plugin registering a custom tool in many-ai so AI can trigger sticker generation via function calling). Inversion of control — distinct from direct function calls (Section 3): the provider holds the handler and decides when to call it. Considered a good idea, possibly as a generic kernel mechanism (not specific to many-ai), deferred for later. Hot-reload lifecycle for this registration remains to be designed.
- **`guardOptions` as manifest field** — currently a loose export in plugin code (e.g. `{ timeout: false }` in many-ai for longer AI/search calls than default timeout). Confirmed it should become a declared field in `manyplug.json`, but not part of initial foundation.
- **Plugin API versioning** — behavior when plugin B changes a function signature breaking dependent plugin A. Undecided.
- **Standardized per-plugin logging** — format `[pluginName:debug/info/error]`. Currently manual (plugin prepends log tag manually). Will become a kernel standard, implementation design pending.

## 8. External Integration (Outside Command Scope, Related Decision)

- Context: a small AI company reached out via email wanting to use ManyBot 5 in a proprietary product; provided no details and did not follow up.
- Decision: **do not build a custom REST API** in ManyBot for this use case — standard recommendation is **Evolution API** (mature REST wrapper over Baileys with QR/pairing, webhooks, multi-instance support) for external HTTP integrations.
- Exception: when someone specifically needs ManyBot's plugin/command system or anti-detection layer (`sendGuard`) rather than the WhatsApp connection itself. In that case, worth reconsidering.

## 9. Case Study: Adapting the `many-ai` Plugin

Analysis conducted on real plugin code (`ai.zip`) to stress-test the model:

- **Current trigger taxonomy** (`getTriggerKind`): `command` (`!ai`), `quote` (reply to bot's own message), `continuation` (conversation window opened per sender+chat, with expiration), `word` (AI name mentioned via regex), `literal` (list of trigger phrases). Only `command` is a true command — the other 4 are completely passive with per-chat state.
- Existing priority rule: if a message starts with a prefix and isn't the plugin's own command, it bails out immediately (never triggers on the other 4 types) — motivates `ctx.triggers.onFallback` running only after the kernel confirms no command matched (Section 7).
- `!ai-settings` is currently hand-rolled inside a single handler (manual check of `msg.is(...)`), with per-chat toggles persisted via `ctx.settings`. In v6, this becomes a regular declared subcommand (`settings: { function: handleSettingsCommand }`) — toggle logic remains the plugin's responsibility.
- `guardOptions = { timeout: false }` is already used to allow AI/search calls longer than default kernel timeout — see Section 7.
- Concrete discovery that prompted `registerTool`: the `send_sticker` tool in many-ai currently **reimplements** sticker generation from scratch (`stickers.js`, custom manifest, `wa-sticker-formatter`) — completely unrelated to the actual `figurinha` plugin. In the unified model (Section 3), this becomes unnecessary: many-ai would directly call `ctx.plugins.require("figurinha").criarFigurinha(...)`.
- For tools needing media from the current message (e.g. "make a sticker with the image I just sent"), resolution is already supported via `msg.downloadMedia()` / `msg.getReply().downloadMedia()` — no new design components needed.

## 10. Summary of Open Decisions (Unresolved)

- Generic `ctx.triggers.*`: code only, or also declarable in manifest/yaml?
- `without_prefix`: fallback, DM/group scope, warning on common words.
- `registerTool`: generic kernel mechanism or specific to many-ai? Hot-reload lifecycle?
- API versioning between dependent plugins.
- Whether the kernel should auto-generate error flows for missing required arguments on kernel types.
- v5: since Stage 7 was marked an error/unstable, decide whether to remove it from v5 immediately or leave flagged until complete deprecation.
- v6: to reuse Stage 7 in v6 menu, the `commandRegistry` it queries must reflect only what is explicitly declared in `commands.yaml` (result of Section 3 reversal) — currently likely still populated via the old auto-activation method.
