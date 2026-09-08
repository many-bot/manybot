
<div align="center">

![ManyBot Logo](logo.png)

![Node.js 24+](https://img.shields.io/badge/Node.js-24+-339933?logo=node.js&logoColor=white) ![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white) ![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)  ![Baileys](https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white)

</div>

---

Framework for building WhatsApp bots, extensible with plugins.

> [!NOTE]
> Use ManyBot responsibly and in accordance with WhatsApp's terms, local law and the consent of the people you contact. Automated or high-volume messaging can get an account rate-limited or banned. The maintainers aren't responsible for misuse, data loss or account restrictions.

## Requirements

- Node.js >= 24
- npm >= 9
- An interactive terminal for first-time WhatsApp login

## Getting started

### Install from npm (recommended)

```bash
npm install -g @manybot/manybot
npm install -g @manybot/manyplug
manybot
```

On first run, a configuration file is created at `~/.manybot/manybot.toml`. Edit it to set up your preferences.

### Develop from source

```bash
git clone https://git.stxerr.dev/manybot.git
cd manybot
npm install
npm start
```

For detailed setup instructions, see the **[documentation](https://manybot.org/docs/getting-started/)**.

## Plugins

ManyBot's functionality comes from plugins. Install them with ManyPlug:

```bash
# From manybot.org/plugins
manyplug install <plugin-name>

# Or locally
manyplug install --local ./plugin/path
manyplug link # Without installing, assuming cwd is the plugin directory
```

Browse available plugins at **[manybot.org/plugins](https://manybot.org/plugins/)**.

View all ManyPlug's commands: **[manybot.org/docs/manyplug-cli](https://manybot.org/docs/manyplug-cli)**

## Testing

ManyBot includes both local unit/contract tests and opt-in real WhatsApp integration tests:

```bash
# Run unit and mock contract test suite (fast, offline)
npm test

# Run all verification gates (typecheck + lint + unit tests)
npm run check
```

For integration tests (which require a prior connection to WhatsApp), you can run:
 
```bash
TEST_CHAT="<group-jid>@g.us" MANYBOT_RUN_WHATSAPP_TESTS=1 npm run test:integration:local

# Manual contacts smoke probe
# Just to debug or inspect the shape of IContact
TEST_CHAT="<group-jid>@g.us" MANYBOT_RUN_WHATSAPP_TESTS=1 \
  node --import ./src/main.ts scripts/probe-contacts.mjs
```

## Documentation

Deeper info about the framework and use are all in the [official documentation](https://manybot.org/docs).

## Contributing

All kinds of contributions are welcome, like:
- **Plugin development**. (see [how to make a plugin](https://manybot.org/docs/how-to-make-a-plugin))
- Arts, logos, ads... **Express yourself!** See [our fanarts page](https://manybot.org/fanarts). 
- **Code and docs**: please read [CONTRIBUTING.md](CONTRIBUTING.md).
- **Ideas or suggestions**: [email us](mailto:manybot@pm.me) or open a issue in the repositories.

Want to become part of the team? Please join [our WhatsApp group](https://wa.manybot.org) and you're in!

### Other repositories:

- [many-bot/website](https://github.com/many-bot/website): source code of our website, including the backend.
- [many-bot/docs](https://github.com/many-bot/docs): official documentation. If you like to write, go there. But read [CONTRIBUTING.md](CONTRIBUTING.md) before.

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
