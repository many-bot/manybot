<div align="center">

![ManyBot Logo](logo.png)

**Bot para WhatsApp 100% gratuito e de código aberto**

[🇧🇷 Português](README.md) · [🇺🇸 English](README_EN.md)

![Node.js 18+](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![npm 9+](https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white)
![GPL v3](https://img.shields.io/badge/License-GPL--v3-blue.svg)
![Linux](https://img.shields.io/badge/Linux%20%7C%20Windows-lightgrey)

<br>

> **Versão Oficial Online**
>
> Adicione **+55 (16) 99459-1903** e envie `!many`
>
> Por favor, leia os [Termos de Uso](TERMOS_pt-br.md)

</div>

---

## O que é

ManyBot é um bot de WhatsApp que roda localmente, sem depender da API oficial.

## O que ele pode fazer na versão oficial

- `!video`, `!audio` - Baixar vídeos e áudios e te manda um link de download
- `!figurinha` - Cria figurinhas com imagens, GIFs e vídeos
- `!adivinhacao` - Jogo de adivinhar números
- `!forca` - Jogo da forca

> Funcionalidades novas são adicionadas com frequência!

## Recursos da versão auto-hospedada

- **100% Local** - Sem API oficial do WhatsApp
- **Multi-chat** - Múltiplos chats em uma sessão
- **Sistema de Plugins** - Crie e adicione funcionalidades
- **Headless** - Roda em segundo plano como serviço systemd
- **Configuração Simples** - Arquivo `manybot.conf` intuitivo

## Instalação

```bash
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot
cp manybot.conf.example manybot.conf
nano manybot.conf          # edite a configuração
bash ./setup
```

Para instalar o serviço systemd e o ManyPlug globalmente, execute como root:
```bash
sudo bash ./setup
```

Pegue o código ou o QR Code nos logs: `journalctl -u manybot -f`

Veja a documentação de instalação e configuração antes de tentar rodar o Bot!

> 📚 **Documentação completa:** [Instalação](docs/INSTALACAO.md), [Configuração](docs/CONFIGURACAO.md), [Plugins](docs/PLUGINS.md)

<div align="center">

**[⬆ Voltar ao topo](#)**

</div>
