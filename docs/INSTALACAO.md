# 📥 Instalação

Guia completo de instalação do ManyBot em diferentes plataformas.

---

## 📑 Índice

- [Linux (com systemd)](#linux-com-systemd) (Recomendado)
- [Linux (manual)](#linux-manual)
- [Windows](#windows)
- [Termux (Android)](#termux-android)

---

## Linux (com systemd)

Esta é a maneira **mais fácil e recomendada** de rodar o ManyBot. O serviço systemd gerencia o bot automaticamente.

### Pré-requisitos

- Linux com systemd (Ubuntu, Debian, Fedora, Arch, etc.)
- Node.js 18+ e npm 9+
- Acesso root (sudo)

### Instalação

```bash
# 1. Clone o repositório
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# 2. Crie o arquivo de configuração
cp manybot.conf.example manybot.conf
nano manybot.conf

# 3. Execute a instalação das dependências
bash ./setup

# 4. Instale e ative o serviço systemd (requer root)
sudo bash ./setup
```

**Autenticação:**

O ManyBot suporta dois métodos de autenticação:

1. **QR Code (padrão):** Escaneie o QR Code nos logs
2. **Código numérico:** Configure `PHONE_NUMBER` no `manybot.conf` com seu número (ex: `5511999999999`)

```bash
journalctl -u manybot -f
```

### Comandos úteis

```bash
# Ver status do serviço
systemctl status manybot

# Ver logs em tempo real
journalctl -u manybot -f

# Parar o bot
systemctl stop manybot

# Iniciar o bot
systemctl start manybot

# Reiniciar o bot
systemctl restart manybot

# Desabilitar início automático
systemctl disable manybot

# Atualizar o bot
git pull
bash ./setup
sudo systemctl restart manybot
```

### O serviço systemd roda como root?

Sim! O serviço é configurado para rodar como `root` para garantir acesso total ao sistema. Isso é necessário para:
- Acessar arquivos de sessão e logs
- Rodar o Chromium/Puppeteer corretamente
- Ter permissões completas de rede

---

## Linux (manual)

### Instalação

```bash
# 1. Clone o repositório
git clone https://git.maneos.net/synt-xerror/manybot
cd manybot

# 2. Crie o arquivo de configuração
cp manybot.conf.example manybot.conf
nano manybot.conf

# 3. Execute a instalação das dependências
bash ./setup

# 4. Configuração inicial do ManyBot
bash ./setup
```

### Primeira execução

```bash
node ./src/main.js
```

Escaneie o QR Code no WhatsApp (ou digite o código se configurado um número):

**Menu → Dispositivos conectados → Conectar um dispositivo**

> 💡 **Dica:** Para rodar em segundo plano sem systemd, use `nohup`:
> ```bash
> nohup node ./src/main.js > manybot.log 2>&1 &
> ```

---

## Windows

O ManyBot foi pensado para Linux, mas funciona no Windows via **Git Bash**.

### Pré-requisitos

1. **Git Bash**: https://git-scm.com/download/win
2. **Node.js**: https://nodejs.org (escolha "Instalador Windows (.msi)")

### Instalação

Após instalar ambos, abra o **Git Bash** e siga os mesmos passos da [instalação Linux](#linux-manual).

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
- Delete as pastas `.wwebjs_*` e tente novamente

### Bot não responde comandos

- Verifique o `CMD_PREFIX` no `manybot.conf`
- Confira se o plugin está ativado com `manyplug list` e confira se está em `PLUGINS` no `manybot.conf`

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
