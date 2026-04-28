# ManyBot + ManyPlug - Complete Project Guide

> **Everything you need to know about the ManyBot ecosystem**

---

## Table of Contents

1. [Overview](#overview)
2. [Project Relationship](#project-relationship)
3. [ManyBot - The Bot Framework](#manybot---the-bot-framework)
4. [ManyPlug - The Plugin Manager](#manyplug---the-plugin-manager)
5. [Plugin Development](#plugin-development)
6. [Configuration Reference](#configuration-reference)
7. [API Reference](#api-reference)
8. [Deployment & Operations](#deployment--operations)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### What is ManyBot?

**ManyBot** is a self-hosted WhatsApp bot framework that runs 100% locally without the official WhatsApp API. It uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) as the WhatsApp client and features a plugin-based architecture for extensibility.

**Key Features:**
- Multi-chat support (handle multiple conversations)
- Plugin system for custom functionality
- Headless operation (runs as systemd service)
- Pairing code or QR code authentication
- Internationalization (en, pt, es)

### What is ManyPlug?

**ManyPlug** is the official CLI plugin manager for ManyBot. It provides a package-manager-like experience (inspired by pacman) for creating, installing, enabling, disabling, and validating plugins.

**Package:** `@freakk.dev/manyplug` (v1.2.0)
**License:** MIT

---

## Project Relationship

```
┌─────────────────────────────────────────────────────────────────┐
│                        ManyBot Ecosystem                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   manybot (main project)                                        │
│   │                                                             │
│   ├── Core framework (WhatsApp client, message handling)        │
│   ├── Plugin loader & API                                       │
│   └── src/plugins/  ◄── Plugins live here                       │
│                                                                 │
│   manyplug (CLI tool)                                           │
│   │                                                             │
│   ├── Creates plugins in manybot-dev/src/plugins/               │
│   ├── Manages registry.json (installed plugins)                 │
│   └── Edits manybot.conf (enable/disable plugins)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Directory Relationship:**
- `manybot-dev/` - The main bot framework
- `manyplug/` - CLI tool that manages plugins FOR manybot-dev
- Plugins created by ManyPlug are stored in `manybot-dev/src/plugins/`
- ManyPlug edits `manybot-dev/manybot.conf` to enable/disable plugins

---

## ManyBot - The Bot Framework

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ManyBot 3.0.0                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  config.js ────────┐                                        │
│  (reads conf)      │                                        │
│                    ▼                                        │
│  main.js ──▶ whatsappClient.js ──▶ Message Events           │
│                    │                                        │
│                    ▼                                        │
│  kernel/ ──▶ messageHandler.js ──▶ pluginLoader.js          │
│                    │                                        │
│                    ▼                                        │
│  Plugins run here (each decides to act or ignore)           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
manybot-dev/
├── src/
│   ├── main.js                 # Entry point
│   ├── config.js               # Configuration loader
│   │
│   ├── client/                 # WhatsApp client layer
│   │   ├── whatsappClient.js   # Client init & events
│   │   ├── qrHandler.js        # QR/pairing code display
│   │   ├── banner.js           # Startup banner
│   │   └── environment.js      # Termux/Puppeteer detection
│   │
│   ├── kernel/                 # Core bot logic
│   │   ├── messageHandler.js   # Message processing
│   │   ├── pluginLoader.js     # Plugin loading
│   │   ├── pluginApi.js        # API exposed to plugins
│   │   ├── pluginGuard.js      # Plugin error sandbox
│   │   ├── pluginState.js      # Plugin state management
│   │   └── scheduler.js        # Background tasks
│   │
│   ├── plugins/                # ← Plugins live here
│   │   └── many/               # Core example plugin
│   │       ├── index.js
│   │       ├── manyplug.json
│   │       └── locale/
│   │
│   ├── utils/
│   │   ├── botMsg.js           # Message helpers
│   │   ├── file.js             # File operations
│   │   ├── getChatId.js        # Chat ID extraction
│   │   └── pluginI18n.js       # Plugin translations
│   │
│   ├── logger/
│   │   ├── logger.js           # Central logger
│   │   ├── formatter.js        # Log formatting
│   │   └── messageContext.js   # Context builder
│   │
│   ├── i18n/
│   │   └── index.js            # Core translations
│   │
│   └── locales/                # Core translations
│       ├── en.json
│       ├── pt.json
│       └── es.json
│
├── manybot.conf                # Main configuration
├── manybot.conf.example        # Example configuration
├── manybot.service             # systemd service file
├── setup                       # Installation script
├── deploy.sh                   # Deployment script
├── update                      # Update script
│
├── docs/                       # Documentation
├── bin/                        # CLI utilities
├── logs/                       # Log files
├── .wwebjs_auth/               # WhatsApp session data
└── .wwebjs_cache/              # Cached data
```

### Message Flow

```
1. WhatsApp message received
         │
         ▼
2. messageHandler.js processes
         │
         ▼
3. Get chat info & extract ID
         │
         ▼
4. Filter by CHATS list ───(not in list)───▶ Ignore
         │ (in list or CHATS empty)
         ▼
5. Build message context (sender, chat, media info)
         │
         ▼
6. Build API object (safe context for plugins)
         │
         ▼
7. Run ALL plugins in sequence
         │
         ▼
8. Each plugin decides: act or ignore
         │
         ▼
9. Done
```

**Key Design Decision:** The kernel knows NO commands. Each plugin independently parses messages and decides whether to act.

### Authentication Flow

```
1. Bot starts
       │
2. Read CLIENT_ID from config
       │
3. Check for session in .wwebjs_auth/session-{CLIENT_ID}/
       │
       ├─── Session exists ──▶ Restore session ──────┐
       │                                             │
       └─── No session ──▶ Check PHONE_NUMBER        │
                              │                      │
                  ┌───────────┴────────────┐         │
                  │                        │         │
            Number exists              No number     │
                  │                        │         │
           Pairing Code Mode         QR Code Mode    │
                  │                        │         │
           Display 8-char code      Display QR       │
           in terminal              in terminal      │
                  │                        │         │
           User enters code in      User scans       │
           WhatsApp > Linked        with WhatsApp    │
           Devices                  > Linked Devices │
                  │                        │         │
                  └────────────┬───────────┘         │
                               │                     │
                        Session saved to             │
                        .wwebjs_auth/session/        │
                               │                     │
                               └─────▶ Bot connected │
```

### Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| WhatsApp Client | whatsapp-web.js 1.24+ |
| Browser Automation | Puppeteer |
| Authentication | LocalAuth (session files) |
| Plugin System | ES Modules |
| Logging | Custom logger with colors |
| i18n | JSON-based with interpolation |
| Deployment | systemd service |

---

## ManyPlug - The Plugin Manager

### Installation

```bash
# Global install
npm i -g @freakk.dev/manyplug

# For development
cd manyplug
npm link
```

### Commands

| Command | Description |
|---------|-------------|
| `manyplug init <name>` | Create new plugin boilerplate |
| `manyplug install [plugins...]` | Install from registry or `--local <path>` |
| `manyplug remove [plugins...]` | Remove installed plugins (alias: `rm`) |
| `manyplug list` | List installed plugins (alias: `ls`) |
| `manyplug enable [plugins...]` | Enable plugins (adds to manybot.conf) |
| `manyplug disable [plugins...]` | Disable plugins |
| `manyplug sync` | Sync local registry with remote mirrors |
| `manyplug update` | Update all plugins (alias: `sync --update`) |
| `manyplug validate [path]` | Validate manyplug.json (alias: `val`) |

### Configuration

**config.json** - Remote registry mirrors:

```json
{
  "mirrors": [
    {
      "name": "Freakk.dev",
      "fetch": "https://git.maneos.net/.../registry.json",
      "git": "https://git.maneos.net/..."
    },
    {
      "name": "Codeberg",
      "fetch": "https://codeberg.org/.../registry.json",
      "git": "https://codeberg.org/..."
    }
  ]
}
```

### Plugin Registry

**registry.json** - Tracks installed plugins:

```json
{
  "plugins": [
    {
      "name": "video",
      "version": "1.0.0",
      "enabled": true
    }
  ]
}
```

---

## Plugin Development

### Plugin Structure

```
src/plugins/my-plugin/
├── index.js           # Main plugin code
├── manyplug.json      # Plugin manifest (REQUIRED)
└── locale/            # Translations (optional)
    ├── en.json
    ├── pt.json
    └── es.json
```

### Plugin Manifest (manyplug.json)

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "category": "utility",
  "service": false,
  "description": "Optional description",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "dependencies": {
    "axios": "^1.6.0"
  },
  "externalDependencies": {
    "ffmpeg": "Required for media processing"
  }
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Plugin identifier (lowercase, hyphens, 2-50 chars) |
| `version` | string | Yes | Semantic version (e.g., "1.0.0") |
| `category` | string | Yes | One of: `games`, `media`, `utility`, `service`, `admin`, `fun` |
| `service` | boolean | No | True if plugin runs background tasks |
| `dependencies` | object | No | npm packages (same format as package.json) |
| `externalDependencies` | object | No | System commands required |

### Basic Plugin Template

```javascript
// src/plugins/hello/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  // Only respond to !hello command
  if (!msg.is(CMD_PREFIX + "hello")) return;

  // Ignore messages from bot itself
  if (msg.fromMe) return;

  api.log.info("Hello command from:", msg.senderName);
  await msg.reply("Hello! 👋");
}

// Optional: Setup function called once at startup
export async function setup(api) {
  api.log.info("Setting up hello plugin");
}

// Optional: Public API for other plugins
export const api = {
  greet: (name) => `Hello, ${name}!`
};
```

### Plugin Lifecycle

1. **Load Phase** - `pluginLoader.js` loads plugins from `src/plugins/`
2. **Setup Phase** - `setup(api)` called on each plugin (after WhatsApp ready)
3. **Message Phase** - `default(msg, api)` called for every message

### Examples

#### Example 1: Simple Command

```javascript
// plugins/saudacao/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "oi")) return;
  if (msg.fromMe) return;

  await msg.reply("Olá! 👋");
}
```

#### Example 2: Command with Arguments

```javascript
// plugins/calcular/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "calcular")) return;

  const [, a, operador, b] = msg.args;

  let resultado;
  switch (operador) {
    case "+": resultado = Number(a) + Number(b); break;
    case "-": resultado = Number(a) - Number(b); break;
    case "*": resultado = Number(a) * Number(b); break;
    case "/": resultado = Number(a) / Number(b); break;
    default: return msg.reply("Operador inválido!");
  }

  await msg.reply(`Resultado: ${resultado}`);
}
```

#### Example 3: Media Processing

```javascript
// plugins/echo-media/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "echo")) return;

  if (!msg.hasMedia) {
    return msg.reply("Envie uma mídia com o comando!");
  }

  const media = await msg.downloadMedia();
  await api.sendSticker(media.data);
}
```

#### Example 4: With Translations

```javascript
// plugins/greeting/index.js
import { CMD_PREFIX } from "../../config.js";
import { createPluginT } from "../../utils/pluginI18n.js";

const { t } = createPluginT(import.meta.url);

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "oi")) return;

  await msg.reply(t("ola", { nome: msg.senderName }));
}
```

**locale/en.json:**
```json
{
  "ola": "Hello, {{nome}}! 👋"
}
```

**locale/pt.json:**
```json
{
  "ola": "Olá, {{nome}}! 👋"
}
```

#### Example 5: Plugin-to-Plugin Communication

```javascript
// plugins/utilidades/index.js

// Public API
export const api = {
  formatarData: (date) => date.toLocaleDateString("pt-BR"),
  formatarMoeda: (valor) => `R$ ${valor.toFixed(2).replace(".", ",")}`,
  esperar: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

export default async function ({ msg, api }) {
  if (msg.is("!ping")) {
    await msg.reply("pong!");
  }
}
```

**Using the API in another plugin:**

```javascript
// plugins/outro/index.js
export default async function ({ msg, api }) {
  const utils = api.getPlugin("utilidades");
  if (!utils) return;

  const data = utils.formatarData(new Date());
  await msg.reply(`Hoje é ${data}`);
}
```

---

## Configuration Reference

### manybot.conf

```bash
# Session identifier (creates .wwebjs_auth/session-{CLIENT_ID}/)
CLIENT_ID=meu_bot

# Command prefix (default: !)
CMD_PREFIX=!

# Phone for pairing code auth (optional, commented = QR code)
#PHONE_NUMBER=5511999999999

# Bot language (en/pt/es)
LANGUAGE=en

# Allowed chats (empty = all chats)
CHATS=[
    5511999999999@c.us,
    5511888888888@g.us
]

# Active plugins
PLUGINS=[
    many,
    figurinha,
    audio,
    video,
    adivinhação,
    forca
]

# Custom variables for plugins
API_KEY=my_secret_key
ADMIN_NUMBER=5511999999999
```

### Options Summary

| Option | Default | Description |
|--------|---------|-------------|
| `CLIENT_ID` | `bot_permanente` | Session identifier for auth storage |
| `CMD_PREFIX` | `!` | Command prefix character |
| `PHONE_NUMBER` | (none) | Phone for pairing code (format: 5511999999999) |
| `LANGUAGE` | `en` | Bot language (en/pt/es) |
| `CHATS` | `[]` | Allowed chat IDs (empty = all) |
| `PLUGINS` | `[]` | Active plugins (folders in src/plugins/) |

### Finding Chat IDs

```bash
node src/utils/get_id.js
```

Send a message in the target chat after running. The ID will appear in the terminal.

---

## API Reference

### Object `msg` (Message)

| Property | Type | Description |
|----------|------|-------------|
| `body` | string | Full message text |
| `args` | string[] | Tokenized message (split by spaces) |
| `type` | string | Message type: `chat`, `image`, `video`, `audio`, `sticker` |
| `sender` | string | Sender ID (e.g., `5511999999999@c.us`) |
| `senderName` | string | Sender display name |
| `fromMe` | boolean | True if bot sent this message |
| `hasMedia` | boolean | True if message has attachment |
| `hasReply` | boolean | True if message is a reply |
| `isGif` | boolean | True if media is GIF |
| `is(cmd)` | function | Check if message starts with command |
| `reply(text)` | function | Reply with quote |
| `downloadMedia()` | function | Download media (returns `{ mimetype, data }`) |
| `getReply()` | function | Get replied message |

### Object `api` (Plugin API)

| Method | Description |
|--------|-------------|
| `send(text)` | Send text to current chat |
| `sendMedia(media, caption)` | Send media to current chat |
| `sendVideo(filePath, caption)` | Send video to current chat |
| `sendAudio(filePath)` | Send audio (voice) to current chat |
| `sendImage(filePath, caption)` | Send image to current chat |
| `sendSticker(source)` | Send sticker to current chat |
| `sendTo(chatId, text)` | Send text to specific chat |
| `sendVideoTo(chatId, filePath, caption)` | Send video to specific chat |
| `sendAudioTo(chatId, filePath)` | Send audio to specific chat |
| `sendImageTo(chatId, filePath, caption)` | Send image to specific chat |
| `sendStickerTo(chatId, source)` | Send sticker to specific chat |
| `getPlugin(name)` | Get another plugin's public API |
| `chat.id` | Current chat ID |
| `chat.name` | Current chat name |
| `chat.isGroup` | True if current chat is a group |
| `log.info(...)` | Info log |
| `log.warn(...)` | Warning log |
| `log.error(...)` | Error log |
| `log.success(...)` | Success log |

### Logger Methods

```javascript
api.log.info("Processing request...");
api.log.warn("Deprecated function used");
api.log.error("Failed to process:", error);
api.log.success("Operation completed");
```

### Log Output Format

```
[HH:MM:SS] INFO    message
[HH:MM:SS] OK      message
[HH:MM:SS] WARN    message
[HH:MM:SS] ERROR   message
[HH:MM:SS] MSG     chat context — from:sender +number — type:"body"
[HH:MM:SS] CMD     !command  extra info
[HH:MM:SS] DONE    !command — detail
```

---

## Deployment & Operations

### Installation

```bash
# Clone the repository
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# Copy and configure
cp manybot.conf.example manybot.conf
nano manybot.conf

# Run setup
bash ./setup
```

### systemd Service

**manybot.service:**
```ini
[Unit]
Description=ManyBot WhatsApp Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/manybot
ExecStart=/usr/bin/node src/main.js
Restart=always

[Install]
WantedBy=multi-user.target
```

**Install service:**
```bash
sudo cp manybot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable manybot
sudo systemctl start manybot
```

**View logs:**
```bash
journalctl -u manybot -f
```

### Scripts

| Script | Description |
|--------|-------------|
| `./setup` | Install dependencies, configure environment |
| `./deploy.sh` | Full deployment script |
| `./update` | Update bot to latest version |

### Running Manually

```bash
# Development
node src/main.js

# Production (with systemd)
sudo systemctl start manybot
```

---

## Troubleshooting

### Common Issues

#### 1. Bot won't start

**Check logs:**
```bash
journalctl -u manybot -f
# or
node src/main.js
```

**Common causes:**
- Missing dependencies: Run `./setup` again
- Invalid config: Check `manybot.conf` syntax
- Port already in use: Change `CLIENT_ID`

#### 2. QR Code not appearing

**Solution:** Use pairing code instead:
```bash
# Add to manybot.conf
PHONE_NUMBER=5511999999999
```

#### 3. Plugin not loading

**Check:**
1. Plugin folder exists in `src/plugins/`
2. `manyplug.json` is valid (run `manyplug validate`)
3. Plugin is in `PLUGINS` list in `manybot.conf`
4. No syntax errors in `index.js`

**View plugin errors:**
```bash
journalctl -u manybot | grep -i "plugin"
```

#### 4. Bot not responding to commands

**Check:**
1. Command prefix matches (`CMD_PREFIX` in config)
2. Chat is in `CHATS` list (or list is empty)
3. Plugin is enabled (not commented in `PLUGINS`)

**Test with core plugin:**
```bash
# Enable the 'many' plugin
PLUGINS=[many]
```

#### 5. Session issues

**Reset session:**
```bash
rm -rf .wwebjs_auth/session-{CLIENT_ID}/
# Restart bot
```

### Getting Help

- Check logs: `journalctl -u manybot -f`
- Validate plugin: `manyplug validate ./src/plugins/my-plugin`
- List plugins: `manyplug list`

---

## Quick Reference

### File Paths

| File | Purpose |
|------|---------|
| `manybot.conf` | Main configuration |
| `src/main.js` | Bot entry point |
| `src/config.js` | Config loader |
| `src/kernel/pluginLoader.js` | Plugin loader |
| `src/kernel/pluginApi.js` | Plugin API builder |
| `src/kernel/messageHandler.js` | Message processor |
| `src/plugins/` | Plugin directory |

### Key Commands

```bash
# Bot operations
node src/main.js              # Run bot
journalctl -u manybot -f      # View logs
sudo systemctl restart manybot # Restart service

# Plugin management
manyplug init my-plugin       # Create plugin
manyplug install --local ./plugin  # Install local
manyplug list                 # List plugins
manyplug enable my-plugin     # Enable plugin
manyplug validate             # Validate manifest
```

### Plugin Checklist

- [ ] `manyplug.json` with valid name, version, category
- [ ] `index.js` with default export function
- [ ] Plugin folder name matches `name` in manifest
- [ ] Plugin added to `PLUGINS` in `manybot.conf`
- [ ] Dependencies installed (`npm install` if needed)

---

## See Also

- [ManyBot Repository](https://git.maneos.net/manybot/manybot)
- [ManyPlug Repository](https://git.maneos.net/manybot/manyplug)
- [whatsapp-web.js Documentation](https://wwebjs.dev/)
