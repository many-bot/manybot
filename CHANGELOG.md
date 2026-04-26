# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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

