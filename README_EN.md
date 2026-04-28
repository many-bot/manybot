<div align="center">

![ManyBot Logo](logo.png)

**100% free and open-source WhatsApp Bot**

[🇧🇷 Português](README.md) · [🇺🇸 English](README_EN.md)

![Node.js 18+](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)

<br>

> **Official Instance Online**
>
> Add **+55 (16) 99459-1903** and send `!many`
>
> Please, read [Terms of Use](TERMS_en-us.md)

</div>

---

## What is

ManyBot is a WhatsApp bot that runs locally, without the official API.

## What it can do on the official version

- `!video`, `!audio` - Download videos and audio files, sends a download link
- `!igurinha` - Create stickers with images, GIFs, and videos
- `!adivinhacao` - Number guessing game
- `!figurinha` - Hangman game

> Disclaimer: the official version has Brazilian Portuguese as the default language.

## Self-hosted version features

- **100% Local** - No official WhatsApp API
- **Multi-chat** - Multiple chats in one session
- **Plugin System** - Create and add features
- **Headless** - Runs in background as systemd service
- **Simple Config** - Intuitive `manybot.conf` file

## Installation

```bash
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot
cp manybot.conf.example manybot.conf
nano manybot.conf          # edit config
bash ./setup
```

To install the systemd service and ManyPlug globally, run as root:
```bash
sudo bash ./setup
```

Get the code or scan the QR Code in logs: `journalctl -u manybot -f`

Read installation and configuration docs before running ManyBot!

> 📚 **Full documentation:** [Installation](docs/INSTALLATION.md), [Configuration](docs/CONFIGURATION.md), [Plugins](docs/PLUGINS_EN.md)

<div align="center">

**[⬆ Back to top](#)**

</div>
