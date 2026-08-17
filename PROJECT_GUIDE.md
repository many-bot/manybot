# Guia de projeto - ManyBot

> Gerado a partir do código-fonte, versão `5.7.0`
> (`package.json`). Referências `arquivo:linha` apontam para o snapshot
> analisado — confira o código atual antes de assumir que uma linha
> específica não mudou. Onde uma afirmação é minha inferência (não algo
> literalmente dito em comentário/doc do projeto), isso é marcado
> explicitamente como "inferência".

---

Sim, o project guide voltou, ebaaa

Eu tenho notado que tenho usado IA em muita coisa e estou perdendo a
capacidade de pensar criticamente e tomar decisões no projeto.

Para o projeto não morrer e virar só um AI slop, eu user engenharia
reversa na IA e pedi pra ela gerar esse documento explicando tudo.

Vou passar alguns dias/semanas estudando como esse projeto está
indo a ponto de eu conseguir explicar quase tudo.

Óbviamente que decisões de arquitetura foram eu, mas a parte de
escrever não é mais comigo, mas estou voltando para que seja.

Esse bloco é um texto totalmente escrito pelo autor do projeto, que
sim kk, é um humano.

Recomendo que leia junto comigo caso queira apoiar o projeto e
enxergue valor nele, você pode até mandar uma pull request
caso queira mexer em algo desse documento que considera importante
de entender.

---

## Como usar este documento

Seções 1–3 dão a visão estática (o que existe, quem depende de quem, por
quê). Seção 4 é sobre estado em tempo de execução — provavelmente a parte
mais importante para não se surpreender depois. Seção 5 são os fluxos
concretos (o que você provavelmente quer ler primeiro). Seções 6+ aprofundam
subsistemas específicos. A última seção tem perguntas para você testar se
entendeu.

---

## 1. O que é o projeto

Framework Node.js/TypeScript (`@manybot/manybot`, GPL-3.0, autor "SyntaxError!")
para construir bots de WhatsApp baseados em plugins.

- **Runtime:** Node >= 24, ESM puro (`"type": "module"`), TypeScript `strict`.
- **Escopo deliberado:** só WhatsApp — abstração genérica multi-plataforma
  (Telegram/Discord) foi explicitamente rejeitada como fora de escopo.
- **Multi-driver dentro do WhatsApp:** Baileys (produção, WebSocket) e
  WhatsMeow (experimental, subprocesso Go + gRPC), atrás do mesmo contrato.
- **Sem GitHub Actions:** CI/release rodam via git hooks no servidor do
  mantenedor (`hooks/post-receive` → `hooks/release.sh`).

---

## 2. Pontos de entrada

Todo processo real do bot nasce em `src/main.ts`, mas ele tem **quatro
caminhos de execução distintos** dependendo dos argv, e existem outros
pontos de entrada fora do processo principal:

| Entrada | Como dispara | O que faz | Carrega plugins? |
|---|---|---|---|
| `npm start` (padrão) | `node dist/main.js` sem flags | Boot normal: registra driver, conecta, roda o bot | Sim |
| `npm start -- --getid` | flag `--getid` | Sessão diagnóstica **separada** da do bot (auth dir próprio `${CLIENT_ID}-getid`), lista chats, copia JID pro clipboard | **Não** — sai antes do fluxo normal |
| `npm start -- --install-whatsmeow` | flag `--install-whatsmeow` | Roda só o instalador do binário WhatsMeow e sai | Não |
| Watcher de plugin/config | `fs.watch` interno, não é CLI | Hot-reload durante o processo já rodando (não é um "entry point" no sentido de processo novo, mas é onde código de terceiros entra no sistema depois do boot) | Recarrega plugin(s) específico(s) |
| `hooks/post-receive` | `git push` de uma tag `v*` no servidor do mantenedor | Dispara `hooks/release.sh` → build + cross-compile + publish | N/A (infra de release, não runtime do bot) |
| `scripts/smoke-whatsmeow*.mjs` | rodado manualmente/CI do mantenedor | Smoke test do subprocesso Go, fora do processo principal do bot | N/A |

O `--getid` é notável: ele abre uma **segunda sessão WhatsApp** (diretório de
auth diferente) só para navegar a lista de chats e descobrir JIDs — não
compete pelo "slot" da sessão principal do bot. Isso só funciona com o
driver **Baileys** hoje (`getIdFn` é lido diretamente de `baileysContract`,
não de `driverManager.get(...)`, justamente porque Baileys pode nem ser o
driver registrado quando `driver_primary = "whatsmeow"` — comentário
explícito em `main.ts:135-140`).

---

## 3. Mapa de módulos e responsabilidades

```
src/
  main.ts              → entry point (ver seção 2)
  config.ts             → carrega/normaliza config (4 arquivos possíveis)
  kernel/                → lógica central independente de driver
    waContract.ts        → interface que TODO driver implementa
    driverManager.ts      → registro do driver único ativo
    pluginLoader.ts        → carrega/observa/recarrega plugins
    pluginGuard.ts          → executa plugin com timeout + 3-strikes
    pluginApi.ts             → contrato TS do ctx passado a plugins
    commandRegistry.ts        → funde commands.yaml + defaults dos plugins
    commandsConfig.ts          → parser do commands.yaml
    commandPermissions.ts       → engine de permissões
    commandDeprecation.ts        → rastreia rename/remoção (SQLite)
    commandMenu.ts                → menu/help/manual
    sendGuard.ts                   → anti-detecção no envio
    contactAutoSave.ts              → salva contatos gradualmente
    settingsDb.ts                    → SQLite: settings por (plugin, chat)
    scheduler.ts                      → wrapper de node-cron persistido
    alerts.ts                          → alertas multi-sink
    statusServer.ts                     → HTTP JSON de status
    updateCheck.ts                       → checa versão via GitHub Releases
    integrationMode.ts / testConfig.ts    → gate p/ suíte de integração real
  drivers/
    baileys/            → driver de produção (WebSocket)
    whatsmeow/           → driver experimental (subprocesso Go + gRPC)
    jid.ts, types.ts     → utilitários e tipos compartilhados pelos 2 drivers
  client/                → estado persistente (store em memória + cache disco)
  i18n/, locales/         → traduções en/pt/es
  download/queue.ts       → fila sequencial p/ jobs pesados
  logger/                 → logger central
whatsmeow-service/       → serviço Go (gRPC) consumido pelo driver whatsmeow
hooks/, scripts/         → infra de release e smoke test (não é runtime do bot)
```

### A fronteira: `WaContract`

`src/kernel/waContract.ts` é a única porta entre o kernel e um driver
concreto. **O kernel nunca importa um driver diretamente**; código fora de
`src/drivers/` nunca deve tocar um socket cru. Isso é convenção reforçada
por `eslint-plugin-import-x` (detecta import circular) + revisão humana —
não existe barreira em runtime. Já regrediu uma vez (`hasBotMention`/
`getContact` voltaram a usar `sock.user` em vez de `contract.me()`),
documentado como invariante que já quebrou (`CONTRIBUTING.md`). Única
exceção legítima hoje: `rawSocketOf(contract)` dentro de
`getGroupMetadataCached()`.

---

## 4. Mapa de dependências (causal, não só "A importa B")

### `main.ts` → `driverManager` → `WaContract` → (`baileys` | `whatsmeow`)

`main.ts` precisa de `driverManager` porque `driverManager` é quem decide
**qual objeto concreto** vai representar "o WhatsApp" para o resto do
processo — isso é necessário porque todo o resto do kernel (`pluginLoader`,
`messageHandler`, `sendGuard`, `contactAutoSave`, `activeDriverSend`) foi
escrito contra a interface `WaContract`, não contra Baileys ou WhatsMeow
especificamente. Isso acontece **uma vez, no boot**: `main.ts` lê
`CONFIG.drivers.primary`, registra só esse driver como `isPrimary: true`, e
a partir daí `driverManager.active()` é a única fonte de verdade — não há
segunda tentativa depois disso (ver seção 9, "sem fallback").

### `pluginLoader` → `commandRegistry` → `commandsConfig` + `pluginRegistry`

`pluginLoader` precisa disparar `initCommandRegistry()` (de
`commandRegistry.ts`) toda vez que a lista de plugins ativos muda (load
inicial, hot-reload de plugin único, `syncPlugins()`), porque
`commandRegistry` **funde duas fontes** — os `commands` que cada plugin
exporta e o `commands.yaml` do usuário (via `commandsConfig.loadCommandsConfig()`)
— num único mapa de invocação (`byInvocation`). Isso é necessário para que
`messageHandler.ts` tenha, em `O(1)`, uma resposta à pergunta "que comando é
esse texto, de qual plugin, com que permissões" — que é o que acontece a
cada mensagem recebida com prefixo de comando (seção 5.2). Se
`initCommandRegistry()` não rodar depois de um hot-reload, o registry fica
com uma referência de `handler` para uma versão **antiga** do plugin (a
importação dinâmica de `loadPlugin` troca o módulo, mas o registry só
reflete isso na próxima reconstrução).

### `messageHandler` → `commandPermissions` → `config.OWNER_NUMBER` + `chat.isSenderAdmin()`

`messageHandler` precisa checar permissão **antes** de decidir se vai
disparar o handler novo do comando, porque a checagem de permissão pode
curto-circuitar a resposta (nega e para) sem nunca chamar o plugin. Isso
acontece **depois** do comando ser resolvido no registry mas **antes** do
fixed-text/deprecation/loop de plugins legados — ou seja, a ordem de
avaliação em `runPluginsForMessage()` não é arbitrária: permissão é checada
uma vez, cedo, e todo o resto do pipeline assume que já passou por ela para
aquele comando específico. `commandPermissions` por sua vez precisa de
`chat.isSenderAdmin()`/`chat.isBotAdmin()` (funções assíncronas vindas de
`buildApi`) porque scope `admin`/`botAdmin` não pode ser resolvido sem uma
chamada ao driver (metadata de grupo) — é por isso que `PermissionContext`
recebe essas checagens como **funções**, não como booleanos já resolvidos:
evita pagar o custo da chamada de rede quando o comando nem exige admin.

### `sendGuard` → `CONFIG.SECURITY_LEVEL` (lido a cada chamada, não cacheado)

`sendGuard` precisa reler `CONFIG.SECURITY_LEVEL` a cada `waitForSendSlot()`
(via `currentProfile()`) em vez de capturar o valor uma vez no boot, porque
isso é necessário para que uma mudança de `SECURITY_LEVEL` via
`manybot.toml` + hot-reload (`reloadConfig()`, disparado pelo watcher de
config em `pluginLoader.ts`) tenha efeito **imediato**, sem reiniciar o
processo — é o mesmo motivo pelo qual `CONFIG` é um objeto mutado in-place
(`Object.assign`) em vez de uma constante recriada (ver seção 6, "CONFIG").

### `pluginApi` (`ctx`) → `sendGuard` + `pluginGuard` — mas plugin nunca vê nenhum dos dois

Todo `ctx.send.*`/`ctx.msg.reply.*` que um plugin chama passa por
`sendGuard.waitForSendSlot()` **antes** de ir para o driver — isso é
necessário para que a política anti-detecção (seção 8) seja aplicada de
forma uniforme, **sem que o autor do plugin precise saber que ela existe**.
Da mesma forma, todo `run(ctx)`/`handler(ctx, input)` de plugin é chamado
através de `pluginGuard.runPlugin()`, nunca diretamente pelo
`messageHandler` — necessário para que timeout e 3-strikes sejam
garantidos **mesmo que o autor do plugin não trate erros**. Consequência
prática: um plugin mal-comportado não consegue contornar nem o throttle de
envio nem o isolamento de falha, porque ele nunca tem acesso direto ao
driver nem é chamado fora do guard.

### `commandDeprecation` e `settingsDb` → mesmo arquivo SQLite, handles separados

`commandDeprecation.ts` reutiliza o mesmo `DB_PATH` (`~/.manybot/settings.db`)
que `settingsDb.ts`, mas abre seu **próprio** `DatabaseSync` em escopo de
módulo, em vez de importar o handle de `settingsDb.ts`. Isso é possível
porque SQLite com WAL (`PRAGMA journal_mode = WAL`, setado em
`settingsDb.ts`) suporta múltiplas conexões no mesmo arquivo com segurança —
o comentário no código confirma que isso é intencional, não uma dependência
oculta acidental. Vale notar: se `settingsDb.ts` mudar o `journal_mode` ou o
`DB_PATH` no futuro, `commandDeprecation.ts` **não vai saber** — não há
import entre os dois arquivos, só a convenção de "mesmo caminho".

### `client/cache.ts` → `client/store.ts`, mas só em uma direção (merge, nunca leitura)

`client/cache.ts` precisa de `store.hydrate()` (não de um setter genérico)
porque isso é necessário para garantir a regra "cache nunca sobrescreve,
só complementa" — uma sessão já pareada não recebe ressincronização
completa de histórico ao reconectar (só uma fatia parcial), então se o
cache em disco pudesse *substituir* o store em memória, uma reconexão
poderia **apagar** chats que só existiam na sessão anterior. `hydrate()` é
a única porta de entrada de dados externos para dentro do `store` que
respeita essa regra — é por isso que ela existe como função dedicada em vez
de o cache simplesmente popular o Map diretamente.

### `updateCheck.ts` / `whatsmeow/installer.ts` → GitHub API, nunca `registry.npmjs.org`

Os dois módulos precisam ler `api.github.com/repos/many-bot/manybot/releases/latest`
em vez do registro npm porque isso é necessário dado como o release
funciona: tags `-rc.N` **pulam publicação no npm inteiramente**, e releases
estáveis ficam em `staged` até aprovação manual com 2FA — nesses dois casos
o npm mentiria (diria "não há versão nova" quando há, ou diria isso com
atraso). Essa é uma invariante documentada explicitamente em
`CONTRIBUTING.md` porque **já foi feito errado antes** (senão não precisaria
estar escrito como regra).

---

## 5. Decisões internas — por que as coisas são como são

Cada item abaixo é uma decisão que, se você não soubesse o motivo, poderia
"corrigir" por engano.

- **Por que existe `WaContract` em vez de cada módulo importar Baileys
  direto?** Porque o projeto sustenta dois backends (Baileys e WhatsMeow)
  simultaneamente no mesmo código-fonte, e a alternativa (cada consumidor
  sabendo qual driver está ativo) explodiria em `if (driver === "baileys")`
  espalhados. O contrato empurra essa decisão para um único lugar
  (`driverManager`).
- **Por que não existe abstração para Telegram/Discord também?** Decisão de
  escopo explícita, não limitação técnica — "WhatsApp-first by design"
  (registrado em memória de conversas anteriores sobre este projeto). O
  `WaContract` já seria o lugar óbvio para estender, mas o projeto optou
  por não pagar esse custo de generalidade agora.
- **Por que o fallback automático entre drivers foi removido?** Foi
  implementado, usado, e depois **revertido** — o `CHANGELOG.md` registra o
  motivo nas palavras do próprio projeto: *"sound on paper but introduced
  complexity and reliability issues in practice"*. Ou seja: não é que
  ninguém tivesse pensado nisso — foi tentado e descartado por experiência
  real, não por falta de tentativa. Ver seção 9 para o estado atual.
- **Por que `sendGuard` existe e é tão elaborado (token bucket + cooldown +
  jitter + gate de concorrência, tudo escalando por `SECURITY_LEVEL`)?**
  Porque o projeto **já sofreu bloqueio de conta** no passado (nota de risco
  explícita em `TEST_REVIEW.md` sobre a suíte de `sendGuard`). Não é
  engenharia especulativa — é resposta a um incidente real. Isso também
  explica por que `contactAutoSave.ts` existe como mecanismo *separado* de
  `sendGuard`: os dois atacam o mesmo problema (parecer um humano, não um
  bot automatizado) por ângulos diferentes (timing de envio vs. grafo
  social de contatos).
- **Por que SQLite (`node:sqlite`) em vez de arquivo JSON ou outro banco?**
  Não documentado explicitamente no código — **inferência**: `node:sqlite`
  é nativo do Node >= 22 (sem dependência externa), suporta WAL para
  múltiplas conexões concorrentes (usado por `settingsDb` e
  `commandDeprecation` no mesmo arquivo), e o volume de dados (settings por
  chat, histórico de comandos) é pequeno o bastante para não precisar de um
  banco de verdade. Isso é razoável dado o resto do projeto (poucas
  dependências externas, preferência por primitivas nativas), mas não está
  escrito em lugar nenhum como decisão consciente — vale confirmar com o
  mantenedor se quiser ter certeza.
- **Por que `commands.yaml` é uma migração incremental de 8 etapas em vez
  de reescrever o roteamento de uma vez?** Porque a base de plugins
  existente depende do modelo legado (`run(ctx)` chamado em toda mensagem,
  decidindo sozinho se age) — trocar de uma vez quebraria todo plugin de
  terceiro que não fosse migrado junto. O modelo aditivo (seção 10) permite
  plugin migrado e não-migrado coexistirem na mesma versão do bot.
- **Por que cooldown de comando é `Map` em memória, não persistido?**
  Decisão explícita do responsável pelo projeto (registrada em conversas
  anteriores) — resetar cooldowns a cada restart foi aceito como
  comportamento correto, não como limitação a corrigir depois.
- **Essencial vs. conveniência — como diferenciar no código:**
  - **Essencial** (removê-lo muda o comportamento observável ou quebra uma
    invariante de segurança): `WaContract`, `sendGuard`, `pluginGuard`,
    dedup de mensagem por `msg.id` em `messageHandler.ts`, o gate de
    `MANYBOT_RUN_WHATSAPP_TESTS=1` em `integrationMode.ts`.
  - **Conveniência** (existe para produtividade/ergonomia, mas o sistema
    funcionaria sem, só pior de usar): `commandMenu.ts` (ajuda formatada),
    `updateCheck.ts` (aviso de versão nova), `statusServer.ts` (endpoint de
    status), `clipboard.ts` (copiar JID do `--getid`), hot-reload de plugin
    (sem ele, funcionaria com `npm run build && npm start` manual).

---

## 6. Estado — onde vive, quem modifica, ciclo de vida, condições de corrida

Este é provavelmente o ponto mais importante para entender antes de mexer
no código: quase todo o kernel usa **estado de módulo** (variáveis `let`/
`const Map` no topo do arquivo), não classes instanciadas por request. Um
processo = um bot = um conjunto de módulos com estado compartilhado global.

| Estado | Onde vive | Quem escreve | Ciclo de vida | Risco de corrida |
|---|---|---|---|---|
| `pluginRegistry` | `Map` exportado em `pluginLoader.ts:54` | `loadPlugin`, `reloadPlugin`, `syncPlugins` | Populado no boot, mutado a cada hot-reload; nunca limpo entre plugins (só por chave) | Leitura concorrente durante escrita: `messageHandler` itera `pluginRegistry.values()` enquanto um hot-reload pode estar no meio de `pluginRegistry.set(...)` em outra micro-task — `Map` do JS é seguro para isso a nível de estrutura (não corrompe), mas o plugin pode ser trocado **no meio** do processamento de uma mensagem que já começou a ser roteada para a versão antiga |
| `currentSock` / `currentStore` / `currentAdapter` | `let` em `drivers/baileys/index.ts:51-53` | `startBot()` a cada (re)conexão | Recriado a cada reconnect; o `sock` antigo é "teardown" (`removeAllListeners` + `.end()`) antes do novo assumir | Entre `teardownSock(previousSock)` e `currentSock = sock` (linhas 198-201) há uma janela onde `currentSock` ainda aponta pro socket antigo já desligado — qualquer código async que capturou `currentSock` antes dessa troca pode operar sobre um socket morto |
| `chatQueues` | `Map<jid, Promise>` em `drivers/baileys/index.ts:68` | `enqueueForChat()`, a cada mensagem recebida | Entrada criada sob demanda, removida no `finally` quando a fila daquele chat esvazia | Baixo risco — é justamente o mecanismo que *evita* corrida entre mensagens do mesmo chat. Mas não protege contra o problema de `currentSock` acima, porque a fila serializa por `jid`, não por socket |
| `seenMessageIds` | `Map<id, timestamp>` em `messageHandler.ts:53` | `alreadyProcessed()` | TTL de 10min, limpeza **lazy** (só varre no momento de uma nova checagem, não em timer) | Cresce sem limite entre chamadas se o bot ficar muito tempo sem receber mensagem alguma (limpeza só roda quando algo chega) — impacto baixo na prática, mas é uma escolha de design (lazy vs. timer) que vale saber |
| `lastProcessedAt` | `Map<jid, timestamp>` em `messageHandler.ts:34` | Bloco de debounce em `handleMessage` | **Nunca populado de fato hoje** — `INCOMING_DEBOUNCE_MS = 0`, então o `if (INCOMING_DEBOUNCE_MS > 0)` nunca entra | Nenhum — é efetivamente código morto/desligado (ver seção 12) |
| `cooldownMap` | `Map<string, number>` em `commandPermissions.ts:33` | `checkPermission()` ao consumir cooldown | Em memória, resetado a cada restart do processo (decisão explícita, seção 5) | Chave provavelmente `command+sender` — duas mensagens quase simultâneas do mesmo remetente para o mesmo comando podem ler o cooldown antes de qualquer uma escrever (não há lock); mitigado na prática porque `messageHandler` já serializa por chat via `chatQueues`, mas **não** serializa por remetente entre chats diferentes (ex. mesmo usuário em dois grupos) |
| `currentRegistry` | `let` em `commandRegistry.ts:329` | `initCommandRegistry()` | Reconstruído inteiro (não incremental) a cada load/reload de plugin ou config | Leitura (`getCommandRegistry()`, `getCommandByInvocation()`) durante uma mensagem em andamento pode pegar a versão antiga ou nova dependendo do timing do hot-reload — não há transação |
| `driverManager` (instância) | Singleton em `driverManager.ts:93-98` (`instance` module-level) | `getDriverManager()` (lazy init), `register()` só chamado por `main.ts` | Vive por todo o processo; `_resetDriverManagerForTests()` existe só para testes | Re-registrar o mesmo nome **não desconecta a instância antiga automaticamente** — quem chama `register()` de novo é responsável por desconectar primeiro (documentado no cabeçalho do arquivo) |
| `CONFIG` | Objeto exportado em `config.ts:574`, mutado via `Object.assign` em `reloadConfig()` | `reloadConfig()`, chamado pelo watcher de config em `pluginLoader.ts` | Criado uma vez no import do módulo; **mutado in-place** depois, nunca recriado — é por isso que `PLUGINS`/`CHATS`/`EXCLUDE_CHATS` (arrays exportados separadamente) também são mutados in-place (`.length = 0` + `.push(...)`) em vez de reatribuídos: um `export const PLUGINS = CONFIG.PLUGINS` captura a *referência* do array, então só mutação in-place propaga para quem já importou `PLUGINS` antes do reload | Documentado no próprio código como "race condition teórica... não testável sem concorrência real" (`config.test.ts`, citado em `TEST_REVIEW.md`) — dois `reloadConfig()` disparados quase ao mesmo tempo (ex. dois eventos de `fs.watch` em sequência rápida, mesmo com debounce de 500ms) podem intercalar mutações |
| `status` | `let` em `statusServer.ts:17` | `setStatus()` | Resetado por teste (`afterEach`), não pelo runtime normal | Documentado como bug latente (não corrigido): `getStatus()` retorna `status` **por referência**; se `setStatus()` reatribuir o objeto no meio de um `JSON.stringify()` de outra request HTTP concorrente, em teoria a resposta pode misturar estado antigo e novo — não testado |
| Estado do driver Baileys (`state`, `reconnectAttempts`, `halted`, etc.) | `let`s em `drivers/baileys/index.ts:49-60` | Handlers de `connection.update`, `startBot()`, `scheduleReconnect()` | Máquina de estados informal (`"BOOT" → "READY_INIT" → "READY"`, ou `"BOOT"` de novo em disconnect) | Ver seção 12 — os ramos que chamam `process.exit(1)` deixam código de limpeza subsequente morto, o que é mais sobre fluxo de controle do que corrida propriamente dita |
| `store` (chats/contatos/mensagens em memória) | Fábrica `createStore()` em `client/store.ts`, instância compartilhada `sharedStore` em `baileysSock.ts` | Handlers de evento do socket (`chats.upsert`, `messages.upsert`, etc.) via closures internas | Um único store sobrevive a reconexões (não é recriado por `startBot()`) — é por isso que `client/cache.ts` existe: sem persistir em disco, um *restart do processo* (não reconexão) perderia tudo | `learnLid`/`resolveJid`/`forgetLid` (mapeamento `@lid`↔JID real) não têm teste algum (`TEST_REVIEW.md`) — uma regressão de merge concorrente aqui não seria pega automaticamente |
| `settings.db` (SQLite) | Arquivo em disco (`~/.manybot/settings.db`), WAL habilitado | `buildSettingsApi()` (plugins nunca tocam direto) + `commandDeprecation.ts` (handle separado) | Persiste entre restarts, por design | WAL permite múltiplos leitores/um escritor concorrentes com segurança a nível de SQLite — mas duas conexões (`settingsDb` e `commandDeprecation`) não têm transação compartilhada, então uma operação que devesse ser atômica entre as duas tabelas (nenhuma hoje, mas seria fácil introduzir) não seria de fato atômica |

**Padrão geral que vale internalizar:** quase todo módulo do `kernel/` é
"singleton por import" — o próprio módulo ES é o singleton (variável no
top-level do arquivo), não uma classe instanciada explicitamente. Isso
funciona bem para um processo único de bot, mas significa que **não há
isolamento entre "instâncias"** — só existe uma instância possível por
processo Node. Se algum dia o projeto precisasse rodar múltiplos bots no
mesmo processo, praticamente todo `kernel/*.ts` precisaria ser refeito para
não depender de estado de módulo.

---

## 7. Fluxos concretos

### 7.1 Inicialização (boot)

1. `main.ts` ajusta `NODE_PATH` e reinicializa a resolução de módulos
   (necessário por causa de como o pacote é instalado globalmente vs. em
   dev — não documentado em detalhe, mas é a primeira coisa que roda).
2. Lê `CONFIG.drivers.primary` (com override de teste via
   `WA_TEST_DRIVER`), decide **um único driver**:
   - `"whatsmeow"` → checa `driver_whatsmeow_enabled`; se falso, `exit(1)`
     imediatamente. Senão, `startWhatsmeowSupervisor()` (spawna o
     subprocesso Go, espera `HealthCheck{ready:true}`); se o supervisor
     falhar ao subir, `exit(1)` — **sem tentar Baileys**.
   - `"baileys"` (default) → registra direto, loga aviso informativo de
     "depreciação futura sendo considerada" (sem prazo, sem flag de config
     associada — é só um aviso).
3. `driverManager.register(contract, { isPrimary: true })` → esse é o
   momento em que `driverManager.active()` passa a responder.
4. Listeners globais de processo são registrados
   (`uncaughtException`/`unhandledRejection`/`SIGTERM`/`SIGINT`) — **antes**
   de conectar, então até um erro durante `connect()` já é capturado pelo
   handler de shutdown.
5. Se não é `--getid` nem `--install-whatsmeow`: `startStatusServer()`
   (se habilitado) e `activeDriver.connect()`.
6. **Dentro do driver Baileys** (`connect()` → `startBot()`):
   - Hidrata o store a partir do cache em disco (`hydrateFromCache`, roda
     uma vez só — `cacheHydrated` guarda isso).
   - Cria o socket (`createSocket()`), monta o adapter (`WaContract`).
   - Registra o handler de `connection.update`. **Só quando
     `connection === "open"`** é que `loadPlugins(PLUGINS)` +
     `setupPlugins(contract, store)` rodam — ou seja, **plugins nunca veem
     um driver desconectado**; o `PluginContext` só existe depois que a
     conexão está de fato aberta.
   - Depois de `open`: inicia autosave de cache (a cada 5min), sweep de
     refresh de contatos (a cada 6h), agendamento de `updateCheck`.
   - Espera mais 2s antes de marcar `state = "READY"` — comentário
     explícito: buffer contra mensagens "fantasma" de replay/sync que
     chegam logo após `open`.
7. **Dentro do driver WhatsMeow:** o supervisor precisa responder
   `HealthCheck{ready:true}` antes de `wrapWithSupervisor` liberar a
   conexão — evita que chamadas cheguem a um subprocesso ainda sem SQLite/
   auth prontos.

### 7.2 Mensagem recebida → resposta (o fluxo mais importante)

1. Baileys emite `messages.upsert` → adapter traduz `WAMessage` →
   `BotMessage` neutro → republicado via `contract.on("messages.upsert")`.
2. `drivers/baileys/index.ts` filtra por `state === "READY"`, ignora tipos
   que não sejam `"notify"`/`"append"`, descarta mensagens com mais de 60s
   (calculado na chegada, não após espera em fila), e **enfileira por
   chat** (`enqueueForChat`) — mesmo chat processa em ordem, chats
   diferentes rodam em paralelo.
3. `handleMessage()` (`messageHandler.ts`):
   - Filtra por `CHATS`/`EXCLUDE_CHATS`.
   - Deduplica por `msg.id` (TTL 10min) — WhatsApp reenvia até 3x em
     reconexão sem confirmação.
   - Marca como lida (best-effort).
   - Constrói `chat` e `msgCtx` (já resolve prefixo/args).
   - Dispara `trackIncomingForContactSave` fire-and-forget.
   - Adquire slot de concorrência do `sendGuard` (`acquireChatSlot`).
4. `runPluginsForMessage()` — roteamento, nesta ordem estrita:
   1. **Alias de menu** (`help`/`man`/`menu`/`bot`/`?`) → responde, para.
   2. **Comando no registry** → checa permissão; negado = responde erro
      e para.
   3. **Fixed-text** (só `commands.yaml`, sem plugin) → responde literal,
      para. Nenhum plugin é chamado.
   4. **Nome deprecado** → notifica, para. **Não redireciona** para o novo
      nome nem cai no fluxo legado (decisão de design explícita).
   5. **Loop sobre TODOS os plugins ativos** — cada um roda em **toda**
      mensagem que passou pelos filtros acima, decide sozinho se age
      (modelo legado). Se o plugin migrado bateu no registry, usa o
      handler novo em vez do `run(ctx)` legado (evita disparo duplo).
   6. **Fallback "not found"** — só se havia `command` reconhecível, nada
      bateu, e `menu.notFoundFallback` habilitado (default `false`); roda
      depois de todos os plugins legados, então um deles ainda pode ter
      respondido também.
5. Qualquer envio de resposta passa por `sendGuard.waitForSendSlot()`
   antes de chegar ao driver.

### 7.3 Shutdown

Disparado por `SIGTERM`/`SIGINT`, `uncaughtException`, `unhandledRejection`,
ou por um driver que decide `process.exit(1)` diretamente (ver seção 12 —
isso pula parte deste fluxo).

1. `shutdown(reason, isError)` em `main.ts` — guardado por `shuttingDown`
   (idempotente, só roda uma vez).
2. Se `isError`: loga erro + tenta `sendAlert({level: "critical", ...})`
   (com try/catch próprio, "belt-and-suspenders" — mesmo que `sendAlert`
   já engula falhas de sink internamente).
3. `cleanupPlugins()` — fecha watchers, chama `exports.events.cleanup()`
   de cada plugin (erro é logado, não propagado).
4. `stopScheduler()` — para todos os cron jobs.
5. `driverManager.shutdown()` — desconecta drivers em **ordem reversa de
   registro**, engolindo erros por driver (um driver teimoso não trava o
   shutdown dos outros nem do processo).
6. Fallback extra: se `supervisor` (WhatsMeow) existe mas não foi
   registrado no `driverManager` (ex. binário faltando), chama
   `supervisor.shutdown()` diretamente — "belt-and-suspenders" de novo.
7. `process.exit(isError ? 1 : 0)`.

Dentro do driver Baileys especificamente, `disconnect()` também: para
autosave de cache e sweep de contatos, salva o cache em disco uma última
vez (`saveChatCache`), desliga o socket (`teardownSock`).

### 7.4 Tratamento de erros (consolidado)

Existem **quatro camadas independentes** de tratamento de erro, cada uma
para um tipo de falha diferente — não é um sistema único:

- **Nível processo** (`main.ts`): `uncaughtException`/`unhandledRejection`
  → `shutdown(reason, true)` → alerta crítico + `exit(1)`. Última linha de
  defesa; se chegou aqui, algo vazou de todas as camadas abaixo.
- **Nível plugin** (`pluginGuard.runPlugin`): try/catch em volta de toda
  chamada a `run(ctx)`/`handler(ctx, input)`. Timeout de 120s conta como
  erro. 3 falhas consecutivas → `status: "error"`, plugin passa a ser
  pulado silenciosamente (sem novo alerta automático além do log). Menos
  de 3 → reload automático fire-and-forget.
- **Nível driver/conexão** (`drivers/baileys/index.ts`, handler de
  `connection.update` com `connection === "close"`): distingue
  `loggedOut`/`badSession` (sessão inválida) de `restartRequired` (515,
  drift de protocolo) de reconexão comum — cada um com sua própria
  política de retry/backoff/circuit breaker (ver detalhes e o problema de
  código morto na seção 12).
- **Nível comando/permissão** (`checkPermission` em `messageHandler.ts`):
  não é bem um "erro" — é uma negação estruturada
  (`{allowed: false, message}`) que vira resposta ao usuário, nunca uma
  exceção lançada.

Todas as camadas compartilham `sendAlert()`/`fireAlert()` de `alerts.ts`
como canal de notificação externa opcional (seção 7.6), mas cada uma decide
por conta própria **quando** vale a pena alertar.

### 7.5 Persistência (consolidado)

Quatro mecanismos de persistência, cada um para um propósito diferente —
não existe uma camada de "banco de dados" única:

| Mecanismo | Onde | O quê | Por quê separado dos outros |
|---|---|---|---|
| `settings.db` (SQLite) | `~/.manybot/settings.db` | Settings arbitrários por `(plugin, chat)` + agrupamento de chats em "community" | Dados estruturados, consultados por chave — SQLite com PK composta é o encaixe natural |
| `commandDeprecation` (SQLite) | Mesmo arquivo, handle separado | Histórico de `id→cmd` e deprecations ativas | Reusa o arquivo por conveniência (WAL permite), mas é logicamente um domínio diferente — não haveria motivo pra misturar tabelas de plugin settings com tabelas de roteamento de comando |
| `client/cache.ts` | `~/.manybot/` (snapshot serializado) | Chats/contatos/lidMap do `store` em memória | Não é "banco" — é um snapshot de conveniência para sobreviver a *restart do processo* (reconexão dentro do mesmo processo já mantém o store vivo). Merge é sempre união, nunca substituição |
| `manybot.toml`/`manyplug.toml` | `~/.manybot/` | Configuração do usuário | Editável a mão; `persistConfigValue()` faz edição pontual preservando comentários/resto do arquivo, em vez de serializar o objeto inteiro de novo |

`config.persistConfigValue()` merece nota: ele atualiza o `CONFIG` em
memória **e** reescreve a linha correspondente no arquivo TOML no disco,
mas documenta explicitamente uma limitação — `export const CLIENT_ID = ...`
e similares são primitivos capturados no load do módulo, então só refletem
o valor novo após **restart do processo**; código que precisa do valor
atualizado na mesma execução (ex. o próprio fluxo de login interativo) deve
ler `CONFIG.<CHAVE>` diretamente, não a constante exportada.

### 7.6 Comunicação externa

- **WhatsApp** — a própria "comunicação externa" central do bot, mediada
  inteiramente pelo `WaContract` ativo (WebSocket para Baileys, gRPC→
  subprocesso Go→biblioteca whatsmeow para o outro driver).
- **`alerts.ts`** — "local-first": arquivo em disco
  (`~/.manybot/alerts.log`) é o único sink garantido. Notificação OS
  (`notify-send`/`osascript`), WhatsApp (`ADMIN_JID`) e e-mail (SMTP) são
  best-effort, cada um condicionado a pré-requisitos próprios (processo
  vivo, socket conectado, SMTP configurado). Motivação explícita no
  cabeçalho do arquivo: o sink mais provável de falhar é justamente o
  WhatsApp do próprio bot — exatamente quando o alerta é mais necessário.
- **`statusServer.ts`** — HTTP JSON read-only, sem autenticação, sem
  rotas reais (qualquer path/método responde igual), CORS aberto mas sem
  preflight correto (ver seção 12).
- **`updateCheck.ts`** — GET periódico para `api.github.com/repos/
  many-bot/manybot/releases/latest` (nunca o registro npm — seção 4).
- **`whatsmeow/installer.ts`** — mesmo padrão de GitHub Releases, mas para
  baixar o **binário** do subprocesso Go sob demanda (não vem via
  `npm install`).

### 7.7 Plugins, drivers, fallback — referência cruzada

Estes três fluxos têm seção própria mais adiante porque são grandes o
bastante para merecer detalhamento dedicado:

- Ciclo de vida de plugin (load/hot-reload/sync/cleanup) → seção 8.
- Seleção de driver e o histórico do fallback removido → seção 9.
- Anti-detecção no envio → seção 10.

---

## 8. Sistema de plugins

### Ciclo de vida (`kernel/pluginLoader.ts`)

- Plugins vivem em `~/.manybot/plugins/<nome>/`, com manifest
  `manyplug.json` apontando o entrypoint.
- `loadPlugin(name)` importa dinamicamente, exige `export default` função —
  senão falha o load inteiro do plugin.
- Exports opcionais por convenção: `setup(ctx)` (roda uma vez após
  conectar), `commands` (sistema novo, seção 11), `api` (exports públicos
  para outros plugins via `ctx.plugins.require()`), `guardOptions`
  (opt-out de timeout/typing).
- **Hot reload:** `fs.watch` recursivo manual por diretório de plugin
  (debounce 500ms) — **não** usa `{recursive: true}` porque no Linux isso
  abriria um inotify watch por subdiretório, e um plugin com seu próprio
  `node_modules` pode estourar `fs.inotify.max_user_watches` (ENOSPC).
  `IGNORED_WATCH_DIRS` filtra isso, mas **sem teste** (seção 13).
- **Isolamento de falhas:** cada plugin tem `errorCount`. Falha durante
  `run(ctx)` incrementa e agenda `reloadPlugin()` fire-and-forget; 3 falhas
  consecutivas → `status: "error"`, pulado silenciosamente por
  `runPlugin` — sem alerta automático além do log.

### `pluginGuard.ts` — a rede de segurança

Toda chamada a um plugin passa por `runPlugin`, que aplica timeout de 120s
(opt-out via `guardOptions.timeout = false`), try/catch universal, e
3-strikes → auto-disable.

**Bug documentado, não corrigido de propósito:** a mensagem de timeout é
`` `[${pluginName}] timed out after ${ms}ms` ``, mas o check é
`error.message?.startsWith("timed out")` — nunca bate por causa do prefixo
`[pluginName]`. `isTimeout` é **sempre `false`**, então o stack trace nunca
é omitido em timeouts (o pretendido era omitir). O time documentou em vez
de corrigir; o teste tem comentário `KNOWN BUG` e vai precisar ser
invertido quando alguém corrigir o check.

---

## 9. Multi-driver: Baileys vs WhatsMeow

### O contrato

Superfície grande (~30 métodos): lifecycle, envio de todos os tipos de
mídia, reação/edição/deleção, presence/leitura, contatos, grupos, perfil
do bot, download de mídia, `getHistory`, `resolveLid`, `on(event, handler)`
genérico.

### Estado atual: seleção mutuamente exclusiva, sem fallback

Decisão **recente** (revertida em 13–14/08, praticamente no momento deste
snapshot):

- Havia um plano ativo de promover WhatsMeow a driver primário com
  fallback automático Baileys↔WhatsMeow durante a transição
  (`WHATSMEOW_MIGRATION_PLAN.md`, `MIGRATION_STATUS.md`).
- **Abandonado.** `CHANGELOG.md`: *"The idea was sound on paper but
  introduced complexity and reliability issues in practice."*
- Hoje: `main.ts` registra **um único driver** no boot. Se falhar ao
  subir, **o processo termina com erro** — sem troca silenciosa.
- **Documentação obsoleta encontrada:** o cabeçalho de
  `src/drivers/whatsmeow/supervisor.ts` ainda descreve o comportamento
  antigo (*"ManyBot keeps running on Baileys alone"*) — não é mais
  verdade, o comentário não foi atualizado junto com a mudança.

### Paridade de implementação do WhatsMeow (real, não "decidido")

Só a **Fatia 0** (parcial) está de pé:
- **Go:** só `Connect`, `Disconnect`, `HealthCheck`, `SubscribeEvents`,
  `VerifySent`, `GetHistory`, `SendText`. Resto retorna
  `codes.Unimplemented`.
- **Node** (`client.ts`): espelha isso — só `connect`, `disconnect`,
  `sendText`, `getHistory` wired. `resolveLid` é stub (sempre `null`).
- `driver_primary = "whatsmeow"` em produção hoje = bot que só manda texto
  e lê histórico; tudo mais falha com erro explícito, não silenciosamente.
- **`sendGuard.ts` só protege o caminho Baileys** — risco transversal
  documentado: promover WhatsMeow sem portar essa camada é abrir mão da
  proteção contra ban.
- Sem binário macOS/darwin ainda — `TARGETS`
  (`scripts/build-whatsmeow-release.mjs`) e `SUPPORTED`
  (`installer.ts`) cobrem só `linux-x64`, `linux-arm64`, `windows-x64`, e
  precisam ficar em sync manualmente (invariante documentada).

### `driverManager.ts` — pontos de atenção

Singleton simples, sem fallback por design. Re-registrar o mesmo nome
**não desconecta a instância antiga automaticamente**. `shutdown()`
desconecta em ordem reversa, engolindo erros.

---

## 10. Anti-detecção — `sendGuard.ts` e `contactAutoSave.ts`

Camada crítica: **"projeto já sofreu bloqueio de conta"** (nota de risco em
`TEST_REVIEW.md`). Histórico real, não preocupação teórica.

Protege todo envio, escalando com `SECURITY_LEVEL`:

| Perfil | msg/s global | cooldown/chat | jitter | concorrência de chats |
|---|---|---|---|---|
| low | 8 | 100ms | 30–120ms | ilimitada |
| medium | 5 | 150ms | 50–200ms | 2 |
| high | 2 | 400ms | 150–500ms | 1 |

Mecanismos: token bucket global, cooldown por chat, jitter humano, gate de
concorrência (chats *diferentes* respondidos ao mesmo tempo — global, não
por chat), simulação de "digitando…"/"gravando áudio…" proporcional ao
texto (cap por perfil).

`contactAutoSave.ts` complementa: salva contatos gradualmente (DM e grupo
contam separado; em grupo só mensagens que invocam o bot contam, para não
vazar membros silenciosos).

**Cobertura de teste é reconhecidamente fraca apesar do risco alto** — os
testes de `sendGuard` desligam justamente `cooldown`/`jitter` e testam só
"não quebra". O mesmo padrão se repete em `pluginApi.test.ts` — uma
regressão na integração `pluginApi` ↔ `sendGuard` real não seria pega hoje.

---

## 11. Sistema de comandos (`commands.yaml`) — redesign em andamento

Migração incremental (8 etapas, aditiva) do modelo "todo plugin decide
sozinho" para um registry central com identidade, permissões e deprecation
geridos fora do código do plugin.

**Estado real das etapas:**

| Etapa | Conteúdo | Status |
|---|---|---|
| 1–4 | `PluginEntry.commands`, parser YAML, merge no registry, roteamento real (com fallback pro `run(ctx)` legado) | ✅ feito |
| 5 | Rename/deprecation tracking (SQLite) | ✅ feito |
| 6 | Engine de permissões | ✅ feito |
| 7 | Menu/fallback | 🔶 parcial |
| 8 | — | não iniciado |

**Decidido no design, confirmadamente ausente do código hoje:**
- `subcommands:` (sub-comandos aninhados por plugin) — não existe.
- `group:` (agrupar comandos sob um item de menu) — idem.
- `menu.welcomeMessage` — não implementado.
- `hideOutOfScope` — descartado explicitamente (sem menu completo ainda).

### Ordem de avaliação de permissões (`commandPermissions.ts`)

Fixa: `owner → scope (group/dm/any) → blacklist → whitelist → botAdmin →
admin → cooldown` (cooldown só consumido se tudo antes passar). Blacklist/
whitelist por comando **substitui** a lista global (não aditivo). Cooldown
não é persistido (decisão explícita, seção 5).

### Deprecation (`commandDeprecation.ts`)

Rename/remoção detectado por mudança de `cmd` associado a um `id` estável,
registrado em SQLite. Invocação do nome antigo dentro da janela
(`notifyPeriodDays`, default 7) recebe aviso e **para ali** — sem
redirecionar, sem cair no legado.

---

## 12. Código que merece atenção

### 12.1 Partes complexas

- **`runPluginsForMessage()`** (`messageHandler.ts`) — seis ramos de
  decisão em sequência (menu/comando+permissão/fixed-text/deprecation/loop
  legado/fallback), cada um podendo curto-circuitar o resto. Fácil
  introduzir um bug de ordem ao adicionar um sétimo ramo.
- **Máquina de estados de conexão do Baileys** (`drivers/baileys/index.ts`,
  handler de `connection.update`) — combina três eixos independentes
  (código de desconexão, contador de tentativas, contador de
  `restartRequired`) em um único bloco `if/else if` grande.
- **`config.ts` `normalize()`** — coerção de tipo para ~15 chaves
  diferentes, cada uma com sua própria regra de fallback; fácil esquecer
  uma checagem ao adicionar chave nova (o `[key: string]: unknown` da
  interface `Config` permite isso passar batido no `tsc`).

### 12.2 APIs pouco óbvias

- **`ctx.send.*` / `ctx.msg.reply.*` retornam um "thenable chainable"**
  (`MessageHandle`) — pode ser usado com `await` direto ou encadeado com
  `.to()`/`.pin()`/`.delete()`. `TEST_REVIEW.md` nota que só o caminho
  `.to()` tem teste; uso direto como thenable (`.then`/`.catch`/`.finally`
  sem `.to()`) não tem cobertura.
- **`guardOptions`** — não é um objeto tipado estritamente documentado em
  um único lugar; hoje só `timeout` e `typing` são lidos, mas a forma
  (`Record<string, unknown>`) permite qualquer chave sem erro de tipo.
- **`resolvePermissions()`** em `commandRegistry.ts` — precedência de 5
  níveis (spec da invocação > spec da mensagem de erro > default do plugin
  > defaults globais > mensagem hardcoded via i18n) só é óbvia lendo a
  função inteira; não há um diagrama ou comentário curto que resuma a
  ordem no topo do arquivo.

### 12.3 Padrões que você provavelmente não conheceria

- **Estado de módulo como singleton** (seção 6) — se você vem de um
  background mais orientado a classes/DI, o padrão "o módulo ES *é* a
  instância" pode surpreender: não há como ter duas instâncias de
  `pluginRegistry` no mesmo processo, por construção.
- **`export const X = CONFIG.X` capturando referência, não valor** — em
  `config.ts`, arrays exportados (`PLUGINS`, `CHATS`, `EXCLUDE_CHATS`) são
  mutados in-place (`.length = 0; .push(...)`) especificamente para que
  quem já fez `import { PLUGINS } from "#config"` continue vendo as
  mudanças depois de um `reloadConfig()`. Reatribuir esses exports
  quebraria silenciosamente todo import anterior.
- **Import dinâmico dentro de uma função para evitar dependência
  circular** (`pluginGuard.ts:100`, `import("#kernel/pluginLoader.js").then(...)`
  em vez de import estático no topo) — padrão deliberado para quebrar um
  ciclo `pluginLoader → pluginGuard → pluginLoader`.
- **Alias `#kernel/*`, `#drivers/*`, etc.** (subpath imports do
  `package.json`) em vez de paths relativos — não é padrão universal do
  Node, é a feature `imports` do `package.json` (Node >= 14ish), usada
  aqui para trocar automaticamente entre `src/` (dev, via `tsx`) e `dist/`
  (produção) sem tocar em nenhum import.

### 12.4 Sinais de código que merece revisão extra (possíveis sobras de refactor)

Não há indicação explícita no repositório de quais trechos foram
gerados por IA — o que segue são pontos onde o *padrão* do problema
(comentário desatualizado em relação ao fluxo de controle real, lógica
morta logo após uma mudança de comportamento) sugere uma edição rápida que
não foi totalmente revisada, tratados abaixo em 12.5 com o mesmo cuidado
que qualquer bug real mereceria — a origem (IA ou humano) importa menos
que o fato de estarem sem correção.

### 12.5 Partes críticas — tratar com cautela

- **Código morto após `process.exit()` em `drivers/baileys/index.ts`**
  (achado nesta análise, não documentado no projeto):
  - Ramo `loggedOut`/`badSession` (linhas ~253-270): `fs.rm(AUTH_DIR, ...)`
    e `scheduleReconnect(1000)` ficam **depois** de `process.exit(1)` nos
    dois sub-ramos. Sessão corrompida/expirada **não tem o diretório de
    sessão limpo automaticamente** antes do processo morrer.
  - Ramo de reconexão esgotada (linhas ~283-293): depois de
    `process.exit(1)`, ainda há `sendAlert({level: "critical", ...})` e um
    `return`. O alerta crítico **nunca dispara** — o processo já morreu.
    Os `logger.error(...)` anteriores já foram emitidos (chegam ao log),
    mas não aos outros sinks de `alerts.ts` (WhatsApp/e-mail/OS) para
    esse evento específico.
  - Padrão comum: comentários próximos dizem *"No longer mark degraded —
    halt on failure"*, sugerindo migração de "degradar e continuar" para
    "matar o processo", com `process.exit(1)` inserido *antes* do código
    de limpeza/alerta em vez de substituí-lo. Vale confirmar com quem
    mantém se é intencional (supervisor externo cuida disso) ou sobra.
- **`sendGuard.ts` como um todo** — é a camada que existe por causa de um
  incidente real (bloqueio de conta). Qualquer mudança aqui merece o
  cuidado extra que a cobertura de teste fraca (seção 13) não está dando
  hoje.
- **`pluginGuard.ts` timeout check** — bug conhecido documentado (seção 8);
  não corrigir sem also inverter o teste que crava o comportamento atual.
- **`integrationMode.ts` / `loadIntegrationPlugin`** — é o gate que separa
  o plugin de teste (que age sobre WhatsApp real) do build de produção.
  `TEST_REVIEW.md` marca risco ALTO aqui justamente porque, apesar de
  pequeno, é a única rede de segurança dessa fronteira.
- **`commandsConfig.ts` (parser YAML)** — aceita `!!js/function` por
  padrão (comportamento padrão do `js-yaml`), sinalizado como dívida de
  *segurança* de design, não só de teste — `commands.yaml` é arquivo em
  disco editável, tecnicamente "input" mesmo que hoje tratado como
  confiável.

---

## 13. Testes — onde a cobertura é fraca (autoavaliação do próprio projeto)

`TEST_REVIEW.md` é uma revisão manual, arquivo por arquivo, procurando
testes que validam o comportamento *atual* em vez do *pretendido*. Resumo
por risco:

**ALTO risco, com gaps reais:** `sendGuard.ts` (seção 10), `pluginLoader.ts`
(`syncPlugins()` inteiramente sem teste, watchers sem teste),
`commandRegistry.ts` (colisões de invocação, orphan/invalid entry sem
teste), `loadIntegrationPlugin.ts` (estado de módulo não resetado entre
testes), `drivers/baileysAdapter.test.ts` (fan-out de eventos no reconnect
sem teste).

**FECHADOS (sem gaps conhecidos):** `config.test.ts`, `driverManager.test.ts`,
`commandPermissions.test.ts`, `commandMenu.test.ts`,
`commandDeprecation.test.ts`, `pluginGuard.test.ts` (fechado incluindo o
bug documentado, que é bug de produção, não de teste).

**MÉDIO/MÉDIO-ALTO:** `store.ts` (resolução `@lid`↔JID sem nenhum teste —
seção 6), `statusServer.ts` (CORS preflight não testado), `contactAutoSave.ts`
(teste não isola `MANYBOT_CONFIG_DIR`, risco de escrever no SQLite real do
dev), `commandsConfig.ts` (parser YAML, seção 12.5).

---

## 14. Build e release

- `npm run build`: `tsc` + copia `locales/`/`.proto` + compila binário Go
  **se** `go` estiver no `PATH` (senão pula, bot roda só com Baileys).
- Sem watch/hot-reload de build — precisa `npm run build && npm start` a
  cada mudança fora de plugin (plugins têm hot-reload próprio, kernel não).
- Pipeline de release (`hooks/post-receive` → `release.sh` →
  `github-release.sh`): cross-compile `linux-x64`/`linux-arm64`/
  `windows-x64` (sem macOS), `CGO_ENABLED=0`, `checksums.txt`, publish npm
  em duas etapas com 2FA manual. **Tags RC pulam npm inteiramente.**
- Binário WhatsMeow **não vem via `npm install`** — baixado sob demanda
  pelo `installer.ts` de GitHub Releases (Codeberg foi tentado e
  abandonado; plano futuro de migrar para Gitea self-hosted).

---

## 15. Roadmap / o que ainda não existe

- `commands.yaml`: `subcommands:`, `group:`, `menu.welcomeMessage` —
  decididos, não implementados.
- WhatsMeow: só Fatia 0 parcial de paridade; quase todo método além de
  enviar texto/ler histórico retorna "not implemented". Sem binário macOS.
- `sendGuard` sem equivalente para o driver WhatsMeow.
- Gaps de teste priorizados em `TEST_REVIEW.md` (seção 13).

---

## Índice rápido de arquivos citados

| Arquivo | Papel |
|---|---|
| `src/main.ts` | Boot, shutdown, sinais, `--getid`, `--install-whatsmeow` |
| `src/config.ts` | Config layering (defaults/legacy/TOML) |
| `src/kernel/waContract.ts` | Interface driver-neutra (~30 métodos) |
| `src/kernel/driverManager.ts` | Registro do driver único ativo, sem fallback |
| `src/kernel/pluginLoader.ts` | Load/hot-reload/sync de plugins |
| `src/kernel/pluginGuard.ts` | Timeout + 3-strikes por plugin |
| `src/kernel/commandRegistry.ts` | Merge yaml + defaults de plugin |
| `src/kernel/commandsConfig.ts` | Parser do `commands.yaml` |
| `src/kernel/commandPermissions.ts` | Engine de permissões |
| `src/kernel/commandDeprecation.ts` | Rename/deprecation tracking (SQLite) |
| `src/kernel/sendGuard.ts` | Anti-detecção de envio |
| `src/kernel/contactAutoSave.ts` | Auto-save gradual de contatos |
| `src/kernel/alerts.ts` | Alertas multi-sink |
| `src/kernel/settingsDb.ts` | SQLite: settings por (plugin, chat) |
| `src/client/store.ts` / `client/cache.ts` | Estado em memória + snapshot em disco |
| `src/drivers/baileys/index.ts` | State machine de conexão Baileys |
| `src/drivers/baileys/messageHandler.ts` | Pipeline de mensagem recebida |
| `src/drivers/whatsmeow/supervisor.ts` | Lifecycle do subprocesso Go |
| `src/drivers/whatsmeow/client.ts` | Cliente gRPC (paridade parcial) |
| `TEST_REVIEW.md` | Autoavaliação de cobertura de teste |
| `MIGRATION_STATUS.md` / `WHATSMEOW_MIGRATION_PLAN.md` | Plano abandonado de migração p/ WhatsMeow primário |
| `CONTRIBUTING.md` / `AGENTS.md` | Invariantes arquiteturais + guia para agentes de IA |

---

## Perguntas para você verificar seu entendimento

Tente responder sem olhar o documento primeiro; depois confira.

1. Se um plugin exporta tanto `run(ctx)` (legado) quanto `commands` (novo
   sistema), em que condição exata o `run(ctx)` legado **não** é chamado
   para uma invocação específica de comando?
2. Por que `sendGuard.ts` lê `CONFIG.SECURITY_LEVEL` a cada chamada em vez
   de capturar o valor uma vez? Que outro mecanismo do projeto depende do
   mesmo motivo?
3. Se `driver_primary = "whatsmeow"` e o supervisor falha ao subir, o que
   acontece? O bot tenta Baileys como alternativa? Por quê (ou por que
   não)?
4. Onde vive o `pluginRegistry`? Que tipo de "instância" é — uma classe
   instanciada, ou outra coisa? O que isso implica se o projeto um dia
   precisasse rodar dois bots no mesmo processo Node?
5. No fluxo de `connection.update` com `connection === "close"` e sessão
   `badSession`, o diretório de sessão é de fato limpo antes do próximo
   `npm start`? Por quê?
6. Qual é a ordem de avaliação de permissões em `commandPermissions.ts`, e
   o que acontece com o cooldown se as checagens anteriores falharem?
7. Por que `commandDeprecation.ts` e `settingsDb.ts` podem compartilhar o
   mesmo arquivo SQLite com segurança, mesmo sem importar um do outro?
8. Cite dois exemplos de "decidido no design, mas ainda não implementado
   no código" para o sistema `commands.yaml`. Onde isso está documentado
   dentro do próprio repositório?
9. Por que `PLUGINS`/`CHATS`/`EXCLUDE_CHATS` são mutados in-place
   (`.length = 0` + `.push`) em vez de reatribuídos em `reloadConfig()`?
10. Qual é o bug conhecido e não corrigido em `pluginGuard.ts`, e por que
    o time decidiu documentá-lo em vez de corrigi-lo imediatamente?
