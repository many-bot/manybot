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
