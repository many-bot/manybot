# Installation

Complete installation guide for ManyBot on different platforms.

---

## Index

- [Linux](#linux)
- [Windows](#windows)
- [Termux (Android)](#termux-android)

---

## Linux

### 1. Clone the repository

```bash
git clone https://github.com/synt-xerror/manybot
cd manybot
```

### 2. Configure the bot

Create the configuration file:

```bash
touch manybot.conf
nano manybot.conf
```

Example configuration:

```bash
# Comments with '#'

CLIENT_ID=bot_permanente
CMD_PREFIX=!
LANGUAGE=en
CHATS=[
    123456789@c.us,
    123456789@g.us
]
PLUGINS=[
    video,
    audio,
    sticker,
    guess
]
```

**Details:**
- `CLIENT_ID`: Session ID (default: `bot_permanente`)
- `CMD_PREFIX`: Command prefix (default: `!`)
- `LANGUAGE`: Bot language - `pt`, `en`, or `es` (default: `en`)
- `CHATS`: Allowed chat IDs (leave empty for all)
- `PLUGINS`: List of active plugins

### 3. Run installation

```bash
bash ./setup
```

### 4. First run

```bash
node ./src/main.js
```

Scan the QR Code in WhatsApp:

**Menu → Linked Devices → Link a Device**

---

## Windows

ManyBot was designed for Linux, but works on Windows via **Git Bash**.

### Prerequisites

1. **Git Bash**: https://git-scm.com/download/win
2. **Node.js**: https://nodejs.org (choose "Windows Installer (.msi)")

### Installation

After installing both, open **Git Bash** and follow the same steps as the [Linux installation](#linux).

---

## Termux (Android)

> ⚠️ **Warning:** Experimental support. No guarantee of functionality.

```bash
# Install Termux from F-Droid (don't use Play Store)
# https://f-droid.org/packages/com.termux/

# Update packages
pkg update && pkg upgrade

# Install dependencies
pkg install nodejs git

# Clone and install
git clone https://github.com/synt-xerror/manybot
cd manybot
```

Follow the Linux configuration steps from step 2.

---

## Troubleshooting

### QR Code scanning error

- Clear Chrome/Chromium data from Termux
- Delete the `session/` folder and try again

### Bot not responding to commands

- Check `CMD_PREFIX` in `manybot.conf`
- Make sure the plugin is in the `PLUGINS` list

### Installation errors

```bash
# Clean npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

---

## Next Steps

- [Advanced configuration](./CONFIGURATION.md)
- [Creating plugins](./PLUGINS_EN.md)
