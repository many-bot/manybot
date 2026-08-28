/**
 * commandPermissions.ts
 *
 * Permission engine for ManyBot commands.
 * Checks dono, owner, scope, allowed_chats, blacklist, whitelist,
 * botAdmin, admin, and cooldown.
 *
 * Order of evaluation:
 *   1. dono       (specific owner JID; otherwise falls through to owner)
 *   2. owner
 *   3. scope
 *   4. allowed_chats  (closed list of JIDs; deny outside)
 *   5. blacklist
 *   6. whitelist
 *   7. botAdmin
 *   8. admin
 *   9. cooldown (only consumed if all prior checks pass)
 */

import { OWNER_NUMBER } from "#config";
import { normalizeJid } from "#drivers/jid.js";
import type { CommandEntry } from "./commandRegistry.js";

export interface SenderIdentity {
  /** LID-canonical id (`@lid`), or `null` when not yet known. */
  lid: string | null;
  /** Phone-number form (`@c.us`), or `null` when not available. */
  pn:  string | null;
}

export interface PermissionContext {
  isGroup: boolean;
  chatId: string;
  sender: SenderIdentity;
  isSenderAdmin: () => Promise<boolean>;
  isBotAdmin: () => Promise<boolean>;
}

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; message?: string };

const cooldownMap = new Map<string, number>();

export function clearCooldowns(): void {
  cooldownMap.clear();
}

export function getCooldownMap(): Map<string, number> {
  return cooldownMap;
}

export function matchId(targetId: string | null | undefined, candidate: string): boolean {
  if (!targetId || !candidate) return false;
  const normTarget = normalizeJid(targetId.trim());
  const normCandidate = normalizeJid(candidate.trim());
  if (normTarget === normCandidate) return true;

  const digitsTarget = targetId.replace(/\D/g, "");
  const digitsCandidate = candidate.replace(/\D/g, "");
  if (digitsTarget.length > 0 && digitsTarget === digitsCandidate) {
    return true;
  }

  return false;
}

export function matchesAny(targetId: string | null | undefined, candidates: string[]): boolean {
  if (!targetId) return false;
  return candidates.some(candidate => matchId(targetId, candidate));
}

/**
 * Matches a sender against a list of configured ids (numbers or JIDs),
 * trying both the LID and PN forms — config today is written in phone
 * numbers, but a sender whose PN mapping isn't known yet only has a LID
 * (or, rarely, only a PN when no LID has been learned). Either form
 * matching is enough.
 */
export function matchesSender(sender: SenderIdentity, candidates: string[]): boolean {
  return matchesAny(sender.lid, candidates) || matchesAny(sender.pn, candidates);
}

/** Stable per-sender identity for cooldown/state keys — prefers LID (canonical), falls back to PN. */
function senderKey(sender: SenderIdentity): string {
  return sender.lid ?? sender.pn ?? "unknown";
}

/**
 * Cooldown reset key. Format: `<pluginName>:<subId|cmd>` so distinct
 * plugin-provided commands don't share buckets even when registered
 * under the same cmd, and the same command under two cmd names doesn't
 * either. Subcommands reuse the parent's plugin/cmd unless overridden.
 */
function cooldownKey(entry: CommandEntry): string {
  return `${entry.pluginName ?? "text"}:${entry.cmd}`;
}

export async function checkPermission(
  entry: CommandEntry,
  ctx: PermissionContext
): Promise<PermissionCheckResult> {
  const perms = entry.permissions;
  const msgs = perms.messages;

  // 1. dono check (specific owner JID, overrides global OWNER_NUMBER)
  if (perms.dono) {
    if (!matchesSender(ctx.sender, [perms.dono])) {
      return { allowed: false, message: msgs.donoOnly };
    }
  }

  // 2. Owner check
  if (perms.owner) {
    if (!OWNER_NUMBER || !matchesSender(ctx.sender, [OWNER_NUMBER])) {
      return { allowed: false, message: msgs.ownerOnly };
    }
  }

  // 3. Scope check (group | dm | any)
  if (perms.scope === "group" && !ctx.isGroup) {
    return { allowed: false, message: msgs.wrongScope };
  }
  if (perms.scope === "dm" && ctx.isGroup) {
    return { allowed: false, message: msgs.wrongScope };
  }

  // 4. allowed_chats check (closed list of JIDs the command may run in)
  if (perms.allowedChats && perms.allowedChats.length > 0) {
    if (!matchesAny(ctx.chatId, perms.allowedChats)) {
      return { allowed: false, message: msgs.allowedChats };
    }
  }

  // 5. Blacklist check
  if (perms.blacklist) {
    if (ctx.isGroup && perms.blacklist.groups.length > 0) {
      if (matchesAny(ctx.chatId, perms.blacklist.groups)) {
        return { allowed: false, message: msgs.blacklist };
      }
    }
    if (perms.blacklist.users.length > 0) {
      if (matchesSender(ctx.sender, perms.blacklist.users)) {
        return { allowed: false, message: msgs.blacklist };
      }
    }
  }

  // 6. Whitelist check (defined list and outside it -> deny)
  if (perms.whitelist) {
    const hasGroupList = perms.whitelist.groups.length > 0;
    const hasUserList = perms.whitelist.users.length > 0;

    if (ctx.isGroup && hasGroupList) {
      if (!matchesAny(ctx.chatId, perms.whitelist.groups)) {
        return { allowed: false, message: msgs.wrongScope };
      }
    } else if (!ctx.isGroup && hasGroupList && !hasUserList) {
      return { allowed: false, message: msgs.wrongScope };
    }

    if (hasUserList) {
      if (!matchesSender(ctx.sender, perms.whitelist.users)) {
        return { allowed: false, message: msgs.wrongScope };
      }
    }
  }

  // 7. botAdmin check
  if (perms.botAdmin) {
    if (!ctx.isGroup) {
      return { allowed: false, message: msgs.botNotAdmin };
    }
    const isBotAdmin = await ctx.isBotAdmin();
    if (!isBotAdmin) {
      return { allowed: false, message: msgs.botNotAdmin };
    }
  }

  // 8. admin check
  if (perms.admin) {
    if (!ctx.isGroup) {
      return { allowed: false, message: msgs.senderNotAdmin };
    }
    const isSenderAdmin = await ctx.isSenderAdmin();
    if (!isSenderAdmin) {
      return { allowed: false, message: msgs.senderNotAdmin };
    }
  }

  // 9. Cooldown check (only consumed if all other checks pass)
  if (perms.cooldownSeconds > 0) {
    const key = `${cooldownKey(entry)}:${senderKey(ctx.sender)}`;
    const now = Date.now();
    const lastUsed = cooldownMap.get(key) ?? 0;
    const elapsedSeconds = (now - lastUsed) / 1000;

    if (elapsedSeconds < perms.cooldownSeconds) {
      const remaining = Math.ceil(perms.cooldownSeconds - elapsedSeconds);
      const msg = msgs.cooldown
        .replace(/\{\{seconds\}\}/g, String(remaining))
        .replace(/\{\{time\}\}/g, String(remaining));
      return { allowed: false, message: msg };
    }

    cooldownMap.set(key, now);
  }

  return { allowed: true };
}

