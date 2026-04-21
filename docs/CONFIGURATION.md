# Configuration

Complete guide for the `manybot.conf` file.

---

## Basic Structure

```bash
# Comments start with '#'

CLIENT_ID=bot_permanente
CMD_PREFIX=!
LANGUAGE=en
CHATS=[]
PLUGINS=[]
```

---

## Options

### CLIENT_ID

Unique identifier for the bot session.

```bash
CLIENT_ID=my_bot
```

- **Default:** `bot_permanente`
- **Usage:** Creates a `session/` folder with this name to store authentication data

### CMD_PREFIX

Character that indicates the start of a command.

```bash
CMD_PREFIX=!
```

- **Default:** `!`
- **Example:** With prefix `!`, the command is `!sticker`. With `.`, it would be `.sticker`.

### LANGUAGE

Bot message language.

```bash
LANGUAGE=en
```

- **Default:** `en` (English)
- **Options:** `en` (English), `pt` (Portuguese), `es` (Spanish)
- **Note:** If the selected language doesn't exist, the bot will fall back to English

### CHATS

List of chat IDs where the bot will respond.

```bash
CHATS=[
    123456789@c.us,      # Private chat
    123456789@g.us       # Group
]
```

- **Default:** `[]` (empty = responds to all)
- **Format:**
  - Private: `NUMBER@c.us`
  - Group: `NUMBER@g.us`

#### How to discover the ID

```bash
node src/utils/get_id.js
```

Scan the QR Code and send a message in the chat. The ID will appear in the terminal.

> Note: The utility uses a separate `CLIENT_ID` to avoid conflicting with the main session.

### PLUGINS

List of plugins to be loaded.

```bash
PLUGINS=[
    video,
    audio,
    sticker,
    guess,
    hangman,
    many,
    thanks
]
```

- **Default:** `[]` (none)
- Each name corresponds to a folder in `src/plugins/`
- Remove or comment to disable without deleting

---

## Custom Settings

You can add your own variables for plugins:

```bash
# manybot.conf
MY_PREFIX=>
API_KEY=my_key
```

And access in the plugin code:

```javascript
import { MY_PREFIX, API_KEY } from "../../config.js";
```

---

## Complete Example

```bash
# ManyBot Configuration

CLIENT_ID=my_bot_prod
CMD_PREFIX=/
LANGUAGE=en

CHATS=[
    5511999999999@c.us,
    5511888888888-123456789@g.us
]

PLUGINS=[
    sticker,
    video,
    audio,
    many
]

# Extra settings
ADMIN_NUMBER=5511999999999@c.us
```
