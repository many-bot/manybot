/**
 * whatsappClient.ts
 *
 * Legacy shim — re-exports from baileysSock.ts.
 * Kept so any external tooling referencing this path doesn't break.
 */
export { createSocket, store, normalizeJid } from "#client/baileysSock";
