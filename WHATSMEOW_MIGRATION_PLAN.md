# WhatsMeow Migration Plan Status

## Status

**Superseded (Aug 14)** – The plan to eventually promote WhatsMeow to the primary driver (and the driver fallback mechanism that supported that transition) has been abandoned. WhatsMeow remains an optional/experimental driver; Baileys is the only production driver. This document reflects the implementation parity state at the time migration was paused — see `WHATSMEOW_MIGRATION_PLAN.md` for full history.

## Overview

The network contract (proto gRPC) is already declared for almost all methods, with the exception of `resolveLid`. In actual implementation, only Scope 0 (partial) is completed: Go only has Connect/Disconnect/HealthCheck/SubscribeEvents/VerifySent/GetHistory/SendText implemented — everything else (media, presence, contacts, groups, profile) still returns `codes.Unimplemented`. Node (`client.ts`) mirrors this: only `connect`, `disconnect`, `sendText`, `getHistory` are wired; `resolveLid` is a stub (always returns `null`, does not invoke RPC). See full baseline in `WHATSMEOW_MIGRATION_PLAN.md` §0.

## Status by Slices

### Scope 0 — Test Harness
- [x] Configure driver flag in test runner (`WA_TEST_DRIVER=baileys|whatsmeow`)
- [ ] Survey actual API usage by plugins
- [ ] Run full test suite against Baileys → reference baseline
- **Exit criteria:** suite runs and passes 100% against Baileys with the new driver parametrization

### Scope 1 — `resolveLid` (NEW PROTO)
- [ ] Add `rpc ResolveLid(LidRequest) returns (PnResponse)` (or equivalent name)
- [ ] Regenerate Go bindings (`protoc`) → `whatsmeow.pb.go` / `whatsmeow_grpc.pb.go`
- [ ] Implement Go handler using the LID↔PN mapping from whatsmeow lib (equivalent to `signalRepository.lidMapping.getPNForLID` in Baileys — check the lib's exact API, likely in `client.Store`)
- [ ] Node: replace the stub with real RPC call in `client.ts`
- [ ] Test: compare results with what Baileys resolves for the same test contact
- **Risk:** known instability of LID↔PN mapping — Baileys comment notes instability depending on `addressingMode`/group vs 1:1

### Scope 2 — Message Sending (high usage, high priority)
- [ ] Implement `SendImage`, `SendVideo`, `SendAudio`, `SendSticker`, `SendDocument`, `SendPoll`, `React`, `DeleteMessage`, `EditMessage`
- [ ] Implement each handler using `client.SendMessage` from the whatsmeow lib with appropriate message types (`ImageMessage`, `VideoMessage`, etc.) — the lib has built-in media upload, check `client.Upload`
- [ ] Special attention:
  - `SendPoll` — Baileys stores `pollEncKeyRaw` (`messageContextInfo.messageSecret`) for vote decryption later; verify if whatsmeow lib exposes an equivalent and whether `BotMessage._raw` needs a new field for whatsmeow or a different one
  - `EditMessage`/`DeleteMessage`/`React` use the same `key` reference (`BotQuotedRef`) — verify format of `MessageID` that the whatsmeow lib expects (not necessarily identical to `IMessageKey` in Baileys)
  - Test: one case per media type (image, video, audio, sticker, document, poll) plus react/edit/delete a test message
  - Smoke manual test: send each media type in a test chat, including a chat with disappearing messages enabled (validates if fixing a bug in Baileys that might not exist in whatsmeow, or requires same handling)
- [ ] Test plan: automated test per media type + manual smoke test verification

### Scope 3 — Presence / Read Receipt
- [ ] Implement `SendPresence` and `MarkRead`
- [ ] In Go: use `client.SendPresence`, `client.MarkRead` from the lib
- [ ] In Node: direct wiring, no complex mapping required
- [ ] Test: send presence "composing"/"paused", mark a message as read, verify corresponding events

### Scope 4 — Contacts / Third-Party Profiles
- [ ] Implement `OnWhatsApp`, `GetBusinessProfile`, `ProfilePictureUrl`, `FetchStatus`, `UpdateBlockStatus`, `AddOrEditContact`, `RemoveContact`
- [ ] Verify contact book management in whatsmeow lib (may only exist on the Node side in `BotStore`, no actual RPC needed)
- [ ] Test: each method against a known test contact

### Scope 5 — Groups
- [ ] Implement `GetGroupMetadata`, `UpdateGroupParticipants`, `UpdateGroupSubject`, `UpdateGroupDescription`, `GetGroupInviteCode`, `RevokeGroupInvite`
- [ ] Verify `pn`/`phoneNumber` fields in `GroupMetadata` proto — ensure they match Baileys' structure or document differences
- [ ] Test: metadata of a test group, add/remove test participant, change name/description, generate/revoke invite

### Scope 6 — Bot Profile + Media Download
- [ ] Implement `UpdateProfilePicture`, `UpdateProfileName`, `UpdateProfileStatus`, `Me`, `DownloadMedia`
- [ ] In Go: `client.SetGroupPhoto`/`client.SetProfilePicture` (verify exact naming for profile vs group), `client.SendPresence` for status, `client.Store.PushName` for name, `client.Download` for media
- [ ] `DownloadMedia`: Baileys has fallback via `contextInfo.quotedMessage` for quoted messages — verify if the equivalent `_raw.contextInfo` exists in whatsmeow or requires different resolution
- [ ] Test: change bot's name/status/profile picture, download received and quoted media

### Scope 7 — Full Regression + Formal Parity
- [ ] Run full test suite against WhatsMeow (100% passing)
- [ ] Run the same real plugins (not just synthetic tests) in a staging environment, per driver, and compare behavior manually over multiple days of real usage
- [ ] Document known differences that won't be fixed (e.g., if whatsmeow lib lacks support for something and there's no reasonable workaround)

### Scope 8 — Cutover
- [ ] Invert priority in `driverManager.ts` — WhatsMeow primary, Baileys fallback (the swapping itself is minor, the heavy work was already done)
- [ ] Production soak period with fallback Baileys still active and functional
- [ ] After a soak period with no incidents: decide if permanently disable Baileys or keep it as permanent fallback (keeping Baileys as fallback may still be worthwhile — it's the safety net already in place)

## Cross-Cutting Risks (apply to multiple scopes, don't forget)

- **`sendGuard.ts`** (anti-detection, throttle, jitter, `SECURITY_LEVEL`) currently only protects the Baileys path. Without an equivalent on the whatsmeow side, making it the primary driver without porting this protection means abandoning the protection that was built to avoid bans/restrictions.
- **Poll vote decryption** depends on a secret (`messageSecret`) and brute-force of candidate JIDs — it's one of the most delicate aspects to port, validate early (Scope 2) instead of leaving to the end.
- **LID↔PN mapping** is known to be unstable even on Baileys (the Baileys code comment notes instability depending on `addressingMode`/group vs 1:1) — don't treat differences here as implementation bugs until confirming it's not a limitation of WhatsApp itself.
- **Every Go change requires recompiling the `whatsmeow-service` binary** (pipeline already exists via `hooks/release.sh`) — plan intermediate builds for smoke testing, not just at the final step.