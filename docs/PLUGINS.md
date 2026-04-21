# 🔌 Criando Plugins

Guia completo para criar plugins no ManyBot.

---

## ManyPlug CLI

**ManyPlug** é a ferramenta oficial para gerenciar plugins do ManyBot. Com ela você pode criar, instalar e validar plugins facilmente.

### Instalação

```bash
npm install -g @freakk.dev/manyplug
```

Ou para desenvolvimento:
```bash
git clone https://git.maneos.net/synt-xerror/manyplug
cd manyplug
npm link
```

### Comandos

| Comando | Descrição |
|---------|-----------|
| `manyplug init <nome>` | Cria estrutura de um novo plugin |
| `manyplug install [nome]` | Instala do registro ou `--local <caminho>` |
| `manyplug list` | Lista plugins instalados |
| `manyplug validate [caminho]` | Valida o manyplug.json |

### Exemplos

```bash
# Criar novo plugin
cd src/plugins
manyplug init meu-plugin --category utility

# Instalar de outro diretório
manyplug install --local ../outro-plugin

# Validar manifesto
manyplug validate ./meu-plugin
```

---

## 📑 Índice

- [ManyPlug CLI](#manyplug-cli)
- [Estrutura Básica](#estrutura-básica)
- [Manifesto do Plugin](#manifesto-do-plugin-manyplugjson)
- [Criando Seu Primeiro Plugin](#criando-seu-primeiro-plugin)
- [API de Objetos](#api-de-objetos)
- [Expondo API](#expondo-api-para-outros-plugins)
- [Traduzindo Seu Plugin](#traduzindo-seu-plugin)
- [Tratamento de Erros](#tratamento-de-erros)

---

## Estrutura Básica

```
src/plugins/
└── meu-plugin/
    ├── index.js
    ├── manyplug.json
    └── locale/         (opcional)
        ├── en.json
        ├── pt.json
        └── es.json
```

O `index.js` deve exportar uma função `default` que recebe `{ msg, api }`:

```javascript
export default async function ({ msg, api }) {
  // Sua lógica aqui
}
```

---

## Manifesto do Plugin (manyplug.json)

Todo plugin deve ter um `manyplug.json` na raiz. Ele descreve o plugin e declara dependências npm extras que ele precisar.

```json
{
  "name": "meu-plugin",
  "version": "1.0.0",
  "category": "utility",
  "service": false,
  "dependencies": {}
}
```

### Campos

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | `string` | Identificador do plugin, deve ser igual ao nome da pasta |
| `version` | `string` | Versão semântica (ex: `"1.0.0"`) |
| `category` | `string` | Categoria do plugin: `utility`, `media`, `game`, `humor`, `info` |
| `service` | `boolean` | `true` se o plugin roda em segundo plano (agendador, listener). `false` se acionado por comando ou evento |
| `dependencies` | `object` | Pacotes npm extras necessários, mesmo formato do `package.json` |

### Exemplo com dependências

```json
{
  "name": "clima",
  "version": "1.0.0",
  "category": "utility",
  "service": false,
  "dependencies": {
    "axios": "^1.6.0"
  }
}
```

Após adicionar dependências, rode `npm install` na raiz do projeto para instalá-las.

---

## Criando Seu Primeiro Plugin

### Exemplo 1: Comando simples

```javascript
// plugins/saudacao/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  // Só responde se a mensagem começar com "!oi"
  if (!msg.is(CMD_PREFIX + "oi")) return;

  await msg.reply("Olá! 👋");
}
```

### Exemplo 2: Comando com argumentos

```javascript
// plugins/calcular/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "calcular")) return;

  // msg.args = ["!calcular", "5", "+", "3"]
  const [, a, operador, b] = msg.args;

  let resultado;
  switch (operador) {
    case "+": resultado = Number(a) + Number(b); break;
    case "-": resultado = Number(a) - Number(b); break;
    case "*": resultado = Number(a) * Number(b); break;
    case "/": resultado = Number(a) / Number(b); break;
    default: return msg.reply("Operador inválido!");
  }

  await msg.reply(`Resultado: ${resultado}`);
}
```

### Exemplo 3: Processando mídia

```javascript
// plugins/echo-media/index.js
import { CMD_PREFIX } from "../../config.js";

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "echo")) return;

  // Verifica se a mensagem tem mídia
  if (!msg.hasMedia) {
    return msg.reply("Envie uma mídia com o comando!");
  }

  // Baixa a mídia
  const media = await msg.downloadMedia();

  // Reenvia no chat
  await api.sendSticker(media.data);
}
```

---

## API de Objetos

### Objeto `msg`

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `msg.body` | `string` | Texto da mensagem |
| `msg.args` | `string[]` | Tokens da mensagem |
| `msg.type` | `string` | Tipo: `chat`, `image`, `video`, `audio`, `sticker` |
| `msg.sender` | `string` | ID do remetente |
| `msg.senderName` | `string` | Nome do remetente |
| `msg.fromMe` | `boolean` | Se o bot enviou |
| `msg.hasMedia` | `boolean` | Se tem mídia |
| `msg.hasReply` | `boolean` | Se é resposta |
| `msg.isGif` | `boolean` | Se é GIF |
| `msg.is(cmd)` | `function` | Verifica se começa com comando |
| `msg.reply(text)` | `function` | Responde com quote |
| `msg.downloadMedia()` | `function` | Retorna `{ mimetype, data }` |
| `msg.getReply()` | `function` | Retorna mensagem citada |

### Objeto `api`

| Método | Descrição |
|--------|-----------|
| `api.send(text)` | Envia texto |
| `api.sendVideo(path)` | Envia vídeo |
| `api.sendAudio(path)` | Envia áudio (voz) |
| `api.sendImage(path, caption?)` | Envia imagem |
| `api.sendSticker(bufferOrPath)` | Envia figurinha |
| `api.getPlugin(name)` | Acessa outro plugin |
| `api.chat.id` | ID do chat |
| `api.chat.name` | Nome do chat |
| `api.chat.isGroup` | Se é grupo |
| `api.log.info(...)` | Log informativo |
| `api.log.warn(...)` | Log de aviso |
| `api.log.error(...)` | Log de erro |

---

## Expondo API para Outros Plugins

Um plugin pode exportar funções para outros usarem:

```javascript
// plugins/utilidades/index.js

// API pública
export const api = {
  formatarData: (date) => date.toLocaleDateString("pt-BR"),
  formatarMoeda: (valor) => `R$ ${valor.toFixed(2).replace(".", ",")}`,
  esperar: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Lógica normal do plugin
export default async function ({ msg }) {
  if (msg.is("!ping")) {
    await msg.reply("pong!");
  }
}
```

Outro plugin usando:

```javascript
// plugins/outro/index.js
export default async function ({ msg, api }) {
  const utils = api.getPlugin("utilidades");

  const data = utils.formatarData(new Date());
  await msg.reply(`Hoje é ${data}`);
}
```

---

## Traduzindo Seu Plugin

Cada plugin pode ter suas próprias traduções, completamente independentes do core do bot. O locale do bot (definido no `manybot.conf`) é usado automaticamente.

### Estrutura

```
src/plugins/
└── meu-plugin/
    ├── index.js
    └── locale/
        ├── en.json
        ├── pt.json
        └── es.json
```

### locale/pt.json

```json
{
  "ola": "Olá, {{nome}}! 👋",
  "erro": {
    "naoEncontrado": "Item não encontrado."
  }
}
```

### index.js

```javascript
import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

export default async function ({ msg }) {
  if (!msg.is(CMD_PREFIX + "oi")) return;

  // Chave simples
  await msg.reply(t("ola", { nome: msg.senderName }));

  // Chave aninhada
  await msg.reply(t("erro.naoEncontrado"));
}
```

### Observações

- Se o locale configurado não tiver arquivo de tradução, cai automaticamente para `en.json`.
- Se a chave não existir em nenhum arquivo, a própria chave é retornada.
- Use a sintaxe `{{variavel}}` para interpolação.
- Cada plugin gerencia suas próprias traduções — nunca importe `t` do core do bot.

---

## Tratamento de Erros

Se um plugin lançar erro, o kernel o desativa automaticamente:

```javascript
export default async function ({ msg, api }) {
  try {
    // Código que pode falhar
    const resultado = await algoPerigoso();
    await msg.reply(resultado);
  } catch (erro) {
    // Loga o erro e notifica
    api.log.error("Erro no plugin:", erro);
    await msg.reply("Ops! Algo deu errado.");
  }
}
```

---

## Ativando o Plugin

Depois de criar, adicione ao `manybot.conf`:

```bash
PLUGINS=[
    # ... outros plugins
    meu-plugin
]
```

Reinicie o bot para carregar.

---

## Veja Também

- [Referência da API](./API.md)
- [Exemplos de plugins](../src/plugins/)