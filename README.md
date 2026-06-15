<div align="center">

![ManyBot Logo](logo.png)

![Node.js 18+](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)
![whatsapp-web.js](https://img.shields.io/badge/WhatsApp-25D366?logo=whatsapp&logoColor=white)

</div>

---

ManyBot is a free and open-source messaging automation ecosystem for online businesses and communities.

## Requirements

- Node.js >= 18
- npm

## Getting started

```bash
npm install -g @manybot/manybot
npm install -g @manybot/manyplug
manybot
```

On first run, a configuration file is created at `~/.manybot/manybot.conf`. Edit it to set up your preferences and list the plugins you want to load.

For detailed setup instructions, see the **[documentation](https://manybot.stxerr.dev/docs/)**.

## Plugins

ManyBot's functionality comes from plugins. Install them with ManyPlug:

```bash
manyplug install <plugin-name>
```

Browse available plugins at **[manybot.stxerr.dev/plugins](https://manybot.stxerr.dev/plugins/)**.

Want to build your own? The plugin API lets you add commands and features without touching the bot's core - *documentation coming soon*.

## Contributing

All kinds of contributions are welcome:

- **Bug reports and feature requests**: open an issue on GitHub or Codeberg
- **Code**: pull requests are welcome on [GitHub](https://github.com/many-bot/manybot) or [Codeberg](https://codeberg.org/many-bot/manybot); patches by email (`devel+manybot@stxerr.dev`) are also accepted - subscribe to the mailing list [here](https://list.stxerr.dev).
- **Plugins**: submit your plugin to [manyplug-repo](https://github.com/many-bot/manyplug-repo), which has instructions on how to do it
- **Anything else**: suggestions, translations, documentation fixes - reach out by email or open an issue

## License

ManyBot is distributed under the [GNU General Public License v3.0](LICENSE).
