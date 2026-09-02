<div align="center">

![ManyBot Logo](logo.png)

![Node.js 24+](https://img.shields.io/badge/Node.js-24+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux / Windows](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)
![Baileys](https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white)

</div>

---

Open-source framework for message automation, extensible via community plugins.

## Requirements

- Node.js >= 24
- npm >= 9

## Getting started

### Install from npm

```bash
npm install -g @manybot/manybot
npm install -g @manybot/manyplug
manybot
```

On first run, a configuration file is created at `~/.manybot/manybot.toml`. Edit it to set up your preferences.

### Develop from source

```bash
git clone <repo-url>
cd dev
npm install
npm start
```

For detailed setup instructions, see the **[documentation](https://manybot.org/docs/)**.

## Plugins

ManyBot's functionality comes from plugins. Install them with ManyPlug:

```bash
manyplug install <plugin-name>
```

Browse available plugins at **[manybot.org/plugins](https://manybot.org/plugins/)**.

## Testing

ManyBot includes both local unit/contract tests and opt-in real WhatsApp integration tests:

```bash
# Run unit and mock contract test suite (fast, offline)
npm test

# Run all verification gates (typecheck + lint + unit tests)
npm run check

# Run real WhatsApp integration tests against a live account.
# Requires: TEST_CHAT, MANYBOT_RUN_WHATSAPP_TESTS=1, and a saved
# WhatsApp session in your CONFIG_DIR. The bare variant below
# always skips every test (no live socket). Use `:local` to boot
# the bot first — it preloads src/main.ts so the driver connects
# before the test runner kicks in.
TEST_CHAT="5516999999999" MANYBOT_RUN_WHATSAPP_TESTS=1 npm run test:integration:local

# Manual smoke probe: connects, runs a few marker round-trips, and
# prints the IContact shape (id / number / numberRaw / numberPretty /
# country / countryCallingCode) returned by contacts.get(...) — useful
# for verifying the LID-aware contact API against your real account
# without the full test runner overhead.
TEST_CHAT="5516999999999" MANYBOT_RUN_WHATSAPP_TESTS=1 \
  node --import ./src/main.ts scripts/probe-contacts.mjs
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md)

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
