/**
 * @manybot/types
 *
 * Tipos autônomos para o objeto de contexto do plugin ManyBot (`ctx`) —
 * propositalmente autocontido, para que projetos de plugin tenham autocomplete
 * sem depender do pacote inteiro "@manybot/manybot". A única dependência
 * externa é @whiskeysockets/baileys, que os plugins já tocam através de
 * ctx.wa.contract/sock.
 *
 * Instalação:
 *
 *   npm install --save-dev @manybot/types
 *
 * Uso em um arquivo de plugin (JS puro, sem build step):
 *
 *   /**
 *    * @param {import('@manybot/types').PluginContext} ctx
 *    *\/
 *   export default async function (ctx) {
 *     if (ctx.msg.is("teste")) {
 *       const msg = await ctx.send.text("teste");
 *       await msg.reply.text("respondendo");
 *     }
 *   }
 *
 * Plugins com setup(ctx) usam SetupContext da mesma forma:
 *
 *   /**
 *    * @param {import('@manybot/types').SetupContext} ctx
 *    *\/
 *   export async function setup(ctx) { ... }
 *
 * Se todos os arquivos de plugin estiverem sob um único tsconfig/jsconfig
 * com "checkJs", dá pra pular o import por arquivo — veja o final deste
 * arquivo para a alternativa global-ambient.
 */

import type { WASocket, proto, BaileysEventMap } from "@whiskeysockets/baileys";

/**
 * Mensagem WhatsApp bruta, recebida/armazenada (`proto.IWebMessageInfo` do
 * Baileys). Prefira {@link WAMessageContext} para lógica comum de plugin —
 * use isto só quando precisar de um campo que o Baileys expõe e que o
 * contexto normalizado não encapsula (ex. via `ctx.wa.msg`).
 *
 * @see WAMessageContext
 */
export type WAProtoMsg = proto.IWebMessageInfo;

/**
 * Envelope de mensagem neutro em relação ao driver. O adapter traduz
 * WAMessages do Baileys para esta forma antes do resto do codebase vê-las.
 * Disponível em `ctx.wa.msg` como alternativa ao `WAProtoMsg` bruto antigo.
 */
export interface BotMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  type: "text" | "image" | "video" | "audio" | "sticker" | "document" | "other";
  contentHash: string;
  timestamp: number;
  body?: string;
  mimetype?: string;
  pushName?: string;
  mentionedJid?: string[];
  quotedKey?: { id: string | null; remoteJid?: string; fromMe: boolean; participant?: string | null };
  fromLid?: string;
  fromPn?: string;
  participantAlt?: string;
  remoteJidAlt?: string;
}

/**
 * Interface de contrato neutra em relação ao driver (subconjunto que plugins
 * podem acessar via `ctx.wa.contract` — ex. `contract.isReady()`).
 */
export interface WaContract {
  readonly name: "baileys" | "whatsmeow";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;
}

/**
 * Store em memória do bot (chats/contatos/mensagens). Só o formato
 * realmente usado pela API de plugin está modelado aqui — trate como
 * majoritariamente somente-leitura.
 *
 * @example
 * ```js
 * const chat = ctx.wa.store.chats.get(ctx.chat.id);
 * console.log(chat?.name);
 * ```
 */
export interface WAStore {
  chats: {
    get(id: string): { id: string; name: string } | null;
    all(): Array<{ id: string; name: string }>;
  };
  contacts: Record<string, { id: string; name?: string | null; notify?: string | null; verifiedName?: string | null }>;
  messages: Map<string, Map<string, unknown>>;
  resolveJid(jid: string): string;
}

// ── Envio de mensagens ────────────────────────────────────────────────────

/** Opções para {@link WAMessageSender.text}. */
export interface SendTextOptions {
  /** Mostrar card de preview de link se o texto contiver uma URL. Usa o padrão do driver se omitido. */
  linkPreview?: boolean;
  /** JIDs a mencionar (marcar) na mensagem, além de qualquer `@numero` já presente no texto. */
  mentions?: string[];
}

/** Opções compartilhadas pelos métodos de envio de mídia ({@link WAMessageSender.image}, {@link WAMessageSender.video}). */
export interface SendMediaOptions {
  /** Enviar como mídia de visualização única (view-once). */
  viewOnce?: boolean;
  /** Enviar como GIF (auto-loop, sem áudio) — aplica-se a {@link WAMessageSender.video} apenas. */
  gifPlayback?: boolean;
  /** JIDs a mencionar (marcar) na legenda. */
  mentions?: string[];
}

/** Opções para {@link WAMessageSender.audio}. */
export interface SendAudioOptions {
  /** Enviar como mensagem de voz (ptt). Padrão true. */
  asVoice?: boolean;
  viewOnce?: boolean;
}

/** Opções para {@link WAMessageSender.poll} e {@link PollApi.create}. */
export interface SendPollOptions {
  /** Permitir que o votante escolha mais de uma opção. Padrão false (escolha única). */
  allowMultipleAnswers?: boolean;
}

/**
 * Uma mensagem enviada, ainda pendente. Dê `await` para obter o
 * {@link WAMessageContext} resultante (ou `undefined` se o envio falhar).
 * Também expõe ações encadeáveis pós-envio.
 *
 * @example
 * ```js
 * const msg = await ctx.send.text("hello");
 * await msg.react("👍");
 * await msg.reply.text("following up");
 * ```
 */
export interface MessageHandle extends PromiseLike<WAMessageContext | undefined> {
  /** Responder à mensagem que acabou de ser enviada (cita ela). */
  readonly reply: WAMessageSender;
  /** Editar o texto da mensagem enviada (só funciona em mensagens do próprio bot). */
  edit(text: string): Promise<unknown>;
  /**
   * Fixar a mensagem enviada.
   * @param duration - Duração da fixação em segundos. Usa o padrão do driver se omitido.
   * @deprecated Não suportado atualmente pelo driver Baileys — loga um aviso e não faz nada.
   */
  pin(duration?: number): Promise<void>;
  /**
   * Apagar a mensagem enviada.
   * @param forEveryone - Se true, apaga para todos os destinatários; senão, só para o bot. Padrão true.
   */
  delete(forEveryone?: boolean): Promise<unknown>;
  /**
   * Reagir à mensagem enviada.
   * @param emoji - Um único caractere de emoji, ex. `"👍"`. Passe `""` para remover uma reação existente.
   */
  react(emoji: string): Promise<unknown>;
}

/**
 * Métodos de envio vinculados a um chat/JID específico. Todo método retorna um {@link MessageHandle}.
 *
 * @see SendApi
 * @see SetupSendApi
 */
export interface WAMessageSender {
  /**
   * Enviar uma mensagem de texto.
   * @param content - O corpo da mensagem.
   * @param opts - Configurações de preview de link e menções.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   * @example
   * ```js
   * await ctx.send.text("Hello world", { mentions: ["5511999999999@s.whatsapp.net"] });
   * ```
   */
  text(content: string, opts?: SendTextOptions): MessageHandle;
  /**
   * Enviar uma imagem.
   * @param source - Caminho local ou Buffer bruto da imagem.
   * @param caption - Legenda opcional mostrada abaixo da imagem.
   * @param opts - Opções de mídia como view-once.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  image(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Enviar um vídeo.
   * @param source - Caminho local ou Buffer bruto do vídeo.
   * @param caption - Legenda opcional mostrada abaixo do vídeo.
   * @param opts - Opções de mídia como view-once ou gifPlayback.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  video(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Enviar uma imagem/vídeo como GIF (auto-loop, sem áudio). Aceita entrada
   * `.gif` e `.mp4` — arquivos `.gif` são convertidos para mp4 via ffmpeg
   * automaticamente.
   * @param source - Caminho local ou Buffer bruto da imagem/vídeo.
   * @param caption - Legenda opcional mostrada abaixo do GIF.
   * @param opts - Opções de mídia como view-once.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  gif(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Enviar uma mensagem de áudio.
   * @param source - Caminho local ou Buffer bruto do áudio.
   * @param opts - Se deve enviar como mensagem de voz (ptt) e/ou view-once.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  audio(source: string | Buffer, opts?: SendAudioOptions): MessageHandle;
  /**
   * Enviar uma figurinha.
   * @param source - Caminho local do arquivo ou um `Buffer` de imagem bruta para converter em figurinha.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  sticker(source: string | Buffer): MessageHandle;
  /**
   * Enviar um arquivo arbitrário como anexo de documento.
   * @param source - Caminho local ou Buffer bruto do arquivo.
   * @param filename - Nome de arquivo exibido ao destinatário; padrão é o basename do caminho do arquivo.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  file(source: string | Buffer, filename?: string): MessageHandle;
  /**
   * Enviar uma enquete (sem rastreamento de votos — use {@link PollApi.create} se precisar de resultados/vencedor).
   * @param question - A pergunta da enquete.
   * @param options - Opções de resposta da enquete (2 ou mais).
   * @param opts - Configurações da enquete, como permitir múltiplas respostas.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   * @see PollApi.create
   */
  poll(question: string, options: string[], opts?: SendPollOptions): MessageHandle;
}

/**
 * `ctx.send` no contexto de runtime — vinculado ao chat atual, mais `.to()` para outros chats.
 *
 * @example
 * ```js
 * await ctx.send.text("reply in this chat");
 * await ctx.send.to("5511999999999@s.whatsapp.net").text("direct message");
 * ```
 */
export interface SendApi extends WAMessageSender {
  /**
   * Obter um sender vinculado a outro chat.
   * @param targetJid - O JID do chat/contato de destino.
   * @returns Um {@link WAMessageSender} escopado para `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

/**
 * `ctx.send` no contexto de setup — ainda não há "chat atual", só `.to()`.
 *
 * @see SendApi
 */
export interface SetupSendApi {
  /**
   * Obter um sender vinculado a um chat específico.
   * @param targetJid - O JID do chat/contato de destino.
   * @returns Um {@link WAMessageSender} escopado para `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

// ── Contexto de mensagem (ctx.msg) ─────────────────────────────────────────

/** Tipo normalizado de uma mensagem WhatsApp recebida. */
export type WAMessageType =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "sticker"
  | "document"
  | "poll"
  | "unknown";

/**
 * Informações normalizadas de contato, retornadas por {@link WAMessageContext.getContact}
 * e {@link ContactsApi.get}.
 */
export interface NormalizedContact {
  id: string;
  number: string;
  pushname: string | null;
  name: string | null;
  shortName: null;
  /** Se é uma conta WhatsApp Business, resolvido via chamada ao vivo a `getBusinessProfile()`. */
  isBusiness: boolean;
  /** Sempre `false` hoje — ainda não derivado de dados reais do WhatsApp. Não confie nisso. */
  isEnterprise: boolean;
  /** Sempre `false` hoje — ainda não derivado de dados reais do WhatsApp. Não use para checar se um contato bloqueou *você*. */
  isBlocked: boolean;
  isMe: boolean;
  isWAAccount: boolean;
  isUser: boolean;
  isGroup: boolean;
  mention: { text: string; mentions: string[] };
}

/**
 * Array de mensagens passadas (mais antiga → mais nova), retornado por
 * `ctx.chat.history`. Comporta-se como um array normal (`history[10]`,
 * `.length`, `.map()`, ...) mais dois filtros de conveniência, ambos
 * encadeáveis e re-empacotados como WAHistoryArray.
 */
export interface WAHistoryArray extends Array<WAMessageContext> {
  /** Últimas `n` mensagens (mais antiga → mais nova). Omita `n` para a lista completa. */
  last(n?: number): WAHistoryArray;
  /** Apenas mensagens enviadas por `senderId`. */
  from(senderId: string): WAHistoryArray;
}

/**
 * Visão normalizada da mensagem recebida, disponível como `ctx.msg` no
 * contexto de runtime. Prefira isto a `ctx.wa.msg` para lógica comum.
 *
 * @example
 * ```js
 * export default async function (ctx) {
 *   if (ctx.msg.is("ping")) {
 *     await ctx.msg.reply.text("pong");
 *   }
 * }
 * ```
 */
export interface WAMessageContext {
  id: string;
  timestamp: number;
  body: string;
  type: WAMessageType;
  fromMe: boolean;
  /** JID normalizado do remetente (participante do grupo ou remoteJid da DM). */
  sender: string;
  senderName: string;
  /** Nome do comando sem o prefixo; string vazia se não for um comando. */
  command: string;
  /** Tudo depois do comando, dividido por espaço. */
  args: string[];
  /**
   * True se esta mensagem invocou o comando dado (case-insensitive).
   * @param cmd - Nome do comando, sem o prefixo.
   * @returns Se `ctx.msg.command` corresponde a `cmd`.
   */
  is(cmd: string): boolean;
  hasMedia: boolean;
  isGif: boolean;
  /**
   * Baixar a mídia desta mensagem, se houver.
   * @param opts - Quando `asMp4` é true, figurinhas animadas são convertidas para mp4.
   * @returns A mídia como `data` em base64 com seu `mimetype`, ou `null` se não houver mídia
   * ou o download falhar.
   */
  downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  hasReply: boolean;
  /**
   * Buscar a mensagem que esta está citando/respondendo. Retorna o mesmo
   * formato normalizado de `ctx.msg` (não dados brutos do Baileys) — então
   * `.hasMedia`, `.downloadMedia()`, `.reply.text(...)`, etc. funcionam
   * diretamente no resultado.
   *
   * Resolve de forma síncrona a partir de dados que a mensagem atual já
   * carrega (a citação vem embutida no `contextInfo`) — sem chamada de
   * rede, então não há atraso relevante para aguardar aqui.
   *
   * O `.senderName` da mensagem citada só reflete um nome de exibição real
   * se o bot já viu esse remetente postar ao menos uma vez enquanto online;
   * caso contrário, cai para o número puro (mesma ressalva de
   * {@link WAMessageContext.getContact}).
   * @returns A mensagem citada como {@link WAMessageContext}, ou `null` se esta mensagem não for uma resposta.
   */
  getReply(): Promise<WAMessageContext | null>;
  /** True se a mensagem contém qualquer @menção. */
  hasMention: boolean;
  /** True se a mensagem @menciona o próprio bot. */
  hasBotMention: boolean;
  /** Responder a esta mensagem (cita ela). */
  reply: WAMessageSender;
  /**
   * Reagir a esta mensagem.
   * @param emoji - Um único caractere de emoji, ex. `"👍"`. Passe `""` para remover uma reação existente.
   */
  react(emoji: string): Promise<unknown>;
  /**
   * Apagar esta mensagem.
   * @param forEveryone - Se true, apaga para todos os destinatários; senão, só para o bot. Padrão true.
   */
  delete(forEveryone?: boolean): Promise<unknown>;
  /**
   * Editar o texto desta mensagem (só funciona em mensagens do próprio bot).
   * @param text - O novo conteúdo de texto.
   */
  edit(text: string): Promise<unknown>;
  /**
   * Fixar esta mensagem.
   * @param duration - Duração da fixação em segundos. Usa o padrão do driver se omitido.
   * @deprecated Não suportado com Baileys ainda — loga um aviso e não faz nada.
   */
  pin(duration?: number): Promise<void>;
  hasPrefix: boolean;
  /**
   * Buscar informações normalizadas sobre o remetente da mensagem.
   * @returns O {@link NormalizedContact} do remetente, ou `null` se o bot ainda não tiver
   * registro desse contato (comum para um JID `@lid` que o bot ainda não viu postar —
   * isso resolve na *próxima* mensagem ao vivo dele, já que o pushname é aprendido a partir
   * da própria mensagem, não só da sincronização de contatos do WhatsApp). Sempre confira
   * `null` antes de ler campos do resultado.
   */
  getContact(): Promise<NormalizedContact | null>;
}

// ── Contexto de chat (ctx.chat) ─────────────────────────────────────────────

/** Um participante de grupo, retornado por {@link ChatContext.getParticipants}. */
export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Visão normalizada do chat atual, disponível como `ctx.chat` no contexto de runtime.
 *
 * @example
 * ```js
 * if (ctx.chat.isGroup && !(await ctx.chat.isSenderAdmin())) {
 *   await ctx.msg.reply.text("Admins only.");
 *   return;
 * }
 * ```
 */
export interface ChatContext {
  id: string;
  name: string;
  isGroup: boolean;
  /**
   * Mensagens passadas neste chat (mais antiga → mais nova). Filtros de
   * conveniência: `history.last(n)`, `history.from(senderId)`.
   */
  history: WAHistoryArray;
  /**
   * Listar os participantes do grupo do chat.
   * @returns Os participantes do grupo, ou `[]` para chats que não são grupo.
   */
  getParticipants(): Promise<GroupParticipant[]>;
  /**
   * Checar se um determinado contato é admin do grupo.
   * @param contactId - O JID do contato/participante a checar.
   * @returns Se esse contato é admin deste grupo.
   */
  isAdmin(contactId: string): Promise<boolean>;
  /** @returns Se o remetente da mensagem atual é admin do grupo. */
  isSenderAdmin(): Promise<boolean>;
  /** @returns Se o próprio bot é admin do grupo. */
  isBotAdmin(): Promise<boolean>;
  /**
   * Limpar todas as mensagens deste chat.
   * @deprecated Não suportado com Baileys — loga um aviso e não faz nada.
   */
  clearMessages(): Promise<void>;
}

// ── API de admin (ctx.admin) ────────────────────────────────────────────────

/**
 * Resultado de uma ação de admin que, por padrão, tem como alvo o chat atual.
 * Pode ser aguardado diretamente, ou redirecionado para outro grupo com `.to(jid)`.
 *
 * @example
 * ```js
 * await ctx.admin.add("5511999999999@s.whatsapp.net").to("120363...@g.us");
 * ```
 */
export interface TargetableAction<T = unknown> extends PromiseLike<T> {
  /**
   * Redirecionar esta ação para um grupo diferente, em vez do chat atual.
   * @param targetJid - O JID do grupo alvo.
   */
  to(targetJid: string): Promise<T>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null): Promise<T>;
}

/**
 * Ações de administração de grupo, escopadas ao chat atual no contexto de runtime.
 * No contexto de setup, todas lançam erro no momento da chamada (sem chat atual),
 * exceto `.add(...).to(jid)` e `.getInviteLink(groupId)`, que aceitam um grupo
 * explícito diretamente.
 */
export interface AdminApi {
  /**
   * Adicionar um ou mais membros ao grupo.
   * @param memberIds - Um único JID ou um array de JIDs a adicionar.
   * @returns Uma {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  add(memberIds: string | string[]): TargetableAction;
  /**
   * Remover um ou mais membros do grupo.
   * @param memberIds - Um único JID ou um array de JIDs a remover.
   */
  kick(memberIds: string | string[]): Promise<unknown>;
  /**
   * Promover um ou mais membros a admin do grupo.
   * @param memberIds - Um único JID ou um array de JIDs a promover.
   */
  promote(memberIds: string | string[]): Promise<unknown>;
  /**
   * Rebaixar um ou mais admins de volta a membros comuns.
   * @param memberIds - Um único JID ou um array de JIDs a rebaixar.
   */
  demote(memberIds: string | string[]): Promise<unknown>;
  /**
   * Renomear o grupo.
   * @param name - O novo nome/assunto do grupo.
   */
  setSubject(name: string): Promise<unknown>;
  /**
   * Definir a descrição do grupo.
   * @param text - O novo texto de descrição.
   */
  setDescription(text: string): Promise<unknown>;
  /**
   * Definir a foto de perfil do grupo.
   * @param source - Caminho local do arquivo ou um `Buffer` de imagem bruta.
   */
  setProfilePic(source: string | Buffer): Promise<unknown>;
  /**
   * Obter o link de convite de um grupo.
   * @param groupId - JID do grupo alvo. Padrão é o chat atual; obrigatório no contexto de setup.
   * @returns O link de convite atual do grupo.
   */
  getInviteLink(groupId?: string): Promise<string>;
  /** Revogar o link de convite atual, invalidando-o (um novo é gerado na próxima requisição). */
  revokeInvite(): Promise<unknown>;
}

// ── Me API (ctx.me) — a própria conta do bot ────────────────────────────────

/** Ações na própria conta/perfil WhatsApp do bot. */
export interface MeApi {
  /**
   * Definir o nome de exibição do bot.
   * @param name - O novo nome de exibição.
   */
  setName(name: string): Promise<unknown>;
  /**
   * Definir o texto de status "Recado" do bot.
   * @param text - O novo texto de recado.
   */
  setAbout(text: string): Promise<unknown>;
  /**
   * Definir a foto de perfil do bot.
   * @param source - Caminho local do arquivo ou um `Buffer` de imagem bruta.
   */
  setProfilePic(source: string | Buffer): Promise<unknown>;
}

// ── Poll API (ctx.poll) ──────────────────────────────────────────────────────

/**
 * Handle de uma enquete com rastreamento de votos ao vivo, retornado por
 * {@link PollApi.create} e {@link PollApi.get}.
 *
 * @example
 * ```js
 * const poll = await ctx.poll.create("Best pizza?", ["Margherita", "Pepperoni"]);
 * poll.onVote((results) => console.log(results));
 * ```
 */
export interface PollHandle {
  readonly msgId: string;
  /**
   * Registrar um callback chamado a cada mudança de voto.
   * @param cb - Recebe a contagem atual e o payload bruto de voto do Baileys.
   * @returns `this`, para encadear mais chamadas `.onVote(...)`.
   */
  onVote(cb: (results: Record<string, number>, raw: unknown) => void): this;
  /** @returns Contagem atual como objeto simples: `{ nomeDaOpcao: numeroDeVotos }`. */
  results(): Record<string, number>;
  /** @returns Nome(s) da(s) opção(ões) líder(es). Array vazio se ainda não houver votos. */
  winner(): string[];
  /** Parar de rastrear esta enquete. Novos votos deixam de atualizar {@link PollHandle.results}. */
  close(): void;
}

/** Criação e busca de enquetes, com rastreamento de votos (diferente de {@link WAMessageSender.poll}). */
export interface PollApi {
  /**
   * Enviar uma enquete e começar a rastrear os votos.
   * @param question - A pergunta da enquete.
   * @param options - Opções de resposta da enquete (2 ou mais).
   * @param opts - Configurações da enquete, como permitir múltiplas respostas.
   * @returns Um {@link PollHandle} para rastrear os resultados.
   * @example
   * ```js
   * const poll = await ctx.poll.create("Lunch?", ["Pizza", "Sushi", "Burger"]);
   * ```
   */
  create(question: string, options: string[], opts?: SendPollOptions): Promise<PollHandle>;
  /**
   * Recuperar uma enquete ativa pelo ID da mensagem.
   * @param msgId - O ID da mensagem da enquete.
   * @returns O {@link PollHandle} correspondente, ou `null` se não encontrado/não mais rastreado.
   */
  get(msgId: string): PollHandle | null;
}

// ── Contacts API (ctx.contacts) ──────────────────────────────────────────────

/** Busca e gerenciamento de contatos do WhatsApp. */
export interface ContactsApi {
  /**
   * Buscar informações normalizadas de um contato.
   * @param contactId - O JID do contato.
   * @param opts - Quando `contactId` é um `@lid` bruto e `opts.groupId` é informado, cruza
   * com uma chamada ao vivo a `groupMetadata()` daquele grupo (que carrega o `phoneNumber`
   * atual do próprio WhatsApp para participantes `@lid`) antes de resolver, em vez de
   * confiar só na heurística do store, cujo mapeamento `@lid` → número pode estar
   * desatualizado. Passe isso sempre que tiver um groupId disponível e não puder garantir
   * que o mapeamento está atualizado — ex. dentro de um handler de `group-participants.update`.
   * Best-effort: em caso de falha, cai silenciosamente na heurística existente.
   * @returns As informações {@link NormalizedContact} do contato, ou `null` se o bot ainda não
   * tiver registro desse JID (comum logo após a *primeira* mensagem de um contato `@lid` novo —
   * resolve assim que ele tiver postado ao menos uma mensagem com o bot online). Dentro de um
   * handler de mensagem, prefira {@link WAMessageContext.getContact} para o remetente atual —
   * ele também resolve `@lid` automaticamente.
   */
  get(contactId: string, opts?: { groupId?: string }): Promise<NormalizedContact | null>;
  /**
   * Obter a URL da foto de perfil de um contato. Consulta a rede do WhatsApp a cada
   * chamada (tipicamente ~150-350ms) — não há camada de cache, então evite chamar
   * isso em loop apertado (ex. uma vez por membro do grupo) sem espaçar as chamadas.
   * @param contactId - O JID do contato.
   * @returns A URL da foto, ou `null` — tanto para um contato sem foto definida quanto
   * para falha/timeout de rede. Os dois casos não são distinguíveis pelo valor retornado.
   */
  getPfpUrl(contactId: string): Promise<string | null>;
  /**
   * Baixar a foto de perfil do contato para disco.
   * @param contactId - O JID do contato.
   * @param destPath - Onde salvar a imagem, ex. via `ctx.storage.resolve(...)`.
   * @returns O caminho do arquivo salvo, ou `null` se indisponível.
   */
  getPfpPath(contactId: string, destPath: string): Promise<string | null>;
  /**
   * Obter o texto de status "Recado" de um contato.
   * @param contactId - O JID do contato.
   * @returns O texto do recado, ou `null` se indisponível.
   */
  getAbout(contactId: string): Promise<string | null>;
  /**
   * Bloquear um contato.
   * @param contactId - O JID do contato.
   */
  block(contactId: string): Promise<void>;
  /**
   * Desbloquear um contato.
   * @param contactId - O JID do contato.
   */
  unblock(contactId: string): Promise<void>;
}

// ── Chats API (ctx.chats) ───────────────────────────────────────────────────

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
}

/** Listagem de chats somente-leitura, disponível como `ctx.chats`. */
export interface ChatsApi {
  /** Todos os chats conhecidos (cache apenas, sem rede). */
  all(): ChatSummary[];
}

// ── Storage API (ctx.storage) ────────────────────────────────────────────────

/** Armazenamento privado de arquivos por plugin. */
export interface StorageApi {
  /** Caminho absoluto do diretório de dados privado deste plugin. */
  dir: string;
  /**
   * Resolver um caminho dentro do diretório de dados do plugin, criando
   * diretórios pai conforme necessário.
   * @param relativePath - Caminho relativo a {@link StorageApi.dir}.
   * @returns O caminho absoluto resolvido.
   * @throws Se `relativePath` tentar path traversal ou for um caminho absoluto.
   */
  resolve(relativePath: string): string;
}

// ── Config / i18n / utils / download / plugins / log APIs ───────────────────

/** Acesso somente-leitura aos valores de configuração do bot. */
export interface ConfigApi {
  /**
   * Ler um valor de configuração.
   * @param key - A chave de configuração.
   * @param defaultValue - Valor retornado se `key` não estiver definida.
   * @returns O valor de configuração, ou `defaultValue` se não definido.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
}

/** Helpers de tradução/localização, disponíveis como `ctx.i18n` (e `ctx.t` como atalho para `ctx.i18n.t`). */
export interface I18nApi {
  /**
   * Traduzir uma chave.
   * @param args - Chave de tradução seguida de quaisquer valores de interpolação, repassados ao engine de i18n.
   * @returns A string traduzida.
   */
  t(...args: unknown[]): string;
  /**
   * Criar um `t()` escopado, vinculado aos arquivos de locale próprios de um plugin.
   * @param pluginMetaUrl - Passe `import.meta.url` do arquivo do plugin.
   * @returns Uma função `t()` escopada aos locales daquele plugin.
   * @example
   * ```js
   * const t = ctx.i18n.createT(import.meta.url);
   * console.log(t("greeting"));
   * ```
   */
  createT(pluginMetaUrl: string): (...args: unknown[]) => string;
  /** Recarregar arquivos de locale do disco. */
  reload(): void;
  /** @returns O código do idioma atualmente ativo. */
  getCurrentLang(): string;
}

/** Helpers diversos de filesystem, disponíveis como `ctx.utils`. */
export interface UtilsApi {
  /**
   * Apagar todo o conteúdo de uma pasta sem remover a pasta em si.
   * @param dirPath - Caminho do diretório a esvaziar.
   */
  emptyFolder(dirPath: string): Promise<void> | void;
}

/** Fila de download em background, disponível como `ctx.download`. Só um job roda por vez. */
export interface DownloadApi {
  /**
   * Enfileirar uma função de download para rodar em background, serializada
   * atrás de qualquer outro job pendente. Não baixe diretamente dentro de
   * um handler de mensagem — isso bloqueia o event loop, e como os plugins
   * são disparados em sequência, atrasa a resposta de todos os outros também.
   * @param workFn - A função que executa o download.
   * @param errorFn - Chamada com o erro se `workFn` lançar/rejeitar.
   */
  enqueue(workFn: () => unknown, errorFn?: (error: unknown) => unknown): void;
}

/** Agendamento de tarefas estilo cron, disponível como `ctx.scheduler`. */
export interface SchedulerApi {
  /**
   * Registrar uma tarefa cron, escopada a este plugin.
   * @param expression - Uma expressão cron, ex. `"0 9 * * 1"` (toda segunda às 9h).
   * @param fn - A função a rodar no horário agendado.
   * @returns Um handle cujo `.stop()` cancela a tarefa.
   * @example
   * ```js
   * ctx.scheduler.schedule("0 9 * * 1", async () => {
   *   await ctx.send.text("Good morning!");
   * });
   * ```
   */
  schedule(expression: string, fn: () => Promise<void>): { stop: () => void };
}

/** Comunicação entre plugins, disponível como `ctx.plugins`. */
export interface PluginsApi {
  /**
   * Buscar a API pública de outro plugin.
   * @param name - O nome do outro plugin.
   * @returns Sua API pública, ou `null` se não estiver ativo.
   */
  get(name: string): unknown | null;
  /**
   * Buscar a API pública de outro plugin, exigindo que ele exista.
   * @param name - O nome do outro plugin.
   * @returns Sua API pública.
   * @throws Se o plugin não existir ou não estiver ativo.
   */
  require(name: string): unknown;
  /**
   * Checar se outro plugin existe e está ativo.
   * @param name - O nome do plugin a checar.
   */
  exists(name: string): boolean;
}

// ── Commands API (ctx.commands) — kernel/commandAccess.ts, Phase 2 ──────────

/** Formato de item retornado por {@link CommandsApi.list}. */
export interface CommandInfo {
  /** Identificador estável do comando (escopado ao plugin). */
  id: string;
  /** O token do comando, sem o prefixo, ex.: `"sticker"`. */
  cmd: string;
  /** Aliases adicionais de invocação para este comando. */
  aliases: string[];
  /** A categoria do comando no menu, ou `null` se não categorizado. */
  category: string | null;
  /** Descrição curta mostrada no menu, ou `null` se não houver. */
  desc: string | null;
}

/**
 * Consultas somente-leitura ao registro de comandos, disponível como `ctx.commands`.
 * Permite que um plugin verifique se outro comando existe, ou leia sua
 * descrição/manual, sem precisar de `ctx.plugins.require()` no plugin dono.
 */
export interface CommandsApi {
  /**
   * Checar se um comando (ou alias) está registrado.
   * @param invocation - O token do comando ou alias, sem o prefixo.
   */
  exists(invocation: string): boolean;
  /**
   * Obter a descrição curta de um comando.
   * @param invocation - O token do comando ou alias, sem o prefixo.
   * @param lang - Código do idioma para tradução. Padrão é o idioma ativo.
   * @returns A descrição, ou `null` se o comando não existir ou não tiver uma.
   */
  desc(invocation: string, lang?: string): string | null;
  /**
   * Obter o manual/texto de ajuda completo de um comando.
   * @param invocation - O token do comando ou alias, sem o prefixo.
   * @param lang - Código do idioma para tradução. Padrão é o idioma ativo.
   * @returns O texto do manual, ou `null` se o comando não existir ou não tiver um.
   */
  manual(invocation: string, lang?: string): string | null;
  /**
   * Listar todos os comandos registrados.
   * @param lang - Código do idioma para traduzir as descrições. Padrão é o idioma ativo.
   */
  list(lang?: string): CommandInfo[];
  /**
   * Checar se `text` corresponde a um dos aliases de menu/ajuda configurados
   * (ex.: `"menu"`, `"help"`, `"?"`), independente do prefixo de comando.
   * @param text - O texto bruto a checar.
   */
  isMenuAlias(text: string): boolean;
}

/** Logger escopado, disponível como `ctx.log`. */
export interface LogApi {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  success(...args: unknown[]): void;
}

// ── Settings API (ctx.settings) — kernel/settingsDb.ts ───────────────────────
// Configurações persistentes por chat, com SQLite.

/** Operações get/set/delete para um único escopo de configuração (um chat, ou global). */
export interface ScopedAccessor {
  /**
   * Ler um valor de configuração.
   * @param key - A chave de configuração.
   * @param defaultValue - Valor retornado se `key` não estiver definida.
   * @returns O valor de configuração, ou `defaultValue` se não definido.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
  /** @returns Todas as configurações deste escopo como um objeto simples. */
  getAll(): Record<string, unknown>;
  /**
   * Escrever um valor de configuração.
   * @param key - A chave de configuração.
   * @param value - O valor a armazenar (deve ser serializável em JSON).
   */
  set(key: string, value: unknown): void;
  /**
   * Remover uma única configuração.
   * @param key - A chave de configuração a apagar.
   */
  delete(key: string): void;
  /** Remover todas as configurações deste escopo. */
  deleteAll(): void;
}

/**
 * Armazenamento persistente de configurações por chat, com SQLite, disponível como `ctx.settings`.
 *
 * @example
 * ```js
 * ctx.settings.set("greeting", "Hi!");
 * const greeting = ctx.settings.get("greeting", "Hello");
 * ```
 */
export interface SettingsApi extends ScopedAccessor {
  /** Configurações escopadas ao bot como um todo, em vez do chat atual. */
  global: ScopedAccessor;
  /**
   * Obter um accessor para as configurações de outro chat.
   * @param targetChatId - O ID do chat cujas configurações você quer acessar.
   * @returns Um {@link ScopedAccessor} escopado para `targetChatId`.
   */
  forChat(targetChatId: string): ScopedAccessor;
  /**
   * Vincular o chat atual a uma comunidade compartilhada, para que compartilhe
   * configurações com outros chats da mesma comunidade.
   * @param communityId - O ID da comunidade a vincular.
   */
  link(communityId: string): void;
  /** Desvincular o chat atual de sua comunidade, se houver. */
  unlink(): void;
  /** @returns O ID de comunidade do chat atual, ou `null` se não vinculado. */
  getCommunityId(): string | null;
  /** @returns IDs de todos os chats vinculados à mesma comunidade do chat atual. */
  getCommunityChats(): string[];
}

// ── Events API (ctx.events) ──────────────────────────────────────────────────

/** Inscrever-se em eventos brutos do socket Baileys / eventos internos, disponível como `ctx.events`. */
export interface EventsApi {
  /**
   * Inscrever-se em um evento bruto do socket Baileys.
   * @param event - Nome do evento, ex. `"messages.upsert"`, `"connection.update"`, `"group-participants.update"`.
   * @param handler - Chamado com o mesmo payload que o Baileys emite para esse evento.
   * @returns Uma função para cancelar a inscrição.
   * @example
   * ```js
   * const off = ctx.events.on("group-participants.update", (update) => {
   *   ctx.log.info("participants changed", update);
   * });
   * // depois: off();
   * ```
   */
  on<K extends keyof BaileysEventMap>(
    event: K,
    handler: (arg: BaileysEventMap[K]) => void
  ): () => void;
  /**
   * Inscrever-se em um nome de evento customizado/interno que não faz parte do event map do Baileys.
   * @param event - O nome do evento.
   * @param handler - Chamado com quaisquer argumentos que esse evento emitir.
   * @returns Uma função para cancelar a inscrição.
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  /**
   * Aguardar um evento bruto do socket Baileys disparar uma vez.
   * @param event - Nome do evento, ex. `"connection.update"`.
   * @returns Uma promise resolvida com o payload tipado do evento na próxima vez que ele disparar.
   */
  once<K extends keyof BaileysEventMap>(event: K): Promise<BaileysEventMap[K]>;
  /**
   * Aguardar um nome de evento customizado/interno disparar uma vez.
   * @param event - O nome do evento.
   */
  once(event: string): Promise<unknown>;

  /** Remover todos os listeners que este plugin registrou via {@link EventsApi.on}. */
  cleanup(): void;
}

// ── Base compartilhada (tanto setup quanto runtime têm acesso a isto) ───────

/** APIs disponíveis tanto em {@link SetupContext} quanto em {@link PluginContext}. */
export interface BaseApi {
  log: LogApi;
  t: I18nApi["t"];
  config: ConfigApi;
  i18n: I18nApi;
  utils: UtilsApi;
  download: DownloadApi;
  scheduler: SchedulerApi;
  plugins: PluginsApi;
  chats: ChatsApi;
  contacts: ContactsApi;
  storage: StorageApi;
  /** Consultas somente-leitura ao registro de comandos. @see CommandsApi */
  commands: CommandsApi;
  /** JID normalizado do bot, ou `null` se o socket ainda não estiver pronto. */
  botId: string | null;
}

// ── Contexto de setup — plugin.setup(ctx), chamado uma vez no load ──────────

/**
 * Contexto passado ao export `setup(ctx)` de um plugin, chamado uma vez
 * quando o plugin é carregado/ativado. Ainda não há "chat atual" neste ponto.
 *
 * @example
 * ```js
 * /**
 *  * @param {import('@manybot/types').SetupContext} ctx
 *  *\/
 * export async function setup(ctx) {
 *   ctx.events.on("connection.update", (u) => ctx.log.info(u));
 * }
 * ```
 * @see PluginContext
 */
export interface SetupContext extends BaseApi {
  send: SetupSendApi;
  admin: AdminApi;
  events: EventsApi;
  me: MeApi;
  settings: { global: ScopedAccessor };
}

// ── Session API (ctx.session) — kernel/chatSession.ts, Phase 7 ──────────────
// Lock exclusivo por chat, para que dois plugins não rodem um fluxo
// interativo (jogos, um prompt com timeout, ...) no mesmo chat ao mesmo
// tempo. O kernel só rastreia QUEM segura o lock; todo o estado do fluxo
// (timeout, entrada coletada, lógica de turnos, ...) fica dentro do plugin.
// Somente runtime — não há chat atual para travar no momento do setup.

/** Lock exclusivo de sessão por chat, disponível como `ctx.session` (somente runtime). */
export interface SessionApi {
  /**
   * Abrir a sessão para este plugin no chat atual.
   * @returns `true` se adquirida (ou já mantida por este mesmo plugin — seguro
   * chamar novamente numa mensagem posterior do mesmo fluxo), `false` se
   * outro plugin já a mantém.
   */
  acquire(): boolean;
  /** Liberar a sessão, mas somente se este plugin a mantém atualmente. */
  release(): void;
  /** Se o chat atual tem uma sessão aberta, mantida por qualquer um. */
  isLocked(): boolean;
  /** Se este plugin é quem mantém a sessão atualmente. */
  isMine(): boolean;
}

// ── runCommand (ctx.runCommand) — kernel/runCommand.ts, Phase 3/8 ───────────

/** Resultado de {@link PluginContext.runCommand}. */
export interface RunCommandResult {
  status:
    /** O comando rodou (e enviou uma resposta, se houver). */
    | "executed"
    /** Quem chamou não tem permissão para rodar este comando. */
    | "permission_denied"
    /** Um argumento obrigatório estava faltando. */
    | "argument_missing"
    /** O token do subcomando não foi reconhecido. */
    | "unknown_sub"
    /** Um comando de texto fixo, ou uma invocação desconhecida — resolve em vez de lançar erro. */
    | "no_dispatch";
  /** O texto de resposta realmente enviado, ou `null` se nada foi enviado. */
  sentReply: string | null;
  /** Uma resposta sugerida para mostrar a quem chamou quando `sentReply` for `null` (ex.: em `"no_dispatch"`). */
  suggestedReply: string | null;
}

// ── Contexto de runtime — plugin.default(ctx), chamado a cada mensagem ──────

/**
 * Contexto passado ao export default de um plugin, chamado a cada
 * mensagem recebida.
 *
 * @example
 * ```js
 * /**
 *  * @param {import('@manybot/types').PluginContext} ctx
 *  *\/
 * export default async function (ctx) {
 *   if (ctx.msg.is("teste")) {
 *     const msg = await ctx.send.text("teste");
 *     await msg.reply.text("respondendo");
 *   }
 * }
 * ```
 * @see SetupContext
 */
export interface PluginContext extends BaseApi {
  send: SendApi;
  msg: WAMessageContext;
  chat: ChatContext;
  admin: AdminApi;
  me: MeApi;
  poll: PollApi;
  settings: SettingsApi;
  /** Lock exclusivo de sessão por chat. @see SessionApi */
  session: SessionApi;
  /**
   * Invocar outro comando registrado através do mesmo pipeline do kernel
   * usado para mensagens reais (checagem de permissão → roteamento de
   * subcomando → validação de argumento obrigatório → dispatch do handler →
   * alerta de crash em caso de erro). Roda contra um contexto escopado ao
   * plugin DONO do comando alvo (seu próprio `storage`, `plugins`, opções de
   * guard), não ao do chamador — mesmo princípio de `ctx.plugins.require()`,
   * mas para a superfície de comandos.
   * @param invocation - O token do comando ou alias, sem o prefixo (ex.: `"sticker"`, não `"!sticker"`).
   * @param rawArgs - O restante da linha, sem parsing.
   */
  runCommand(invocation: string, rawArgs?: string): Promise<RunCommandResult>;
  /** Escape hatch específico do WhatsApp, para quando a API abstraída não for suficiente. */
  wa: {
    /** Contrato neutro do driver (substitui o campo `WASocket` antigo). */
    contract: WaContract;
    /** Store em memória (substitui o campo `WAStore` antigo). */
    store: WAStore;
    /** Envelope de mensagem neutro (substitui o `WAProtoMsg` antigo). */
    msg: BotMessage;
    /** Baixar a mídia da mensagem atual; `asMp4` converte figurinhas animadas para mp4. */
    downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  };
  /** Reservado para um futuro driver de Telegram — sempre `null` no WhatsApp. */
  tg: null;
  /** Reservado para um futuro driver de Discord — sempre `null` no WhatsApp. */
  dc: null;
}

// ── Formato do módulo de plugin ───────────────────────────────────────────────

/**
 * O que um arquivo de plugin deve exportar.
 *
 * @example
 * ```js
 * /** @type {import('@manybot/types').PluginModule} *\/
 * export default {
 *   async setup(ctx) { ... },
 *   async default(ctx) { ... },
 * };
 * ```
 */
export interface PluginModule {
  /**
   * Chamado uma vez quando o plugin é carregado/ativado.
   * @param ctx - O {@link SetupContext} deste plugin.
   */
  setup?(ctx: SetupContext): unknown | Promise<unknown>;
  /**
   * Chamado a cada mensagem recebida.
   * @param ctx - O {@link PluginContext} deste plugin.
   */
  default?(ctx: PluginContext): unknown | Promise<unknown>;
}

// ── Opcional: tipos globais sem import ─────────────────────────────────────────
//
// Se preferir não escrever `@param {import('...').PluginContext}` em todo
// arquivo de plugin, descomente o bloco abaixo e garanta que este arquivo
// esteja incluído em qualquer tsconfig/jsconfig que cubra seus plugins
// (adicione o caminho em "include"). Aí todo plugin pode simplesmente escrever:
//
//   /**
//    * @param {PluginContext} ctx
//    */
//   export default async function (ctx) { ... }
//
// sem nenhum import.
//
// declare global {
//   type PluginContext = import("@manybot/types").PluginContext;
//   type SetupContext  = import("@manybot/types").SetupContext;
// }

