<div align="center">

![ManyBot Logo](logo.png)

<p>
  <strong>100% Local WhatsApp Bot, no official API</strong>
</p>

<p>
  <a href="#-features">Features</a> •
  <a href="#-quick-install">Install</a> •
  <a href="#-usage">Usage</a> •
  <a href="#-plugins">Plugins</a> •
  <a href="#-documentation">Documentation</a>
</p>

<p>
  <a href="README.md">🇧🇷 Português</a> · <a href="README_EN.md">🇺🇸 English</a> 
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white" alt="npm 9+">
  <img src="https://img.shields.io/badge/License-GPL--v3-blue.svg" alt="License: GPL v3">
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows-lightgrey" alt="Platform">
</p>

<p>
  <img src="https://img.shields.io/badge/whatsapp--web.js-%2325D366?logo=whatsapp&logoColor=white" alt="whatsapp-web.js">
  <img src="https://img.shields.io/badge/headless-Automated-green" alt="Headless">
</p>

<br>

> 🟢 **Official Instance Online**
> Want to use ManyBot without installing? Add the official bot:
>
> **+55 (16) 99459-1903**
>
> Online 24h (when possible) · Availability not guaranteed
>
> By adding, you agree to the [Terms of Use](TERMS_en-us.md)

![Sticker generator example](examples/figurinha.gif)

</div>

---

## ✨ Features

- **100% Local** — No dependency on the official WhatsApp API
- **Multi-chat** — Support for multiple chats in a single session
- **Plugin System** — Add, remove, or create features without touching the core
- **Headless** — Runs in the background without a GUI
- **Easy Configuration** — Simple and intuitive config file

---

## 🚀 Quick Install

### Option 1: Use the Official Bot (No install)

Add the number **+55 (16) 99459-1903** to your contacts and send `!many` to see available commands.

**Status:** 🟢 Online (24h when possible, but no guarantee)

> ⚠️ **Important:** By using the official bot, you agree to the [Terms of Use](TERMS_en-us.md). Read before adding!

---

### Option 2: Install Your Own Version

```bash
# 1. Clone the repository
git clone https://github.com/synt-xerror/manybot
cd manybot

# 2. Create the config file
cp manybot.conf.example manybot.conf

# 3. Configure as needed (see documentation)
nano manybot.conf

# 4. Run the install script
bash ./setup

# 5. Run the bot
node ./src/main.js
```

📱 **Scan the QR Code** on WhatsApp: Menu → Linked Devices → Link a Device

> **⚡ Done!** See the [full documentation](docs/INSTALLATION.md) for more details.

---

## 💻 Usage

```bash
# Start the bot
node ./src/main.js

# Update to the latest version
bash ./update

# Discover chat IDs
node src/utils/get_id.js
```

---

## 🔌 Plugins

ManyBot is built around a plugin system. The kernel only connects to WhatsApp and distributes messages — plugins decide what to do.

### Managing Plugins with ManyPlug

Install and manage plugins using the **ManyPlug CLI**:

```bash
# Install the plugin manager
npm install -g @freakk.dev/manyplug

# Create a new plugin
cd src/plugins
manyplug init my-plugin --category utility

# Install from another directory
manyplug install --local ../another-plugin

# List installed plugins
manyplug list
```

### Create a Plugin

```javascript
// plugins/my-plugin/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "hello")) return;
  await msg.reply("Hello! 👋");
}
```

See more in the [plugin documentation](docs/PLUGINS_EN.md).

---

## 📚 Documentation

- [📥 Full Installation](docs/INSTALLATION.md) — Linux, Windows, Termux
- [⚙️ Configuration](docs/CONFIGURATION.md) — All `manybot.conf` options
- [🔌 Creating Plugins](docs/PLUGINS.md) — Complete development guide
- [🛠️ Plugin API](docs/API.md) — Reference for `msg` and `api` objects

## 🌍 Internationalization

ManyBot supports multiple languages. Configure in `manybot.conf`:

```bash
LANGUAGE=pt  # Português
LANGUAGE=en  # English
LANGUAGE=es  # Español
```

- **Default:** English (`en`)
- **Fallback:** If selected language doesn't exist, bot falls back to English

---

## 📋 Requirements

- **Node.js** 18+
- **NPM** 9+
- **Linux** or **Windows** (via Git Bash)

> ⚠️ Android/iOS and Termux have experimental support with no guarantees.

---

## 📝 License

Distributed under the **GPLv3** license. See [LICENSE](LICENSE) for details.

---

<div align="center">

**[⬆ Back to top](#)**

</div>
