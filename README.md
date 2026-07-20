<div align="center">

![ManyBot Logo](logo.png)

![Node.js 24+](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)
![Baileys](https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white)

</div>

---

Open-source framework for message automation, extensible via community plugins.

## Requirements

- Node.js >= 24
- npm

## Getting started

```bash
npm install -g @manybot/manybot
npm install -g @manybot/manyplug
manybot
```

On first run, a configuration file is created at `~/.manybot/manybot.toml`. Edit it to set up your preferences.

For detailed setup instructions, see the **[documentation](https://manybot.org/docs/)**.

## Plugins

ManyBot's functionality comes from plugins. Install them with ManyPlug:

```bash
manyplug install <plugin-name>
```

Browse available plugins at **[manybot.org/plugins](https://manybot.org/plugins/)**.

## Contributing

All kinds of contributions are welcome:

- **Bug reports and feature requests**: open an issue on GitHub or Codeberg
- **Code**: pull requests are welcome on [GitHub](https://github.com/many-bot/manybot) or [Codeberg](https://codeberg.org/many-bot/manybot); patches by email (`devel+manybot.org`) are also accepted - subscribe to the mailing list [here](https://list.stxerr.dev).
- **Plugins**: submit your plugin to [manyplug-repo](https://github.com/many-bot/manyplug-repo), which has instructions on how to do it
- **Anything else**: suggestions, translations, documentation fixes - reach out by email or open an issue

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
