# Changelog

## v5.8.0 — In Development

> Esta entrada cobre trabalho já presente no código mas nunca lançado em changelog, mais os itens planejados para fechar o ciclo atual (ver `plano-final-manybot.md`). Itens marcados `[planejado]` ainda não foram aplicados ao código — ficam aqui como rascunho para não esquecer de registrar assim que forem feitos.

### New Features

- **Sistema `commands.yaml`** — configuração central de comandos, substituindo definição hardcoded no plugin de menu:
  - Registro de comandos (`src/kernel/commandRegistry.ts`) com schema por comando: `cmd`, `aliases`, `plugin`, `function`, `text` (fixo, inline ou `file:./caminho`), `desc`, `category`, `manual`, `deprecatedMessage`.
  - Permissões por comando (`src/kernel/commandPermissions.ts`): `admin`, `botAdmin`, `scope` (`group`/`dm`/`any`), `owner`, `cooldownSeconds`, `whitelist`/`blacklist` (grupo e usuário separados, blacklist tem prioridade sobre whitelist). Mensagens de aviso customizáveis por caso (`botNotAdmin`, `senderNotAdmin`, `ownerOnly`, `wrongScope`, `cooldown`).
  - Depreciação automática de comando (`src/kernel/commandDeprecation.ts`): detecta rename ou remoção de um `cmd` já em uso e bloqueia reuso do nome antigo por um período configurável (`notifyPeriodDays`, default 7 dias), com toggle global + override por comando (`notifyChanges`).
  - Menu nativo (`src/kernel/commandMenu.ts`): overview, listagem por categoria, manual individual e fallback de "comando não encontrado" — configurável via `menu.title`/`intro`/`footer`/`aliases`.
  - Suporte a i18n em todos os campos de texto do schema (`desc`, `manual`, `title`, `intro`, `footer`) via `LocalizedString`, usando a mesma infra de `src/i18n`/`src/locales`.
- **Infraestrutura de Testes & Tooling (ESLint)**:
  - Suporte a execução de testes automatizados via `node:test` + `tsx` com resolução condicional de subpath imports (`development` -> `src/*`, `default` -> `dist/*`).
  - Suporte a banco SQLite em memória (`:memory:`) em `settingsDb.ts` e `commandDeprecation.ts` quando `NODE_ENV === "test"`.
  - Suíte de testes unitários cobrindo `drivers/jid`, `sendGuard`, `driverManager`, `commandRegistry`, `commandMenu`, `commandDeprecation`, `config`, `sendFallbackGuard`, `contactAutoSave` e `pluginGuard`.
  - Flat config do ESLint com `eslint-plugin-import-x` (`import-x/no-cycle`) para prevenção de import circular.

### Fixes

- **Internationalization coverage** — menu labels and defaults, command permission messages, operational alerts, and Baileys group/poll errors now use the active locale. The configured/system locale selection remains unchanged; test defaults continue to use English.
- **`hasBotMention`/`getContact` voltam a usar `contract.me()`** em vez de acessar `sock.user`/`sock.user?.lid` diretamente — regressão em relação ao padrão já usado no resto de `src/drivers/baileys/api/index.ts`. Depois da correção, `rawSocketOf` fica restrito a um único uso legítimo (`getGroupMetadataCached`).
- **`updateCheck.ts` migra de `registry.npmjs.org` para a GitHub Releases API**, mesmo padrão já usado por `src/drivers/whatsmeow/installer.ts`. Corrige o caso em que o aviso de atualização nunca dispara para tags RC (que pulam publicação no npm) ou demora para releases estáveis presas em `staged` aguardando aprovação 2FA.

### Known limitations

- Driver WhatsMeow ainda não distribui binário para macOS/darwin — `TARGETS` em `scripts/build-whatsmeow-release.mjs` e `SUPPORTED` em `src/drivers/whatsmeow/installer.ts` cobrem só `linux-x64`, `linux-arm64` e `windows-x64`. Pendente de quem tiver máquina Mac disponível para validar cross-compile + download ponta a ponta.
- `subcommands:` (estrutura aninhada para sub-comandos de um mesmo plugin) e `group:` (agrupar comandos diferentes num item de menu) foram decididos no design do `commands.yaml` mas ainda não existem no schema.
- Mensagem de boas-vindas configurável para usuário novo (`menu.welcomeMessage`) ainda não implementada.

---

Previous releases are tracked via Git tags.
