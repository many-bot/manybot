# 🛠️ API Reference

Complete documentation of objects available in plugins.

---

## The `msg` Object

Contains information about the received message.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `msg.body` | `string` | Full text of the message |
| `msg.args` | `string[]` | Message tokens. E.g.: `"!video url"` → `["!video", "url"]` |
| `msg.type` | `string` | Message type: `chat`, `image`, `video`, `audio`, `sticker`, `ptt` (voice), `document`, `location` |
| `msg.sender` | `string` | Sender ID (format: `NUMBER@c.us` or `NUMBER@g.us`) |
| `msg.senderName` | `string` | Display name of the sender |
| `msg.fromMe` | `boolean` | `true` if the bot itself sent the message |
| `msg.hasMedia` | `boolean` | `true` if the message contains media |
| `msg.hasReply` | `boolean` | `true` if the message is a reply to another |
| `msg.isGif` | `boolean` | `true` if the media is a GIF |
| `msg.timestamp` | `number` | Unix timestamp of the message |

### Methods

#### `msg.is(cmd)`

Checks whether the message starts with the specified command.

```javascript
if (msg.is(CMD_PREFIX + "video")) {
  // Execute command
}
```

**Returns:** `boolean`

---

#### `msg.reply(text)`

Replies to the current message with a quote (citation).

```javascript
await msg.reply("Reply with citation!");
```

**Parameters:**
- `text` (string): Text of the reply

**Returns:** `Promise<void>`

---

#### `msg.downloadMedia()`

Downloads the media from the message.

```javascript
const media = await msg.downloadMedia();
// Returns: { mimetype: "image/jpeg", data: "base64string..." }
```

**Returns:** `Promise<{ mimetype: string, data: string } | null>`

---

#### `msg.getReply()`

Returns the message that was quoted.

```javascript
const quotedMsg = msg.getReply();
if (quotedMsg) {
  console.log(quotedMsg.body);
}
```

**Returns:** `msg object | null`

---

## The `api` Object

Contains methods for interacting with WhatsApp and other plugins.

### Properties

#### `api.chat`

Information about the current chat.

| Property | Type | Description |
|----------|------|-------------|
| `api.chat.id` | `string` | Chat ID |
| `api.chat.name` | `string` | Chat name |
| `api.chat.isGroup` | `boolean` | `true` if it is a group |

---

### Send Methods

#### `api.send(text)`

Sends a text message.

```javascript
await api.send("Message sent!");
```

**Parameters:**
- `text` (string): Text to send

**Returns:** `Promise<void>`

---

#### `api.sendVideo(filePath)`

Sends a video from the file system.

```javascript
await api.sendVideo("/path/to/video.mp4");
```

**Parameters:**
- `filePath` (string): Path to the file

**Returns:** `Promise<void>`

---

#### `api.sendAudio(filePath)`

Sends audio as a voice message (PTT).

```javascript
await api.sendAudio("/path/to/audio.mp3");
```

**Parameters:**
- `filePath` (string): Path to the file

**Returns:** `Promise<void>`

---

#### `api.sendImage(filePath, caption?)`

Sends an image.

```javascript
await api.sendImage("/path/to/image.jpg", "Optional caption");
```

**Parameters:**
- `filePath` (string): Path to the file
- `caption` (string, optional): Image caption

**Returns:** `Promise<void>`

---

#### `api.sendSticker(bufferOrPath)`

Sends a sticker. Accepts a `Buffer` or a file path.

```javascript
// With Buffer
const buffer = fs.readFileSync("image.png");
await api.sendSticker(buffer);

// With path
await api.sendSticker("/path/to/image.png");
```

**Parameters:**
- `bufferOrPath` (`Buffer` | `string`): Image data or file path

**Returns:** `Promise<void>`

---

### Plugin Methods

#### `api.getPlugin(name)`

Accesses the public API of another plugin.

```javascript
const utils = api.getPlugin("utilities");
const data = utils.formatDate(new Date());
```

**Parameters:**
- `name` (string): Plugin name

**Returns:** `object | undefined`

---

### Log Methods

#### `api.log.info(...args)`

Informational log.

```javascript
api.log.info("Message received:", msg.body);
```

#### `api.log.warn(...args)`

Warning log.

```javascript
api.log.warn("Missing config, using default");
```

#### `api.log.error(...args)`

Error log.

```javascript
api.log.error("Failed to process:", error);
```

---

## Configuration Object

Import settings from `manybot.conf`:

```javascript
import { CMD_PREFIX, CLIENT_ID, CHATS, PLUGINS } from "../../config.js";

// Custom configurations also work
import { MY_PREFIX } from "../../config.js";
```

---

## Full Example

```javascript
import { CMD_PREFIX } from "../../config.js";
import fs from "fs";

export default async function ({ msg, api }) {
  // Ignore messages from the bot itself
  if (msg.fromMe) return;

  // Command: !echo
  if (!msg.is(CMD_PREFIX + "echo")) return;

  api.log.info("Echo command received from:", msg.senderName);

  // If it has media, download and resend
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    await api.sendSticker(media.data);
    return;
  }

  // If it's a reply, echo the quoted message
  if (msg.hasReply) {
    const quoted = msg.getReply();
    await msg.reply(`You quoted: "${quoted.body}"`);
    return;
  }

  // Default response
  await msg.reply("Send media or reply to a message!");
}
```