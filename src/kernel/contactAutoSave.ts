/**
 * contactAutoSave.ts
 *
 * Gradually saves incoming senders as real contacts (using their pushName)
 * once they've shown they're likely to keep talking, and periodically
 * refreshes stale pushNames. Purely additive to sendGuard/floodGuard's
 * anti-detection posture — a saved contact scores as "known" rather than
 * "stranger" on WhatsApp's contact-graph-distance signal, and mobile
 * clients resolve @mentions to a name instead of raw digits.
 *
 * Rules:
 *  - DMs: every message from the sender counts toward the DM threshold.
 *  - Groups: only messages that actually invoke the bot (hasPrefix) count
 *    toward the group threshold, so silent group members are never
 *    auto-added.
 *  - DM and group progress are tracked as two SEPARATE counters per
 *    sender, each with its own randomized target — a person who first
 *    messages in a group and later DMs the bot doesn't get to skip the
 *    (deliberately higher) group threshold via their DM count, or vice
 *    versa. Saving happens as soon as EITHER counter reaches its target.
 *  - The thresholds are randomized per sender (not fixed), so the save
 *    timing doesn't look scripted.
 *  - Saves happen one at a time, paced naturally by how often people
 *    actually talk to the bot — never a bulk import.
 *  - If the actual contact-save call fails (e.g. transient error), the
 *    sender is NOT marked as saved — the next qualifying message retries
 *    automatically, rather than waiting for the 30-day refresh cycle.
 *  - Refresh: occasionally, a small random sample of long-saved contacts
 *    get removed and are transparently re-added on their next message,
 *    picking up pushName changes instead of keeping a stale name forever.
 *
 * Storage: each sender is its own key (not one shared blob) so that a
 * slow contact-save call for one sender can never cause a concurrent
 * update for a different sender to be silently lost — see setSenderState.
 */

import type { WASocket, WAProtoMsg } from "#types";
import { buildSettingsApi } from "#kernel/settingsDb.js";
import { toWireJid } from "#drivers/whatsapp/sdk/baileysSock.js";
import { logger } from "#logger";

const DM_THRESHOLD_RANGE    = { min: 3, max: 6 };
const GROUP_THRESHOLD_RANGE = { min: 5, max: 9 }; // groups need extra calm

const REFRESH_MIN_AGE_MS   = 30 * 24 * 60 * 60 * 1000; // re-check after 30 days
const REFRESH_SWEEP_SAMPLE = 2; // stale contacts touched per sweep, not all at once

interface SenderState {
  dmTarget:       number; // DM messages needed before saving (randomized once)
  groupTarget:    number; // bot-invoking group messages needed before saving (randomized once)
  dmCount:        number;
  groupCount:     number;
  saved:          boolean;
  savedAt:        number;
  pendingRefresh: boolean;
}

// Reserved plugin namespace — not chat-scoped, since a saved contact is a
// bot-wide fact, not a per-chat one. Each sender gets its own key
// ("sender:<jid>") rather than one shared JSON blob, so concurrent
// updates for different senders (normal — different chats run
// concurrently) never clobber each other.
const store = buildSettingsApi("__contactAutoSave__", "_global").global;
const SENDER_KEY_PREFIX = "sender:";

function senderKey(jid: string): string {
  return `${SENDER_KEY_PREFIX}${jid}`;
}

function getSenderState(jid: string): SenderState | undefined {
  return store.get(senderKey(jid)) as SenderState | undefined;
}

function setSenderState(jid: string, s: SenderState): void {
  store.set(senderKey(jid), s);
}

function getAllSenderStates(): Record<string, SenderState> {
  const all = store.getAll();
  const result: Record<string, SenderState> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(SENDER_KEY_PREFIX)) {
      result[key.slice(SENDER_KEY_PREFIX.length)] = value as SenderState;
    }
  }
  return result;
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * @returns whether the contact was actually saved. Callers must not mark
 * a sender as "saved" unless this returns true — otherwise a transient
 * failure would be mistaken for a real save and never retried.
 */
async function addContact(sock: WASocket, jid: string, name: string): Promise<boolean> {
  // `jid` here is this framework's internal "@c.us" form (see
  // getMsgSender()/normalizeJid()) — Baileys needs the real wire JID or
  // it silently no-ops instead of throwing, which is exactly how this
  // went unnoticed before.
  const wireJid = toWireJid(jid);
  try {
    await sock.addOrEditContact(wireJid, {
      fullName:  name,
      firstName: name,
      saveOnPrimaryAddressbook: true,
    });
    logger.debug(`[contactAutoSave] saved contact ${wireJid} as "${name}"`);
    return true;
  } catch (e) {
    logger.debug(`[contactAutoSave] failed to save contact ${wireJid}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Call on every incoming message that has a resolvable sender. Handles
 * both the gradual first-save flow and completing a pending refresh.
 * Best-effort — never throws.
 *
 * @param {WASocket}   sock
 * @param {WAProtoMsg} msg
 * @param {string}     senderJid    — normalized sender JID (never a group JID)
 * @param {boolean}    isGroup      — whether this message came from a group chat
 * @param {boolean}    triggeredBot — true if this message invoked the bot
 *                                    (command prefix). Ignored outside groups.
 */
export async function trackIncomingForContactSave(
  sock:         WASocket,
  msg:          WAProtoMsg,
  senderJid:    string,
  isGroup:      boolean,
  triggeredBot: boolean
): Promise<void> {
  try {
    const pushName = msg.pushName?.trim();
    if (!pushName || senderJid.endsWith("@g.us")) return;

    let s = getSenderState(senderJid);

    // Completing a refresh takes priority over new-save logic, but in
    // groups it still only fires on messages that invoke the bot — same
    // rule as the initial save, so a refresh never re-adds someone based
    // on a silent group message.
    if (s?.pendingRefresh && (!isGroup || triggeredBot)) {
      const ok = await addContact(sock, senderJid, pushName);
      if (ok) {
        // Re-read rather than reuse `s` — another concurrent message from
        // this same sender may have updated the record while we awaited.
        const latest = getSenderState(senderJid) ?? s;
        latest.pendingRefresh = false;
        latest.savedAt = Date.now();
        setSenderState(senderJid, latest);
      }
      return;
    }

    if (s?.saved) return; // already saved, not due for refresh

    if (isGroup && !triggeredBot) return; // groups: only count messages that invoke the bot

    if (!s) {
      s = {
        dmTarget:    randomInt(DM_THRESHOLD_RANGE.min, DM_THRESHOLD_RANGE.max),
        groupTarget: randomInt(GROUP_THRESHOLD_RANGE.min, GROUP_THRESHOLD_RANGE.max),
        dmCount:     0,
        groupCount:  0,
        saved:          false,
        savedAt:        0,
        pendingRefresh: false,
      };
    }

    if (isGroup) s.groupCount += 1; else s.dmCount += 1;

    // Persist the increment right away, with no await in between — so a
    // slow addContact() call below never leaves this sender's counter
    // based on stale data for longer than necessary.
    setSenderState(senderJid, s);

    const reachedTarget = s.dmCount >= s.dmTarget || s.groupCount >= s.groupTarget;

    if (reachedTarget) {
      const ok = await addContact(sock, senderJid, pushName);
      if (ok) {
        const latest = getSenderState(senderJid) ?? s;
        latest.saved   = true;
        latest.savedAt = Date.now();
        setSenderState(senderJid, latest);
      }
      // If it failed, `saved` stays false — the next qualifying message
      // will see the target already reached and retry automatically.
    }
  } catch (e) {
    logger.debug(`[contactAutoSave] tracking failed (non-fatal): ${(e as Error).message}`);
  }
}

/**
 * Periodic maintenance: picks a small random sample of contacts saved
 * more than REFRESH_MIN_AGE_MS ago and starts their refresh cycle
 * (remove now, transparently re-added on their next message via
 * trackIncomingForContactSave) so a changed pushName doesn't linger.
 *
 * Call this occasionally (e.g. every few hours) from the driver.
 * @param {WASocket} sock
 */
export async function runContactRefreshSweep(sock: WASocket): Promise<void> {
  const now = Date.now();
  const all = getAllSenderStates();

  const due = Object.entries(all)
    .filter(([, s]) => s.saved && !s.pendingRefresh && now - s.savedAt > REFRESH_MIN_AGE_MS)
    .sort(() => Math.random() - 0.5)
    .slice(0, REFRESH_SWEEP_SAMPLE);

  if (due.length === 0) return;

  for (const [jid, s] of due) {
    try {
      await sock.removeContact(toWireJid(jid));
      s.pendingRefresh = true;
      setSenderState(jid, s);
      logger.debug(`[contactAutoSave] queued refresh for ${jid}`);
    } catch (e) {
      logger.debug(`[contactAutoSave] failed to remove contact ${jid} for refresh: ${(e as Error).message}`);
    }
  }
}
