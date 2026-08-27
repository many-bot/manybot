/**
 * drivers/baileys/messageHandler.ts
 *
 * WhatsApp message pipeline.
 * Moved from kernel/messageHandler.ts to keep all WhatsApp logic together.
 *
 * Order:
 *   1. Filter allowed chats (CHATS from config)
 *   2. Per-chat incoming debounce (prevents command spam)
 *   3. Pass context to all active plugins
 *
 * Each plugin decides whether to act or ignore.
 */

import type { BotMessage } from "#drivers/types.js";
import type { WaContract } from "#kernel/waContract.js";
import type { BotStore } from "#client/store.js";
import { CHATS, EXCLUDE_CHATS, CMD_PREFIX } from "#config";
import { buildApi,
         buildChatFromMsg,
         buildMessageContext } from "./api/index.js";
import { pluginRegistry }     from "#kernel/pluginLoader.js";
import { getCommandByInvocation, getCommandRegistry } from "#kernel/commandRegistry.js";
import { resolveDispatch, runCommand } from "#kernel/runCommand.js";
import { getActiveDeprecation, formatDeprecationMessage } from "#kernel/commandDeprecation.js";
import { checkPermission } from "#kernel/commandPermissions.js";
import { handleMenuCommand, renderNotFound, resolveLocalizedString, checkAndTriggerWelcomeMessage } from "#kernel/commandMenu.js";
import { runPlugin }          from "#kernel/pluginGuard.js";
import { acquireChatSlot }    from "#sendguard";
import { trackIncomingForContactSave } from "#kernel/contactAutoSave.js";
import { normalizeJid } from "#drivers/jid.js";
import { logger } from "#logger";

const INCOMING_DEBOUNCE_MS = 0;
const lastProcessedAt = new Map<string, number>();

/**
 * Extract the bare command token from a raw body string.
 * Mirrors the prefix/parsing logic in `buildMessageContext` and `buildApi`
 * (kept local to avoid coupling to internal helpers of api/index.ts).
 * Returns "" when the body does not start with the configured prefix.
 */
function extractCommand(body: string, prefix: string): string {
  const first = body.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first.startsWith(prefix) ? first.slice(prefix.length) : "";
}

// ── Dedup of already-processed messages ────────────────────────────────────
// WhatsApp resends messages without a delivery/read confirmation (the
// protocol's own retry, usually up to 3 times) when the socket reconnects.
// Without this, the same msg.key.id would arrive again as "notify" and be
// reprocessed.
const SEEN_TTL_MS = 10 * 60 * 1000; // 10 min is enough for WA's retries
const seenMessageIds = new Map<string, number>();


function alreadyProcessed(id: string | null | undefined): boolean {
  if (!id) return false;

  const now = Date.now();

  // lazy cleanup of expired entries
  for (const [key, ts] of seenMessageIds) {
    if (now - ts > SEEN_TTL_MS) seenMessageIds.delete(key);
  }

  if (seenMessageIds.has(id)) return true;

  seenMessageIds.set(id, now);
  return false;
}

/**
 * @param {BotMessage}   msg       - driver-neutral incoming message envelope
 * @param {WaContract}   contract  - driver-neutral contract (replaces WASocket)
 * @param {BotStore}     store     - in-memory store
 */
export async function handleMessage(msg: BotMessage, contract: WaContract, store: BotStore): Promise<void> {
  const rawJid = msg.chatId;
  const jid    = normalizeJid(store.resolveJid(rawJid));

  if (CHATS.length > 0 && !CHATS.includes(jid)) {
    return;
  }

  if (EXCLUDE_CHATS.includes(jid)) {
    return;
  }

  if (alreadyProcessed(msg.id)) {
    return;
  }

  // Mark as read/delivered to reduce the chance WhatsApp resends it
  // (`msg.quotedKey`/`fromLid`/`fromPn` carry the LID/PN parts so the
  // contract can reconstruct a proper key on each driver).
  const rawKey: BotMessage["quotedKey"] = msg.id ? {
    id:        msg.id,
    remoteJid: msg.chatId,
    fromMe:    false,
    participant: msg.fromPn ?? msg.fromLid ?? undefined,
  } : undefined;
  if (rawKey) {
    contract.readMessages([rawKey]).catch(() => {});
  }

  // Debounce rapid bursts per chat
  if (INCOMING_DEBOUNCE_MS > 0) {
    const now  = Date.now();
    const last = lastProcessedAt.get(jid) ?? 0;
    const gap  = now - last;
    if (gap < INCOMING_DEBOUNCE_MS) {
      const wait = INCOMING_DEBOUNCE_MS - gap;
      await new Promise<void>(r => setTimeout(r, wait));
    }
    lastProcessedAt.set(jid, Date.now());
  }

  // Build a WAChat adapter from the message metadata
  const chat = await buildChatFromMsg(msg, store, contract);

  // Gradual contact-saving (best-effort, never blocks message handling)
  const msgCtx = buildMessageContext(msg, contract, store);
  const isGroup = jid.endsWith("@g.us");
  trackIncomingForContactSave(contract, msg, msgCtx.sender, isGroup, msgCtx.hasPrefix)
    .catch(() => {});

  // Caps how many chats get answered at the same time — see SECURITY_LEVEL.
  const releaseChatSlot = await acquireChatSlot(jid);

  try {
    await runPluginsForMessage(msg, chat, msgCtx, contract, store, rawJid);
  } finally {
    releaseChatSlot();
  }
}

async function runPluginsForMessage(
  msg: BotMessage,
  chat: Awaited<ReturnType<typeof buildChatFromMsg>>,
  msgCtx: ReturnType<typeof buildMessageContext>,
  contract: WaContract,
  store: BotStore,
  rawJid: string
): Promise<void> {
  const command = extractCommand(msgCtx.body, CMD_PREFIX);
  const registry = getCommandRegistry();

  // 0. Welcome message (first message within the configured window)
  //
  // Two gates before we even consider firing the welcome:
  //
  //   - `!msg.fromMe`: skip when the bot itself "sent" the message
  //     that triggered this dispatch. Baileys' history-sync replays
  //     the bot's own outgoing messages as `messages.upsert` with
  //     `fromMe=true` on every reconnect — without this gate, the
  //     bot would greet itself in its own DM/group on every restart
  //     the moment history-sync completes. The welcome is for
  //     *incoming* messages only.
  //
  //   - `!chat.isGroup`: skip when the message arrived in a group.
  //     A new member joining a group shouldn't get a per-member
  //     welcome reply inside the group's conversation — it's noise
  //     and reads weird in front of everyone else. The welcome is
  //     only meaningful in a 1:1 (DM) chat where the message
  //     originates from the user being greeted, and where the reply
  //     goes back to the same chat (`msgCtx.reply` already targets
  //     the source chat).
  if (registry && !msg.fromMe && !chat.isGroup) {
    const welcomeMsg = checkAndTriggerWelcomeMessage(msgCtx.sender, registry);
    if (welcomeMsg) {
      try {
        await msgCtx.reply.text(welcomeMsg);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(`[messageHandler] welcome reply failed: ${err.message}`);
      }
    }
  }

  // 1. Menu aliases match (overview / category / manual / notFound)
  if (command && registry && registry.menuAliases.has(command)) {
    const rawArgs = msgCtx.body.trim().slice(CMD_PREFIX.length + command.length).trim();
    const scope = chat.isGroup ? "group" : "dm";
    const menuResponse = handleMenuCommand(command, rawArgs, registry, undefined, scope);
    try {
      await msgCtx.reply.text(menuResponse);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn(`[messageHandler] menu reply failed: ${err.message}`);
    }
    return;
  }

  const matched = command ? getCommandByInvocation(command) : null;

  // Full v6 dispatch resolution (parent vs. subcommand) for the matched
  // entry, if any — feeds `runCommand()` below so subcommand routing,
  // required-argument validation, and the Phase-8 crash-alert hook are
  // active in production. Kept separate from the `matched` top-level
  // permission pre-check further down (unchanged, still gates the whole
  // per-message plugin loop exactly as before `runCommand` existed).
  const rawArgsForDispatch = command ? msgCtx.body.trim().slice(CMD_PREFIX.length + command.length).trim() : "";
  const resolution = command ? resolveDispatch(command, rawArgsForDispatch) : { target: { kind: "none" as const } };

  if (matched) {
    const permApi = buildApi({
      msg,
      chat,
      contract,
      store,
      pluginRegistry,
      pluginName:   matched.pluginName ?? "system",
      guardOptions: {},
    });

    const permResult = await checkPermission(matched, {
      isGroup: permApi.chat.isGroup,
      chatId: permApi.chat.id,
      senderId: msgCtx.sender,
      isSenderAdmin: () => permApi.chat.isSenderAdmin(),
      isBotAdmin: () => permApi.chat.isBotAdmin(),
    });

    if (!permResult.allowed) {
      if (permResult.message) {
        try {
          await msgCtx.reply.text(permResult.message);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          logger.warn(`[messageHandler] permission reply failed: ${err.message}`);
        }
      }
      return;
    }
  }

  // Fixed-text command: reply with the literal text and stop — do not
  // invoke any plugin (legacy or migrated) for this message.
  if (matched && matched.source === "text" && matched.text !== null) {
    try {
      const textContent = resolveLocalizedString(matched.text) ?? "";
      await msgCtx.reply.text(textContent);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn(`[messageHandler] fixed-text reply failed: ${err.message}`);
    }
    return;
  }

  // Deprecated old name: notify the user and stop. We do NOT redirect
  // to the new command and do NOT fall through to the legacy run(ctx).
  if (!matched && command) {
    const defaults = registry?.defaults ?? {
      notifyChanges:    true,
      notifyPeriodDays: 7,
      notifyMessage:    null,
    };
    const dep = defaults.notifyChanges ? getActiveDeprecation(command) : null;
    if (dep) {
      try {
        await msgCtx.reply.text(formatDeprecationMessage(dep, defaults));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.warn(`[messageHandler] deprecation reply failed: ${err.message}`);
      }
      return;
    }
  }

  const matchedPlugin = matched && matched.source === "plugin" ? matched : null;

  for (const plugin of pluginRegistry.values()) {
    const ctx = buildApi({
      msg,
      chat,
      contract,
      store,
      pluginRegistry,
      pluginName:   plugin.name,
      guardOptions: plugin.guardOptions,
    });

    const useTyping = plugin.guardOptions?.typing !== false;
    let typingInterval: ReturnType<typeof setInterval> | undefined;

    if (useTyping) {
      // Refresh presence every 4s so WhatsApp doesn't auto-clear it
      typingInterval = setInterval(() => {
        contract.sendPresenceUpdate("composing", rawJid).catch(() => {});
      }, 4000);
    }

    try {
      // If this plugin owns the matched registry entry, skip the legacy
      // run(ctx) and go through the unified v6 dispatcher instead — avoids
      // double-firing for a migrated command and activates subcommand
      // routing, required-argument validation, and the Phase-8 crash-alert
      // hook (`runCommand.ts`), none of which the direct `runPlugin` call
      // below it used to provide. Other plugins (and other invocations of
      // this same plugin that did NOT match the registry) keep their legacy
      // run(ctx).
      if (matchedPlugin && matchedPlugin.pluginName === plugin.name && matchedPlugin.handler) {
        // runCommand() opts into rethrow so its Phase-8 fireAlert("plugin_crash")
        // catch actually runs (runPlugin() swallows by default — see pluginGuard.ts).
        // Swallow here too, at the boundary: this loop must never crash the bot,
        // same guarantee the legacy runPlugin(plugin, ctx) branch below already has.
        try {
          await runCommand({ pluginName: plugin.name, ctx, resolution, reply: msgCtx.reply });
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          logger.warn(`[messageHandler] runCommand crashed for plugin "${plugin.name}": ${err.message}`);
        }
      } else {
        await runPlugin(plugin, ctx);
      }
    } finally {
      if (useTyping) {
        clearInterval(typingInterval);
        contract.sendPresenceUpdate("paused", rawJid).catch(() => {});
      }
    }
  }

  // Legacy plugins do not report whether they handled a message.  Keep the
  // generic fallback opt-in and send it only after they have all had a
  // chance to respond; a legacy plugin may therefore still produce a reply
  // alongside this fallback.
  if (!matched && command && registry?.menu.notFoundFallback) {
    try {
      await msgCtx.reply.text(renderNotFound(command, registry));
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.warn(`[messageHandler] notFoundFallback reply failed: ${err.message}`);
    }
  }
}

