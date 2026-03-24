![ManyBot Logo](logo.png)

ManyBot é um bot para WhatsApp que roda 100% localmente, sem depender da API oficial do WhatsApp. Ele utiliza a biblioteca `whatsapp-web.js`, que automatiza o WhatsApp Web sem depender de gráficos (headless).

Algumas funcionalidades desse bot incluem:
- Suporte a múltiplos chats em uma única sessão
- Sistema de plugins — adicione, remova ou crie funcionalidades sem mexer no núcleo do bot

# Exemplos

<center>

![Exemplo do gerador de figurinhas](examples/figurinha.gif)

</center>

---

# Requisitos
- Node.js
- NPM
- Sistema Linux ou Windows

obs: Sistemas Android e iOS ainda não são 100% compatíveis. O suporte para Termux está em fases de testes e sem garantia de funcionamento correto.

# Instalação (Linux)

1. Clone o repositório e entre:
```bash
git clone https://github.com/synt-xerror/manybot
cd manybot
```

2. Crie e abra o arquivo de configuração (use o editor de sua preferência):
```bash
touch manybot.conf
nano manybot.conf
```

3. Nele você pode configurar algumas coisas do ManyBot. Esse é o arquivo base para que possa modificar:
```bash
# Comentários com '#'

CLIENT_ID=bot_permanente
CMD_PREFIX=!
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
- **CLIENT_ID:** ID do cliente, serve para identificar sua sessão.
    - Valor padrão: `bot_permanente`
- **CMD_PREFIX:** Prefixo do comando, o caractere que você usa para executar um comando (!many, !figurinha).
    - Valor padrão: `!`
- **CHATS:** ID dos chats no qual você quer que o bot assista. Use o utilitário: `src/utils/get_id.js` para descobrir os IDs. Deixe vazio caso queira que funcione com qualquer chat.
    - Valor padrão: (nenhum)
- **PLUGINS:** Lista de plugins ativos. Cada nome corresponde a uma pasta dentro de `src/plugins/`. Remova ou comente uma linha para desativar o plugin sem apagá-lo.
    - Valor padrão: (nenhum)

obs: o utilitário `src/utils/get_id.js` usa um CLIENT_ID separado para que não entre em conflito com a sessão principal do ManyBot. Você terá que escanear o QR Code novamente para executá-lo.

4. Execute o script de instalação:
```bash
bash ./setup
```

5. Rode o bot pela primeira vez (você deve rodar da raiz, não dentro de `src`):
```bash
node ./src/main.js
```
Ele vai pedir para que escaneie o QR Code com seu celular.

No WhatsApp:
Menu (três pontos) > Dispositivos conectados > Conectar um dispositivo

# Instalação (Windows)

O uso desse bot foi pensado para rodar em um terminal Linux. No entanto, você pode usar o Git Bash, que simula um terminal Linux com Bash real:

1. Para baixar o Git Bash: https://git-scm.com/install/windows
Selecione a versão que deseja (portátil ou instalador)

2. Para baixar o Node.js: https://nodejs.org/pt-br/download
Role a tela e selecione "Instalador Windows (.msi)"
Ou se preferir, use um gerenciador de pacotes como mostra no conteúdo inicial

Depois de instalar ambos, abra o Git Bash e execute exatamente os mesmos comandos mostrados na seção Linux.

# Uso

Feito a instalação, você pode executar o bot apenas rodando:
```bash
node ./src/main.js
```

## Atualizações

É recomendável sempre ter a versão mais recente do ManyBot. Para isso, temos um utilitário logo na raíz. Para executar:
```bash
bash ./update
```

## Criando um serviço (opcional)

Se estiver rodando numa VPS ou apenas quer mais controle, é recomendável criar um serviço systemd. Siga os passos abaixo para saber como criar, habilitar e gerenciar um.

1. Configurando o diretório 

Primeiro passo é garantir que o diretório do ManyBot esteja no local adequado, é recomendável guardar em `/root/manybot` (os passos a seguir supõem que esteja essa localização)

2. Criando o serviço

Abra o arquivo:
```bash
/etc/systemd/system/manybot.service
```

E cole o seguinte conteúdo:
```conf
[Unit]
Description=ManyBot
After=network.target

[Service]
ExecStart=/usr/bin/env node /root/manybot/src/main.js
WorkingDirectory=/root/manybot
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

3. Iniciando e habilitando o serviço:

Primeiro reinicie o daemon do systemd:
```bash
systemctl daemon-reload
```

Inicie o serviço:
```bash
systemctl start manybot
```

Habilite para que ele seja iniciado junto com o seu sistema (opcional):
```bash
systemctl enable manybot
```

4. Gerenciando o serviço:

Ver logs:
```bash
journalctl -u manybot
```

Em tempo real:
```bash
journalctl -u manybot -f
```

Parar o serviço:
```bash
systemctl stop manybot
```

Reiniciar o serviço:
```bash
systemctl restart manybot
```

Saiba mais sobre como gerenciar serviços em: https://www.digitalocean.com/community/tutorials/how-to-use-systemctl-to-manage-systemd-services-and-units-pt
Sobre o journalctl: https://www.digitalocean.com/community/tutorials/how-to-use-journalctl-to-view-and-manipulate-systemd-logs-pt

# Plugins

O ManyBot é construído em torno de um sistema de plugins. O núcleo do bot (kernel) apenas conecta ao WhatsApp e distribui as mensagens — quem decide o que fazer com elas são os plugins.

Isso significa que você pode adicionar, remover ou criar funcionalidades sem tocar no código principal do bot.

## Plugins incluídos

O ManyBot vem com alguns plugins prontos para uso, como:

- **video** — baixa um vídeo da internet e envia no chat (`!video <link>`)
- **audio** — baixa o áudio de um vídeo e envia como mensagem de voz (`!audio <link>`)
- **figurinha** — converte imagens, GIFs e vídeos em figurinhas (`!figurinha`)
- **adivinhacao** — jogo de adivinhação de um número entre 1 e 100 (`!adivinhação começar`)
- **forca** — clássico jogo da forca (`!forca começar`)
- **many** — exibe a lista de comandos disponíveis (`!many`)
- **obrigado** — responde agradecimentos (`!obrigado`, `!valeu`, `!brigado`)

Para ativar ou desativar qualquer um deles, basta editar a lista `PLUGINS` no `manybot.conf`.

## Criando um plugin

Cada plugin é uma pasta dentro de `plugins/` com um arquivo `index.js`. O bot carrega automaticamente todos os plugins listados no `manybot.conf`.

A estrutura mínima de um plugin:

```
plugins/
└── meu-plugin/
    └── index.js
```

O `index.js` deve exportar uma função `default` que o kernel chama a cada mensagem recebida. A função recebe `{ msg, api }` e decide por conta própria se age ou ignora:

```js
// plugins/meu-plugin/index.js

import { CMD_PREFIX } from "../../config.js"

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "oi")) return;

  await msg.reply("Olá! 👋");
}
```

### O objeto `msg`

Contém as informações da mensagem recebida:

| Propriedade | Descrição |
|---|---|
| `msg.body` | Texto da mensagem |
| `msg.args` | Tokens da mensagem — `["!video", "https://..."]` |
| `msg.type` | Tipo — `"chat"`, `"image"`, `"video"`, `"audio"`, `"sticker"` |
| `msg.sender` | ID de quem enviou |
| `msg.senderName` | Nome de quem enviou |
| `msg.fromMe` | `true` se foi o próprio bot que enviou |
| `msg.hasMedia` | `true` se a mensagem tem mídia |
| `msg.hasReply` | `true` se é uma resposta a outra mensagem |
| `msg.isGif` | `true` se a mídia é um GIF |
| `msg.is(cmd)` | Retorna `true` se a mensagem começa com `cmd` |
| `msg.reply(text)` | Responde à mensagem com quote |
| `msg.downloadMedia()` | Baixa a mídia — retorna `{ mimetype, data }` |
| `msg.getReply()` | Retorna a mensagem citada, ou `null` |

### O objeto `api`

Contém tudo que o plugin pode fazer — enviar mensagens, acessar outros plugins, registrar logs:

| Método | Descrição |
|---|---|
| `api.send(text)` | Envia texto no chat |
| `api.sendVideo(filePath)` | Envia um vídeo a partir de um arquivo local |
| `api.sendAudio(filePath)` | Envia um áudio a partir de um arquivo local |
| `api.sendImage(filePath, caption?)` | Envia uma imagem a partir de um arquivo local |
| `api.sendSticker(bufferOuPath)` | Envia uma figurinha — aceita `Buffer` ou caminho |
| `api.getPlugin(name)` | Retorna a API pública de outro plugin |
| `api.chat.id` | ID do chat atual |
| `api.chat.name` | Nome do chat atual |
| `api.chat.isGroup` | `true` se é um grupo |
| `api.log.info(...)` | Loga uma mensagem informativa |
| `api.log.warn(...)` | Loga um aviso |
| `api.log.error(...)` | Loga um erro |

### Lendo o manybot.conf no plugin

Se o seu plugin precisar de configurações próprias, você pode adicioná-las diretamente no `manybot.conf` e importá-las no código:

```js
import { MEU_PREFIXO } from "../../src/config.js";

const prefixo = MEU_PREFIXO ?? "padrão";
```

### Expondo uma API para outros plugins

Um plugin pode expor funções para que outros plugins as utilizem. Para isso, basta exportar um objeto `api`:

```js
// plugins/utilidades/index.js

export const api = {
  formatarData: (date) => date.toLocaleDateString("pt-BR"),
};

export default async function ({ msg }) {
  // lógica normal do plugin
}
```

Outro plugin pode chamar:

```js
const utils = api.getPlugin("utilidades");
utils.formatarData(new Date());
```

### Erros no plugin

Se um plugin lançar um erro, o kernel o desativa automaticamente e loga o problema — o restante dos plugins continua funcionando normalmente. Isso garante que um plugin com bug não derruba o bot inteiro.

# Considerações

ManyBot é distribuído sob a licença GPLv3. Você pode usar, modificar e redistribuir o software conforme os termos da licença.

Saiba mais sobre as permissões lendo o arquivo [LICENSE](LICENSE) ou em: https://www.gnu.org/licenses/quick-guide-gplv3.pt-br.html