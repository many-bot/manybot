# 🛠️ Referência da API

Documentação completa dos objetos disponíveis nos plugins.

---

## Objeto `msg`

Contém informações da mensagem recebida.

### Propriedades

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `msg.body` | `string` | Texto completo da mensagem |
| `msg.args` | `string[]` | Tokens da mensagem. Ex: `"!video url"` → `["!video", "url"]` |
| `msg.type` | `string` | Tipo da mensagem: `chat`, `image`, `video`, `audio`, `sticker`, `ptt` (voz), `document`, `location` |
| `msg.sender` | `string` | ID do remetente (formato: `NUMERO@c.us` ou `NUMERO@g.us`) |
| `msg.senderName` | `string` | Nome de exibição do remetente |
| `msg.fromMe` | `boolean` | `true` se o próprio bot enviou a mensagem |
| `msg.hasMedia` | `boolean` | `true` se a mensagem contém mídia |
| `msg.hasReply` | `boolean` | `true` se é uma resposta a outra mensagem |
| `msg.isGif` | `boolean` | `true` se a mídia é um GIF |
| `msg.timestamp` | `number` | Timestamp Unix da mensagem |

### Métodos

#### `msg.is(cmd)`

Verifica se a mensagem começa com o comando especificado.

```javascript
if (msg.is(CMD_PREFIX + "video")) {
  // Executa comando
}
```

**Retorno:** `boolean`

---

#### `msg.reply(text)`

Responde à mensagem atual com quote (citação).

```javascript
await msg.reply("Resposta com citação!");
```

**Parâmetros:**
- `text` (string): Texto da resposta

**Retorno:** `Promise<void>`

---

#### `msg.downloadMedia()`

Baixa a mídia da mensagem.

```javascript
const media = await msg.downloadMedia();
// Retorna: { mimetype: "image/jpeg", data: "base64string..." }
```

**Retorno:** `Promise<{ mimetype: string, data: string } | null>`

---

#### `msg.getReply()`

Retorna a mensagem que foi citada.

```javascript
const mensagemCitada = msg.getReply();
if (mensagemCitada) {
  console.log(mensagemCitada.body);
}
```

**Retorno:** `msg object | null`

---

## Objeto `api`

Contém métodos para interagir com o WhatsApp e outros plugins.

### Propriedades

#### `api.chat`

Informações do chat atual.

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `api.chat.id` | `string` | ID do chat |
| `api.chat.name` | `string` | Nome do chat |
| `api.chat.isGroup` | `boolean` | `true` se é grupo |

---

### Métodos de Envio

#### `api.send(text)`

Envia uma mensagem de texto.

```javascript
await api.send("Mensagem enviada!");
```

**Parâmetros:**
- `text` (string): Texto a enviar

**Retorno:** `Promise<void>`

---

#### `api.sendVideo(filePath)`

Envia um vídeo do sistema de arquivos.

```javascript
await api.sendVideo("/caminho/para/video.mp4");
```

**Parâmetros:**
- `filePath` (string): Caminho para o arquivo

**Retorno:** `Promise<void>`

---

#### `api.sendAudio(filePath)`

Envia um áudio como mensagem de voz (PTT).

```javascript
await api.sendAudio("/caminho/para/audio.mp3");
```

**Parâmetros:**
- `filePath` (string): Caminho para o arquivo

**Retorno:** `Promise<void>`

---

#### `api.sendImage(filePath, caption?)`

Envia uma imagem.

```javascript
await api.sendImage("/caminho/para/imagem.jpg", "Legenda opcional");
```

**Parâmetros:**
- `filePath` (string): Caminho para o arquivo
- `caption` (string, opcional): Legenda da imagem

**Retorno:** `Promise<void>`

---

#### `api.sendSticker(bufferOuPath)`

Envia uma figurinha. Aceita `Buffer` ou caminho para arquivo.

```javascript
// Com Buffer
const buffer = fs.readFileSync("imagem.png");
await api.sendSticker(buffer);

// Com caminho
await api.sendSticker("/caminho/para/imagem.png");
```

**Parâmetros:**
- `bufferOuPath` (`Buffer` | `string`): Dados da imagem ou caminho

**Retorno:** `Promise<void>`

---

### Métodos de Plugin

#### `api.getPlugin(name)`

Acessa a API pública de outro plugin.

```javascript
const utils = api.getPlugin("utilidades");
const data = utils.formatarData(new Date());
```

**Parâmetros:**
- `name` (string): Nome do plugin

**Retorno:** `object | undefined`

---

### Métodos de Log

#### `api.log.info(...args)`

Log informativo.

```javascript
api.log.info("Mensagem recebida:", msg.body);
```

#### `api.log.warn(...args)`

Log de aviso.

```javascript
api.log.warn("Configuração ausente, usando padrão");
```

#### `api.log.error(...args)`

Log de erro.

```javascript
api.log.error("Falha ao processar:", erro);
```

---

## Objeto de Configuração

Importe configurações do `manybot.conf`:

```javascript
import { CMD_PREFIX, CLIENT_ID, CHATS, PLUGINS } from "../../config.js";

// Configurações personalizadas também funcionam
import { MEU_PREFIXO } from "../../config.js";
```

---

## Exemplo Completo

```javascript
import { CMD_PREFIX } from "../../config.js";
import fs from "fs";

export default async function ({ msg, api }) {
  // Ignora mensagens do próprio bot
  if (msg.fromMe) return;

  // Comando: !eco
  if (!msg.is(CMD_PREFIX + "eco")) return;

  api.log.info("Comando eco recebido de:", msg.senderName);

  // Se tem mídia, baixa e reenvia
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    await api.sendSticker(media.data);
    return;
  }

  // Se é resposta, ecoa a mensagem citada
  if (msg.hasReply) {
    const citada = msg.getReply();
    await msg.reply(`Você citou: "${citada.body}"`);
    return;
  }

  // Resposta padrão
  await msg.reply("Envie uma mídia ou responda uma mensagem!");
}
```
