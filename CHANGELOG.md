# Changelog

## v5.10.0 - 2026-08-30

### New Features
- **Types Internationalization:** Full translation of type documentation (`packages/types/pt/index.d.ts`) into Portuguese, improving the developer experience for Portuguese-speaking plugin authors.
- **Targetable Admin API:** Refactored `AdminApi` to support `TargetableAction`. Methods such as `kick`, `promote`, `demote`, `setSubject`, `setDescription`, `setProfilePic`, and `revokeInvite` can now be redirected to specific groups via `.to(jid)` or awaited directly for the current chat.

### Changed
- **Kernel:** Updated `pluginApi.ts` and associated tests to integrate the new redirectable action structure.
- **Baileys Driver:** Optimized "self-kick" validation and participant resolution within administration actions.

### Fixed
- **UI:** Minor spacing adjustment in the CLI banner (`src/client/banner.ts`).
- **i18n:** Updates to the translation engine (`src/i18n/index.ts`).

---

Previous releases are tracked via Git tags.
