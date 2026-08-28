/**
 * kernel/runCommand.ts
 *
 * ManyBot v6 — single kernel-side dispatcher for routed prefix
 * commands. Centralising this gives Phase 8 a single try/catch hook
 * (the "natural capture point" called out in MANYBOT-6.md) and keeps
 * the per-command logic out of the message handler so each step
 * (permission → required-arguments → sub-command routing → handler
 * dispatch → crash alert) can be tested independently.
 *
 * Pipeline:
 *   1. Resolve the parent entry by invocation (= cmd or alias).
 *   2. Permission check (owner/scope/blacklist/whitelist/admin/botAdmin/cooldown).
 *   3. Sub-command routing: if the parent has subcommands, look up the
 *      next token; if a match exists, dispatch to the sub instead.
 *   4. Required-argument validation against the matched entry's
 *      declared `arguments:` block.
 *   5. Handler dispatch via `runPlugin` (same timeout + 3-strikes guard
 *      as the message handler uses for the legacy plugin.run path).
 *   6. Crash capture: any throw inside step 5 fires `fireAlert` at
 *      phase 8 hook level before re-raising; this is the unique
 *      advantage of the unified dispatcher over the legacy
 *      `for (plugin of pluginRegistry) await runPlugin(...)` loop.
 */

import { logger } from "#logger";
import { tFor } from "#i18n";
import { CMD_PREFIX } from "#config";
import { fireAlert } from "./alerts.js";
import { runPlugin } from "./pluginGuard.js";
import { checkPermission } from "./commandPermissions.js";
import { getCommandRegistry, type CommandEntry, type CommandSubcommand } from "./commandRegistry.js";
import { pluginRegistry, resolvePluginCommandHandler, type PluginEntry } from "./pluginLoader.js";
import { STOP_CHAIN, type CommandArgument } from "./commandsConfig.js";
import type { PluginContext } from "./pluginApi.js";
import { resolveCoreCommandHandler } from "./coreCommands.js";
import { getChatLocale, getChatPrefix } from "./chatOverrides.js";

export type DispatchTarget =
  | { kind: "parent"; entry: CommandEntry; args: string[] }
  | { kind: "sub";    parent: CommandEntry; sub: CommandSubcommand; args: string[] }
  | { kind: "none" };

export interface DispatchResolution {
  target: DispatchTarget;
  /** Set when target.kind === "parent" AND a sub token was given but
   *  didn't match. Caller can decide what to do (render a usage hint
   *  with valid subs, fall through to the parent handler, …). */
  unmatchedSubToken?: string;
}

/** Flat shape used inside {@link runCommand} so the discriminated-union
 *  collapses to one record. The compiler can't follow `kind === "sub"
 *  ? ... .entry : ... .entry` ternaries through separate sub-arms, so
 *  we materialise a uniform `name` + `permissions` + `arguments` triple
 *  before the body runs. */
interface FlatTarget {
  kind: "parent" | "sub";
  name: string;
  entry: CommandEntry;
  permissions: CommandEntry["permissions"];
  arguments: CommandArgument[];
  args: string[];
}

function flatten(target: Exclude<DispatchTarget, { kind: "none" }>): FlatTarget {
  if (target.kind === "sub") {
    return {
      kind: "sub",
      entry: target.parent,
      name: `${target.parent.cmd} ${target.sub.cmd}`,
      permissions: target.sub.permissions,
      arguments: target.sub.arguments ?? [],
      args: target.args,
    };
  }
  return {
    kind: "parent",
    entry: target.entry,
    name: target.entry.cmd,
    permissions: target.entry.permissions,
    arguments: target.entry.arguments ?? [],
    args: target.args,
  };
}

/**
 * Pure resolution — finds the parent + sub (if any) without invoking.
 * `rawArgs` is the body fragment with the leading `<cmd> ` stripped.
 */
export function resolveDispatch(command: string, rawArgs: string): DispatchResolution {
  const registry = getCommandRegistry();
  if (!registry) return { target: { kind: "none" } };

  const parentId = registry.byInvocation.get(command);
  if (!parentId) return { target: { kind: "none" } };
  const entry = registry.byId.get(parentId);
  if (!entry) return { target: { kind: "none" } };

  const trimmed = rawArgs.trim();
  if (Object.keys(entry.subcommands).length === 0 || !trimmed) {
    return { target: { kind: "parent", entry, args: trimmed ? trimmed.split(/\s+/) : [] } };
  }

  const token = trimmed.split(/\s+/)[0].toLowerCase();
  const sub = entry.subcommands[token];
  if (!sub) {
    const remaining = trimmed.split(/\s+/).slice(1);
    return {
      target: { kind: "parent", entry, args: remaining },
      unmatchedSubToken: token,
    };
  }

  const rest = trimmed.split(/\s+/).slice(1);
  return { target: { kind: "sub", parent: entry, sub, args: rest } };
}

export interface RunCommandOptions {
  /**
   * The plugin that should run the command. For plugin commands, this
   * is `entry.pluginName`; for legacy `text::` specs it's null.
   */
  pluginName: string | null;
  /**
   * The raw chat id the message arrived on (`msg.chatId`, not yet
   * normalized). Used to resolve this chat's `!config` overrides
   * (prefix / language) — see `chatOverrides.ts`. Passed separately
   * from `ctx` because `ctx.chat.id` goes through a different jid
   * resolution path than the one `!config` writes are scoped under,
   * so we thread the same raw id the message handler already has
   * rather than risk the two disagreeing. Optional: omitting it (e.g.
   * in tests that don't care about per-chat overrides) just means
   * every chat looks like it has none set, so the global defaults
   * (`CMD_PREFIX`, `CONFIG.LANGUAGE`) are used.
   */
  chatId?: string;
  /**
   * The fully-built PluginContext for the current message. The
   * dispatcher does not construct ctx itself — it consumes one built
   * by the message handler so we don't duplicate ctx construction.
   */
  ctx: PluginContext;
  /** Resolved dispatch target (parent, sub, or none). */
  resolution: DispatchResolution;
  /**
   * Pre-rendered replies. The dispatcher may need to send permission
   * denials or argument-missing errors itself; callers may pass in
   * the bound message replies instead. We keep this minimal — the
   * caller still owns the message-reply surface.
   */
  reply: { text(text: string): unknown };
}

export interface RunCommandResult {
  /** What happened. */
  status: "executed" | "permission_denied" | "argument_missing" | "unknown_sub" | "no_dispatch";
  /** Optional reply text the dispatcher already sent on the caller's behalf. */
  sentReply: string | null;
  /** When status === "permission_denied" / "argument_missing" / "unknown_sub",
   *  the message the caller can also render (if it wasn't sent). */
  suggestedReply: string | null;
}

/**
 * Imperative run: takes the dispatcher-ready shapes (plugin, ctx,
 * resolved target) and runs them through the unified pipeline.
 *
 * Returns a small result so the caller (the message handler) can
 * decide whether to send any extra reply, log the action, or fall
 * through to the legacy run loop.
 */
export async function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const { resolution, pluginName, ctx, reply, chatId } = opts;
  const { target } = resolution;

  // Resolved once per dispatch: this chat's `!config` overrides (or the
  // global defaults when none were set) for every kernel-authored reply
  // below (unknown-sub hint, missing-argument usage, ...).
  const lang = chatId ? getChatLocale(chatId) : undefined;
  const prefix = chatId ? getChatPrefix(chatId) : CMD_PREFIX;

  if (target.kind === "none") {
    return { status: "no_dispatch", sentReply: null, suggestedReply: null };
  }

  const flat = flatten(target);

  // Sub-tokens that don't match any declared sub go through the parent
  // handler — same convention as a CLI tool with an unknown subcommand.
  if (resolution.unmatchedSubToken && target.kind === "parent") {
    const validSubs = Object.keys(target.entry.subcommands);
    const help = tFor(lang, "commandRun.unknownSubcommand", {
      sub: resolution.unmatchedSubToken,
      cmd: target.entry.cmd,
      valid: validSubs.join(", ") || "(none)",
    }) as string;
    await reply.text(help);
    return { status: "unknown_sub", sentReply: help, suggestedReply: help };
  }

  // Permission check uses the resolved (parent OR sub) permissions.
  const permEntry: CommandEntry =
    target.kind === "sub" ? subAsEntry(target.parent, target.sub) : target.entry;

  const perm = await checkPermission(permEntry, {
    isGroup:    ctx.chat.isGroup,
    chatId:     ctx.chat.id,
    sender:     { lid: ctx.msg.sender, pn: ctx.msg.senderPn },
    isSenderAdmin: () => ctx.chat.isSenderAdmin(),
    isBotAdmin:    () => ctx.chat.isBotAdmin(),
  });
  if (!perm.allowed) {
    if (perm.message) {
      await reply.text(perm.message);
    }
    return { status: "permission_denied", sentReply: perm.message ?? null, suggestedReply: perm.message ?? null };
  }

  // Required-argument check — purely advisory, the plugin still gets
  // called with whatever args arrived. Surface the kernel-side message
  // + auto-generated usage before invoking.
  const requiredCount = flat.arguments.filter(a => a.required).length;
  if (requiredCount > flat.args.length) {
    const usage = renderUsage(target, prefix);
    const msg = `${tFor(lang, "commandRun.missingRequiredArg")}\n\n${usage}`;
    await reply.text(msg);
    return { status: "argument_missing", sentReply: msg, suggestedReply: msg };
  }

  // Wrap the dispatch in a try/catch and fire alerts on any throw.
  // This is the Phase 8 hook.
  try {
    if (!pluginName) {
      // text-only command handled below (caller will handle the fixed-text path).
      return { status: "no_dispatch", sentReply: null, suggestedReply: null };
    }

    // Function chain dispatch — v6 reference yaml allows a command to
    // declare `functions: [a, b, c]` and have them run top-to-bottom.
    // Each function receives the same `(ctx, { args, subcommand })`
    // shape; a function may short-circuit the rest of the chain by
    // returning the sentinel `STOP_CHAIN` (exported from
    // `commandsConfig.ts`). Anything else (void/undefined/regular value)
    // lets the chain continue. Empty chain → "no_dispatch" (parent is
    // metadata-only, e.g. a sub-container with no override).
    const fnNames: string[] = target.kind === "sub" ? target.sub.functions : target.entry.functions;

    if (fnNames.length === 0) {
      return { status: "no_dispatch", sentReply: null, suggestedReply: null };
    }

    const subId = target.kind === "sub" ? target.sub.cmd : undefined;
    const input = { args: flat.args, subcommand: subId };

    if (pluginName === "core") {
      for (const fnName of fnNames) {
        const handler = resolveCoreCommandHandler(fnName);
        if (!handler) {
          logger.warn(`[runCommand] Core namespace does not expose handler "${fnName}"`);
          continue;
        }
        const result = await handler(ctx, input);
        if (result === STOP_CHAIN) break;
      }
      return { status: "executed", sentReply: null, suggestedReply: null };
    }

    const plugin = lookupPlugin(pluginName);
    if (!plugin) {
      const msg = `Plugin "${pluginName}" is not active`;
      logger.warn(`[runCommand] ${msg}`);
      return { status: "no_dispatch", sentReply: null, suggestedReply: msg };
    }

    for (const fnName of fnNames) {
      const handler = resolvePluginCommandHandler(plugin.commands?.[fnName]);
      if (!handler) {
        const msg = `Plugin "${pluginName}" does not expose handler for !${flat.name}.${fnName}`;
        logger.warn(`[runCommand] ${msg}`);
        continue;
      }
      const result = await runPlugin(
        plugin,
        ctx as never,
        handler,
        input,
        { rethrow: true }
      );
      if (result === STOP_CHAIN) break;
    }

    return { status: "executed", sentReply: null, suggestedReply: null };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));

    fireAlert("plugin_crash", {
      plugin: pluginName,
      command: flat.name,
      kind: err.message?.startsWith("timed out") ? "timeout" : "exception",
      message: err.message,
    });
    // Re-raise so pluginGuard can keep its 3-strike bookkeeping.
    throw err;
  }
}

/**
 * Treat a sub-command as if it were a CommandEntry for permission
 * checks. We materialise a virtual entry sharing the sub's resolved
 * permissions, since `checkPermission` works against `CommandEntry`.
 */
function subAsEntry(parent: CommandEntry, sub: CommandSubcommand): CommandEntry {
  return {
    ...parent,
    id: sub.id,
    cmd: sub.cmd,
    permissions: sub.permissions,
    subcommands: {},
    arguments: sub.arguments,
    group: null,
    manual: sub.manual,
    categoryHiddenInScope: null,
  };
}

/**
 * Look up the real, live `PluginEntry` for a plugin command dispatch.
 * `pluginRegistry` (from `pluginLoader.ts`) is the same module-level
 * map `commandRegistry.ts` reads at build time — its `commands` field
 * carries the plugin's raw `commands` export as-is (bare handler
 * function or `{ handler, ... }` object); `resolvePluginCommandHandler`
 * normalizes either shape into a callable handler.
 *
 * Returning the *real* entry (not a throwaway `{ name }` stand-in)
 * matters: `runPlugin` (`pluginGuard.ts`) gates on `plugin.status ===
 * "active"` and persists `errorCount`/3-strikes bookkeeping onto the
 * object it's given — a fresh literal each call would silently no-op
 * every dispatch (fails the `status` check) and never accumulate
 * crash counts.
 *
 * NOTE: this is deliberately NOT `ctx.plugins.require(pluginName)` —
 * that facet returns `PluginEntry.exports` (the plugin's pure `api`
 * object, Phase 3's `export const api = {...}`, which never receives
 * `ctx`). Command/sub-command handlers are a different facet
 * (`PluginEntry.commands`) and always receive `ctx`.
 */
function lookupPlugin(pluginName: string): PluginEntry | null {
  const plugin = pluginRegistry.get(pluginName);
  if (!plugin || plugin.status !== "active" || !plugin.commands) return null;
  return plugin;
}

/**
 * Render an auto-generated usage line for a command/sub. Format:
 *   !<cmd>[ <sub>] [--<arg1> ...]
 * Built from the declared `arguments:` block.
 */
export function renderUsage(target: DispatchTarget, prefix: string = CMD_PREFIX): string {
  if (target.kind === "none") return "";
  const flat = flatten(target);
  const head = target.kind === "sub"
    ? `${prefix}${target.parent.cmd} ${target.sub.cmd}`
    : `${prefix}${flat.entry.cmd}`;
  const headClean = head.replace(/\s+$/, "");

  if (flat.arguments.length === 0) return headClean;

  const parts: string[] = [];
  for (const arg of flat.arguments) {
    const tok = arg.type === "boolean" ? `--${arg.name}[=true|false]` :
                arg.type === "choice"   ? `--${arg.name}=<${arg.choices?.join("|") ?? "..."}>` :
                arg.type === "mention"  ? `@<user>` :
                arg.type === "url"      ? `<url>` :
                arg.type === "media_direct" ? `<media>` :
                arg.type === "media_reply"  ? `<reply-media>` :
                arg.type === "number"   ? `<n>` :
                arg.type === "duration" ? `<duration>` :
                arg.type === "quoted_text" ? `"<text>"` :
                arg.type === "reply"    ? `<reply>` :
                `<${arg.name}>`;
    parts.push(arg.required ? tok : `[${tok}]`);
  }
  return `${headClean} ${parts.join(" ")}`;
}

