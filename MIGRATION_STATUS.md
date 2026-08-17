# WhatsMeow Migration Plan Status

## Status

**Superseded (Aug 14)** – The plan to eventually promote WhatsMeow to the primary driver (and the driver fallback mechanism that supported that transition) has been abandoned. WhatsMeow remains an optional/experimental driver; Baileys is the only production driver. This document reflects the implementation parity state at the time migration was paused — see `WHATSMEOW_MIGRATION_PLAN.md` for full history.

## Overview

The network contract (proto gRPC) is already declared for almost all methods, with the exception of `resolveLid`. In actual implementation, only Slice 0 (partial) is working: Go only has Connect/Disconnect/HealthCheck/SubscribeEvents/VerifySent/GetHistory/SendText implemented — everything else (media, presence, contacts, groups, profile) still returns `codes.Unimplemented`. Node (`client.ts`) mirrors this: only `connect`, `disconnect`, `sendText`, `getHistory` are wired; `resolveLid` is a stub (always returns `null`, does not invoke RPC). See full baseline in `WHATSMEOW_MIGRATION_PLAN.md` §0.

## Status by Slices

### Slice 0 — Test Harness
- [x] Configure driver flag in test runner (`WA_TEST_DRIVER=baileys|whatsmeow`)
- [ ] Survey actual API usage by plugins
- [ ] Run full test suite against Baileys → reference baseline
- **Exit criteria:** suite runs and passes 100% against Baileys (not reached — missing inventory + reference run)

### Slice 1 — `resolveLid` (NEW PROTO)
- [ ] Add `rpc ResolveLid` to `.proto`
- [ ] Regenerate Go bindings (`protoc`)
- [ ] Implement Go handler using LID↔PN mapping from whatsmeow lib
- [ ] Replace Node stub with real RPC call in `client.ts`
- [ ] Comparative test against Baileys
- **Risk:** known instability of LID↔PN resolution

### Slice 2 — Message Sending
- [ ] Implement `SendImage`, `SendVideo`, `SendAudio`, `SendSticker`, `SendDocument`, `SendPoll`, `React`, `DeleteMessage`, `EditMessage`
- [ ] Validate `MessageID`/`BotQuotedRef` mapping between drivers
- [ ] Verify `pollEncKeyRaw` equivalent exposure in whatsmeow lib
- [ ] Unit test and manual smoke test with all media types

### Slice 3 — Presence / Read Receipt
- [ ] Implement `SendPresence` and `MarkRead` in Go
- [ ] Wire in Node + test

### Slice 4 — Contacts / Third-Party Profiles
- [ ] Implement `OnWhatsApp`, `GetBusinessProfile`, `ProfilePictureUrl`, `FetchStatus`, `UpdateBlockStatus`, `AddOrEditContact`, `RemoveContact`
- [ ] Verify contact book management in whatsmeow lib (may live solely on the Node side)

### Slice 5 — Groups
- [ ] Implement `GetGroupMetadata`, `UpdateGroupParticipants`, `UpdateGroupSubject`, `UpdateGroupDescription`, `GetGroupInviteCode`, `RevokeGroupInvite`
- [ ] Verify `pn`/`phoneNumber` fields in `GroupMetadata` proto

### Slice 6 — Bot Profile + Media Download
- [ ] Implement `UpdateProfilePicture`, `UpdateProfileName`, `UpdateProfileStatus`, `Me`, `DownloadMedia`
- [ ] Validate download fallback via `contextInfo.quotedMessage`

### Slice 7 — Full Regression
- [ ] Run full test suite against WhatsMeow (100% passing)
- [ ] Staging tests with real plugins over multiple days

### Slice 8 — Cutover
- [ ] Invert priority in `driverManager.ts` (WhatsMeow primary, Baileys fallback)
- [ ] Production soak period

## Execution Rules

1. One slice = one method domain (do not mix PRs)
2. Order: Go handler → Node wiring → test → smoke → merge
3. Baileys remains primary until Slice 8 (parity + soak)
4. Each slice reports implemented features, passed tests, and pending items
5. AI implements; human validates via test + smoke

## Cross-Cutting Risks

- `sendGuard.ts` (anti-detection) only protects Baileys → port before cutover
- Poll vote decryption depends on `messageSecret` → validate early (Slice 2)
- LID↔PN resolution is unstable even on Baileys → document differences
- Every Go change requires service recompilation (`hooks/release.sh`)
