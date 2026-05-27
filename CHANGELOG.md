# Changelog

All notable changes to this project will be documented in this file.

## [3.0.7] - 2026-05-27
- f390f17 fix: replace cjs syntax with esm syntax
- 451cd01 add devtools with tools for development
- c2fab62 refactor(update): use atomic directory replacement during updates

## [3.0.6] - 2026-05-26
- ab10266 refactor(update): downloads the zip to not depends on git anymore. also refactor ouput to avoid useless complexity

## [3.0.5] - 2026-05-26
- 4010d3c refactor(update): rewrite update script
    - git fetch + reset --hard to origin/<branch>
    - backup manybot.conf, .wwebjs_{auth,cache}, src/plugins/ before reset
    - restore backed up files after npm install
    - tmp/ preserved on failure with manual restore hint
    - block root execution

- 09d0709 refactor(setup): rewrite setup script
    - remove Termux support
    - remove ASCII banner, replace with compact one-liner
    - generates service file inline, no source file needed
    - systemd installs as user service (~/.config/systemd/user/)
    - add 3-option prompt: user service / save locally / skip
    - block root execution
    - fix ManyPlug version comparison (semver_lt via sort -V)
    - simplify output: ✓ · ! ✗ prefixes, no timestamps, no spinner

- 3003a3a remove manybot.service as setup doesn't need it anymore


## [3.0.4] - 2026-05-26
- fix systemd restart by catching SIGTERM signal correctly (a4acd2b)

## [3.0.3] - 2026-04-29

- Now changelogs will use just git log for simplicity.
- fix: convert pluginPath to URL, so the Node.js ESM can understand paths on Windows (fa1e63e)

## [3.0.2] - 2026-04-25

### Added
* manybot.service is now available

## [3.0.1] - 2026-04-25

### Changed
* Now get_id util allows to search by number, name and other infos. Also shows LID (d792294).

## [3.0.0] - 2026-04-25

### Added

* **Pairing code authentication**: New alternative authentication method to QR Code
  * Configure `PHONE_NUMBER` in `manybot.conf` using the format `5511999999999`
  * Bot displays an 8-character pairing code to you insert in WhatsApp menu

* **i18n system in setup script**
  * Automatic language detection based on `LANG`, `LC_ALL`, `LC_MESSAGES`
  * All setup messages translated into Portuguese and English

* **New error and log messages** in the setup script for improved clarity

### Changed

* **Changelogs introduced**  
  * ManyBot will now have changelogs and more professional version control.

* **Complete rewrite of the `setup` script**
  * New i18n system with `t()` translation function
  * Added `require_cmd()` function for dependency validation
  * Cleaner output with timestamps and standardized colors
  * Optional and interactive ManyPlug installation or update
  * Node.js version validation (minimum v18)
  * Simplified systemd service installation (no `--install-service` flag)

* **Documentation**
  * Updated installation instructions to reflect new setup flow
  * Added pairing code authentication documentation
  * Simplified README.md and README_EN.md to focus on essential information

* **`manybot.conf.example`**

  * Added documented `PHONE_NUMBER` option for pairing code authentication

### Technical

* **`qrHandler.js` module**
  * New `handlePairingCode()` function to display pairing code

* **`whatsappClient.js` module**
  * Added `PHONE_NUMBER` import from config
  * Dynamic `pairWithPhoneNumber` configuration when `PHONE_NUMBER` is set
  * Registered `code` event for phone-based authentication

* **`config.js` module**
  * New optional `PHONE_NUMBER` configuration (defaults to `null`)

### Removed

* **File download on setup script**
  * Completely unnecessary, as plugins no longer come with the core

* **`--install-service` flag** from setup script
  * Systemd service installation is now automatically detected (requires root)

* **Docker support** (removed in a previous commit, consolidated in this version)

### Fixed

* Node.js version check prevents compatibility issues with Puppeteer

