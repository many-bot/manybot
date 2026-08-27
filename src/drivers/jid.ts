// Neutral JID utilities used by both Baileys and WhatsMeow drivers.

/**
 * Normalize a JID to the internal "@c.us" format used in ManyBot configs.
 * Groups (@g.us) and broadcasts are passed through unchanged.
 */
export function normalizeJid(jid: string): string {
  if (!jid) return jid;
  return jid
    .replace(/@s\.whatsapp\.net$/, "@c.us")
    .replace(/:\d+@/, "@");
}

/**
 * Reverse of normalizeJid – convert back to the raw wire format "@s.whatsapp.net".
 */
export function denormalizeJid(jid: string): string {
  return jid.replace(/@c\.us$/, "@s.whatsapp.net");
}

/**
 * Convert any identifier (phone number, already‑wire JID, or framework JID) to the
 * wire JID format WhatsApp expects ("...@s.whatsapp.net").
 */
export function toWireJid(id: string): string {
  const trimmed = id.trim();
  if (/@(s\.whatsapp\.net|lid|g\.us)$/.test(trimmed)) return trimmed;
  if (trimmed.endsWith("@c.us")) return denormalizeJid(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

/**
 * Split a Baileys "primary/alt" JID pair (e.g. `key.participant` +
 * `key.participantAlt`, or `key.remoteJid` + `key.remoteJidAlt`) into its
 * LID and PN forms.
 *
 * Baileys only labels the primary field as the PN and the alt field as the
 * LID under the legacy `addressingMode: "pn"`. Under the modern default
 * `addressingMode: "lid"` the roles are reversed — the primary field IS
 * already the LID, and the alt field carries the PN instead (see
 * https://baileys.wiki/concepts/jids: "Group participant fields are
 * typically LIDs; participantAlt carries the matching PN, and vice versa").
 *
 * Branching on `addressingMode` itself isn't reliable either — it's been
 * observed flip-flopping for the same conversation across rc builds (see
 * https://github.com/WhiskeySockets/Baileys/issues/1827). The one thing
 * that's actually trustworthy is the JID suffix itself: whichever of the
 * two values ends in "@lid" IS the LID, regardless of which field it came
 * from or what addressingMode claims.
 */
export function splitLidPn(
  primary?: string | null,
  alt?:     string | null,
): { lid?: string; pn?: string } {
  const candidates = [primary, alt].filter((v): v is string => !!v);
  return {
    lid: candidates.find(v => v.endsWith("@lid")),
    pn:  candidates.find(v => !v.endsWith("@lid")),
  };
}
