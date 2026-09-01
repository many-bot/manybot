# Changelog

## v5.10.1 - 2026-08-30

### Fixed
- **i18n:** Fixed plugin locale discovery. The `createT` function now correctly searches for the plugin root (containing `manyplug.json`) instead of assuming the locale folder is adjacent to the entry file. This ensures translations work correctly for plugins with separate build/dist directories.
- **UI:** Minor spacing adjustment in the CLI banner.

---

Previous releases are tracked via Git tags.
