<div align="center">

![ManyBot Logo](logo.png)

<p>
  <strong>Bot para WhatsApp 100% local, sem API oficial</strong>
</p>

<p>
  <a href="#-recursos">Recursos</a> .
  <a href="#-instalação-rápida">Instalação</a> .
  <a href="#-uso">Uso</a> .
  <a href="#-plugins">Plugins</a> .
  <a href="#-documentação">Documentação</a>
</p>

<p>
  🇧🇷 Português · <a href="README_EN.md">🇺🇸 English</a>
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/npm-9+-CB3837?logo=npm&logoColor=white" alt="npm 9+">
  <img src="https://img.shields.io/badge/License-GPL--v3-blue.svg" alt="License: GPL v3">
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows-lightgrey" alt="Platform">
</p>

<p>
  <img src="https://img.shields.io/badge/whatsapp--web.js-%2325D366?logo=whatsapp&logoColor=white" alt="whatsapp-web.js">
  <img src="https://img.shields.io/badge/headless-Automated-green" alt="Headless">
</p>

<br>

> **Versão Oficial Online**
> Quer usar o ManyBot sem instalar? Adicione o bot oficial:
>
> **+55 (16) 99459-1903**
>
> Online 24h (quando possível) - Disponibilidade não garantida
>
> Ao adicionar, você concorda com os [Termos de Uso](TERMOS_pt-br.md)

![Exemplo do gerador de figurinhas](examples/figurinha.gif)

</div>

---

## Recursos

- **100% Local** - Sem depender da API oficial do WhatsApp
- **Multi-chat** - Suporte a múltiplos chats em uma única sessão
- **Sistema de Plugins** - Adicione, remova ou crie funcionalidades sem mexer no núcleo
- **Headless** - Funciona em segundo plano sem interface gráfica
- **Fácil Configuração** - Arquivo de config simples e intuitivo

---

## Instalação Rápida

### Opção 1: Usar o Bot Oficial (Sem instalar)

Adicione o número **+55 (16) 99459-1903** aos seus contatos e envie `!many` para ver os comandos disponíveis.

**Status:** 🟢 Online (24h quando possível, mas sem garantia)

> ⚠️ **Importante:** Ao usar o bot oficial, você concorda com os [Termos de Uso](TERMOS_pt-br.md). Leia antes de adicionar!

---

### Opção 2: Instalar sua Própria Versão

```bash
# 1. Clone o repositório
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# 2. Crie o arquivo de configuração
cp manybot.conf.example manybot.conf

# 3. Configure conforme sua necessidade (veja a documentação)
nano manybot.conf

# 4. Execute o script de instalação
bash ./setup

# 5. Rode o bot
node ./src/main.js
```

📱 **Escaneie o QR Code** no WhatsApp: Menu → Dispositivos conectados → Conectar um dispositivo

> **⚡ Pronto!** Veja a [documentação completa](docs/INSTALACAO.md) para mais detalhes.

---

## 💻 Uso

```bash
# Iniciar o bot
node ./src/main.js

# Atualizar para a versão mais recente
bash ./update

# Descobrir IDs de chats
node src/utils/get_id.js
```

---

## 🔌 Plugins

O ManyBot é construído em torno de um sistema de plugins. O kernel apenas conecta ao WhatsApp e distribui as mensagens — os plugins decidem o que fazer.

### Gerenciando Plugins com ManyPlug

Instale e gerencie plugins usando o **ManyPlug CLI**:

```bash
# Instalar o gerenciador
npm install -g @freakk.dev/manyplug

# Criar um novo plugin
cd src/plugins
manyplug init meu-plugin --category utility

# Instalar de outro diretório
manyplug install --local ../outro-plugin

# Listar plugins instalados
manyplug list
```

### Criar um Plugin

```javascript
// plugins/meu-plugin/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "oi")) return;
  await msg.reply("Olá! 👋");
}
```

Veja mais na [documentação de plugins](docs/PLUGINS.md).

---

## 📚 Documentação

- [📥 Instalação Completa](docs/INSTALACAO.md) — Linux, Windows, Termux
- [⚙️ Configuração](docs/CONFIGURACAO.md) — Todas as opções do `manybot.conf`
- [🔌 Criando Plugins](docs/PLUGINS.md) — Guia completo de desenvolvimento
- [🛠️ API de Plugins](docs/API.md) — Referência de objetos `msg` e `api`

## 🌍 Internacionalização

O ManyBot suporta múltiplos idiomas. Configure no `manybot.conf`:

```bash
LANGUAGE=pt  # Português
LANGUAGE=en  # English
LANGUAGE=es  # Español
```

- **Padrão:** Inglês (`en`)
- **Fallback:** Se o idioma selecionado não existir, o bot usa inglês

---

## 📋 Requisitos

- **Node.js** 18+
- **NPM** 9+
- **Linux** ou **Windows** (via Git Bash)

> ⚠️ Android/iOS e Termux têm suporte experimental sem garantias.

---

## 📝 Licença

Distribuído sob a licença **GPLv3**. Veja [LICENSE](LICENSE) para mais detalhes.

---

<div align="center">

**[⬆ Voltar ao topo](#)**

</div>
