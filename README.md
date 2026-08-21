> [!WARNING]
> Versions 5.6.x and 5.7.x are UNSTABLE because of management error. Please use 5.5.4 instead. 

<div align="center">

![ManyBot Logo](logo.png)

![Node.js 24+](https://img.shields.io/badge/Node.js-24+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)
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

# Run real WhatsApp integration tests (requires TEST_CHAT and live session)
TEST_CHAT="5516999999999" npm run test:integration
```

For full details on the test architecture and API coverage classification, see [API_TEST_PLAN.md](API_TEST_PLAN.md).

## Contributing

All kinds of contributions are welcome:

- **Bug reports and feature requests**: open an issue on GitHub or Codeberg
- **Code**: pull requests are welcome on [GitHub](https://github.com/many-bot/manybot) or [Codeberg](https://codeberg.org/many-bot/manybot); patches by email (`manybot@pm.me`) are also accepted.
- **Plugins**: submit your plugin to [manyplug-repo](https://github.com/many-bot/manyplug-repo), which has instructions on how to do it
- **Anything else**: suggestions, translations, documentation fixes, art - reach out by email or open an issue

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
