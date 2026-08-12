# Changelog

## v5.7.0 - 2026-08-12

### Improvements

- **WaContract event surface** — `WaEventName` expanded from 10 to 16 events. New: `chats.delete`, `messages.delete`, `group.join-request`, `blocklist.set`, `blocklist.update`, `groups.upsert`. Excluded events (`creds.update`, `chats.phoneNumberShare`, `presence.update`, `messages.media-update`, `messages.reaction`, `message-receipt.update`, `call`, `labels.*`, `newsletter.*`) are documented per-event in `src/kernel/waContract.ts` — adding them later is a deliberate contract change, not a silent extension.

### Refactors

- **Plugin events API** — `buildEventsApi` / `cleanupPluginEvents` no longer touch the raw Baileys socket. Subscriptions go through `contract.on()` and event names are validated against the `WaEventName` set, throwing on unknown names instead of registering a silent no-op listener.
- **Group metadata invalidation** — `bindGroupMetaInvalidation` now subscribes to `group-participants.update` / `groups.update` through the contract instead of `sock.ev`.
- **Poll-vote decryption** — Extracted from raw Baileys calls into two optional contract methods: `decryptPollVote` and `aggregatePollVotes` (Baileys-only). `buildPollApi` subscribes to `messages.upsert` through the contract and routes decryption through it, removing the last raw-sock escape hatch from the events/poll path. The poll subscription is now properly detached in `cleanupPluginEvents` so plugin reload re-subscribes instead of leaking.
- **Baileys bump** — `@whiskeysockets/baileys` 6.7.23 → 6.7.24. `Events.d.ts` is identical, so no event-surface impact.

---

Previous releases are tracked via Git tags.
