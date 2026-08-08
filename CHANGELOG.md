# Changelog

## v5.6.0-rc.6 — In-Development

### New Features

- **WhatsMeow driver** — Go-based gRPC subprocess driver that acts as a fallback when the primary (Baileys) driver fails. Includes `whatsmeow-service/` (Go gRPC server), build script (`scripts/build-whatsmeow.mjs`), process supervisor, and smoke tests.
- **DriverManager** (`kernel/driverManager.ts`) — Singleton managing lifecycle of both Baileys and WhatsMeow drivers with automatic fallback.
- **SendFallbackGuard** (`kernel/sendFallbackGuard.ts`) — Verifies message delivery via `getHistory` and retries through the fallback driver on failure. New alert types: `send_failed_no_fallback`, `send_failed_both_drivers`, `whatsmeow_subprocess_halted`.
- **Alert system** (`kernel/alerts.ts`) — Multi-sink alerting (WhatsApp, email via nodemailer, log) wired into reconnect-halt, crash, and flood-attack events.
- **Update checker** (`kernel/updateCheck.ts`) — Scheduled check for new versions on npm with admin notification.
- **Exclude chats in config** — Ability to ignore specific chats via configuration.
- **WaContract interface** — Driver-neutral contract layer decoupling the kernel from Baileys-specific types. All adapters now produce/consume `BotMessage` instead of raw Baileys messages.

### Improvements

- **FloodGuard hardening** — Weighted message counting (media/stickers count less), per-chat disable/enable API, global trip tracking for attack detection, muted-sender notification, and "possible attack" alerts on threshold breach.
- **contactAutoSave** — Separate DM/group counters per sender, per-sender storage keys (no more concurrent-write clobbering), skip save on failed `addContact` (with auto-retry), fix contact JID to wire format.
- **pluginApi** — Exposes `ctx.chat.floodGuard.{disable,enable,disabled}` to plugins.
- **sendGuard** — Per-security-profile `typingMaxMs` cap; `mediaDuration` now factors in caption length.
- **i18n** — `t()` and `pluginT()` now support the `returnObjects` option.

### Refactors

- **Rename `whatsapp` → `baileys` driver** — `src/drivers/whatsapp/` moved to `src/drivers/baileys/` for driver-neutral naming.
- **In-memory store** — Replaced Baileys `WAStore` with a custom in-memory store (`src/client/store.ts`).
- **MessageHandler migration** — Ported to `BotMessage`/`WaContract` types, fully decoupled from Baileys SDK.
- **Removed deprecated modules** — `src/core/adapter.ts`, `src/core/capabilities.ts`, `src/core/types.ts`, and the old flood guard implementation.
- **Config flattening** — `[drivers]` config blocks dropped in favor of flat lowercase keys under `drivers.*`.
- **`MANYBOT_SMOKE=1`** — Now enables the whatsmeow driver regardless of the config file contents.

### Build / CI

- **Git hooks** for CI/CD releases (`hooks/release.sh`, `hooks/github-release.sh`, `hooks/post-receive`).
- **GitHub workflow removed** — Migrated to self-hosted CI.
- **`allowScripts` removed** from `package.json`.
- Build step now compiles the whatsmeow Go service and copies the `.proto` file to `dist/`.

### New Dependencies

- `@grpc/grpc-js`, `@grpc/proto-loader`, `nodemailer`, `@types/nodemailer`
- Go: `go.mau.fi/whatsmeow`, `modernc.org/sqlite`, `google.golang.org/grpc`

### New Configuration Options

| Key | Description |
|---|---|
| `ADMIN_JID` | JID to receive system alerts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email alert sink settings |
| `UPDATE_CHECK_INTERVAL` | Interval between update checks (cron) |
| `UPDATE_CHECK_ENABLED` | Enable/disable update checking |
| `FLOOD_ATTACK_TRIP_WINDOW_MS` | Time window for attack detection |
| `FLOOD_ATTACK_TRIP_THRESHOLD` | Message count threshold to trigger attack alert |
| `drivers.primary` | Primary driver name (default: `baileys`) |
| `drivers.fallbackCooldownMs` | Cooldown before retrying the primary driver after fallback |
| `drivers.verifyWindowMs` | Time window for delivery verification via getHistory |

---

Previous releases are tracked via Git tags.
