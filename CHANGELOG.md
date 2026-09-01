# Changelog

## v5.11.0 - 2026-09-01

### New Features
- **`AUTO_READ_MESSAGES` configuration** — Now you can choose whether the bot should automatically mark every incoming message as read (blue check). Off by default to avoid interfering with specific integrations.
- **Enhanced Contact Discovery** — Improved how the bot retrieves contact names and pushnames during the `getId` process by merging cached snapshots, ensuring names are available immediately even in new sessions.

### Fixed
- **`EADDRINUSE` crashes during plugin reload** — Plugins now correctly run their `api.events.cleanup()` export before being reloaded or disabled, ensuring ports and resources are released.
- **Contact lookup accuracy** — Added `denormalizeJid` to improve contact lookup across different WhatsApp JID formats.
- **Plugin cleanup consistency** — Refactored cleanup logic into a centralized `cleanupPluginExports` function to ensure reliable resource release.
