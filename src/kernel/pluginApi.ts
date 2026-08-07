/**
 * kernel/pluginApi.ts — explicit `PluginContext` contract.
 *
 * This file declares the typed surface that the
 * plugin runtime passes to `plugin.default(ctx)` and `plugin.setup(ctx)`.
 * Plugins depend ONLY on `PluginContext` (and the driver-neutral types
 * it references — `WaContract`, `BotMessage`, …). The
 * implementation lives in `drivers/baileys/api/index.ts`; this file is
 * the source of truth that the implementation must satisfy via
 * `tsc --noEmit`.
 *
 * History:
 *   - Originally this file was a re-export shim from the WhatsApp
 *     driver; now that the driver has been split into `drivers/baileys/`,
 *     the contract is promoted here and the implementation annotates
 *     `(): PluginContext`.
 *   - WAMessageContext / WAMessageSender / WAHistoryArray / PollHandle
 *     stay in `drivers/baileys/api/index.ts` because their internal field
 *     shapes still mirror Baileys-proto (e.g. `msg.key.id`). whatsapp-
 *     platform-neutrality is a per-property evolution; the contract
 *     exposes them at the boundary (`ctx.msg`) so future swaps only touch
 *     the implementation, never plugins.
 */

import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import type { BotMessage } from "#drivers/types.js";
import type { ScopedAccessor } from "#kernel/settingsDb.js";

// Re-export the implementation module so existing callers that
// `import { buildSetupApi, cleanupPluginEvents } from "#manyapi"`
// keep working. The contract types below are the new source of truth;
// the implementation in drivers/baileys/api/index.ts is annotated
// to satisfy them.
export {
  buildApi,
  buildSetupApi,
  buildMessageContext,
  buildChatFromMsg,
  buildStorageApi,
  cleanupPluginEvents,
  type WAMessageContext,
  type WAHistoryArray,
  type WAMessageSender,
} from "#drivers/baileys/api/index.js";

// ── Contract ──────────────────────────────────────────────────────────────────
// The `ctx` object passed to `plugin.default(ctx)` on every message.
// Plugins depend on this exact shape; nothing else is guaranteed.
//
// Sub-facets (storage, scheduler, admin, poll, …) are flat fields on the
// ctx object — not nested namespaces — so a plugin can write
// `ctx.send.text(...)`, `ctx.admin.promote(...)`, `ctx.contacts.get(...)`
// straight without an extra `.api.` hop. The implementation builds these
// facets inline; here we only document the typed surface.

// Shared contact shape used by `ctx.contacts.get(...)` and
// `ctx.msg.getContact()`. Field-for-field compatible with the object the
// whatsapp-web.js era exposed; today it's produced by `normalizeContact()`
// in drivers/baileys/api/index.ts.
export interface IContact {
  id: string;
  number: string;
  pushname: string | null;
  name: string | null;
  shortName: string | null;
  isBusiness: boolean;
  isEnterprise: boolean;
  isBlocked: boolean;
  isMe: boolean;
  isWAAccount: boolean;
  isUser: boolean;
  isGroup: boolean;
  mention: { text: string; mentions: string[] };
}

// Lightweight per-chat summary used by `ctx.chats.all()`.
export interface IChatSummary {
  id: string;
  name: string;
  isGroup: boolean;
}

// Per-group-participant summary returned by `ctx.chat.getParticipants()`.
export interface IParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

// Sender API returned by `makeSender()` — the chainable, thenable sender
// accessible via `ctx.send.text(...)`, `ctx.send.image(...)`, etc. AND via
// `ctx.msg.reply.text(...)` (after a reply target is bound). Re-imported
// from the implementation so the contract doesn't drift.
import type {
  WAMessageContext,
  WAHistoryArray,
  WAMessageSender,
  PollHandle,
} from "#drivers/baileys/api/index.js";

// Per-method return types of `makeSender()`. Each send method returns a
// `MessageHandle` (thenable + chainable `.reply`/`.pin`/`.delete`/...)
// — we infer the actual shape via ReturnType so the contract never drifts
// from the implementation's `MessageHandle`.
type SenderText    = ReturnType<WAMessageSender["text"]>;
type SenderImage   = ReturnType<WAMessageSender["image"]>;
type SenderVideo   = ReturnType<WAMessageSender["video"]>;
type SenderGif     = ReturnType<WAMessageSender["gif"]>;
type SenderAudio   = ReturnType<WAMessageSender["audio"]>;
type SenderSticker = ReturnType<WAMessageSender["sticker"]>;
type SenderFile    = ReturnType<WAMessageSender["file"]>;
type SenderPoll    = ReturnType<WAMessageSender["poll"]>;

// Sub-facet: storage. Sandbox-safe per-plugin data dir.
export interface IStorage {
  dir: string;
  resolve(relativePath: string): string;
}

// Sub-facet: top-level config reader. Today's full config object is
// exported by `#config` as `CONFIG`; plugins were already reaching into it
// directly. We mirror that one accessor so plugins stay source-compatible.
export interface IConfig {
  get(key: string, defaultValue?: unknown): unknown;
}

// Sub-facet: i18n. `t` itself is the bare function; `createT` returns a
// scoped translator object `{ t, lang }` (see `createPluginT` in
// src/i18n/index.ts). `reload` forces a re-read of locale files (synchronous
// cache invalidate); `getCurrentLang` returns the active language code.
export interface II18n {
  t: (key: string, vars?: Record<string, unknown>) => string;
  createT: (pluginMetaUrl: string) => { t: (key: string, context?: Record<string, unknown>) => string; lang: string | null };
  reload: () => void;
  getCurrentLang: () => string;
}

// Sub-facet: download queue. Plugin calls `enqueue(work, error?)` and the
// worker is run serially in the background — used by anything that
// shouldn't block the inbound-message path.
export interface IDownload {
  enqueue(workFn: () => Promise<void>, errorFn: (err: Error) => Promise<void>): void;
}

// Sub-facet: scheduler. Cron task scoped to the calling plugin; returns
// a handle whose `.stop()` cancels the registration.
export interface IScheduler {
  schedule(expression: string, fn: () => Promise<void>): { stop: () => void };
}

// Sub-facet: cross-plugin registry. Lets a plugin reach another plugin's
// public exports (`require` throws if missing; `get` returns null; `exists`
// is a boolean probe).
export interface IPlugins {
  get(name: string): unknown;
  require(name: string): unknown;
  exists(name: string): boolean;
}

// Sub-facet: chat listing. Today's only entry is `all()`, returning a
// cache-only list (no network).
export interface IChats {
  all(): IChatSummary[];
}

// Sub-facet: contacts. The reading methods (`get`, `getPfpUrl`, …) plus
// the mutating ones (`block`, `unblock`). All methods tolerate unknown
// JIDs by resolving to `null` / `false`.
export interface IContacts {
  get(contactId: string, opts?: { groupId?: string }): Promise<IContact | null>;
  getPfpUrl(contactId: string): Promise<string | null>;
  getPfpPath(contactId: string, destPath: string): Promise<string | null>;
  getAbout(contactId: string): Promise<string | null>;
  block(contactId: string): Promise<void>;
  unblock(contactId: string): Promise<void>;
}

// Sub-facet: log. Mirrors the project logger at warn/info/error/success.
export interface ILog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  success(...args: unknown[]): void;
}

// Sub-facet: utilities (right now: `emptyFolder` from utils/file).
export interface IUtils {
  emptyFolder(folderPath: string): void;
}

// `add()` returns a thenable targetable — `await ctx.admin.add(...)`
// runs against the implicit current chat, while `ctx.admin.add(...).to(jid)`
// redirects to an explicit group. Type it explicitly so the contract
// matches the implementation's chainable shape (see
// `createTargetableAction` in drivers/baileys/api/index.ts).
export interface ITargetableAction<T = unknown> {
  to(targetJid: string): Promise<T>;
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined,
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | null | undefined): Promise<T>;
}

// Sub-facet: admin actions on groups. Each method accepts a JID-or-array
// of JIDs (in any of: raw wire form "@s.whatsapp.net", framework form
// "@c.us", "@lid", or a bare phone number). Promoted to an explicit
// contract here; the implementation already enforces protocol-level
// status checks and throws on rejection (see
// `assertParticipantsUpdateOk` in drivers/baileys/api/index.ts).
export interface IAdmin {
  add(memberIds: string | string[]): ITargetableAction;
  kick(memberIds: string | string[]): Promise<unknown>;
  promote(memberIds: string | string[]): Promise<unknown>;
  demote(memberIds: string | string[]): Promise<unknown>;
  setSubject(name: string): Promise<unknown>;
  setDescription(text: string): Promise<unknown>;
  setProfilePic(source: string | Buffer): Promise<unknown>;
  getInviteLink(groupId?: string): Promise<string>;
  revokeInvite(): Promise<unknown>;
}

// Sub-facet: bot's own profile.
export interface IMe {
  setName(name: string): Promise<unknown>;
  setAbout(text: string): Promise<unknown>;
  setProfilePic(source: string | Buffer): Promise<unknown>;
}

// Sub-facet: poll tracking. `create()` sends a poll and starts recording
// votes; `get(msgId)` retrieves an existing handle.
export interface IPoll {
  create(
    question: string,
    options: string[],
    opts?: { allowMultipleAnswers?: boolean },
  ): Promise<PollHandle>;
  get(msgId: string): PollHandle | null;
}

// Sub-facet: plugin-scoped settings. Mirrors `buildSettingsApi()` from
// kernel/settingsDb.ts: `global` is plugin-scoped across all chats;
// the accessor methods on the settings object itself (`get`/`set`/...)
// target the current chat, while `forChat(targetChatId)` reads another.
//
// Setup variant exposes only `{ global: ScopedAccessor }` since there's
// no current chat to bind to.
export interface ISettings extends ScopedAccessor {
  global: ScopedAccessor;
  forChat(targetChatId: string): ScopedAccessor;
}

// Sub-facet: events. `on()` registers a listener and returns an unsubscribe
// handle; `once()` resolves on the first fire; `cleanup()` removes every
// registered listener for the plugin.
export interface IEvents {
  on(event: string, handler: (...args: unknown[]) => void): () => void;
  once(event: string): Promise<unknown>;
  cleanup(): void;
}

// Sub-facet: chat context for the current message.
export interface IChat {
  id: string;
  name: string;
  isGroup: boolean;
  history: WAHistoryArray;
  getParticipants(): Promise<IParticipant[]>;
  isAdmin(contactId: string): Promise<boolean>;
  isSenderAdmin(): Promise<boolean>;
  isBotAdmin(): Promise<boolean>;
  clearMessages(): Promise<void>;
}

// Sub-facet: utils for the message being handled. Imported as the
// implementation's WAMessageContext so the shape never drifts.
export interface IMsg extends WAMessageContext {}

/**
 * Isolated platform escape hatch. The `.wa.*` namespace exposes the
 * driver-neutral `WaContract`, the in-memory `BotStore`, and the current
 * `BotMessage` to plugins that genuinely need them — e.g.
 * `ctx.wa.downloadMedia({ asMp4: true })` for animated-sticker → mp4
 * conversion. `.tg` and `.dc` are intentionally `null` until a Telegram
 * or Discord adapter ships; the field exists today so plugins can write
 * `ctx.wa?.downloadMedia(...)` without future changes.
 */
export interface IPlatformContexts {
  wa: {
    /** Driver-neutral contract (replace the old `WASocket` field). */
    contract: WaContract;
    /** In-memory store (replace the old `WAStore` field). */
    store: BotStore;
    /** Driver-neutral message envelope (replace the old `WAProtoMsg` field). */
    msg: BotMessage;
    downloadMedia(opts?: { asMp4?: boolean }): Promise<{ mimetype: string; data: string } | null>;
  } | null;
  tg: null;
  dc: null;
}

/**
 * The full runtime ctx — passed to `plugin.default(ctx)` on every message.
 * Plugins depend only on this shape; nothing outside it is part of the
 * contract.
 */
export interface PluginContext {
  // Base
  log: ILog;
  t: II18n["t"];
  config: IConfig;
  i18n: II18n;
  utils: IUtils;
  download: IDownload;
  scheduler: IScheduler;
  plugins: IPlugins;
  chats: IChats;
  contacts: IContacts;
  storage: IStorage;
  botId: string | null;

  // Send — returns a thenable `MessageHandle` per method (which awaits to
  // a `WAMessageContext | undefined`). See WAMessageSender for the full
  // chainable surface (`.reply`, `.pin`, `.delete`, etc.).
  send: {
    text(text: string, opts?: { linkPreview?: boolean; mentions?: string[] }): SenderText;
    image(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): SenderImage;
    video(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): SenderVideo;
    gif(source: string | Buffer, caption?: string, opts?: { viewOnce?: boolean; mentions?: string[] }): SenderGif;
    audio(source: string | Buffer, opts?: { asVoice?: boolean; viewOnce?: boolean }): SenderAudio;
    sticker(source: string | Buffer): SenderSticker;
    file(source: string | Buffer, filename?: string): SenderFile;
    poll(question: string, options: string[], cfg?: { allowMultipleAnswers?: boolean }): SenderPoll;
    to(targetJid: string): WAMessageSender;
  };

  // Per-message context.
  msg: IMsg;

  // Per-chat context.
  chat: IChat;

  // Group admin (chatJid-bound). `null` only in the SetupContext variant.
  admin: IAdmin;

  // Bot's own profile.
  me: IMe;

  // Poll tracking + live tally.
  poll: IPoll;

  // Raw platform access (sock/store/msg + helpers) plus future tg/dc stubs.
  wa: IPlatformContexts["wa"];
  tg: IPlatformContexts["tg"];
  dc: IPlatformContexts["dc"];

  // Settings: `global` is plugin-scoped; `chat` is per-chat.
  settings: ISettings;
}

/**
 * The setup-time ctx — passed to `plugin.setup(ctx)` once at startup.
 * Differs from `PluginContext` only in:
 *   - no `msg` or `chat` (no inbound message yet);
 *   - `send` exposes only `.to(targetJid)` (no implicit destination);
 *   - `admin` operations targeting the *current* chat throw (no chat
 *     bound yet — `.to(target).add(...)` is the supported shape);
 *   - `settings` exposes only `global` (no current chat to scope to).
 */
export interface SetupContext {
  log: ILog;
  t: II18n["t"];
  config: IConfig;
  i18n: II18n;
  utils: IUtils;
  download: IDownload;
  scheduler: IScheduler;
  plugins: IPlugins;
  chats: IChats;
  contacts: IContacts;
  storage: IStorage;
  botId: string | null;

  send: {
    to(targetJid: string): WAMessageSender;
  };

  // `admin` is available in setup too, but every method requires an
  // explicit `.to(groupJid)` target — there's no implicit current chat.
  admin: IAdmin;
  me: IMe;
  events: IEvents;
  settings: { global: ScopedAccessor };
}
