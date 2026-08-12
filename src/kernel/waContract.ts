/**
 * kernel/waContract.ts
 *
 * Driver-neutral contract that the core (kernel + pluginApi + sendGuard +
 * contactAutoSave + pluginLoader + messageHandler) consumes. Every WhatsApp
 * driver — Baileys today, whatsmeow in a later phase — implements this
 * interface. The core never imports a driver package directly.
 *
 * Event payloads are all driver-neutral: adapters translate incoming
 * driver-specific event shapes (e.g. Baileys WAMessage) into the records
 * declared here before letting the rest of the kernel see them.
 *
 * This file MUST NOT import from `@whiskeysockets/baileys` or any
 * other driver package.
 */

import type { BotMessage, BotQuotedRef } from "#drivers/types.js";

export type { BotMessage, BotQuotedRef };

// ── Event payloads ──────────────────────────────────────────────────────────

/** Payload of `messages.upsert`. */
export interface MessagesUpsertEvent {
  messages: BotMessage[];
  type:     "notify" | "append";
}

/** Payload of `messages.update`. */
export interface MessagesUpdateEvent {
  updates: Array<{ key: BotQuotedRef; update: Record<string, unknown> }>;
}

/** Plain chat summary (no live admin state — that's on groupMetadata). */
export interface BotChatSummary {
  id:   string;
  name?: string;
}

/** Plain contact summary (no live business-status — that's on getBusinessProfile). */
export interface BotContactSummary {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  /** @lid form, if known. */
  lid?: string;
}

/** Payload of `messaging-history.set`. */
export interface HistorySetEvent {
  chats:    BotChatSummary[];
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
  participants: Array<{ id: string; action: "add" | "remove" | "promote" | "demote" }>;
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
  connection:      "open" | "close" | "connecting";
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
  id:          string;
  author:      string;
  participant: string;
  action:      "created" | "revoked" | "rejected";
  method:      "invite_link" | "linked_group_join" | "non_admin_add" | "unknown";
}

/** Payload of `blocklist.set`. */
export interface BlocklistSetEvent {
  blocklist: string[];
}

/** Payload of `blocklist.update`. */
export interface BlocklistUpdateEvent {
  blocklist: string[];
  type:      "add" | "remove";
}

/**
 * Events the driver-neutral `WaContract` exposes to the kernel and to
 * plugins. Deliberately a STRICT SUBSET of the underlying Baileys
 * `BaileysEventMap` (and, in the future, of whatsmeow's event surface)
 * — every member here is something we have committed to deliver, and
 * the adapter implements every `bindSockEventsExternal` listener for
 * each one.
 *
 * What is NOT here, and why (per-event decisions — keep this list in
 * sync with the adapter's `bindSockEventsExternal` and the documentation):
 *
 *   - `creds.update`              Internal auth state; only the Baileys
 *                                 socket needs to save creds.
 *   - `chats.phoneNumberShare`    Declared in Baileys' type but never
 *                                 actually emitted by the socket (issue
 *                                 #2416). Adding it would create a
 *                                 promise the driver can never keep.
 *   - `presence.update`           High-volume typing/online state; no
 *                                 plugin surface needs it today. Add
 *                                 back when a real consumer exists.
 *   - `messages.media-update`     Carries raw ciphertext/iv — an
 *                                 internal artifact of the media path.
 *                                 The contract's `downloadMedia()`
 *                                 already abstracts that.
 *   - `messages.reaction`         Reactions are visible via
 *                                 `messages.upsert` carrying the
 *                                 reaction key. Promote to a first-
 *                                 class event if a plugin needs it.
 *   - `message-receipt.update`    Read-receipt batch; high volume, no
 *                                 consumer today.
 *   - `call` / `labels.*` /
 *     `newsletter.*`              Platform niches without a plugin
 *                                 surface. Add as needed.
 */
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

export type WaEventPayload<E extends WaEventName> =
  E extends "messages.upsert"            ? MessagesUpsertEvent :
  E extends "messages.update"            ? MessagesUpdateEvent :
  E extends "messages.delete"            ? MessagesDeleteEvent :
  E extends "messaging-history.set"      ? HistorySetEvent :
  E extends "chats.upsert"               ? ChatsUpsertEvent :
  E extends "chats.update"               ? ChatsUpdateEvent :
  E extends "chats.delete"               ? ChatsDeleteEvent :
  E extends "contacts.upsert"            ? ContactsUpsertEvent :
  E extends "contacts.update"            ? ContactsUpdateEvent :
  E extends "group-participants.update"  ? GroupParticipantsUpdateEvent :
  E extends "groups.upsert"              ? GroupsUpsertEvent :
  E extends "groups.update"              ? GroupsUpdateEvent :
  E extends "group.join-request"         ? GroupJoinRequestEvent :
  E extends "blocklist.set"              ? BlocklistSetEvent :
  E extends "blocklist.update"           ? BlocklistUpdateEvent :
  E extends "connection.update"          ? ConnectionUpdateEvent :
  never;

// ── Send / react / edit / delete ────────────────────────────────────────────

export interface BotPollOptions {
  name:            string;
  values:          string[];
  selectableCount?: number;
}

export interface SentMessageRef {
  id:        string;
  chatId:    string;
  timestamp: number;
}

// ── Group metadata ──────────────────────────────────────────────────────────

export interface BotGroupParticipant {
  id:           string;
  isAdmin:      boolean;
  isSuperAdmin: boolean;
  /** E.164 phone-number JID, populated when the driver exposes it (Baileys pn field). */
  phoneNumber?: string;
}

export interface BotGroupMetadata {
  subject:     string;
  participants: BotGroupParticipant[];
}

// ── Profile ─────────────────────────────────────────────────────────────────

export interface BotMe {
  id:  string;
  lid?: string;
}

// ── Contract ────────────────────────────────────────────────────────────────

export interface WaContract {
  readonly name: "baileys" | "whatsmeow";

  // ── lifecycle ───────────────────────────────────────────────────────────────
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady(): boolean;

  /**
   * Resolve a @lid JID to the real @s.whatsapp.net JID using the driver's
   * authoritative source (Baileys: signalRepository.lidMapping). Optional —
   * drivers without a protocol-level resolver (e.g. while whatsmeow Go
   * service is stubbed) can omit it.
   */
  resolveLid?(lid: string): Promise<string | null>;

  // ── event subscription ──────────────────────────────────────────────────────
  /**
   * Register a listener for a driver event. Returns an unsubscribe function.
   * Adapters translate the driver's own event shape into the neutral payload
   * type declared above.
   */
  on<E extends WaEventName>(event: E, handler: (payload: WaEventPayload<E>) => void): () => void;

  // ── send (text routes through sendFallbackGuard; these are the direct calls) ─
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

  // ── presence + read ────────────────────────────────────────────────────────
  sendPresenceUpdate(state: "composing" | "recording" | "paused", jid: string): Promise<void>;
  readMessages(keys: BotQuotedRef[]): Promise<void>;

  // ── contacts ────────────────────────────────────────────────────────────────
  onWhatsApp(jid: string): Promise<{ exists: boolean }[] | null>;
  getBusinessProfile(jid: string): Promise<unknown | null>;
  profilePictureUrl(jid: string): Promise<string | null>;
  fetchStatus(jid: string): Promise<string | null>;
  updateBlockStatus(jid: string, action: "block" | "unblock"): Promise<void>;
  addOrEditContact(jid: string, info: { fullName: string; firstName?: string; saveOnPrimaryAddressbook?: boolean }): Promise<void>;
  removeContact(jid: string): Promise<void>;

  // ── groups ──────────────────────────────────────────────────────────────────
  groupMetadata(jid: string): Promise<BotGroupMetadata>;
  groupParticipantsUpdate(jid: string, users: string[], action: "add" | "remove" | "promote" | "demote"): Promise<Array<{ status: string; jid?: string }>>;
  groupUpdateSubject(jid: string, subject: string): Promise<void>;
  groupUpdateDescription(jid: string, description: string): Promise<void>;
  groupInviteCode(jid: string): Promise<string>;
  groupRevokeInvite(jid: string): Promise<string>;

  // ── profile (bot + group) ───────────────────────────────────────────────────
  updateProfilePicture(jid: string, buffer: Buffer): Promise<void>;
  updateProfileName(name: string): Promise<void>;
  updateProfileStatus(status: string): Promise<void>;

  // ── me ──────────────────────────────────────────────────────────────────────
  me(): BotMe;

  // ── media (download) ────────────────────────────────────────────────────────
  /**
   * Download a media payload. `msg` is the (neutral) BotMessage that was
   * received — adapters fetch the underlying buffer from whichever transport
   * they implement. Returns null on any failure (already-downloaded media,
   * expired blob, protocol error, etc).
   */
  downloadMedia(msg: BotMessage, opts: { asMp4?: boolean }): Promise<{ mimetype: string; data: Buffer } | null>;

  // ── verification primitive ──────────────────────────────────────────────────
  /**
   * Read the most recent N messages the driver has on hand for `jid`,
   * in chronological order (oldest → newest). Used by the fallback guard
   * to confirm a send landed. Optional for drivers that
   * don't keep a local history (pure-fire-and-forget transports) — the
   * fallback guard degrades to time-based confirmation in that case.
   */
  getHistory?(jid: string, opts?: { limit?: number }): Promise<BotMessage[]>;

  // ── poll decryption (Baileys-specific) ───────────────────────────────────
  /**
   * Decrypt a single poll-vote update against a known poll creation
   * message. Optional — only the Baileys driver implements it. whatsmeow
   * (and any future driver) may leave this undefined; the poll-tracking
   * code in `drivers/baileys/api/index.ts` is the only consumer today
   * and already tolerates the absence.
   *
   * The driver is responsible for picking the correct JID shape
   * (LID vs PN) on each side via its protocol-level heuristics — the
   * caller only supplies the raw message keys and the poll encryption
   * key fetched from the creation message's `messageContextInfo`.
   * Returns null on every known failure (missing store entry, wrong
   * AES-GCM key, exhausted JID candidates) so the caller can decide
   * whether to drop the update or escalate.
   */
  decryptPollVote?(opts: PollDecryptOpts): Promise<PollDecryptResult | null>;

  /**
   * Aggregate a per-voter vote history into a tally keyed by option
   * name. Baileys replays the whole current selection on every tap, so
   * callers must already keep only the latest entry per voter before
   * calling this. Optional — same rules as `decryptPollVote`.
   */
  aggregatePollVotes?(opts: PollAggregateOpts): PollVoteAggregate[];
}

/** Inputs to {@link WaContract.decryptPollVote}. */
export interface PollDecryptOpts {
  /** Key of the poll-vote update message. */
  voteKey:   BotQuotedRef;
  /** Key of the poll-creation message (the message that contains the option list). */
  pollKey:   BotQuotedRef;
  /** Poll encryption key, base64-string or Buffer. Fetched from the creation message's
   *  `messageContextInfo.messageSecret` by the caller (the poll-creation message is in
   *  the store, the API file already reads the store). */
  pollEncKey: Buffer | string;
}

/** Successful result of {@link WaContract.decryptPollVote}. */
export interface PollDecryptResult {
  /** Decrypted list of selected option hashes (SHA-256 of each option name). */
  selectedOptions: string[];
  /** Raw decrypted vote message — exposed for callers that need fields the neutral
   *  envelope intentionally doesn't model. */
  raw: unknown;
}

/** Inputs to {@link WaContract.aggregatePollVotes}. */
export interface PollAggregateOpts {
  /** Poll-creation message key (used to look up the original option list). */
  pollKey:  BotQuotedRef;
  /** The latest per-voter entries, in the shape produced by `decryptPollVote`. */
  votes:    PollDecryptResult[];
  /** Optional JID used to filter the bot's own votes out of the tally (matches Baileys'
   *  `meId` argument). */
  selfJid?: string;
}

/** One row of the aggregated tally — option name and the set of voters that picked it. */
export interface PollVoteAggregate {
  name:   string;
  voters: string[];
}
