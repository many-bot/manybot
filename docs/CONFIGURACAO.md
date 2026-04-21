# ⚙️ Configuração

Guia completo do arquivo `manybot.conf`.

---

## Estrutura Básica

```bash
# Comentários começam com '#'

CLIENT_ID=bot_permanente
CMD_PREFIX=!
LANGUAGE=pt
CHATS=[]
PLUGINS=[]
```

---

## Opções

### CLIENT_ID

Identificador único da sessão do bot.

```bash
CLIENT_ID=bot_permanente
```

- **Padrão:** `bot_permanente`
- **Uso:** Cria uma pasta `session/` com esse nome para armazenar dados de autenticação

### CMD_PREFIX

Caractere que indica o início de um comando.

```bash
CMD_PREFIX=!
```

- **Padrão:** `!`
- **Exemplo:** Com prefixo `!`, o comando é `!figurinha`. Com `.`, seria `.figurinha`.

### LANGUAGE

Idioma das mensagens do bot.

```bash
LANGUAGE=pt
```

- **Padrão:** `en` (inglês)
- **Opções:** `en` (inglês), `pt` (português), `es` (espanhol)
- **Nota:** Se o idioma selecionado não existir, o bot usará inglês como fallback

### CHATS

Lista de IDs de chats onde o bot responderá.

```bash
CHATS=[
    123456789@c.us,      # Chat privado
    123456789@g.us       # Grupo
]
```

- **Padrão:** `[]` (vazio = responde em todos)
- **Formato:**
  - Privado: `NUMERO@c.us`
  - Grupo: `NUMERO@g.us`

#### Como descobrir o ID

```bash
node src/utils/get_id.js
```

Escaneie o QR Code e mande uma mensagem no chat. O ID aparecerá no terminal.

> Nota: O utilitário usa um `CLIENT_ID` separado para não conflitar com a sessão principal.

### PLUGINS

Lista de plugins a serem carregados.

```bash
PLUGINS=[
    video,
    audio,
    figurinha,
    adivinhacao,
    forca,
    many,
    obrigado
]
```

- **Padrão:** `[]` (nenhum)
- Cada nome corresponde a uma pasta em `src/plugins/`
- Remova ou comente para desativar sem apagar

---

## Configurações Personalizadas

Você pode adicionar suas próprias variáveis para plugins:

```bash
# manybot.conf
MEU_PREFIXO=>
API_KEY=minha_chave
```

E acessar no código do plugin:

```javascript
import { MEU_PREFIXO, API_KEY } from "../../config.js";
```

---

## Exemplo Completo

```bash
# ManyBot Configuration

CLIENT_ID=meu_bot_prod
CMD_PREFIX=/
LANGUAGE=pt

CHATS=[
    5511999999999@c.us,
    5511888888888-123456789@g.us
]

PLUGINS=[
    figurinha,
    video,
    audio,
    many
]

# Configurações extras
ADMIN_NUMBER=5511999999999@c.us
```
