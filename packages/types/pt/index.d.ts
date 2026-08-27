/**
 * @manybot/types
 *
 * Standalone types for the ManyBot plugin context object (`ctx`) —
 * self-contained on purpose, so plugin projects get autocomplete without
 * depending on the whole "@manybot/manybot" package. The only external
 * dependency is @whiskeysockets/baileys, which plugins already touch
 * through ctx.wa.contract/sock.
 *
 * Install:
 *
 *   npm install --save-dev @manybot/types
 *
 * Usage in a plugin file (plain JS, no build step needed):
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
 * setup(ctx) plugins use SetupContext the same way:
 *
 *   /**
 *    * @param {import('@manybot/types').SetupContext} ctx
 *    *\/
 *   export async function setup(ctx) { ... }
 *
 * If every plugin file lives under one tsconfig/jsconfig with "checkJs",
 * you can skip the per-file import entirely — see the bottom of this file
 * for a global-ambient alternative.
 */

import type { proto } from "@whiskeysockets/baileys";

/**
 * Raw incoming/stored WhatsApp message (Baileys' `proto.IWebMessageInfo`).
 * Prefer {@link WAMessageContext} for everyday plugin logic — reach for this
 * only when you need a field Baileys exposes that the normalized context
 * doesn't wrap (e.g. via `ctx.wa.msg`).
 *
 * @see WAMessageContext
 */
export type WAProtoMsg = proto.IWebMessageInfo;

/**
 * Driver-neutral message envelope. The adapter translates Baileys WAMessages
 * into this shape before the rest of the codebase sees them. Available on
 * `ctx.wa.msg` as an alternative to the old raw `WAProtoMsg`.
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
 * Identifier for a specific message on WhatsApp — the driver-neutral
 * shape of a "message key", used as the reference for reactions,
 * edits, deletes, quotes, and poll-vote bookkeeping.
 *
 * Every field is optional because every driver surface hands partial
 * keys in some contexts (e.g. a reaction handler that only knows the
 * target message ID, not the participant). Pass back whatever you
 * have; the adapter fills the rest.
 */
export interface BotQuotedRef {
  id?: string | null;
  remoteJid?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}

/** Minimal chat summary used by history payloads. */
export interface BotChatSummary {
  id: string;
  name?: string;
}

/** Plain contact summary used by history payloads. */
export interface BotContactSummary {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  /** @lid form, if known. */
  lid?: string;
}

/** Payload of `messages.upsert`. */
export interface MessagesUpsertEvent {
  messages: BotMessage[];
  type: "notify" | "append";
}

/** Payload of `messages.update`. */
export interface MessagesUpdateEvent {
  updates: Array<{ key: BotQuotedRef; update: Record<string, unknown> }>;
}

/** Payload of `messaging-history.set`. */
export interface HistorySetEvent {
  chats: BotChatSummary[];
  contacts: BotContactSummary[];
  messages: BotMessage[];
}

/** Payload of `chats.upsert`. */
export interface ChatsUpsertEvent {
  chats: BotChatSummary[];
}

/** Payload of `chats.update`. */
export interface ChatsUpdateEvent {
  updates: Array<{ id: string; name?: string }>;
}

/** Payload of `contacts.upsert`. */
export interface ContactsUpsertEvent {
  contacts: BotContactSummary[];
}

/** Payload of `contacts.update`. */
export interface ContactsUpdateEvent {
  updates: BotContactSummary[];
}

/** Payload of `group-participants.update`. */
export interface GroupParticipantsUpdateEvent {
  id: string;
  author: string;
  /** JIDs of the affected participants, normalized to user-server form. */
  participants: string[];
  action: "add" | "remove" | "promote" | "demote" | "modify";
}

/** Payload of `groups.upsert`. */
export interface GroupsUpsertEvent {
  groups: Array<{ id: string; subject?: string }>;
}

/** Payload of `groups.update`. */
export interface GroupsUpdateEvent {
  updates: Array<{ id: string }>;
}

/** Payload of `connection.update`. */
export interface ConnectionUpdateEvent {
  connection: "open" | "close" | "connecting";
  lastDisconnect?: { statusCode?: number };
}

/** Payload of `chats.delete`. */
export interface ChatsDeleteEvent {
  ids: string[];
}

/** Payload of `messages.delete`. */
export interface MessagesDeleteEvent {
  keys: BotQuotedRef[];
  /** When true, every message in `jid` was wiped (chat-clear semantics). */
  all?: { jid: string } | null;
}

/** Payload of `group.join-request`. */
export interface GroupJoinRequestEvent {
  id: string;
  author: string;
  participant: string;
  action: "created" | "revoked" | "rejected";
  method: "invite_link" | "linked_group_join" | "non_admin_add" | "unknown";
}

/** Payload of `blocklist.set`. */
export interface BlocklistSetEvent {
  blocklist: string[];
}

/** Payload of `blocklist.update`. */
export interface BlocklistUpdateEvent {
  blocklist: string[];
  type: "add" | "remove";
}

/** Driver-neutral event names surfaced on `WaContract.on`. */
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

/** Per-event payload map. */
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

/** Inputs to {@link WaContract.sendPoll}. */
export interface BotPollOptions {
  name: string;
  values: string[];
  selectableCount?: number;
}

/** Reference to a message the bot just sent. */
export interface SentMessageRef {
  id: string;
  chatId: string;
  timestamp: number;
}

/** A participant entry in {@link BotGroupMetadata.participants}. */
export interface BotGroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  /** E.164 phone-number JID, populated when the driver exposes it. */
  phoneNumber?: string;
}

/** Group metadata returned by {@link WaContract.groupMetadata}. */
export interface BotGroupMetadata {
  subject: string;
  participants: BotGroupParticipant[];
}

/** Information about the bot's own account. */
export interface BotMe {
  id: string;
  lid?: string;
}

/** Inputs to {@link WaContract.decryptPollVote}. */
export interface PollDecryptOpts {
  /** Key of the poll-vote update message. */
  voteKey: BotQuotedRef;
  /** Key of the poll-creation message. */
  pollKey: BotQuotedRef;
  /** Poll encryption key, base64-string or Buffer. */
  pollEncKey: Buffer | string;
}

/** Successful result of {@link WaContract.decryptPollVote}. */
export interface PollDecryptResult {
  /** Decrypted list of selected option hashes (SHA-256 of each option name). */
  selectedOptions: string[];
  /** Raw decrypted vote message — exposed for callers that need fields
   *  the neutral envelope intentionally doesn't model. */
  raw: unknown;
}

/** Inputs to {@link WaContract.aggregatePollVotes}. */
export interface PollAggregateOpts {
  /** Poll-creation message key. */
  pollKey: BotQuotedRef;
  /** Latest per-voter entries from {@link WaContract.decryptPollVote}. */
  votes: PollDecryptResult[];
  /** JID used to filter the bot's own votes out of the tally. */
  selfJid?: string;
}

/** One row of the aggregated tally. */
export interface PollVoteAggregate {
  name: string;
  voters: string[];
}

/**
 * Driver-neutral contract that the kernel exposes as
 * `ctx.wa.contract`. Every WhatsApp driver — Baileys today, whatsmeow
 * later — implements this interface. Plugins reach into it for the
 * protocol-level operations that aren't abstracted by `ctx.send.*`,
 * `ctx.admin.*`, etc. (e.g. `contract.groupMetadata(jid)`,
 * `contract.readMessages(keys)`).
 *
 * All event names listed in {@link WaEventName} are committed-to —
 * the adapter implements every `bindSockEventsExternal` listener for
 * each one. Optional methods (`resolveLid`, `getHistory`,
 * `decryptPollVote`, `aggregatePollVotes`) are driver-specific
 * extensions; callers MUST handle their absence.
 */
export interface WaContract {
  readonly name: "baileys" | "whatsmeow";

  // ── lifecycle ───────────────────────────────────────────────────────
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;

  /**
   * Resolve a @lid JID to the real @s.whatsapp.net JID using the
   * driver's authoritative source. Optional — drivers without a
   * protocol-level resolver can omit it.
   */
  resolveLid?(lid: string): Promise<string | null>;

  // ── event subscription ──────────────────────────────────────────────
  /**
   * Register a listener for a driver event. Returns an unsubscribe
   * function. Adapters translate the driver's own event shape into
   * the neutral payload type declared above.
   */
  on<E extends WaEventName>(event: E, handler: (payload: WaEventPayload<E>) => void): () => void;

  // ── send (text routes through sendFallbackGuard; these are direct) ─
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

  // ── presence + read ─────────────────────────────────────────────────
  sendPresenceUpdate(state: "composing" | "recording" | "paused", jid: string): Promise<void>;
  readMessages(keys: BotQuotedRef[]): Promise<void>;

  // ── contacts ────────────────────────────────────────────────────────
  onWhatsApp(jid: string): Promise<{ exists: boolean }[] | null>;
  getBusinessProfile(jid: string): Promise<unknown | null>;
  profilePictureUrl(jid: string): Promise<string | null>;
  fetchStatus(jid: string): Promise<string | null>;
  updateBlockStatus(jid: string, action: "block" | "unblock"): Promise<void>;
  addOrEditContact(jid: string, info: { fullName: string; firstName?: string; saveOnPrimaryAddressbook?: boolean }): Promise<void>;
  removeContact(jid: string): Promise<void>;

  // ── groups ──────────────────────────────────────────────────────────
  groupMetadata(jid: string): Promise<BotGroupMetadata>;
  groupParticipantsUpdate(jid: string, users: string[], action: "add" | "remove" | "promote" | "demote"): Promise<Array<{ status: string; jid?: string }>>;
  groupUpdateSubject(jid: string, subject: string): Promise<void>;
  groupUpdateDescription(jid: string, description: string): Promise<void>;
  groupInviteCode(jid: string): Promise<string>;
  groupRevokeInvite(jid: string): Promise<string>;

  // ── profile (bot + group) ───────────────────────────────────────────
  updateProfilePicture(jid: string, buffer: Buffer): Promise<void>;
  updateProfileName(name: string): Promise<void>;
  updateProfileStatus(status: string): Promise<void>;

  // ── me ───────────────────────────────────────────────────────────────
  me(): BotMe;

  // ── media (download) ────────────────────────────────────────────────
  /**
   * Download a media payload. Returns null on any failure
   * (already-downloaded media, expired blob, protocol error, etc).
   */
  downloadMedia(msg: BotMessage, opts: { asMp4?: boolean }): Promise<{ mimetype: string; data: Buffer } | null>;

  // ── verification primitive ──────────────────────────────────────────
  /**
   * Read the most recent N messages the driver has on hand for `jid`,
   * in chronological order (oldest → newest). Optional for drivers
   * that don't keep a local history.
   */
  getHistory?(jid: string, opts?: { limit?: number }): Promise<BotMessage[]>;

  // ── poll decryption (Baileys-specific) ──────────────────────────────
  /**
   * Decrypt a single poll-vote update against a known poll creation
   * message. Optional — only the Baileys driver implements it.
   */
  decryptPollVote?(opts: PollDecryptOpts): Promise<PollDecryptResult | null>;

  /**
   * Aggregate a per-voter vote history into a tally keyed by option
   * name. Optional — same rules as `decryptPollVote`.
   */
  aggregatePollVotes?(opts: PollAggregateOpts): PollVoteAggregate[];
}

/**
 * The bot's in-memory chat/contact/message store.
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

// ── Message sending ────────────────────────────────────────────────────────

/** Options for {@link WAMessageSender.text}. */
export interface SendTextOptions {
  /** Show a link preview card if the text contains a URL. Defaults to the driver's own default. */
  linkPreview?: boolean;
  /** JIDs to mention (tag) in the message, in addition to any `@number` already in the text. */
  mentions?: string[];
}

/** Options shared by media-sending methods ({@link WAMessageSender.image}, {@link WAMessageSender.video}). */
export interface SendMediaOptions {
  /** Send as a view-once media message. */
  viewOnce?: boolean;
  /** JIDs to mention (tag) in the caption. */
  mentions?: string[];
}

/** Options for {@link WAMessageSender.audio}. */
export interface SendAudioOptions {
  /** Send as a voice note (ptt). Defaults to true. */
  asVoice?: boolean;
  viewOnce?: boolean;
}

/** Options for {@link WAMessageSender.poll} and {@link PollApi.create}. */
export interface SendPollOptions {
  /** Allow voters to select more than one option. Defaults to false (single choice). */
  allowMultipleAnswers?: boolean;
}

/**
 * A pending sent message. `await` it to get the resulting {@link WAMessageContext}
 * (or `undefined` if the send failed). Also exposes chainable post-send actions.
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
   * Underlying `BotMessage` (or `undefined` if the send failed). Exposed
   * so plugins that need the raw key for follow-up operations
   * (e.g. cross-referencing against history) don't have to re-await.
   */
  readonly rawPromise: Promise<BotMessage | undefined>;
  /** Reply to the message that was just sent (quotes it). */
  readonly reply: WAMessageSender;
  /** Edit the sent message's text (only works on the bot's own messages). */
  edit(text: string): Promise<unknown>;
  /**
   * Pin the sent message.
   * @param duration - Pin duration in seconds. Driver default is used if omitted.
   * @deprecated Not currently supported by the Baileys driver — logs a warning and is a no-op.
   */
  pin(duration?: number): Promise<void>;
  /**
   * Delete the sent message.
   * @param forEveryone - If true, deletes for all recipients; otherwise only for the bot. Defaults to true.
   */
  delete(forEveryone?: boolean | undefined): Promise<unknown>;
  /**
   * React to the sent message.
   * @param emoji - A single emoji character, e.g. `"👍"`. Pass `""` to remove an existing reaction.
   */
  react(emoji: string): Promise<unknown>;
  then<TResult1 = WAMessageContext | undefined, TResult2 = never>(
    onfulfilled?: ((value: WAMessageContext | undefined) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  /**
   * Attach a handler for a rejection on the underlying send. Mirrors
   * `Promise.prototype.catch` so the handle can be used in
   * promise-chained error paths.
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined,
  ): Promise<WAMessageContext | undefined | TResult>;
  /**
   * Attach a handler run when the underlying send settles. Mirrors
   * `Promise.prototype.finally`.
   */
  finally(onfinally?: (() => void) | null | undefined): Promise<WAMessageContext | undefined>;
}

/**
 * Send methods bound to a specific chat/JID. Every method returns a {@link MessageHandle}.
 *
 * @see SendApi
 * @see SetupSendApi
 */
export interface WAMessageSender {
  /**
   * Send a text message.
   * @param content - The message body.
   * @param opts - Link preview and mention settings.
   * @returns A {@link MessageHandle} for the sent message.
   * @example
   * ```js
   * await ctx.send.text("Hello world", { mentions: ["5511999999999@s.whatsapp.net"] });
   * ```
   */
  text(content: string, opts?: SendTextOptions): MessageHandle;
  /**
   * Send an image.
   * @param filePath - Local path or raw Buffer of the image.
   * @param caption - Optional caption shown under the image.
   * @param opts - Media options such as view-once.
   * @returns A {@link MessageHandle} for the sent message.
   */
  image(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Send a video.
   * @param filePath - Local path or raw Buffer of the video.
   * @param caption - Optional caption shown under the video.
   * @param opts - Media options such as view-once or gifPlayback.
   * @returns A {@link MessageHandle} for the sent message.
   */
  video(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Send an image/video as a GIF (auto-loops, muted). Accepts `.gif` and
   * `.mp4` inputs — `.gif` files are converted to mp4 via ffmpeg automatically.
   * @param filePath - Local path or raw Buffer of the image/video.
   * @param caption - Optional caption shown below the GIF.
   * @param opts - Media options such as view-once.
   * @returns A {@link MessageHandle} for the sent message.
   */
  gif(source: string | Buffer, caption?: string, opts?: SendMediaOptions): MessageHandle;
  /**
   * Send an audio message.
   * @param filePath - Local path or raw Buffer of the audio.
   * @param opts - Whether to send as a voice note (ptt) and/or view-once.
   * @returns A {@link MessageHandle} for the sent message.
   */
  audio(source: string | Buffer, opts?: SendAudioOptions): MessageHandle;
  /**
   * Send a sticker.
   * @param source - Local file path or a raw image `Buffer` to convert into a sticker.
   * @returns A {@link MessageHandle} for the sent message.
   */
  sticker(source: string | Buffer): MessageHandle;
  /**
   * Send an arbitrary file as a document attachment.
   * @param filePath - Local path or raw Buffer of the file.
   * @param filename - Display filename shown to the recipient; defaults to the basename of `filePath`.
   * @returns A {@link MessageHandle} for the sent message.
   */
  file(source: string | Buffer, filename?: string): MessageHandle;
  /**
   * Send a poll (without vote tracking — use {@link PollApi.create} if you need results/winner).
   * @param question - The poll question.
   * @param options - Poll answer options (2 or more).
   * @param opts - Poll settings such as allowing multiple answers.
   * @returns A {@link MessageHandle} for the sent message.
   * @see PollApi.create
   */
  poll(question: string, options: string[], opts?: SendPollOptions): MessageHandle;
}

/**
 * `ctx.send` in runtime context — bound to the current chat, plus `.to()` for other chats.
 *
 * @example
 * ```js
 * await ctx.send.text("reply in this chat");
 * await ctx.send.to("5511999999999@s.whatsapp.net").text("direct message");
 * ```
 */
export interface SendApi extends WAMessageSender {
  /**
   * Get a sender bound to a different chat.
   * @param targetJid - The destination chat/contact JID.
   * @returns A {@link WAMessageSender} scoped to `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

/**
 * `ctx.send` in setup context — there's no "current chat" yet, only `.to()`.
 *
 * @see SendApi
 */
export interface SetupSendApi {
  /**
   * Get a sender bound to a specific chat.
   * @param targetJid - The destination chat/contact JID.
   * @returns A {@link WAMessageSender} scoped to `targetJid`.
   */
  to(targetJid: string): WAMessageSender;
}

// ── Message context (ctx.msg) ──────────────────────────────────────────────

/** Normalized kind of an incoming WhatsApp message. */
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
 * Normalized contact info, as returned by {@link WAMessageContext.getContact}
 * and {@link ContactsApi.get}.
 */
export interface NormalizedContact {
  /**
   * The contact's primary identifier. For users, this is the `@lid` JID when
   * known, or `null` if the LID could not be resolved. For groups, this is the
   * `@g.us` JID.
   */
  id: string | null;
  /**
   * The contact's phone number in canonical E.164 format (with leading `+`),
   * or `null` when unresolved or not a valid phone number.
   */
  number: string | null;
  /**
   * Phone number digits only (no `+`), or `null`.
   */
  numberRaw: string | null;
  /**
   * International formatted phone number (e.g. `+55 16 99999 9999`), or `null`.
   */
  numberPretty: string | null;
  /**
   * ISO 3166-1 alpha-2 country code (e.g. `BR`, `PH`, `US`), or `null`.
   */
  country: string | null;
  /**
   * ITU country calling code (e.g. `55`, `63`, `1`), or `null`.
   */
  countryCallingCode: string | null;
  pushname: string | null;
  name: string | null;
  /** Always `null` in Baileys (no shortName equivalent on the wire). */
  shortName: null;
  /** Whether this is a WhatsApp Business account, resolved via a live `getBusinessProfile()` call. */
  isBusiness: boolean;
  /** Always `false` today — not yet derived from real WhatsApp data. Don't rely on it. */
  isEnterprise: boolean;
  /** Always `false` today — not yet derived from real WhatsApp data. Don't use this to check whether a contact has blocked *you*. */
  isBlocked: boolean;
  isMe: boolean;
  isWAAccount: boolean;
  isUser: boolean;
  isGroup: boolean;
  mention: { text: string; mentions: string[] };
}

/**
 * Array of past messages (oldest → newest), as returned by `ctx.chat.history`.
 * Behaves like a normal array (`history[10]`, `.length`, `.map()`, ...) plus
 * two convenience filters, both chainable and re-wrapped as WAHistoryArray.
 */
export interface WAHistoryArray extends Array<WAMessageContext> {
  /** Last `n` messages (oldest → newest). Omit `n` for the full list. */
  last(n?: number): WAHistoryArray;
  /** Only messages sent by `senderId`. */
  from(senderId: string): WAHistoryArray;
}

/**
 * Normalized view of the incoming message, available as `ctx.msg` in
 * runtime context. Prefer this over `ctx.wa.msg` for everyday logic.
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
  /** Normalized sender JID (group participant or DM remote JID). */
  sender: string;
  senderName: string;
  /** Command name without the prefix; empty string if this isn't a command. */
  command: string;
  /** Everything after the command, split on whitespace. */
  args: string[];
  /**
   * True if this message invoked the given command (case-insensitive).
   * @param cmd - Command name, without the prefix.
   * @returns Whether `ctx.msg.command` matches `cmd`.
   */
  is(cmd: string): boolean;
  hasMedia: boolean;
  isGif: boolean;
  /**
   * Download this message's media, if any.
   * @param opts - When `asMp4` is true, animated stickers are converted to mp4.
   * @returns The media as base64 `data` with its `mimetype`, or `null` if there's no media
   * or the download failed.
   */
  downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  hasReply: boolean;
  /**
   * Fetch the message this one is quoting/replying to. Returns the same
   * normalized shape as `ctx.msg` itself (not raw Baileys data) — so
   * `.hasMedia`, `.downloadMedia()`, `.reply.text(...)`, etc. all work
   * directly on the result.
   *
   * Resolves synchronously from data the current message already carries
   * (the quote is embedded in its `contextInfo`) — no network call, so
   * there's no meaningful delay to await here.
   *
   * The quoted message's `.senderName` reflects a real display name only if
   * the bot has already seen that sender post at least once while online;
   * otherwise it falls back to their bare number (same caveat as
   * {@link WAMessageContext.getContact}).
   * @returns The quoted message as a {@link WAMessageContext}, or `null` if this message isn't a reply.
   */
  getReply(): Promise<WAMessageContext | null>;
  /** True if the message contains any @mention at all. */
  hasMention: boolean;
  /** True if the message @mentions the bot itself. */
  hasBotMention: boolean;
  /** Reply to this message (quotes it). */
  reply: WAMessageSender;
  /**
   * React to this message.
   * @param emoji - A single emoji character, e.g. `"👍"`. Pass `""` to remove an existing reaction.
   */
  react(emoji: string): Promise<unknown>;
  /**
   * Delete this message.
   * @param forEveryone - If true, deletes for all recipients; otherwise only for the bot. Defaults to true.
   */
  delete(forEveryone?: boolean | undefined): Promise<unknown>;
  /**
   * Edit this message's text (only works on the bot's own messages).
   * @param text - The new text content.
   */
  edit(text: string): Promise<unknown>;
  /**
   * Pin this message.
   * @param duration - Pin duration in seconds. Driver default is used if omitted.
   * @deprecated Not supported with Baileys yet — logs a warning and is a no-op.
   */
  pin(duration?: number): Promise<void>;
  hasPrefix: boolean;
  /**
   * Fetch normalized info about the message sender.
   * @returns The sender's {@link NormalizedContact}, or `null` if the bot doesn't have a
   * record for this contact yet (common for a `@lid` JID the bot hasn't seen post before —
   * this resolves on their *next* live message, since the pushname is learned from the
   * message itself, not just from WhatsApp's contact sync). Always check for `null` before
   * reading fields off the result.
   */
  getContact(): Promise<NormalizedContact | null>;
}

// ── Chat context (ctx.chat) ─────────────────────────────────────────────────

/** A group chat participant, as returned by {@link ChatContext.getParticipants}. */
export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Normalized view of the current chat, available as `ctx.chat` in runtime context.
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
   * Past messages in this chat (oldest → newest). Convenience filters:
   * `history.last(n)`, `history.from(senderId)`.
   */
  history: WAHistoryArray;
  /**
   * List the chat's group participants.
   * @returns The group's participants, or `[]` for non-group chats.
   */
  getParticipants(): Promise<GroupParticipant[]>;
  /**
   * Check whether a given contact is a group admin.
   * @param contactId - The contact/participant JID to check.
   * @returns Whether that contact is an admin of this group.
   */
  isAdmin(contactId: string): Promise<boolean>;
  /** @returns Whether the sender of the current message is a group admin. */
  isSenderAdmin(): Promise<boolean>;
  /** @returns Whether the bot itself is a group admin. */
  isBotAdmin(): Promise<boolean>;
  /**
   * Clear all messages in this chat.
   * @deprecated Not supported with Baileys — logs a warning and is a no-op.
   */
  clearMessages(): Promise<void>;
}

// ── Admin API (ctx.admin) ───────────────────────────────────────────────────

/**
 * Result of an admin action that targets the current chat by default.
 * Awaitable directly, or redirect it to another group with `.to(jid)`.
 *
 * @example
 * ```js
 * await ctx.admin.add("5511999999999@s.whatsapp.net").to("120363...@g.us");
 * ```
 */
export interface TargetableAction<T = unknown> extends PromiseLike<T> {
  /**
   * Redirect this action to a different group instead of the current chat.
   * @param targetJid - The target group JID.
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
 * Group administration actions, scoped to the current chat in runtime context.
 * In setup context these all throw at call time (no current chat), except
 * `.add(...).to(jid)` and `.getInviteLink(groupId)`, which both accept an
 * explicit group directly.
 */
export interface AdminApi {
  /**
   * Add one or more members to the group.
   * @param memberIds - A single JID or an array of JIDs to add.
   * @returns A {@link TargetableAction}, awaitable or redirectable via `.to(jid)`.
   */
  add(memberIds: string | string[]): TargetableAction;
  /**
   * Remove one or more members from the group.
   * @param memberIds - A single JID or an array of JIDs to remove.
   */
  kick(memberIds: string | string[]): Promise<unknown>;
  /**
   * Promote one or more members to group admin.
   * @param memberIds - A single JID or an array of JIDs to promote.
   */
  promote(memberIds: string | string[]): Promise<unknown>;
  /**
   * Demote one or more admins back to regular members.
   * @param memberIds - A single JID or an array of JIDs to demote.
   */
  demote(memberIds: string | string[]): Promise<unknown>;
  /**
   * Rename the group.
   * @param name - The new group subject/name.
   */
  setSubject(name: string): Promise<unknown>;
  /**
   * Set the group description.
   * @param text - The new description text.
   */
  setDescription(text: string): Promise<unknown>;
  /**
   * Set the group's profile picture.
   * @param source - Local file path or a raw image `Buffer`.
   */
  setProfilePic(source: string | Buffer): Promise<unknown>;
  /**
   * Get a group's invite link.
   * @param groupId - Target group JID. Defaults to the current chat; required in setup context.
   * @returns The group's current invite link.
   */
  getInviteLink(groupId?: string): Promise<string>;
  /** Revoke the current invite link, invalidating it (a new one is generated on next request). */
  revokeInvite(): Promise<unknown>;
}

// ── Me API (ctx.me) — the bot's own account ────────────────────────────────

/** Actions on the bot's own WhatsApp account/profile. */
export interface MeApi {
  /**
   * Set the bot's display name.
   * @param name - The new display name.
   */
  setName(name: string): Promise<unknown>;
  /**
   * Set the bot's "About" status text.
   * @param text - The new about text.
   */
  setAbout(text: string): Promise<unknown>;
  /**
   * Set the bot's profile picture.
   * @param source - Local file path or a raw image `Buffer`.
   */
  setProfilePic(source: string | Buffer): Promise<unknown>;
}

// ── Poll API (ctx.poll) ──────────────────────────────────────────────────────

/**
 * Handle to a poll with live vote tracking, returned by {@link PollApi.create}
 * and {@link PollApi.get}.
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
   * Register a callback invoked on every vote change.
   * @param cb - Receives the current tally and the raw Baileys vote payload.
   * @returns `this`, for chaining further `.onVote(...)` calls.
   */
  onVote(cb: (results: Record<string, number>, raw: unknown) => void): this;
  /** @returns Current tally as a plain object: `{ optionName: voteCount }`. */
  results(): Record<string, number>;
  /** @returns Name(s) of the leading option(s). Empty array if no votes yet. */
  winner(): string[];
  /** Stop tracking this poll. Further votes will no longer update {@link PollHandle.results}. */
  close(): void;
}

/** Poll creation and lookup, with vote tracking (unlike {@link WAMessageSender.poll}). */
export interface PollApi {
  /**
   * Send a poll and start tracking votes.
   * @param question - The poll question.
   * @param options - Poll answer options (2 or more).
   * @param opts - Poll settings such as allowing multiple answers.
   * @returns A {@link PollHandle} for tracking results.
   * @example
   * ```js
   * const poll = await ctx.poll.create("Lunch?", ["Pizza", "Sushi", "Burger"]);
   * ```
   */
  create(question: string, options: string[], opts?: { allowMultipleAnswers?: boolean }): Promise<PollHandle>;
  /**
   * Retrieve an active poll by its message ID.
   * @param msgId - The poll message's ID.
   * @returns The matching {@link PollHandle}, or `null` if not found/no longer tracked.
   */
  get(msgId: string): PollHandle | null;
}

// ── Contacts API (ctx.contacts) ──────────────────────────────────────────────

/** Lookup and management of WhatsApp contacts. */
export interface ContactsApi {
  /**
   * Fetch normalized info about a contact.
   * @param contactId - The contact's JID.
   * @param opts - When `contactId` is a raw `@lid` and `opts.groupId` is given, cross-checks
   * it against a live `groupMetadata()` call for that group (which carries WhatsApp's own
   * current `phoneNumber` for `@lid` participants) before resolving, instead of trusting only
   * the store's heuristic, possibly-stale `@lid` → phone-number mapping. Pass this whenever
   * you have a groupId handy and can't otherwise be sure the mapping is fresh — e.g. inside a
   * `group-participants.update` handler. Best-effort: silently falls back to the existing
   * heuristic on any failure.
   * @returns The contact's {@link NormalizedContact} info, or `null` if the bot doesn't have
   * a record for this JID yet (common right after a new `@lid` contact's *first* message —
   * it resolves once they've posted at least one message while the bot was online). Inside a
   * message handler, prefer {@link WAMessageContext.getContact} for the current sender — it
   * additionally resolves `@lid` for you.
   */
  get(contactId: string, opts?: { groupId?: string }): Promise<NormalizedContact | null>;
  /**
   * Get a contact's profile picture URL. Hits the WhatsApp network on every
   * call (typically ~150-350ms) — there's no caching layer, so avoid
   * calling this in a tight loop (e.g. once per group member) without
   * spacing calls out.
   * @param contactId - The contact's JID.
   * @returns The picture URL, or `null` — both for a contact with no picture set *and* for
   * a network failure/timeout. The two cases aren't distinguishable from the return value.
   */
  getPfpUrl(contactId: string): Promise<string | null>;
  /**
   * Download the contact's profile picture to disk.
   * @param contactId - The contact's JID.
   * @param destPath - Where to save the image, e.g. via `ctx.storage.resolve(...)`.
   * @returns The saved file's path, or `null` if unavailable.
   */
  getPfpPath(contactId: string, destPath: string): Promise<string | null>;
  /**
   * Get a contact's "About" status text.
   * @param contactId - The contact's JID.
   * @returns The about text, or `null` if unavailable.
   */
  getAbout(contactId: string): Promise<string | null>;
  /**
   * Block a contact.
   * @param contactId - The contact's JID.
   */
  block(contactId: string): Promise<void>;
  /**
   * Unblock a contact.
   * @param contactId - The contact's JID.
   */
  unblock(contactId: string): Promise<void>;
}

// ── Chats API (ctx.chats) ───────────────────────────────────────────────────

export interface ChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
}

/** Read-only chat listing, available as `ctx.chats`. */
export interface ChatsApi {
  /** All known chats (cache-only, no network). */
  all(): ChatSummary[];
}

// ── Storage API (ctx.storage) ────────────────────────────────────────────────

/** Per-plugin private file storage. */
export interface StorageApi {
  /** Absolute path to this plugin's private data directory. */
  dir: string;
  /**
   * Resolve a path inside the plugin's data directory, creating parent
   * directories as needed.
   * @param relativePath - Path relative to {@link StorageApi.dir}.
   * @returns The resolved absolute path.
   * @throws If `relativePath` attempts path traversal or is an absolute path.
   */
  resolve(relativePath: string): string;
}

// ── Config / i18n / utils / download / plugins / log APIs ───────────────────

/** Read-only access to the bot's configuration values. */
export interface ConfigApi {
  /**
   * Read a config value.
   * @param key - The config key.
   * @param defaultValue - Value returned if `key` isn't set.
   * @returns The config value, or `defaultValue` if not set.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
}

/** Translation/localization helpers, available as `ctx.i18n` (and `ctx.t` as a shortcut to `ctx.i18n.t`). */
export interface I18nApi {
  /**
   * Translate a key.
   * @param args - Translation key followed by any interpolation values, forwarded to the underlying i18n engine.
   * @returns The translated string.
   */
  t(key: string): string;
  t(key: string, context: Record<string, unknown>): string | Record<string, unknown>;
  /**
   * Create a scoped `t()` bound to a plugin's own locale files.
   * @param pluginMetaUrl - Pass `import.meta.url` from the plugin file.
   * @returns A `t()` function scoped to that plugin's locales.
   * @example
   * ```js
   * const { t } = ctx.i18n.createT(import.meta.url);
   * console.log(t("greeting"));
   * ```
   */
  createT(pluginMetaUrl: string): { t: I18nApi["t"]; lang: string | null };
  /** Reload locale files from disk. */
  reload(): void;
  /** @returns The currently active language code. */
  getCurrentLang(): string;
}

/** Miscellaneous filesystem helpers, available as `ctx.utils`. */
export interface UtilsApi {
  /**
   * Delete all contents of a folder without removing the folder itself.
   * @param dirPath - Path to the directory to empty.
   */
  emptyFolder(folderPath: string): void;
}

/** Background download queue, available as `ctx.download`. Only one job runs at a time. */
export interface DownloadApi {
  /**
   * Enqueue a download work function to run in the background, serialized
   * behind any other pending job. Don't download directly inside a message
   * handler — that blocks the event loop, and plugins are dispatched in
   * sequence, so it delays every other plugin's response too.
   * @param workFn - The function performing the download.
   * @param errorFn - Called with the error if `workFn` throws/rejects. If
   * omitted, the error is logged instead of being silently swallowed.
   */
  enqueue(workFn: () => Promise<void>, errorFn?: (error: Error) => Promise<void>): void;
}

/** Cron-style task scheduling, available as `ctx.scheduler`. */
export interface SchedulerApi {
  /**
   * Register a cron task, scoped to this plugin.
   * @param expression - A cron expression, e.g. `"0 9 * * 1"` (every Monday at 9am).
   * @param fn - The function to run on schedule.
   * @returns A handle whose `.stop()` cancels the task.
   * @example
   * ```js
   * ctx.scheduler.schedule("0 9 * * 1", async () => {
   *   await ctx.send.text("Good morning!");
   * });
   * ```
   */
  schedule(expression: string, fn: () => Promise<void>): { stop: () => void };
}

/** Cross-plugin communication, available as `ctx.plugins`. */
export interface PluginsApi {
  /**
   * Look up another plugin's public API.
   * @param name - The other plugin's name.
   * @returns Its public API, or `null` if it's not active.
   */
  get(name: string): unknown;
  /**
   * Look up another plugin's public API, requiring it to exist.
   * @param name - The other plugin's name.
   * @returns Its public API.
   * @throws If the plugin doesn't exist or isn't active.
   */
  require(name: string): unknown;
  /**
   * Check whether another plugin exists and is active.
   * @param name - The plugin name to check.
   */
  exists(name: string): boolean;
}

// ── Commands API (ctx.commands) — kernel/commandAccess.ts, Phase 2 ──────────

/** Item shape returned by {@link CommandsApi.list}. */
export interface CommandInfo {
  /** Stable identifier for the command (plugin-scoped). */
  id: string;
  /** The bare command token, without the prefix, e.g. `"sticker"`. */
  cmd: string;
  /** Additional invocation aliases for this command. */
  aliases: string[];
  /** The command's menu category, or `null` if uncategorized. */
  category: string | null;
  /** Short description shown in the menu, or `null` if none. */
  desc: string | null;
}

/**
 * Read-only queries against the command registry, available as `ctx.commands`.
 * Lets a plugin check whether another command exists, or read its
 * description/manual, without `ctx.plugins.require()`'ing the owning plugin.
 */
export interface CommandsApi {
  /**
   * Check whether a command (or alias) is registered.
   * @param invocation - The bare command token or alias, without the prefix.
   */
  exists(invocation: string): boolean;
  /**
   * Get a command's short description.
   * @param invocation - The bare command token or alias, without the prefix.
   * @param lang - Language code to translate into. Defaults to the active language.
   * @returns The description, or `null` if the command doesn't exist or has none.
   */
  desc(invocation: string, lang?: string): string | null;
  /**
   * Get a command's full manual/help text.
   * @param invocation - The bare command token or alias, without the prefix.
   * @param lang - Language code to translate into. Defaults to the active language.
   * @returns The manual text, or `null` if the command doesn't exist or has none.
   */
  manual(invocation: string, lang?: string): string | null;
  /**
   * List every registered command.
   * @param lang - Language code to translate descriptions into. Defaults to the active language.
   */
  list(lang?: string): Array<{
    id: string;
    cmd: string;
    aliases: string[];
    category: string | null;
    desc: string | null;
  }>;
  /**
   * Check whether `text` matches one of the configured menu/help aliases
   * (e.g. `"menu"`, `"help"`, `"?"`), independent of the command prefix.
   * @param text - The raw text to check.
   */
  isMenuAlias(text: string): boolean;
}

/** Scoped logger, available as `ctx.log`. */
export interface LogApi {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  success(...args: unknown[]): void;
}

// ── Settings API (ctx.settings) — kernel/settingsDb.ts ───────────────────────
// Persistent per-chat settings backed by SQLite.

/** Get/set/delete operations for a single settings scope (a chat, or global). */
export interface ScopedAccessor {
  /**
   * Read a setting value.
   * @param key - The setting key.
   * @param defaultValue - Value returned if `key` isn't set.
   * @returns The setting value, or `defaultValue` if not set.
   */
  get<T = unknown>(key: string, defaultValue?: T): T;
  /** @returns All settings in this scope as a plain object. */
  getAll(): Record<string, unknown>;
  /**
   * Write a setting value.
   * @param key - The setting key.
   * @param value - The value to store (must be JSON-serializable).
   */
  set(key: string, value: unknown): void;
  /**
   * Remove a single setting.
   * @param key - The setting key to delete.
   */
  delete(key: string): void;
  /** Remove every setting in this scope. */
  deleteAll(): void;
}

/**
 * Persistent, per-chat settings storage backed by SQLite, available as `ctx.settings`.
 *
 * @example
 * ```js
 * ctx.settings.set("greeting", "Hi!");
 * const greeting = ctx.settings.get("greeting", "Hello");
 * ```
 */
export interface SettingsApi extends ScopedAccessor {
  /** Settings scoped to the bot as a whole, instead of the current chat. */
  global: ScopedAccessor;
  /**
   * Get an accessor for a different chat's settings.
   * @param targetChatId - The chat ID whose settings you want to access.
   * @returns A {@link ScopedAccessor} scoped to `targetChatId`.
   */
  forChat(targetChatId: string): ScopedAccessor;
  /**
   * Link the current chat to a shared community, so it shares settings with
   * other chats in the same community.
   * @param communityId - The community ID to link to.
   */
  link(communityId: string): void;
  /** Unlink the current chat from its community, if any. */
  unlink(): void;
  /** @returns The current chat's community ID, or `null` if not linked. */
  getCommunityId(): string | null;
  /** @returns IDs of every chat linked to the same community as the current chat. */
  getCommunityChats(): string[];
}

// ── Events API (ctx.events) ──────────────────────────────────────────────────

/** Subscribe to raw Baileys socket / internal events, available as `ctx.events`. */
export interface EventsApi {
  /**
   * Subscribe to an internal event.
   * @param event - Event name, e.g. `"messages.upsert"`, `"connection.update"`, `"group-participants.update"`.
   * @param handler - Called with the same payload the driver emits for that event.
   * @returns An unsubscribe function.
   * @example
   * ```js
   * const off = ctx.events.on("group-participants.update", (update) => {
   *   ctx.log.info("participants changed", update);
   * });
   * // later: off();
   * ```
   */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  /**
   * Wait for an internal event to fire once.
   * @param event - Event name, e.g. `"connection.update"`.
   * @returns A promise resolving with that event's payload the next time it fires.
   */
  once(event: string): Promise<unknown>;

  /** Remove every listener this plugin registered via {@link EventsApi.on}. */
  cleanup(): void;
}

// ── Shared base (both setup and runtime contexts get these) ─────────────────

/** APIs available in both {@link SetupContext} and {@link PluginContext}. */
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
  /** Read-only command registry queries. @see CommandsApi */
  commands: CommandsApi;
  /** Normalized bot JID, or `null` if the socket isn't ready yet. */
  botId: string | null;
}

// ── Setup context — plugin.setup(ctx), called once on load ──────────────────

/**
 * Context passed to a plugin's `setup(ctx)` export, called once when the
 * plugin is loaded/enabled. There's no "current chat" yet at this point.
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

// ── Session API (ctx.session) — kernel/chatSession.ts, Phase 7 ──────────────
// Exclusive chat-scoped lock, so two plugins can't run an interactive flow
// (games, a timed prompt, ...) in the same chat at once. The kernel only
// tracks WHO holds the lock; all flow state (timeout, collected input, turn
// logic, ...) stays inside the plugin. Runtime-only — no current chat to
// lock at setup time.

/** Exclusive per-chat session lock, available as `ctx.session` (runtime only). */
export interface SessionApi {
  /**
   * Open the session for this plugin in the current chat.
   * @returns `true` if acquired (or already held by this same plugin — safe
   * to call again on a later message of the same flow), `false` if another
   * plugin currently holds it.
   */
  acquire(): boolean;
  /** Release the session, but only if this plugin currently holds it. */
  release(): void;
  /** Whether the current chat has an open session, held by anyone. */
  isLocked(): boolean;
  /** Whether this plugin is the one currently holding the session. */
  isMine(): boolean;
}

// ── runCommand (ctx.runCommand) — kernel/runCommand.ts, Phase 3/8 ───────────

/** Result of {@link PluginContext.runCommand}. */
export interface RunCommandResult {
  status:
    /** The command ran (and sent a reply, if any). */
    | "executed"
    /** The caller doesn't have permission to run this command. */
    | "permission_denied"
    /** A required argument was missing. */
    | "argument_missing"
    /** The subcommand token wasn't recognized. */
    | "unknown_sub"
    /** A text-only (fixed reply) command, or an unknown invocation — resolves instead of throwing. */
    | "no_dispatch";
  /** The reply text that was actually sent, or `null` if nothing was sent. */
  sentReply: string | null;
  /** A suggested reply to show the caller when `sentReply` is `null` (e.g. on `"no_dispatch"`). */
  suggestedReply: string | null;
}

// ── Runtime context — plugin.default(ctx), called on every message ──────────

/**
 * Context passed to a plugin's default export, called on every incoming
 * message.
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
  /** Exclusive chat-scoped session lock. @see SessionApi */
  session: SessionApi;
  /**
   * Invoke another registered command through the same kernel pipeline used
   * for real inbound messages (permission check → subcommand routing →
   * required-argument validation → handler dispatch → crash alert on throw).
   * Runs against a context scoped to the TARGET command's owning plugin
   * (own `storage`, `plugins`, guard options), not the caller's — same
   * principle as `ctx.plugins.require()`, but for the command surface.
   * @param invocation - The bare command token or alias, without the prefix (e.g. `"sticker"`, not `"!sticker"`).
   * @param rawArgs - The remainder of the line, unparsed.
   */
  runCommand(invocation: string, rawArgs?: string): Promise<RunCommandResult>;
  /** WhatsApp-specific escape hatch, for when the abstracted API isn't enough. */
  wa: {
    /** Driver-neutral contract (replaces the old `WASocket` field). */
    contract: WaContract;
    /** In-memory store (replaces the old `WAStore` field). */
    store: WAStore;
    /** Driver-neutral message envelope (replaces the old `WAProtoMsg` field). */
    msg: BotMessage;
    /** Download the current message's media; `asMp4` converts animated stickers to mp4. */
    downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  } | null;
  /** Reserved for a future Telegram driver — always `null` on WhatsApp. */
  tg: null;
  /** Reserved for a future Discord driver — always `null` on WhatsApp. */
  dc: null;
}

// ── Plugin module shape ──────────────────────────────────────────────────────

/**
 * What a plugin file is expected to export.
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
   * Called once when the plugin is loaded/enabled.
   * @param ctx - The {@link SetupContext} for this plugin.
   */
  setup?(ctx: SetupContext): unknown | Promise<unknown>;
  /**
   * Called on every incoming message.
   * @param ctx - The {@link PluginContext} for this plugin.
   */
  default?(ctx: PluginContext): unknown | Promise<unknown>;
}

// ── Optional: zero-import global types ───────────────────────────────────────
//
// If you'd rather not write `@param {import('...').PluginContext}` in every
// plugin file, uncomment the block below and make sure this file is included
// by whatever tsconfig/jsconfig covers your plugins (add its path to
// "include"). Then every plugin can just write:
//
//   /**
//    * @param {PluginContext} ctx
//    */
//   export default async function (ctx) { ... }
//
// with no import at all.
//
// declare global {
//   type PluginContext = import("@manybot/types").PluginContext;
//   type SetupContext  = import("@manybot/types").SetupContext;
// }
