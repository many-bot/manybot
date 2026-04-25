# 🔌 Creating Plugins

Complete guide to creating plugins in ManyBot.

---

## ManyPlug CLI

**ManyPlug** is the official tool for managing ManyBot plugins. With it you can create, install, and validate plugins easily.

### Installation

```bash
npm install -g @freakk.dev/manyplug
```

Or for development:
```bash
git clone https://git.maneos.net/synt-xerror/manyplug
cd manyplug
npm link
```

### Commands

| Command | Description |
|---------|-------------|
| `manyplug init <name>` | Creates a new plugin structure |
| `manyplug install [name]` | Installs from registry or `--local <path>` |
| `manyplug list` | Lists installed plugins |
| `manyplug validate [path]` | Validates manyplug.json |

### Examples

```bash
# Create new plugin
cd src/plugins
manyplug init my-plugin --category utility

# Install from another directory
manyplug install --local ../other-plugin

# Validate manifest
manyplug validate ./my-plugin
```

---

## 📑 Index

- [ManyPlug CLI](#manyplug-cli)
- [Basic Structure](#basic-structure)
- [Plugin Manifest](#plugin-manifest-manyplug-json)
- [Creating Your First Plugin](#creating-your-first-plugin)
- [Object API](#object-api)
- [Exposing API](#exposing-api-to-other-plugins)
- [Translating Your Plugin](#translating-your-plugin)
- [Error Handling](#error-handling)

---

## Basic Structure

```
src/plugins/
└── my-plugin/
    ├── index.js
    ├── manyplug.json
    └── locale/         (optional)
        ├── en.json
        ├── pt.json
        └── es.json
```

`index.js` must export a `default` function that receives `{ msg, api }`:

```javascript
export default async function ({ msg, api }) {
  // Your logic here
}
```

---

## Plugin Manifest (manyplug.json)

Every plugin should have a `manyplug.json` at its root. It describes the plugin and declares any extra npm dependencies it needs.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "category": "utility",
  "service": false,
  "dependencies": {}
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Plugin identifier, must match the folder name |
| `version` | `string` | Semantic version (e.g., `"1.0.0"`) |
| `category` | `string` | Plugin category: `utility`, `media`, `game`, `humor`, `info` |
| `service` | `boolean` | `true` if the plugin runs in the background (scheduler, listener). `false` if triggered by a command or event |
| `dependencies` | `object` | Extra npm packages required by the plugin, same format as `package.json` |

### Example with dependencies

```json
{
  "name": "weather",
  "version": "1.0.0",
  "category": "utility",
  "service": false,
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

After adding dependencies, run `npm install` at the project root to install them.

---

## Creating Your First Plugin

### Example 1: Simple command

```javascript
// plugins/greeting/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  // Only responds if the message starts with "!hi"
  if (!msg.is(CMD_PREFIX + "hi")) return;

  await msg.reply("Hello! 👋");
}
```

### Example 2: Command with arguments

```javascript
// plugins/calculate/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "calculate")) return;

  // msg.args = ["!calculate", "5", "+", "3"]
  const [, a, operator, b] = msg.args;

  let result;
  switch (operator) {
    case "+": result = Number(a) + Number(b); break;
    case "-": result = Number(a) - Number(b); break;
    case "*": result = Number(a) * Number(b); break;
    case "/": result = Number(a) / Number(b); break;
    default: return msg.reply("Invalid operator!");
  }

  await msg.reply(`Result: ${result}`);
}
```

### Example 3: Processing media

```javascript
// plugins/echo-media/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "echo")) return;

  // Checks if the message has media
  if (!msg.hasMedia) {
    return msg.reply("Send a media file with the command!");
  }

  // Downloads the media
  const media = await msg.downloadMedia();

  // Resends in the chat
  await api.sendSticker(media.data);
}
```

---

## Object API

### `msg` Object

| Property | Type | Description |
|----------|------|-------------|
| `msg.body` | `string` | Message text |
| `msg.args` | `string[]` | Message tokens |
| `msg.type` | `string` | Type: `chat`, `image`, `video`, `audio`, `sticker` |
| `msg.sender` | `string` | Sender ID |
| `msg.senderName` | `string` | Sender name |
| `msg.fromMe` | `boolean` | Whether the bot sent it |
| `msg.hasMedia` | `boolean` | Whether it has media |
| `msg.hasReply` | `boolean` | Whether it is a reply |
| `msg.isGif` | `boolean` | Whether it is a GIF |
| `msg.is(cmd)` | `function` | Checks if starts with command |
| `msg.reply(text)` | `function` | Replies with quote |
| `msg.downloadMedia()` | `function` | Returns `{ mimetype, data }` |
| `msg.getReply()` | `function` | Returns quoted message |

### `api` Object

| Method | Description |
|--------|-------------|
| `api.send(text)` | Sends text |
| `api.sendVideo(path)` | Sends video |
| `api.sendAudio(path)` | Sends audio (voice) |
| `api.sendImage(path, caption?)` | Sends image |
| `api.sendSticker(bufferOrPath)` | Sends sticker |
| `api.getPlugin(name)` | Accesses another plugin |
| `api.chat.id` | Chat ID |
| `api.chat.name` | Chat name |
| `api.chat.isGroup` | Whether it is a group |
| `api.log.info(...)` | Info log |
| `api.log.warn(...)` | Warning log |
| `api.log.error(...)` | Error log |

---

## Exposing API to Other Plugins

A plugin can export functions for others to use:

```javascript
// plugins/utilities/index.js

// Public API
export const api = {
  formatDate: (date) => date.toLocaleDateString("en-US"),
  formatCurrency: (value) => `$${value.toFixed(2)}`,
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Normal plugin logic
export default async function ({ msg }) {
  if (msg.is("!ping")) {
    await msg.reply("pong!");
  }
}
```

Another plugin using it:

```javascript
// plugins/other/index.js
export default async function ({ msg, api }) {
  const utils = api.getPlugin("utilities");

  const date = utils.formatDate(new Date());
  await msg.reply(`Today is ${date}`);
}
```

---

## Translating Your Plugin

Each plugin can have its own translations, completely independent from the bot core. The bot locale (set in `manybot.conf`) is used automatically.

### Structure

```
src/plugins/
└── my-plugin/
    ├── index.js
    └── locale/
        ├── en.json
        ├── pt.json
        └── es.json
```

### locale/en.json

```json
{
  "hello": "Hello, {{name}}! 👋",
  "error": {
    "notFound": "Item not found."
  }
}
```

### index.js

```javascript
import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

export default async function ({ msg }) {
  if (!msg.is(CMD_PREFIX + "hi")) return;

  // Simple key
  await msg.reply(t("hello", { name: msg.senderName }));

  // Nested key
  await msg.reply(t("error.notFound"));
}
```

### Notes

- If the configured locale has no translation file, falls back to `en.json`.
- If the key doesn't exist in any file, the key itself is returned as-is.
- Use `{{variable}}` syntax for interpolation.
- Each plugin manages its own translations — never import `t` from the bot core.

---

## Error Handling

If a plugin throws an error, the kernel automatically disables it:

```javascript
export default async function ({ msg, api }) {
  try {
    // Code that might fail
    const result = await somethingRisky();
    await msg.reply(result);
  } catch (error) {
    // Logs the error and notifies
    api.log.error("Plugin error:", error);
    await msg.reply("Oops! Something went wrong.");
  }
}
```

---

## Enabling the Plugin

After creating it, add to `manybot.conf`:

```bash
PLUGINS=[
    # ... other plugins
    my-plugin
]
```

Restart the bot to load it.

---

## See Also

- [API Reference](./API.md)
- [Plugin examples](../src/plugins/)