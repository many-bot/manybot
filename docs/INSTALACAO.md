# 📥 Instalação

Guia completo de instalação do ManyBot em diferentes plataformas.

---

## 📑 Índice

- [Docker](#docker) (Recomendado)
- [Linux](#linux)
- [Windows](#windows)
- [Termux (Android)](#termux-android)

---

## Docker

A maneira mais fácil e recomendada de rodar o ManyBot.

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Instalação

```bash
# 1. Clone o repositório
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# 2. Crie o arquivo de configuração
cp manybot.conf.example manybot.conf
nano manybot.conf

# 3. Inicie com Docker
docker-compose up -d

# 4. Veja os logs para escanear o QR Code
docker-compose logs -f
```

**Escaneie o QR Code** que aparecerá nos logs.

### Comandos úteis

```bash
# Ver logs
docker-compose logs -f

# Parar o bot
docker-compose down

# Atualizar
git pull
docker-compose up --build -d
```

---

## Linux

### 1. Clone o repositório

```bash
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot
```

### 2. Configure o bot

Crie o arquivo de configuração:

```bash
touch manybot.conf
nano manybot.conf
```

Exemplo de configuração:

```bash
# Comentários com '#'

CLIENT_ID=bot_permanente
CMD_PREFIX=!
LANGUAGE=pt
CHATS=[
    123456789@c.us,
    123456789@g.us
]
PLUGINS=[
    video,
    audio,
    figurinha,
    adivinhacao
]
```

**Detalhes:**
- `CLIENT_ID`: ID da sessão (padrão: `bot_permanente`)
- `CMD_PREFIX`: Prefixo dos comandos (padrão: `!`)
- `LANGUAGE`: Idioma do bot - `pt`, `en` ou `es` (padrão: `en`)
- `CHATS`: IDs dos chats permitidos (deixe vazio para todos)
- `PLUGINS`: Lista de plugins ativos

### 3. Execute a instalação

```bash
bash ./setup
```

### 4. Primeira execução

```bash
node ./src/main.js
```

Escaneie o QR Code no WhatsApp:

**Menu → Dispositivos conectados → Conectar um dispositivo**

---

## Windows

O ManyBot foi pensado para Linux, mas funciona no Windows via **Git Bash**.

### Pré-requisitos

1. **Git Bash**: https://git-scm.com/download/win
2. **Node.js**: https://nodejs.org (escolha "Instalador Windows (.msi)")

### Instalação

Após instalar ambos, abra o **Git Bash** e siga os mesmos passos da [instalação Linux](#linux).

---

## Termux (Android)

> ⚠️ **Aviso:** Suporte experimental. Não há garantia de funcionamento.

```bash
# Instale o Termux pela F-Droid (não use Play Store)
# https://f-droid.org/packages/com.termux/

# Atualize pacotes
pkg update && pkg upgrade

# Instale dependências
pkg install nodejs git

# Clone e instale
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot
```

Siga os passos de configuração Linux a partir do passo 2.

---

## 🔧 Resolução de Problemas

### Erro ao escanear QR Code

- Limpe os dados do Chrome/Chromium do Termux
- Delete a pasta `session/` e tente novamente

### Bot não responde comandos

- Verifique o `CMD_PREFIX` no `manybot.conf`
- Confira se o plugin está na lista `PLUGINS`

### Erros de instalação

```bash
# Limpe a cache do npm
npm cache clean --force

# Reinstale dependências
rm -rf node_modules package-lock.json
npm install
```

---

## 📚 Próximos Passos

- [Configuração avançada](./CONFIGURACAO.md)
- [Criando plugins](./PLUGINS.md)
