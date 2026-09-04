/**
 * @manybot/types
 *
 * Tipos independentes para o objeto de contexto (`ctx`) dos plugins do
 * ManyBot — propositalmente autocontido, para que os projetos de plugin
 * ganhem autocomplete sem depender do pacote inteiro "@manybot/manybot".
 * A única dependência externa é @whiskeysockets/baileys, que os plugins
 * já tocam através de ctx.wa.contract/sock.
 *
 * Instalação:
 *
 *   npm install --save-dev @manybot/types
 *
 * Uso em um arquivo de plugin (JS puro, sem etapa de build):
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
 * Se todos os arquivos de plugin vivem sob um único tsconfig/jsconfig com
 * "checkJs", você pode pular o import por arquivo completamente — veja o
 * final deste arquivo para uma alternativa global-ambiente.
 */

import type { proto } from "@whiskeysockets/baileys";

/**
 * Mensagem bruta do WhatsApp recebida/armazenada (`proto.IWebMessageInfo`
 * do Baileys). Prefira {@link WAMessageContext} para a lógica cotidiana
 * de plugins — recorra a este tipo apenas quando precisar de um campo que
 * o Baileys expõe e que o contexto normalizado não envolve (ex.: via
 * `ctx.wa.msg`).
 *
 * @see WAMessageContext
 */
export type WAProtoMsg = proto.IWebMessageInfo;

/**
 * Envelope de mensagem neutro em relação ao driver. O adaptador traduz as
 * WAMessages do Baileys para este formato antes que o resto do código as
 * veja. Disponível em `ctx.wa.msg` como alternativa ao antigo `WAProtoMsg`
 * bruto.
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
  quotedKey?: BotQuotedRef;
  fromLid?: string;
  fromPn?: string;
  participantAlt?: string;
  remoteJidAlt?: string;
}

/**
 * Identificador de uma mensagem específica no WhatsApp — o formato neutro
 * em relação ao driver de uma "chave de mensagem", usado como referência
 * para reações, edições, exclusões, citações e contabilização de votos de
 * enquete.
 *
 * Todos os campos são opcionais porque cada superfície de driver entrega
 * chaves parciais em alguns contextos (ex.: um handler de reação que só
 * conhece o ID da mensagem alvo, não o participante). Repasse o que você
 * tiver; o adaptador completa o resto.
 */
export interface BotQuotedRef {
  id?: string | null;
  remoteJid?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}

/** Resumo mínimo de chat usado nos payloads de histórico. */
export interface BotChatSummary {
  id: string;
  name?: string;
}

/** Resumo simples de contato usado nos payloads de histórico. */
export interface BotContactSummary {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  /** Forma @lid, se conhecida. */
  lid?: string;
}

/** Payload de `messages.upsert`. */
export interface MessagesUpsertEvent {
  messages: BotMessage[];
  type: "notify" | "append";
}

/** Payload de `messages.update`. */
export interface MessagesUpdateEvent {
  updates: Array<{ key: BotQuotedRef; update: Record<string, unknown> }>;
}

/** Payload de `messaging-history.set`. */
export interface HistorySetEvent {
  chats: BotChatSummary[];
  contacts: BotContactSummary[];
  messages: BotMessage[];
}

/** Payload de `chats.upsert`. */
export interface ChatsUpsertEvent {
  chats: BotChatSummary[];
}

/** Payload de `chats.update`. */
export interface ChatsUpdateEvent {
  updates: Array<{ id: string; name?: string }>;
}

/** Payload de `contacts.upsert`. */
export interface ContactsUpsertEvent {
  contacts: BotContactSummary[];
}

/** Payload de `contacts.update`. */
export interface ContactsUpdateEvent {
  updates: BotContactSummary[];
}

/** Payload de `group-participants.update`. */
export interface GroupParticipantsUpdateEvent {
  id: string;
  author: string;
  /** JIDs dos participantes afetados, normalizados para a forma user-server. */
  participants: string[];
  action: "add" | "remove" | "promote" | "demote" | "modify";
}

/** Payload de `groups.upsert`. */
export interface GroupsUpsertEvent {
  groups: Array<{ id: string; subject?: string }>;
}

/** Payload de `groups.update`. */
export interface GroupsUpdateEvent {
  updates: Array<{ id: string }>;
}

/** Payload de `connection.update`. */
export interface ConnectionUpdateEvent {
  connection: "open" | "close" | "connecting";
  lastDisconnect?: { statusCode?: number };
}

/** Payload de `chats.delete`. */
export interface ChatsDeleteEvent {
  ids: string[];
}

/** Payload de `messages.delete`. */
export interface MessagesDeleteEvent {
  keys: BotQuotedRef[];
  /** Quando true, todas as mensagens em `jid` foram apagadas (semântica de limpeza de chat). */
  all?: { jid: string } | null;
}

/** Payload de `group.join-request`. */
export interface GroupJoinRequestEvent {
  id: string;
  author: string;
  participant: string;
  action: "created" | "revoked" | "rejected";
  method: "invite_link" | "linked_group_join" | "non_admin_add" | "unknown";
}

/** Payload de `blocklist.set`. */
export interface BlocklistSetEvent {
  blocklist: string[];
}

/** Payload de `blocklist.update`. */
export interface BlocklistUpdateEvent {
  blocklist: string[];
  type: "add" | "remove";
}

/** Nomes de eventos neutros em relação ao driver, expostos em `WaContract.on`. */
export type WaEventName =
  | "messages.upsert"
  | "messages.update"
  | "messages.delete"
  | "messaging-history.set"
  | "chats.upsert"
  | "chats.update"
  | "chats.delete"
  | "contacts.upsert"
  | "contacts.update"
  | "group-participants.update"
  | "groups.upsert"
  | "groups.update"
  | "group.join-request"
  | "blocklist.set"
  | "blocklist.update"
  | "connection.update";

/** Mapa de payload por evento. */
export type WaEventPayload<E extends WaEventName> =
  E extends "messages.upsert"           ? MessagesUpsertEvent :
  E extends "messages.update"           ? MessagesUpdateEvent :
  E extends "messages.delete"           ? MessagesDeleteEvent :
  E extends "messaging-history.set"     ? HistorySetEvent :
  E extends "chats.upsert"              ? ChatsUpsertEvent :
  E extends "chats.update"              ? ChatsUpdateEvent :
  E extends "chats.delete"              ? ChatsDeleteEvent :
  E extends "contacts.upsert"           ? ContactsUpsertEvent :
  E extends "contacts.update"           ? ContactsUpdateEvent :
  E extends "group-participants.update" ? GroupParticipantsUpdateEvent :
  E extends "groups.upsert"             ? GroupsUpsertEvent :
  E extends "groups.update"             ? GroupsUpdateEvent :
  E extends "group.join-request"        ? GroupJoinRequestEvent :
  E extends "blocklist.set"             ? BlocklistSetEvent :
  E extends "blocklist.update"          ? BlocklistUpdateEvent :
  E extends "connection.update"         ? ConnectionUpdateEvent :
  never;

/** Entradas para {@link WaContract.sendPoll}. */
export interface BotPollOptions {
  name: string;
  values: string[];
  selectableCount?: number;
}

/** Referência a uma mensagem que o bot acabou de enviar. */
export interface SentMessageRef {
  id: string;
  chatId: string;
  timestamp: number;
}

/** Uma entrada de participante em {@link BotGroupMetadata.participants}. */
export interface BotGroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** JID de número de telefone no formato E.164, preenchido quando o driver o expõe. */
  phoneNumber?: string;
}

/** Metadados de grupo retornados por {@link WaContract.groupMetadata}. */
export interface BotGroupMetadata {
  subject: string;
  participants: BotGroupParticipant[];
}

/** Informações sobre a própria conta do bot. */
export interface BotMe {
  id: string;
  lid?: string;
}

/** Entradas para {@link WaContract.decryptPollVote}. */
export interface PollDecryptOpts {
  /** Chave da mensagem de atualização de voto da enquete. */
  voteKey: BotQuotedRef;
  /** Chave da mensagem de criação da enquete. */
  pollKey: BotQuotedRef;
  /** Chave de criptografia da enquete, string base64 ou Buffer. */
  pollEncKey: Buffer | string;
}

/** Resultado de sucesso de {@link WaContract.decryptPollVote}. */
export interface PollDecryptResult {
  /** Lista decifrada dos hashes das opções selecionadas (SHA-256 do nome de cada opção). */
  selectedOptions: string[];
  /** Mensagem de voto bruta decifrada — exposta para chamadores que
   *  precisam de campos que o envelope neutro propositalmente não modela. */
  raw: unknown;
}

/** Entradas para {@link WaContract.aggregatePollVotes}. */
export interface PollAggregateOpts {
  /** Chave da mensagem de criação da enquete. */
  pollKey: BotQuotedRef;
  /** Entradas mais recentes por votante, vindas de {@link WaContract.decryptPollVote}. */
  votes: PollDecryptResult[];
  /** JID usado para filtrar os próprios votos do bot fora da contagem. */
  selfJid?: string;
}

/** Uma linha da contagem agregada. */
export interface PollVoteAggregate {
  name: string;
  voters: string[];
}

/**
 * Contrato neutro em relação ao driver que o kernel expõe como
 * `ctx.wa.contract`. Todo driver de WhatsApp — Baileys hoje, whatsmeow
 * futuramente — implementa esta interface. Os plugins recorrem a ela
 * para operações em nível de protocolo que não são abstraídas por
 * `ctx.send.*`, `ctx.admin.*` etc. (ex.: `contract.groupMetadata(jid)`,
 * `contract.readMessages(keys)`).
 *
 * Todos os nomes de evento listados em {@link WaEventName} são
 * compromissos firmes — o adaptador implementa cada listener
 * `bindSockEventsExternal` para cada um deles. Os métodos opcionais
 * (`resolveLid`, `getHistory`, `decryptPollVote`, `aggregatePollVotes`)
 * são extensões específicas do driver; os chamadores DEVEM lidar com a
 * ausência deles.
 */
export interface WaContract {
  readonly name: "baileys" | "whatsmeow";

  // ── ciclo de vida ───────────────────────────────────────────────────
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;

  /**
   * Resolve um JID @lid para o JID real @s.whatsapp.net usando a fonte
   * autoritativa do driver. Opcional — drivers sem um resolvedor em
   * nível de protocolo podem omiti-lo.
   */
  resolveLid?(lid: string): Promise<string | null>;

  // ── inscrição em eventos ─────────────────────────────────────────────
  /**
   * Registra um listener para um evento do driver. Retorna uma função
   * de cancelamento de inscrição. Os adaptadores traduzem o formato de
   * evento próprio do driver para o tipo de payload neutro declarado
   * acima.
   */
  on<E extends WaEventName>(event: E, handler: (payload: WaEventPayload<E>) => void): () => void;

  // ── envio (texto passa por sendFallbackGuard; estes são diretos) ────
  sendText(jid: string, text: string, opts?: { quoted?: BotQuotedRef; mentions?: string[] }): Promise<SentMessageRef>;
  sendImage(jid: string, buffer: Buffer, opts?: { caption?: string; quoted?: BotQuotedRef; mentions?: string[]; viewOnce?: boolean }): Promise<SentMessageRef>;
  sendVideo(jid: string, buffer: Buffer, opts?: { caption?: string; quoted?: BotQuotedRef; mentions?: string[]; viewOnce?: boolean; gifPlayback?: boolean }): Promise<SentMessageRef>;
  sendAudio(jid: string, buffer: Buffer, opts?: { quoted?: BotQuotedRef; viewOnce?: boolean; ptt?: boolean; mimetype?: string }): Promise<SentMessageRef>;
  sendSticker(jid: string, buffer: Buffer, opts?: { quoted?: BotQuotedRef }): Promise<SentMessageRef>;
  sendDocument(jid: string, buffer: Buffer, filename: string, mimetype: string, opts?: { quoted?: BotQuotedRef }): Promise<SentMessageRef>;
  sendPoll(jid: string, opts: BotPollOptions & { quoted?: BotQuotedRef }): Promise<SentMessageRef>;

  react(jid: string, target: BotQuotedRef, emoji: string): Promise<void>;
  deleteMessage(jid: string, target: BotQuotedRef, forEveryone: boolean): Promise<void>;
  editMessage(jid: string, target: BotQuotedRef, text: string): Promise<void>;

  // ── presença + leitura ───────────────────────────────────────────────
  sendPresenceUpdate(state: "composing" | "recording" | "paused", jid: string): Promise<void>;
  readMessages(keys: BotQuotedRef[]): Promise<void>;

  // ── contatos ────────────────────────────────────────────────────────
  onWhatsApp(jid: string): Promise<{ exists: boolean }[] | null>;
  getBusinessProfile(jid: string): Promise<unknown | null>;
  profilePictureUrl(jid: string): Promise<string | null>;
  fetchStatus(jid: string): Promise<string | null>;
  updateBlockStatus(jid: string, action: "block" | "unblock"): Promise<void>;
  addOrEditContact(jid: string, info: { fullName: string; firstName?: string; saveOnPrimaryAddressbook?: boolean }): Promise<void>;
  removeContact(jid: string): Promise<void>;

  // ── grupos ──────────────────────────────────────────────────────────
  groupMetadata(jid: string): Promise<BotGroupMetadata>;
  groupParticipantsUpdate(jid: string, users: string[], action: "add" | "remove" | "promote" | "demote"): Promise<Array<{ status: string; jid?: string }>>;
  groupUpdateSubject(jid: string, subject: string): Promise<void>;
  groupUpdateDescription(jid: string, description: string): Promise<void>;
  groupInviteCode(jid: string): Promise<string>;
  groupRevokeInvite(jid: string): Promise<string>;

  // ── perfil (bot + grupo) ─────────────────────────────────────────────
  updateProfilePicture(jid: string, buffer: Buffer): Promise<void>;
  updateProfileName(name: string): Promise<void>;
  updateProfileStatus(status: string): Promise<void>;

  // ── eu (me) ─────────────────────────────────────────────────────────
  me(): BotMe;

  // ── mídia (download) ────────────────────────────────────────────────
  /**
   * Baixa um payload de mídia. Retorna null em qualquer falha (mídia já
   * baixada, blob expirado, erro de protocolo etc).
   */
  downloadMedia(msg: BotMessage, opts: { asMp4?: boolean }): Promise<{ mimetype: string; data: Buffer } | null>;

  // ── primitiva de verificação ─────────────────────────────────────────
  /**
   * Lê as N mensagens mais recentes que o driver tem disponíveis para
   * `jid`, em ordem cronológica (mais antiga → mais recente). Opcional
   * para drivers que não mantêm um histórico local.
   */
  getHistory?(jid: string, opts?: { limit?: number }): Promise<BotMessage[]>;

  // ── decifragem de enquete (específico do Baileys) ────────────────────
  /**
   * Decifra uma única atualização de voto de enquete em relação a uma
   * mensagem de criação de enquete conhecida. Opcional — só o driver
   * Baileys implementa.
   */
  decryptPollVote?(opts: PollDecryptOpts): Promise<PollDecryptResult | null>;

  /**
   * Agrega um histórico de votos por votante em uma contagem indexada
   * pelo nome da opção. Opcional — mesmas regras de `decryptPollVote`.
   */
  aggregatePollVotes?(opts: PollAggregateOpts): PollVoteAggregate[];
}

/**
 * O armazenamento em memória de chats/contatos/mensagens do bot.
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

// ── Envio de mensagens ───────────────────────────────────────────────────────

/** Opções para {@link WAMessageSender.text}. */
export interface SendTextOptions {
  /** Mostra um card de pré-visualização de link se o texto contiver uma URL. Usa o padrão do driver se omitido. */
  linkPreview?: boolean;
  /** JIDs para mencionar (marcar) na mensagem, além de qualquer `@numero` já presente no texto. */
  mentions?: string[];
}

/** Opções compartilhadas pelos métodos de envio de mídia ({@link WAMessageSender.image}, {@link WAMessageSender.video}). */
export interface SendMediaOptions {
  /** Envia como mensagem de mídia de visualização única. */
  viewOnce?: boolean;
  /** JIDs para mencionar (marcar) na legenda. */
  mentions?: string[];
}

/** Opções para {@link WAMessageSender.audio}. */
export interface SendAudioOptions {
  /** Envia como mensagem de voz (ptt). O padrão é true. */
  asVoice?: boolean;
  viewOnce?: boolean;
}

/** Opções para {@link WAMessageSender.poll} e {@link PollApi.create}. */
export interface SendPollOptions {
  /** Permite que os votantes selecionem mais de uma opção. O padrão é false (escolha única). */
  allowMultipleAnswers?: boolean;
}

/**
 * Uma mensagem pendente de envio. Aguarde (`await`) para obter o
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
  /**
   * `BotMessage` subjacente (ou `undefined` se o envio falhar). Exposto
   * para que plugins que precisem da chave bruta para operações
   * subsequentes (ex.: cruzamento com o histórico) não precisem
   * aguardar de novo.
   */
  readonly rawPromise: Promise<BotMessage | undefined>;
  /** Responde à mensagem que acabou de ser enviada (citando-a). */
  readonly reply: WAMessageSender;
  /** Edita o texto da mensagem enviada (só funciona nas próprias mensagens do bot). */
  edit(text: string): Promise<unknown>;
  /**
   * Fixa a mensagem enviada.
   * @param duration - Duração da fixação em segundos. Usa o padrão do driver se omitido.
   * @deprecated Não suportado atualmente pelo driver Baileys — registra um aviso e não faz nada.
   */
  pin(duration?: number): Promise<void>;
  /**
   * Exclui a mensagem enviada.
   * @param forEveryone - Se true, exclui para todos os destinatários; caso contrário, só para o bot. O padrão é true.
   */
  delete(forEveryone?: boolean | undefined): Promise<unknown>;
  /**
   * Reage à mensagem enviada.
   * @param emoji - Um único caractere de emoji, ex.: `"👍"`. Passe `""` para remover uma reação existente.
   */
  react(emoji: string): Promise<unknown>;
  then<TResult1 = WAMessageContext | undefined, TResult2 = never>(
    onfulfilled?: ((value: WAMessageContext | undefined) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  /**
   * Anexa um handler para uma rejeição no envio subjacente. Espelha
   * `Promise.prototype.catch` para que o handle possa ser usado em
   * cadeias de tratamento de erro baseadas em promises.
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined,
  ): Promise<WAMessageContext | undefined | TResult>;
  /**
   * Anexa um handler executado quando o envio subjacente é resolvido.
   * Espelha `Promise.prototype.finally`.
   */
  finally(onfinally?: (() => void) | null | undefined): Promise<WAMessageContext | undefined>;
}

/**
 * Métodos de envio vinculados a um chat/JID específico. Todo método
 * retorna um {@link MessageHandle}.
 *
 * @see SendApi
 * @see SetupSendApi
 */
export interface WAMessageSender {
  /**
   * Envia uma mensagem de texto.
   * @param content - O corpo da mensagem.
   * @param opts - Configurações de pré-visualização de link e menções.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   * @example
   * ```js
   * await ctx.send.text("Hello world", { mentions: ["5511999999999@s.whatsapp.net"] });
   * ```
   */
  text(content: string, opts?: SendTextOptions): MessageHandle;
  /**
   * Envia uma imagem.
   * @param filePath - Caminho local ou Buffer bruto da imagem.
   * @param caption - Legenda opcional exibida abaixo da imagem.
   * @param opts - Opções de mídia como visualização única.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  image(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Envia um vídeo.
   * @param filePath - Caminho local ou Buffer bruto do vídeo.
   * @param caption - Legenda opcional exibida abaixo do vídeo.
   * @param opts - Opções de mídia como visualização única ou gifPlayback.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  video(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Envia uma imagem/vídeo como GIF (loop automático, mudo). Aceita
   * entradas `.gif` e `.mp4` — arquivos `.gif` são convertidos para mp4
   * automaticamente via ffmpeg.
   * @param filePath - Caminho local ou Buffer bruto da imagem/vídeo.
   * @param caption - Legenda opcional exibida abaixo do GIF.
   * @param opts - Opções de mídia como visualização única.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  gif(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Envia uma mensagem de áudio.
   * @param filePath - Caminho local ou Buffer bruto do áudio.
   * @param opts - Se deve enviar como mensagem de voz (ptt) e/ou visualização única.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  audio(source: string | Buffer, opts?: SendAudioOptions): MessageHandle;
  /**
   * Envia uma figurinha.
   * @param source - Caminho local ou um Buffer bruto de imagem para converter em figurinha.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  sticker(source: string | Buffer): MessageHandle;
  /**
   * Envia um arquivo arbitrário como anexo de documento.
   * @param filePath - Caminho local ou Buffer bruto do arquivo.
   * @param filename - Nome de arquivo exibido ao destinatário; o padrão é o nome-base de `filePath`.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   */
  file(source: string | Buffer, filename?: string): MessageHandle;
  /**
   * Envia uma enquete (sem rastreamento de votos — use {@link PollApi.create} se precisar de resultados/vencedor).
   * @param question - A pergunta da enquete.
   * @param options - Opções de resposta da enquete (2 ou mais).
   * @param opts - Configurações da enquete, como permitir múltiplas respostas.
   * @returns Um {@link MessageHandle} para a mensagem enviada.
   * @see PollApi.create
   */
  poll(question: string, options: string[], opts?: SendPollOptions): MessageHandle;
}

/**
 * `ctx.send` no contexto de execução — vinculado ao chat atual, mais `.to()` para outros chats.
 *
 * @example
 * ```js
 * await ctx.send.text("reply in this chat");
 * await ctx.send.to("5511999999999@s.whatsapp.net").text("direct message");
 * ```
 */
export interface SendApi extends WAMessageSender {
  /**
   * Obtém um sender vinculado a um chat diferente.
   * @param targetJid - O JID do chat/contato de destino.
   * @returns Um {@link WAMessageSender} vinculado a `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

/**
 * `ctx.send` no contexto de setup — ainda não há um "chat atual", só `.to()`.
 *
 * @see SendApi
 */
export interface SetupSendApi {
  /**
   * Obtém um sender vinculado a um chat específico.
   * @param targetJid - O JID do chat/contato de destino.
   * @returns Um {@link WAMessageSender} vinculado a `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

// ── Contexto de mensagem (ctx.msg) ───────────────────────────────────────────

/** Tipo normalizado de uma mensagem recebida do WhatsApp. */
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
 * Informações de contato normalizadas, conforme retornadas por
 * {@link WAMessageContext.getContact} e {@link ContactsApi.get}.
 */
export interface NormalizedContact {
  /**
   * O identificador primário do contato. Para usuários, é o JID `@lid`
   * quando conhecido, ou `null` se o LID não pôde ser resolvido. Para
   * grupos, é o JID `@g.us`.
   */
  id: string | null;
  /**
   * O número de telefone do contato no formato canônico E.164 (com `+`
   * à esquerda), ou `null` quando não resolvido ou não for um número
   * válido.
   */
  number: string | null;
  /**
   * Apenas os dígitos do número de telefone (sem `+`), ou `null`.
   */
  numberRaw: string | null;
  /**
   * Número de telefone formatado internacionalmente (ex.: `+55 16 99999 9999`), ou `null`.
   */
  numberPretty: string | null;
  /**
   * Código de país ISO 3166-1 alpha-2 (ex.: `BR`, `PH`, `US`), ou `null`.
   */
  country: string | null;
  /**
   * Código de discagem internacional ITU (ex.: `55`, `63`, `1`), ou `null`.
   */
  countryCallingCode: string | null;
  pushname: string | null;
  name: string | null;
  /** Sempre `null` no Baileys (não há equivalente de shortName no protocolo). */
  shortName: null;
  /** Se é uma conta WhatsApp Business, resolvido através de uma chamada em tempo real a `getBusinessProfile()`. */
  isBusiness: boolean;
  /** Sempre `false` hoje — ainda não derivado de dados reais do WhatsApp. Não confie neste campo. */
  isEnterprise: boolean;
  /** Sempre `false` hoje — ainda não derivado de dados reais do WhatsApp. Não use isto para verificar se um contato bloqueou *você*. */
  isBlocked: boolean;
  isMe: boolean;
  isWAAccount: boolean;
  isUser: boolean;
  isGroup: boolean;
  mention: { text: string; mentions: string[] };
}

/**
 * Array de mensagens passadas (da mais antiga → mais recente), conforme
 * retornado por `ctx.chat.history`. Comporta-se como um array normal
 * (`history[10]`, `.length`, `.map()`, ...) mais dois filtros de
 * conveniência, ambos encadeáveis e re-envolvidos como WAHistoryArray.
 */
export interface WAHistoryArray extends Array<WAMessageContext> {
  /** As últimas `n` mensagens (mais antiga → mais recente). Omita `n` para a lista completa. */
  last(n?: number): WAHistoryArray;
  /** Apenas mensagens enviadas por `senderId`. */
  from(senderId: string): WAHistoryArray;
}

/**
 * Visão normalizada da mensagem recebida, disponível como `ctx.msg` no
 * contexto de execução. Prefira este tipo em vez de `ctx.wa.msg` para a
 * lógica cotidiana.
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
  type: string;
  fromMe: boolean;
  /** JID do remetente canônico-LID (`@lid`), ou `null` quando ainda não há LID conhecido para este contato. */
  sender: string | null;
  /** Forma de número de telefone (`@c.us`) do remetente, ou `null` quando indisponível. Para comparar com config baseada em número de telefone; prefira `sender` para identidade. */
  senderPn: string | null;
  senderName: string;
  /** Nome do comando sem o prefixo; string vazia se não for um comando. */
  command: string;
  /** Tudo após o comando, dividido por espaço em branco. */
  args: string[];
  /**
   * True se esta mensagem invocou o comando informado (sem diferenciar maiúsculas/minúsculas).
   * @param cmd - Nome do comando, sem o prefixo.
   * @returns Se `ctx.msg.command` corresponde a `cmd`.
   */
  is(cmd: string): boolean;
  hasMedia: boolean;
  isGif: boolean;
  /**
   * Baixa a mídia desta mensagem, se houver.
   * @param opts - Quando `asMp4` é true, figurinhas animadas são convertidas para mp4.
   * @returns A mídia como `data` em base64 com seu `mimetype`, ou `null` se não houver mídia
   * ou o download tiver falhado.
   */
  downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  hasReply: boolean;
  /**
   * Busca a mensagem que esta está citando/respondendo. Retorna o mesmo
   * formato normalizado do próprio `ctx.msg` (não os dados brutos do
   * Baileys) — então `.hasMedia`, `.downloadMedia()`, `.reply.text(...)`
   * etc. funcionam diretamente no resultado.
   *
   * Resolve de forma síncrona a partir de dados que a mensagem atual já
   * carrega (a citação vem embutida no seu `contextInfo`) — sem chamada
   * de rede, então não há atraso relevante para aguardar aqui.
   *
   * O `.senderName` da mensagem citada só reflete um nome de exibição
   * real se o bot já viu aquele remetente postar pelo menos uma vez
   * enquanto estava online; caso contrário, recorre ao número puro
   * (mesma ressalva de {@link WAMessageContext.getContact}).
   * @returns A mensagem citada como um {@link WAMessageContext}, ou `null` se esta mensagem não for uma resposta.
   */
  getReply(): Promise<WAMessageContext | null>;
  /** True se a mensagem contém qualquer @menção. */
  hasMention: boolean;
  /** True se a mensagem @menciona o próprio bot. */
  hasBotMention: boolean;
  /** `contextInfo.mentionedJid`, com PN já resolvido para `@lid` quando conhecido. Array vazio se não houver menções. */
  mentionedJid: string[];
  /** Responde a esta mensagem (citando-a). */
  reply: WAMessageSender;
  /**
   * Reage a esta mensagem.
   * @param emoji - Um único caractere de emoji, ex.: `"👍"`. Passe `""` para remover uma reação existente.
   */
  react(emoji: string): Promise<unknown>;
  /**
   * Exclui esta mensagem.
   * @param forEveryone - Se true, exclui para todos os destinatários; caso contrário, só para o bot. O padrão é true.
   */
  delete(forEveryone?: boolean | undefined): Promise<unknown>;
  /**
   * Edita o texto desta mensagem (só funciona nas próprias mensagens do bot).
   * @param text - O novo conteúdo de texto.
   */
  edit(text: string): Promise<unknown>;
  /**
   * Fixa esta mensagem.
   * @param duration - Duração da fixação em segundos. Usa o padrão do driver se omitido.
   * @deprecated Ainda não suportado com o Baileys — registra um aviso e não faz nada.
   */
  pin(duration?: number): Promise<void>;
  hasPrefix: boolean;
  /**
   * Busca informações normalizadas sobre o remetente da mensagem.
   * @returns O {@link NormalizedContact} do remetente, ou `null` se o bot ainda não tiver
   * um registro para este contato (comum para um JID `@lid` que o bot ainda não viu postar —
   * isso se resolve na *próxima* mensagem ao vivo dele, já que o pushname é aprendido a partir da
   * própria mensagem, não apenas da sincronização de contatos do WhatsApp). Sempre verifique
   * `null` antes de ler campos do resultado.
   */
  getContact(): Promise<NormalizedContact | null>;
}

// ── Contexto de chat (ctx.chat) ──────────────────────────────────────────────

/** Um participante de grupo, conforme retornado por {@link ChatContext.getParticipants}. */
export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Visão normalizada do chat atual, disponível como `ctx.chat` no contexto de execução.
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
   * Mensagens passadas deste chat (mais antiga → mais recente). Filtros de
   * conveniência: `history.last(n)`, `history.from(senderId)`.
   */
  history: WAHistoryArray;
  /**
   * Lista os participantes de grupo do chat.
   * @returns Os participantes do grupo, ou `[]` para chats que não são grupo.
   */
  getParticipants(): Promise<GroupParticipant[]>;
  /**
   * Verifica se um determinado contato é admin do grupo.
   * @param contactId - O JID do contato/participante a verificar.
   * @returns Se aquele contato é admin deste grupo.
   */
  isAdmin(contactId: string): Promise<boolean>;
  /** @returns Se o remetente da mensagem atual é admin do grupo. */
  isSenderAdmin(): Promise<boolean>;
  /** @returns Se o próprio bot é admin do grupo. */
  isBotAdmin(): Promise<boolean>;
  /**
   * Limpa todas as mensagens deste chat.
   * @deprecated Não suportado com o Baileys — registra um aviso e não faz nada.
   */
  clearMessages(): Promise<void>;
  /**
   * Busca qualquer outro chat (grupo ou DM) pelo seu JID, retornando um
   * novo {@link ChatContext} com essa exata mesma forma — ele próprio
   * também é `getChat()`-ável. Diferente de todos os outros métodos
   * aqui, que ficam vinculados ao chat sobre o qual esta instância é,
   * este busca um chat que o plugin não está processando no momento
   * (ex: um descoberto via {@link ChatsApi.all} ou guardado antes).
   *
   * `isSenderAdmin()` no chat retornado ainda se refere ao remetente da
   * mensagem que disparou a execução atual do plugin — não existe outro
   * "remetente" sobre o qual perguntar.
   * @param jid - O JID do chat alvo (ex: `"123...@g.us"`).
   * @returns O chat, ou `null` se `jid` for um grupo inacessível/inválido
   *   (bot não é membro, id errado, etc). Nunca lança exceção.
   * @example
   * ```js
   * const outro = await ctx.chat.getChat("123456789@g.us");
   * if (outro) console.log(outro.name, await outro.getParticipants());
   * ```
   */
  getChat(jid: string): Promise<ChatContext | null>;
}

// ── API de administração (ctx.admin) ─────────────────────────────────────────

/**
 * Resultado de uma ação de admin que, por padrão, tem como alvo o chat
 * atual. Pode ser aguardado (`await`) diretamente, ou redirecionado para
 * outro grupo com `.to(jid)`.
 *
 * @example
 * ```js
 * await ctx.admin.add("5511999999999@s.whatsapp.net").to("120363...@g.us");
 * ```
 */
export interface TargetableAction<T = unknown> extends PromiseLike<T> {
  /**
   * Redireciona esta ação para um grupo diferente em vez do chat atual.
   * @param targetJid - O JID do grupo de destino.
   */
  to(targetJid: string): Promise<T>;
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null | undefined): Promise<T>;
}

/**
 * Ações de administração de grupo, vinculadas ao chat atual no contexto
 * de execução. No contexto de setup, todo método exige um alvo explícito
 * — seja via `.to(jid)` no {@link TargetableAction} retornado, seja (para
 * `getInviteLink`) diretamente como argumento `groupId`.
 */
export interface AdminApi {
  /**
   * Adiciona um ou mais membros ao grupo.
   * @param memberIds - Um único JID ou um array de JIDs para adicionar.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  add(memberIds: string | string[]): TargetableAction;
  /**
   * Remove um ou mais membros do grupo.
   * @param memberIds - Um único JID ou um array de JIDs para remover.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  kick(memberIds: string | string[]): TargetableAction;
  /**
   * Promove um ou mais membros a admin do grupo.
   * @param memberIds - Um único JID ou um array de JIDs para promover.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  promote(memberIds: string | string[]): TargetableAction;
  /**
   * Rebaixa um ou mais admins de volta a membros comuns.
   * @param memberIds - Um único JID ou um array de JIDs para rebaixar.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  demote(memberIds: string | string[]): TargetableAction;
  /**
   * Renomeia o grupo.
   * @param name - O novo assunto/nome do grupo.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  setSubject(name: string): TargetableAction;
  /**
   * Define a descrição do grupo.
   * @param text - O novo texto de descrição.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  setDescription(text: string): TargetableAction;
  /**
   * Define a foto de perfil do grupo.
   * @param source - Caminho local do arquivo ou um Buffer bruto de imagem.
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  setProfilePic(source: string | Buffer): TargetableAction;
  /**
   * Obtém o link de convite de um grupo.
   * @param groupId - JID do grupo alvo. Usa o chat atual por padrão; obrigatório no contexto de setup.
   * @returns O link de convite atual do grupo.
   */
  getInviteLink(groupId?: string): Promise<string>;
  /**
   * Revoga o link de convite atual, invalidando-o (um novo é gerado na próxima solicitação).
   * @returns Um {@link TargetableAction}, aguardável ou redirecionável via `.to(jid)`.
   */
  revokeInvite(): TargetableAction;
}

// ── API "Me" (ctx.me) — a própria conta do bot ───────────────────────────────

/** Ações sobre a própria conta/perfil do WhatsApp do bot. */
export interface MeApi {
  /**
   * Define o nome de exibição do bot.
   * @param name - O novo nome de exibição.
   */
  setName(name: string): Promise<unknown>;
  /**
   * Define o texto de status "Recado" do bot.
   * @param text - O novo texto de recado.
   */
  setAbout(text: string): Promise<unknown>;
  /**
   * Define a foto de perfil do bot.
   * @param source - Caminho local do arquivo ou um Buffer bruto de imagem.
   */
  setProfilePic(source: string | Buffer): Promise<unknown>;
}

// ── API de enquete (ctx.poll) ─────────────────────────────────────────────────

/**
 * Handle para uma enquete com rastreamento de votos em tempo real,
 * retornado por {@link PollApi.create} e {@link PollApi.get}.
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
   * Registra um callback chamado a cada mudança de voto.
   * @param cb - Recebe a contagem atual e o payload de voto bruto do Baileys.
   * @returns `this`, para encadear mais chamadas `.onVote(...)`.
   */
  onVote(cb: (results: Record<string, number>, raw: unknown) => void): this;
  /** @returns A contagem atual como um objeto simples: `{ nomeDaOpcao: numeroDeVotos }`. */
  results(): Record<string, number>;
  /** @returns Nome(s) da(s) opção(ões) líder(es). Array vazio se ainda não houver votos. */
  winner(): string[];
  /** Para de rastrear esta enquete. Novos votos não atualizarão mais {@link PollHandle.results}. */
  close(): void;
}

/** Criação e busca de enquetes, com rastreamento de votos (diferente de {@link WAMessageSender.poll}). */
export interface PollApi {
  /**
   * Envia uma enquete e começa a rastrear os votos.
   * @param question - A pergunta da enquete.
   * @param options - Opções de resposta da enquete (2 ou mais).
   * @param opts - Configurações da enquete, como permitir múltiplas respostas.
   * @returns Um {@link PollHandle} para rastrear os resultados.
   * @example
   * ```js
   * const poll = await ctx.poll.create("Lunch?", ["Pizza", "Sushi", "Burger"]);
   * ```
   */
  create(question: string, options: string[], opts?: { allowMultipleAnswers?: boolean }): Promise<PollHandle>;
  /**
   * Recupera uma enquete ativa pelo ID da mensagem.
   * @param msgId - O ID da mensagem da enquete.
   * @returns O {@link PollHandle} correspondente, ou `null` se não encontrada/não rastreada mais.
   */
  get(msgId: string): PollHandle | null;
}

// ── API de contatos (ctx.contacts) ─────────────────────────────────────────────

/** Busca e gerenciamento de contatos do WhatsApp. */
export interface ContactsApi {
  /**
   * Busca informações normalizadas sobre um contato.
   * @param contactId - O JID do contato.
   * @param opts - Quando `contactId` é um `@lid` bruto e `opts.groupId` é informado, faz uma
   * verificação cruzada contra uma chamada em tempo real a `groupMetadata()` daquele grupo (que
   * carrega o `phoneNumber` atual e oficial do WhatsApp para participantes `@lid`) antes de
   * resolver, em vez de confiar apenas no mapeamento heurístico e possivelmente desatualizado
   * `@lid` → número de telefone do armazenamento local. Informe isso sempre que tiver um groupId
   * à mão e não puder garantir por outra via que o mapeamento está atualizado — ex.: dentro de um
   * handler de `group-participants.update`. Melhor esforço: recorre silenciosamente à heurística
   * existente em caso de qualquer falha.
   * @returns As informações {@link NormalizedContact} do contato, ou `null` se o bot ainda não
   * tiver um registro para este JID (comum logo após a *primeira* mensagem de um novo contato
   * `@lid` — resolve-se assim que ele tiver postado ao menos uma mensagem com o bot online).
   * Dentro de um handler de mensagem, prefira {@link WAMessageContext.getContact} para o
   * remetente atual — ele também resolve o `@lid` para você.
   */
  get(contactId: string, opts?: { groupId?: string }): Promise<NormalizedContact | null>;
  /**
   * Obtém a URL da foto de perfil de um contato. Acessa a rede do
   * WhatsApp a cada chamada (tipicamente ~150-350ms) — não há camada de
   * cache, então evite chamar isto em um loop apertado (ex.: uma vez
   * por membro do grupo) sem espaçar as chamadas.
   * @param contactId - O JID do contato.
   * @returns A URL da foto, ou `null` — tanto para um contato sem foto definida *quanto* para
   * uma falha de rede/timeout. Os dois casos não são distinguíveis pelo valor de retorno.
   */
  getPfpUrl(contactId: string): Promise<string | null>;
  /**
   * Baixa a foto de perfil do contato para o disco.
   * @param contactId - O JID do contato.
   * @param destPath - Onde salvar a imagem, ex.: via `ctx.storage.resolve(...)`.
   * @returns O caminho do arquivo salvo, ou `null` se indisponível.
   */
  getPfpPath(contactId: string, destPath: string): Promise<string | null>;
  /**
   * Obtém o texto de status "Recado" de um contato.
   * @param contactId - O JID do contato.
   * @returns O texto do recado, ou `null` se indisponível.
   */
  getAbout(contactId: string): Promise<string | null>;
  /**
   * Bloqueia um contato.
   * @param contactId - O JID do contato.
   */
  block(contactId: string): Promise<void>;
  /**
   * Desbloqueia um contato.
   * @param contactId - O JID do contato.
   */
  unblock(contactId: string): Promise<void>;
}

// ── API de chats (ctx.chats) ─────────────────────────────────────────────────

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
}

/** Listagem de chats somente leitura, disponível como `ctx.chats`. */
export interface ChatsApi {
  /** Todos os chats conhecidos (apenas cache, sem rede). */
  all(): ChatSummary[];
}

// ── API de armazenamento (ctx.storage) ────────────────────────────────────────

/** Armazenamento de arquivos privado por plugin. */
export interface StorageApi {
  /** Caminho absoluto para o diretório de dados privado deste plugin. */
  dir: string;
  /**
   * Resolve um caminho dentro do diretório de dados do plugin, criando
   * diretórios pais conforme necessário.
   * @param relativePath - Caminho relativo a {@link StorageApi.dir}.
   * @returns O caminho absoluto resolvido.
   * @throws Se `relativePath` tentar um path traversal ou for um caminho absoluto.
   */
  resolve(relativePath: string): string;
}

// ── APIs de config / i18n / utils / download / plugins / log ─────────────────

/** Acesso somente leitura aos valores de configuração do bot. */
export interface ConfigApi {
  /**
   * Lê um valor de configuração.
   * @param key - A chave de configuração.
   * @param defaultValue - Valor retornado se `key` não estiver definida.
   * @returns O valor de configuração, ou `defaultValue` se não definido.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
}

/** Auxiliares de tradução/localização, disponíveis como `ctx.i18n` (e `ctx.t` como atalho para `ctx.i18n.t`). */
export interface I18nApi {
  /**
   * Traduz uma chave.
   * @param args - Chave de tradução seguida de quaisquer valores de interpolação, repassados ao mecanismo de i18n subjacente.
   * @returns A string traduzida.
   */
  t(key: string): string;
  t(key: string, context: Record<string, unknown>): string | Record<string, unknown>;
  /**
   * Cria um `t()` vinculado aos próprios arquivos de idioma de um plugin.
   * @param pluginMetaUrl - Passe `import.meta.url` do arquivo do plugin.
   * @returns Uma função `t()` vinculada aos idiomas daquele plugin.
   * @example
   * ```js
   * const { t } = ctx.i18n.createT(import.meta.url);
   * console.log(t("greeting"));
   * ```
   */
  createT(pluginMetaUrl: string): { t: I18nApi["t"]; lang: string | null };
  /** Recarrega os arquivos de idioma do disco. */
  reload(): void;
  /** @returns O código do idioma atualmente ativo. */
  getCurrentLang(): string;
}

/** Auxiliares diversos de sistema de arquivos, disponíveis como `ctx.utils`. */
export interface UtilsApi {
  /**
   * Apaga todo o conteúdo de uma pasta sem remover a pasta em si.
   * @param dirPath - Caminho do diretório a esvaziar.
   */
  emptyFolder(folderPath: string): void;
}

/** Fila de downloads em segundo plano, disponível como `ctx.download`. Apenas um job roda por vez. */
export interface DownloadApi {
  /**
   * Enfileira uma função de trabalho de download para rodar em segundo
   * plano, serializada atrás de qualquer outro job pendente. Não baixe
   * diretamente dentro de um handler de mensagem — isso bloqueia o
   * event loop, e como os plugins são despachados em sequência, atrasa
   * também a resposta de todos os outros plugins.
   * @param workFn - A função que realiza o download.
   * @param errorFn - Chamada com o erro se `workFn` lançar/rejeitar. Se
   * omitida, o erro é registrado em log em vez de ser silenciosamente engolido.
   */
  enqueue(workFn: () => Promise<void>, errorFn?: (error: Error) => Promise<void>): void;
}

/** Agendamento de tarefas no estilo cron, disponível como `ctx.scheduler`. */
export interface SchedulerApi {
  /**
   * Registra uma tarefa cron, vinculada a este plugin.
   * @param expression - Uma expressão cron, ex.: `"0 9 * * 1"` (toda segunda-feira às 9h).
   * @param fn - A função a executar conforme o agendamento.
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
   * Busca a API pública de outro plugin.
   * @param name - O nome do outro plugin.
   * @returns Sua API pública, ou `null` se ele não estiver ativo.
   */
  get(name: string): unknown;
  /**
   * Busca a API pública de outro plugin, exigindo que ele exista.
   * @param name - O nome do outro plugin.
   * @returns Sua API pública.
   * @throws Se o plugin não existir ou não estiver ativo.
   */
  require(name: string): unknown;
  /**
   * Verifica se outro plugin existe e está ativo.
   * @param name - O nome do plugin a verificar.
   */
  exists(name: string): boolean;
}

// ── API de comandos (ctx.commands) — kernel/commandAccess.ts, Fase 2 ─────────

/** Formato de item retornado por {@link CommandsApi.list}. */
export interface CommandInfo {
  /** Identificador estável para o comando (vinculado ao plugin). */
  id: string;
  /** O token de comando puro, sem o prefixo, ex.: `"sticker"`. */
  cmd: string;
  /** Aliases adicionais de invocação para este comando. */
  aliases: string[];
  /** A categoria de menu do comando, ou `null` se não categorizado. */
  category: string | null;
  /** Descrição curta exibida no menu, ou `null` se não houver. */
  desc: string | null;
}

/**
 * Consultas somente leitura ao registro de comandos, disponíveis como
 * `ctx.commands`. Permite que um plugin verifique se outro comando
 * existe, ou leia sua descrição/manual, sem precisar dar
 * `ctx.plugins.require()` no plugin dono.
 */
export interface CommandsApi {
  /**
   * Verifica se um comando (ou alias) está registrado.
   * @param invocation - O token de comando ou alias puro, sem o prefixo.
   */
  exists(invocation: string): boolean;
  /**
   * Obtém a descrição curta de um comando.
   * @param invocation - O token de comando ou alias puro, sem o prefixo.
   * @param lang - Código de idioma para tradução. O padrão é o idioma ativo.
   * @returns A descrição, ou `null` se o comando não existir ou não tiver nenhuma.
   */
  desc(invocation: string, lang?: string): string | null;
  /**
   * Obtém o manual/texto de ajuda completo de um comando.
   * @param invocation - O token de comando ou alias puro, sem o prefixo.
   * @param lang - Código de idioma para tradução. O padrão é o idioma ativo.
   * @returns O texto do manual, ou `null` se o comando não existir ou não tiver nenhum.
   */
  manual(invocation: string, lang?: string): string | null;
  /**
   * Lista todos os comandos registrados.
   * @param lang - Código de idioma para traduzir as descrições. O padrão é o idioma ativo.
   */
  list(lang?: string): Array<{
    id: string;
    cmd: string;
    aliases: string[];
    category: string | null;
    desc: string | null;
  }>;
  /**
   * Verifica se `text` corresponde a um dos aliases de menu/ajuda
   * configurados (ex.: `"menu"`, `"help"`, `"?"`), independente do
   * prefixo de comando.
   * @param text - O texto bruto a verificar.
   */
  isMenuAlias(text: string): boolean;
}

/** Logger vinculado ao contexto, disponível como `ctx.log`. */
export interface LogApi {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  success(...args: unknown[]): void;
}

// ── API de configurações (ctx.settings) — kernel/settingsDb.ts ───────────────
// Configurações persistentes por chat, armazenadas em SQLite.

/** Operações de get/set/delete para um único escopo de configurações (um chat, ou global). */
export interface ScopedAccessor {
  /**
   * Lê um valor de configuração.
   * @param key - A chave da configuração.
   * @param defaultValue - Valor retornado se `key` não estiver definida.
   * @returns O valor da configuração, ou `defaultValue` se não definido.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
  /** @returns Todas as configurações deste escopo como um objeto simples. */
  getAll(): Record<string, unknown>;
  /**
   * Grava um valor de configuração.
   * @param key - A chave da configuração.
   * @param value - O valor a armazenar (deve ser serializável em JSON).
   */
  set(key: string, value: unknown): void;
  /**
   * Remove uma única configuração.
   * @param key - A chave da configuração a excluir.
   */
  delete(key: string): void;
  /** Remove todas as configurações deste escopo. */
  deleteAll(): void;
}

/**
 * Armazenamento de configurações persistente por chat, apoiado em
 * SQLite, disponível como `ctx.settings`.
 *
 * @example
 * ```js
 * ctx.settings.set("greeting", "Hi!");
 * const greeting = ctx.settings.get("greeting", "Hello");
 * ```
 */
export interface SettingsApi extends ScopedAccessor {
  /** Configurações vinculadas ao bot como um todo, em vez do chat atual. */
  global: ScopedAccessor;
  /**
   * Obtém um acessor para as configurações de outro chat.
   * @param targetChatId - O ID do chat cujas configurações você quer acessar.
   * @returns Um {@link ScopedAccessor} vinculado a `targetChatId`.
   */
  forChat(targetChatId: string): ScopedAccessor;
  /**
   * Vincula o chat atual a uma comunidade compartilhada, para que ele
   * compartilhe configurações com outros chats da mesma comunidade.
   * @param communityId - O ID da comunidade a vincular.
   */
  link(communityId: string): void;
  /** Desvincula o chat atual de sua comunidade, se houver. */
  unlink(): void;
  /** @returns O ID da comunidade do chat atual, ou `null` se não vinculado. */
  getCommunityId(): string | null;
  /** @returns IDs de todos os chats vinculados à mesma comunidade do chat atual. */
  getCommunityChats(): string[];
}

// ── API de eventos (ctx.events) ──────────────────────────────────────────────

/** Inscreve-se em eventos brutos do socket Baileys / eventos internos, disponível como `ctx.events`. */
export interface EventsApi {
  /**
   * Inscreve-se em um evento interno.
   * @param event - Nome do evento, ex.: `"messages.upsert"`, `"connection.update"`, `"group-participants.update"`.
   * @param handler - Chamado com o mesmo payload que o driver emite para aquele evento.
   * @returns Uma função de cancelamento de inscrição.
   * @example
   * ```js
   * const off = ctx.events.on("group-participants.update", (update) => {
   *   ctx.log.info("participants changed", update);
   * });
   * // depois: off();
   * ```
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  /**
   * Aguarda um evento interno ser disparado uma vez.
   * @param event - Nome do evento, ex.: `"connection.update"`.
   * @returns Uma promise resolvida com o payload daquele evento na próxima vez que ele disparar.
   */
  once(event: string): Promise<unknown>;

  /** Remove todo listener que este plugin registrou via {@link EventsApi.on}. */
  cleanup(): void;
}

// ── Base compartilhada (tanto setup quanto runtime context recebem isto) ────

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
  /** Consultas somente leitura ao registro de comandos. @see CommandsApi */
  commands: CommandsApi;
  /** JID normalizado do bot, ou `null` se o socket ainda não estiver pronto. */
  botId: string | null;
}

// ── Contexto de setup — plugin.setup(ctx), chamado uma vez no carregamento ──

/**
 * Contexto passado à exportação `setup(ctx)` de um plugin, chamado uma
 * vez quando o plugin é carregado/habilitado. Ainda não há um "chat
 * atual" neste ponto.
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
  send: { to(targetJid: string): WAMessageSender };
  admin: AdminApi;
  events: EventsApi;
  me: MeApi;
  settings: { global: ScopedAccessor };
}

// ── API de sessão (ctx.session) — kernel/chatSession.ts, Fase 7 ─────────────
// Trava exclusiva por chat, para que dois plugins não possam rodar um fluxo
// interativo (jogos, um prompt cronometrado, ...) no mesmo chat ao mesmo
// tempo. O kernel só rastreia QUEM detém a trava; todo o estado do fluxo
// (timeout, entrada coletada, lógica de turnos, ...) fica dentro do plugin.
// Somente em runtime — não há chat atual para travar no momento do setup.

/** Trava de sessão exclusiva por chat, disponível como `ctx.session` (somente em runtime). */
export interface SessionApi {
  /**
   * Abre a sessão para este plugin no chat atual.
   * @returns `true` se adquirida (ou já detida por este mesmo plugin —
   * seguro chamar de novo em uma mensagem posterior do mesmo fluxo),
   * `false` se outro plugin detém a sessão no momento.
   */
  acquire(): boolean;
  /** Libera a sessão, mas só se este plugin a detém no momento. */
  release(): void;
  /** Se o chat atual tem uma sessão aberta, detida por quem quer que seja. */
  isLocked(): boolean;
  /** Se este plugin é quem detém a sessão no momento. */
  isMine(): boolean;
}

// ── runCommand (ctx.runCommand) — kernel/runCommand.ts, Fase 3/8 ────────────

/** Resultado de {@link PluginContext.runCommand}. */
export interface RunCommandResult {
  status:
    /** O comando rodou (e enviou uma resposta, se houver). */
    | "executed"
    /** Quem chamou não tem permissão para rodar este comando. */
    | "permission_denied"
    /** Um argumento obrigatório estava faltando. */
    | "argument_missing"
    /** O token de subcomando não foi reconhecido. */
    | "unknown_sub"
    /** Um comando de texto fixo (resposta fixa), ou uma invocação desconhecida — resolve em vez de lançar erro. */
    | "no_dispatch";
  /** O texto de resposta que foi realmente enviado, ou `null` se nada foi enviado. */
  sentReply: string | null;
  /** Uma resposta sugerida para mostrar a quem chamou quando `sentReply` é `null` (ex.: em `"no_dispatch"`). */
  suggestedReply: string | null;
}

// ── Contexto de execução — plugin.default(ctx), chamado a cada mensagem ─────

/**
 * Contexto passado à exportação padrão de um plugin, chamado a cada
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
  send: {
    text(text: string, opts?: { linkPreview?: boolean; mentions?: string[] }): MessageHandle;
    image(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): MessageHandle;
    video(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): MessageHandle;
    gif(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): MessageHandle;
    audio(source: string | Buffer, opts?: { asVoice?: boolean; viewOnce?: boolean }): MessageHandle;
    sticker(source: string | Buffer): MessageHandle;
    file(source: string | Buffer, filename?: string): MessageHandle;
    poll(question: string, options: string[], cfg?: { allowMultipleAnswers?: boolean }): MessageHandle;
    to(targetJid: string): WAMessageSender;
  };
  msg: WAMessageContext;
  chat: ChatContext;
  admin: AdminApi;
  me: MeApi;
  poll: PollApi;
  settings: SettingsApi;
  /** Trava de sessão exclusiva por chat. @see SessionApi */
  session: SessionApi;
  /**
   * Invoca outro comando registrado através do mesmo pipeline do kernel
   * usado para mensagens reais recebidas (verificação de permissão →
   * roteamento de subcomando → validação de argumento obrigatório →
   * despacho do handler → alerta de crash em caso de erro). Roda contra
   * um contexto vinculado ao plugin DONO do comando alvo (seu próprio
   * `storage`, `plugins`, opções de guarda), não o do chamador — mesmo
   * princípio de `ctx.plugins.require()`, mas para a superfície de
   * comandos.
   * @param invocation - O token de comando ou alias puro, sem o prefixo (ex.: `"sticker"`, não `"!sticker"`).
   * @param rawArgs - O restante da linha, sem parsing.
   */
  runCommand(invocation: string, rawArgs?: string): Promise<RunCommandResult>;
  /** Escape hatch específico do WhatsApp, para quando a API abstraída não é suficiente. `null` quando nenhum driver de WhatsApp está ativo (ex.: em um bot exclusivo de Telegram). */
  wa: {
    /** Contrato neutro em relação ao driver (substitui o antigo campo `WASocket`). */
    contract: WaContract;
    /** Armazenamento em memória (substitui o antigo campo `WAStore`). */
    store: WAStore;
    /** Envelope de mensagem neutro em relação ao driver (substitui o antigo campo `WAProtoMsg`). */
    msg: BotMessage;
    /** Baixa a mídia da mensagem atual; `asMp4` converte figurinhas animadas para mp4. */
    downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  } | null;
  /** Reservado para um futuro driver de Telegram — sempre `null` no WhatsApp. */
  tg: null;
  /** Reservado para um futuro driver de Discord — sempre `null` no WhatsApp. */
  dc: null;
}

// ── Formato do módulo de plugin ───────────────────────────────────────────────

/**
 * O que se espera que um arquivo de plugin exporte.
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
   * Chamado uma vez quando o plugin é carregado/habilitado.
   * @param ctx - O {@link SetupContext} deste plugin.
   */
  setup?(ctx: SetupContext): unknown | Promise<unknown>;
  /**
   * Chamado a cada mensagem recebida.
   * @param ctx - O {@link PluginContext} deste plugin.
   */
  default?(ctx: PluginContext): unknown | Promise<unknown>;
}

// ── Opcional: tipos globais sem import ─────────────────────────────────────
//
// Se preferir não escrever `@param {import('...').PluginContext}` em todo
// arquivo de plugin, descomente o bloco abaixo e garanta que este arquivo
// esteja incluído em qualquer tsconfig/jsconfig que cubra seus plugins
// (adicione o caminho dele em "include"). Aí todo plugin pode simplesmente
// escrever:
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
