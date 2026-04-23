# Installation

Complete installation guide for ManyBot on different platforms.

---

## Index

- [Linux (with systemd)](#linux-with-systemd) (Recommended)
- [Linux (manual)](#linux-manual)
- [Windows](#windows)
- [Termux (Android)](#termux-android)

---

## Linux (with systemd)

This is the **easiest and recommended** way to run ManyBot. The systemd service manages the bot automatically.

### Prerequisites

- Linux with systemd (Ubuntu, Debian, Fedora, Arch, etc.)
- Node.js 18+ and npm 9+
- Root access (sudo)

### Installation

```bash
# 1. Clone the repository
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# 2. Create the configuration file
cp manybot.conf.example manybot.conf
nano manybot.conf

# 3. Run the dependency installation
bash ./setup

# 4. Install and enable systemd service (requires root)
sudo bash ./setup --install-service
```

**Scan the QR Code** that appears in the logs:

```bash
journalctl -u manybot -f
```

### Useful Commands

```bash
# Check service status
systemctl status manybot

# View logs in real-time
journalctl -u manybot -f

# Stop the bot
systemctl stop manybot

# Start the bot
systemctl start manybot

# Restart the bot
systemctl restart manybot

# Disable auto-start
systemctl disable manybot

# Update the bot
git pull
bash ./setup
sudo systemctl restart manybot
```

### Does the systemd service run as root?

Yes! The service is configured to run as `root` to ensure full system access. This is necessary for:
- Accessing session files and logs
- Running Chromium/Puppeteer correctly
- Having complete network permissions

---

## Linux (manual)

If you don't use systemd or prefer to run manually:

### 1. Clone the repository

```bash
git clone https://git.maneos.net/synt-xerror/manybot
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

> 💡 **Tip:** To run in the background without systemd, use `nohup`:
> ```bash
> nohup node ./src/main.js > manybot.log 2>&1 &
> ```

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
git clone https://git.maneos.net/synt-xerror/manybot
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
