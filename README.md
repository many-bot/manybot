<h1 align="center">ManyBot</h1>

<p align="center">
  <img src="logo.png" alt="ManyBot" />
</p>

<p align="center">
  <a href="https://manybot.org/docs/"><img src="https://img.shields.io/badge/docs-manybot.org-2563eb?style=for-the-badge" alt="Documentation" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-2f855a?style=for-the-badge" alt="License: GPL-3.0" /></a>
  <img src="https://img.shields.io/badge/node.js-24%2B-339933?logo=node.js&style=for-the-badge" alt="Node.js 24+" />
  <img src="https://img.shields.io/badge/status-active-2ecc71?style=for-the-badge" alt="Status: active" />
</p>

ManyBot is an open-source WhatsApp automation framework. It's kernel handles the
connection lifecycle, command dispatch, permissions, scheduling, localization,
storage and safety guards while community plugins provide the bot's features.
The current WhatsApp backend is [Baileys](https://github.com/WhiskeySockets/Baileys).

## Disclaimer

Use ManyBot responsibly and in accordance with WhatsApp's terms, local law and
the consent of the people you contact. Automated or high-volume messaging can
cause an account to be rate-limited or banned. The maintainers are not
responsible for misuse, data loss or account restrictions.

## Features

- Plugin-based message handling with hot reload during development
- Declarative command registry in `commands.yaml`
- Command aliases, subcommands, argument validation, loading indicators,
  localized descriptions, menus, deprecations and permission checks
- Group, DM, admin, bot-admin, owner, allowlist, blacklist and cooldown rules
- Driver-neutral plugin API for messages, chats, contacts, media, polls,
  storage, settings, cron scheduling, sessions and cross-plugin APIs
- Built-in English, Portuguese and Spanish framework translations
- LID-aware contact lookup with phone-number normalization
- Configurable security level, log verbosity, read receipts, status endpoint,
  update checks and multi-sink critical alerts

## Requirements

- Node.js >= 24
- npm >= 9
- A WhatsApp account for pairing
- A terminal with an interactive TTY for first-time QR or phone-code login

## Quick start

### Install from npm

```bash
npm install -g @manybot/manybot
npm install -g @manybot/manyplug
manybot
```

On the first run, ManyBot creates `~/.manybot/manybot.toml` and asks whether
to connect by QR code or phone pairing code. A valid saved session skips this
prompt on later runs. Edit the TOML file to change the defaults.

### Run from source

```bash
git clone https://github.com/many-bot/manybot.git
cd manybot
npm install
npm run build
npm start
```

`npm run build` writes compiled JavaScript to `dist/` and copies the framework
locale files. After source changes, run the build again before `npm start`.

### Login methods

Set these values before starting if you want a non-interactive first login:

```toml
LOGIN_METHOD = "qr"                 # "qr" or "phone"
PHONE_NUMBER = "5511999999999"      # required for phone pairing
```

You can also leave `LOGIN_METHOD` empty and choose interactively. Numbers use
country code and digits only, without a leading `+`.

## Configuration

Configuration lives in `~/.manybot/manybot.toml`. Set
`MANYBOT_CONFIG_DIR=/path/to/config` to relocate configuration, sessions,
plugin data, logs and other runtime files.

The generated file includes comments and safe defaults. The most commonly used
keys are:

| Key                              | Purpose                                        | Default         |
| -------------------------------- | ---------------------------------------------- | --------------- |
| `CLIENT_ID`                      | Client identity used by the session            | `manybot`       |
| `CMD_PREFIX`                     | Prefix for commands                            | `!`             |
| `CHATS`                          | Optional list of chats to include              | `[]`            |
| `EXCLUDE_CHATS`                  | Chats to exclude                               | `[]`            |
| `LANGUAGE`                       | Framework language: `en`, `pt`, or `es`        | `en`            |
| `PLUGINS`                        | Active plugin directory names                  | `[]`            |
| `SECURITY_LEVEL`                 | Automation caution: `low`, `medium`, or `high` | `medium`        |
| `LOG_LEVEL`                      | `normal`, `clean`, or `minimal` startup output | `normal`        |
| `AUTO_READ_MESSAGES`             | Mark incoming messages read immediately        | `false`         |
| `STATUS_ENABLED` / `STATUS_PORT` | Local JSON status endpoint                     | `true` / `8080` |
| `UPDATE_CHECK_ENABLED`           | Check npm for updates                          | `true`          |

The optional alert settings are `ADMIN_JID`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SEC`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TO` and
`SMTP_INSECURE`. Critical events are always written to `alerts.log`; WhatsApp,
OS notifications and email are best-effort sinks.

Older `manybot.conf` and `manyplug.conf` files are migrated to TOML and kept as
`.bak` files. `manybot.toml` and `manyplug.toml` are merged, with TOML values
taking precedence over legacy values. Configuration changes are watched and
reloaded while the process is running.

## Plugins

Plugins are enabled in `PLUGINS` and loaded from:

```text
~/.manybot/plugins/<plugin-name>/
```

Each plugin needs a `manyplug.json` manifest. Its `main` field is optional;
ManyBot falls back to `index.js`, then `index.ts`.

```json
{
  "main": "index.js"
}
```

A plugin must export a default function. It may also export `setup`,
`commands`, `api`, and `guardOptions`:

```js
export default async function (ctx) {
  await ctx.send.text('Hello from my plugin');
}

export async function setup(ctx) {
  ctx.log.info('Plugin initialized');
}

export const commands = {
  greet: async (ctx) => {
    await ctx.send.text('Hello');
  },
};

export const api = {
  version: '1.0.0',
};
```

Install the companion CLI to manage published plugins:

```bash
npm install -g @manybot/manyplug
manyplug install <plugin-name>
```

For editor autocomplete and JSDoc types, install `@manybot/types` in the
plugin project:

```bash
npm install --save-dev @manybot/types
```

The plugin context includes `ctx.send`, `ctx.msg`, `ctx.chat`, `ctx.admin`,
`ctx.contacts`, `ctx.storage`, `ctx.settings`, `ctx.scheduler`, `ctx.i18n`,
`ctx.session`, `ctx.commands`, `ctx.runCommand` and driver-neutral
`ctx.wa` access. See [packages/types/README.md](packages/types/README.md) for
the typed public surface.

## Commands

Commands are configured in `~/.manybot/commands.yaml`. The file is optional
plugins can still handle every incoming message through their default export.
When present, it maps command names to plugin functions or inline text:

```yaml
menu:
  enabled: true
  cmd: menu
  aliases: [help, '?']
  pageSize: 15

commands:
  greet:
    cmd: greet
    aliases: [hi]
    plugin: hello
    function: greet
    category: utility
    desc:
      en: Greet the chat
      pt: Cumprimenta o chat
    permissions:
      scope: any
```

The registry also supports imported YAML files, categories, manuals,
localized descriptions, nested subcommands, argument declarations, loading
presets, function chains, deprecation notices and permission-specific
messages. Supported permission controls include group/DM scope, admin and bot
admin requirements, owner or `dono` restrictions, cooldowns, allowlists and
blacklists.

Built-in core commands include `!ping`, `!status` and the per-chat
configuration command (`!config`, `!configurar` or `!cfg`) for changing a
chat's prefix and language.

## Runtime utilities

The default status server exposes JSON at `http://localhost:8080`:

```json
{ "online": true, "since": "2026-09-05T12:00:00.000Z" }
```

To identify the JID of the next incoming chat without loading plugins:

```bash
npm start -- --getid
```

Use the printed value in `CHATS`, `EXCLUDE_CHATS` or `ADMIN_JID` as needed.

## Development and testing

Run the complete local verification gate before submitting changes:

```bash
npm run check
```

This runs TypeScript checking, ESLint, the offline unit/contract suite and
the public `@manybot/types` drift check. Individual commands are also useful:

```bash
npm test
npm run typecheck
npm run lint
npm run build:types
```

Real WhatsApp integration tests are opt-in and require a saved session plus a
chat number:

```bash
TEST_CHAT="5516999999999" MANYBOT_RUN_WHATSAPP_TESTS=1 \
  npm run test:integration:local
```

The manual contacts smoke probe uses the same gate:

```bash
TEST_CHAT="5516999999999" MANYBOT_RUN_WHATSAPP_TESTS=1 \
  node --import ./src/main.ts scripts/probe-contacts.mjs
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the kernel, driver
contract, plugin API or release-facing behavior.

## Troubleshooting

**The bot does not start:** run `npm run build`, confirm Node.js is version 24
or newer, and inspect the generated TOML for invalid syntax.

**Pairing fails:** verify the phone number contains only digits and a country
code. Remove the saved session under `MANYBOT_CONFIG_DIR` and pair again.

**A plugin is not loaded:** check that its name is present in `PLUGINS`, that
`manyplug.json` exists and that its `main` file exports a default function.

**A command is ignored:** verify the prefix, plugin name, function name and
permissions in `commands.yaml`. Use `LOG_LEVEL = "normal"` while diagnosing.

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/many-bot/manybot)
or [Codeberg](https://codeberg.org/many-bot/manybot). Plugin projects belong in
their own repositories. See [CONTRIBUTING.md](CONTRIBUTING.md) for the required
checks, architecture rules, testing expectations, and security reporting
process.

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
