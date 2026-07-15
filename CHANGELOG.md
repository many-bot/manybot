# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

---

## [5.2.0] - 2026-07-09

### 🎉 Major Features

#### 🏗️ Driver Architecture Refactor
- **Isolamento completo da lógica WhatsApp** dentro do driver (`drivers/whatsapp/`)
- Nova estrutura preparada para suportar múltiplas plataformas (Discord, Telegram, Business API)
- Padrão estabelecido: cada driver expõe `buildApi()`, `buildSetupApi()`, `buildChatFromMsg()`

#### 🔗 Message Chaining API
- Todos os métodos de envio (`ctx.send.*`) agora retornam `MessageHandle` (PromiseLike)
- **Novo**: `.reply` property em qualquer mensagem enviada para responder citando
- Suporte completo a chaining:
  ```typescript
  const msg = await ctx.send.text("olá");
  const reply = await msg.reply.audio("file.mp3");
  const reaction = await reply.reply.text("pronto!");
  ```
- Fire-and-forget ainda funciona (não precisa usar `await`)

#### ✨ Improved Type Safety & Autocomplete
- `WAMessageContext` agora com IntelliSense completo
- `MessageHandle` agora tipo `PromiseLike<WAMessageContext>` (não mais `undefined`)
- Todas as propriedades de `ctx.msg` sugeridas pelo IDE:
  - `msg.body`, `msg.sender`, `msg.timestamp`, `msg.type`, `msg.hasMedia`, etc.
- Novo method `.reply` em `MessageHandle` com tipos corretos

### 🔄 Structure Changes

#### Files Reorganized
```
src/drivers/whatsapp/
├── index.ts                 # Entry point do driver
├── messageHandler.ts        # Pipeline de roteamento
├── adapter.ts              # Re-export (compatibilidade)
├── sdk/
│   └── baileys.ts          # Socket + Auth (mover de client/)
└── api/
    ├── index.ts            # buildApi() + buildSetupApi()
    └── helpers.ts          # Helpers WhatsApp-específicos
```

#### Migration From Kernel to Driver
- `kernel/pluginApi.ts` → `drivers/whatsapp/api/index.ts` (1264 linhas)
- `kernel/messageHandler.ts` → `drivers/whatsapp/messageHandler.ts`
- `client/baileysSock.ts` → `drivers/whatsapp/sdk/baileys.ts`

### ✅ Backward Compatibility

- **Zero Breaking Changes** ✅ para plugins existentes
- Todos os imports legados continuam funcionando via re-exports:
  - `#manyapi` → redireciona para `drivers/whatsapp/api/`
  - `#client/baileysSock` → mantido para compatibilidade
  - `#client/whatsappClient` → mantido para compatibilidade

- Todos os plugins atuais funcionam 100% sem mudanças:
  ```typescript
  // Código antigo - continua funcionando
  await ctx.send.text("oi");
  await ctx.msg.reply.text("resposta");
  await ctx.admin.getParticipants();
  ```

### 🛠️ Technical Improvements

- `makeSender()` agora aceita `Promise<WAProtoMsg>` para suportar reply chaining
- `resolveQuoted()` helper resolve automaticamente Promises ou WAProtoMsg
- `MessageHandle.reply` getter retorna `WAMessageSender` pronto para encadear
- Tipo de retorno `getPfpUrl()` corrigido (`undefined` → `null`)
- Todos os tipos verificados com `npm run typecheck` ✅

### 📦 Dependencies

- ✅ Mantém `@whiskeysockets/baileys` (sem mudanças)
- ✅ TypeScript já estava - tipos melhorados
- ✅ Sem novas dependências adicionadas

### 🚀 Future Ready

Estrutura pronta para:
- `drivers/discord/` - Discord Bot Support
- `drivers/telegram/` - Telegram Bot Support
- `drivers/business/` - WhatsApp Business API
- Plugins funcionarão em múltiplas plataformas simultaneamente

---

## Previous Versions

### [5.1.0] - Migration to TypeScript & Baileys
- Migração de `whatsapp-web.js` para `@whiskeysockets/baileys`
- Refatoração completa para TypeScript
- Type safety garantida
- IntelliSense support

### [5.0.0] - Initial Release
- Plugin system
- WhatsApp integration
- Message handling
- Admin features
- i18n support

---

## 🎯 How to Update

### For Plugin Developers
**Boas notícias**: Nenhuma mudança necessária! Seus plugins continuam funcionando.

### New Capabilities Available
```typescript
// Novo: Responder citando a mensagem que você enviou
const message = await ctx.send.text("hello");
await message.react("🔥");

// Novo: Encadear respostas
const audio = await ctx.msg.reply.audio("file.mp3");
const text = await audio.reply.text("aqui está!");
```

---

## 📚 Documentation

- `README.md` - Overview geral
- `ROADMAP.md` - Plano futuro
- Session files (refactor documentation):
  - `refactor_complete.md` - Resumo das mudanças
  - `architecture.txt` - Diagrama visual
  - `how_it_works_now.md` - Fluxo completo
  - `checklist.md` - Validação

---

## ✨ Summary

| Aspecto | Status |
|---------|--------|
| **Plugins existentes** | 100% compatível ✅ |
| **Novo API chaining** | ✅ Funcionando |
| **Types/Autocomplete** | ✅ Melhorado |
| **Multi-driver ready** | ✅ Pronto |
| **Zero breaking changes** | ✅ Garantido |
| **TypeScript safe** | ✅ Passing typecheck |

---

**Próximo passo**: Testar em produção e começar implementação dos novos drivers! 🚀
