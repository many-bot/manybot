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
 *  - DMs: every message from the sender counts toward the threshold.
 *  - Groups: only messages that actually invoke the bot (hasPrefix) count,
 *    so silent group members are never auto-added.
 *  - The threshold itself is randomized per sender (not fixed), so the
 *    save timing doesn't look scripted.
 *  - Saves happen one at a time, paced naturally by how often people
 *    actually talk to the bot — never a bulk import.
 *  - Refresh: occasionally, a small random sample of long-saved contacts
 *    get removed and are transparently re-added on their next message,
 *    picking up pushName changes instead of keeping a stale name forever.
 */

import type { WASocket, WAProtoMsg } from "#types";
import { buildSettingsApi } from "#kernel/settingsDb.js";
import { logger } from "#logger";

const DM_THRESHOLD_RANGE    = { min: 3, max: 6 };
const GROUP_THRESHOLD_RANGE = { min: 5, max: 9 }; // groups need extra calm

const REFRESH_MIN_AGE_MS   = 30 * 24 * 60 * 60 * 1000; // re-check after 30 days
const REFRESH_SWEEP_SAMPLE = 2; // stale contacts touched per sweep, not all at once

interface SenderState {
  target:          number; // messages needed before saving (randomized once)
  count:           number;
  saved:           boolean;
  savedAt:         number;
  pendingRefresh:  boolean;
}

type StateMap = Record<string, SenderState>;

// One JSON blob under a reserved plugin namespace — not chat-scoped, since
// a saved contact is a bot-wide fact, not a per-chat one.
const store = buildSettingsApi("__contactAutoSave__", "_global").global;

function loadState(): StateMap {
  return (store.get("state", {}) as StateMap) ?? {};
}

function saveState(state: StateMap): void {
  store.set("state", state);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function addContact(sock: WASocket, jid: string, name: string): Promise<void> {
  try {
    await sock.addOrEditContact(jid, {
      fullName:  name,
      firstName: name,
      saveOnPrimaryAddressbook: true,
    });
    logger.debug(`[contactAutoSave] saved contact ${jid} as "${name}"`);
  } catch (e) {
    logger.debug(`[contactAutoSave] failed to save contact ${jid}: ${(e as Error).message}`);
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

    const state = loadState();
    let s = state[senderJid];

    // Completing a refresh takes priority over new-save logic, but in
    // groups it still only fires on messages that invoke the bot — same
    // rule as the initial save, so a refresh never re-adds someone based
    // on a silent group message.
    if (s?.pendingRefresh && (!isGroup || triggeredBot)) {
      await addContact(sock, senderJid, pushName);
      s.pendingRefresh = false;
      s.savedAt = Date.now();
      state[senderJid] = s;
      saveState(state);
      return;
    }

    if (s?.saved) return; // already saved, not due for refresh

    if (isGroup && !triggeredBot) return; // groups: only count messages that invoke the bot

    if (!s) {
      const range = isGroup ? GROUP_THRESHOLD_RANGE : DM_THRESHOLD_RANGE;
      s = { target: randomInt(range.min, range.max), count: 0, saved: false, savedAt: 0, pendingRefresh: false };
    }

    s.count += 1;

    if (s.count >= s.target) {
      await addContact(sock, senderJid, pushName);
      s.saved   = true;
      s.savedAt = Date.now();
    }

    state[senderJid] = s;
    saveState(state);
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
  const state = loadState();
  const now = Date.now();

  const due = Object.entries(state)
    .filter(([, s]) => s.saved && !s.pendingRefresh && now - s.savedAt > REFRESH_MIN_AGE_MS)
    .sort(() => Math.random() - 0.5)
    .slice(0, REFRESH_SWEEP_SAMPLE);

  if (due.length === 0) return;

  for (const [jid, s] of due) {
    try {
      await sock.removeContact(jid);
      s.pendingRefresh = true;
      state[jid] = s;
      logger.debug(`[contactAutoSave] queued refresh for ${jid}`);
    } catch (e) {
      logger.debug(`[contactAutoSave] failed to remove contact ${jid} for refresh: ${(e as Error).message}`);
    }
  }

  saveState(state);
}
