/**
 * commandPermissions.ts
 *
 * Permission engine for ManyBot commands.
 * Checks owner, scope, blacklist, whitelist, botAdmin, admin, and cooldown.
 *
 * Order of evaluation:
 *   1. owner
 *   2. scope
 *   3. blacklist
 *   4. whitelist
 *   5. botAdmin
 *   6. admin
 *   7. cooldown (only consumed if all prior checks pass)
 */

import { OWNER_NUMBER } from "#config";
import { normalizeJid } from "#drivers/jid.js";
import type { CommandEntry } from "./commandRegistry.js";

export interface PermissionContext {
  isGroup: boolean;
  chatId: string;
  senderId: string;
  isSenderAdmin: () => Promise<boolean>;
  isBotAdmin: () => Promise<boolean>;
}

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; message: string };

const cooldownMap = new Map<string, number>();

export function clearCooldowns(): void {
  cooldownMap.clear();
}

export function getCooldownMap(): Map<string, number> {
  return cooldownMap;
}

export function matchId(targetId: string, candidate: string): boolean {
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

export function matchesAny(targetId: string, candidates: string[]): boolean {
  return candidates.some(candidate => matchId(targetId, candidate));
}

export async function checkPermission(
  entry: CommandEntry,
  ctx: PermissionContext
): Promise<PermissionCheckResult> {
  const perms = entry.permissions;
  const msgs = perms.messages;

  // 1. Owner check
  if (perms.owner) {
    if (!OWNER_NUMBER || !matchId(ctx.senderId, OWNER_NUMBER)) {
      return { allowed: false, message: msgs.ownerOnly };
    }
  }

  // 2. Scope check (group | dm | any)
  if (perms.scope === "group" && !ctx.isGroup) {
    return { allowed: false, message: msgs.wrongScope };
  }
  if (perms.scope === "dm" && ctx.isGroup) {
    return { allowed: false, message: msgs.wrongScope };
  }

  // 3. Blacklist check
  if (perms.blacklist) {
    if (ctx.isGroup && perms.blacklist.groups.length > 0) {
      if (matchesAny(ctx.chatId, perms.blacklist.groups)) {
        return { allowed: false, message: msgs.wrongScope };
      }
    }
    if (perms.blacklist.users.length > 0) {
      if (matchesAny(ctx.senderId, perms.blacklist.users)) {
        return { allowed: false, message: msgs.wrongScope };
      }
    }
  }

  // 4. Whitelist check (defined list and outside it -> deny)
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
      if (!matchesAny(ctx.senderId, perms.whitelist.users)) {
        return { allowed: false, message: msgs.wrongScope };
      }
    }
  }

  // 5. botAdmin check
  if (perms.botAdmin) {
    if (!ctx.isGroup) {
      return { allowed: false, message: msgs.botNotAdmin };
    }
    const isBotAdmin = await ctx.isBotAdmin();
    if (!isBotAdmin) {
      return { allowed: false, message: msgs.botNotAdmin };
    }
  }

  // 6. admin check
  if (perms.admin) {
    if (!ctx.isGroup) {
      return { allowed: false, message: msgs.senderNotAdmin };
    }
    const isSenderAdmin = await ctx.isSenderAdmin();
    if (!isSenderAdmin) {
      return { allowed: false, message: msgs.senderNotAdmin };
    }
  }

  // 7. Cooldown check (only consumed if all other checks pass)
  if (perms.cooldownSeconds > 0) {
    const key = `${entry.id}:${ctx.senderId}`;
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
