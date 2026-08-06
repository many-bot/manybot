/**
 * drivers/whatsmeow/index.ts
 *
 * Public surface of the whatsmeow driver:
 *   - whatsmeowContract         : the raw contract (test-only / fallback path)
 *   - wrapWithSupervisor(...)   : returns a contract whose lifecycle
 *                                 methods (connect / disconnect / isReady)
 *                                 are gated on the supervisor state
 *
 * The supervisor is the lifecycle authority for the subprocess; this
 * proxy exists so the DriverManager sees one contract whose `isReady()`
 * never lies — true only when both the gRPC client is up AND the
 * subprocess has answered HealthCheck{ready:true}.
 */

import type { WaContract } from "#kernel/waContract.js";
import type { WhatsmeowSupervisor } from "./supervisor.js";
import { whatsmeowContract } from "./client.js";

export { whatsmeowContract };
export { startWhatsmeowSupervisor } from "./supervisor.js";
export type { WhatsmeowSupervisor } from "./supervisor.js";

/**
 * Wraps a raw whatsmeow contract so its lifecycle methods delegate to
 * the supervisor. Send/event methods still pass through unchanged —
 * the contract already knows how to talk gRPC; the supervisor only
 * owns "is it safe to use right now?".
 */
export function wrapWithSupervisor(
  contract:    WaContract,
  supervisor:  WhatsmeowSupervisor,
): WaContract {
  return {
    name: contract.name,

    async connect(): Promise<void> {
      await supervisor.whenReady();
      await contract.connect();
    },

    async disconnect(): Promise<void> {
      // Try to stop the subprocess too — disconnecting the contract
      // alone would leave the Go process running until the bot shuts
      // down. Idempotent; safe to call multiple times.
      await Promise.allSettled([
        contract.disconnect(),
        supervisor.shutdown(),
      ]);
    },

    isReady: () => supervisor.isReady() && contract.isReady(),

    on: (...args) => contract.on(...args),
    resolveLid: contract.resolveLid
      ? (lid: string) => contract.resolveLid!(lid)
      : undefined,

    sendText:     (...args) => contract.sendText(...args),
    sendImage:    (...args) => contract.sendImage(...args),
    sendVideo:    (...args) => contract.sendVideo(...args),
    sendAudio:    (...args) => contract.sendAudio(...args),
    sendSticker:  (...args) => contract.sendSticker(...args),
    sendDocument: (...args) => contract.sendDocument(...args),
    sendPoll:     (...args) => contract.sendPoll(...args),

    react:           (...args) => contract.react(...args),
    deleteMessage:   (...args) => contract.deleteMessage(...args),
    editMessage:     (...args) => contract.editMessage(...args),

    sendPresenceUpdate: (...args) => contract.sendPresenceUpdate(...args),
    readMessages:       (...args) => contract.readMessages(...args),

    onWhatsApp:         (...args) => contract.onWhatsApp(...args),
    getBusinessProfile: (...args) => contract.getBusinessProfile(...args),
    profilePictureUrl:  (...args) => contract.profilePictureUrl(...args),
    fetchStatus:        (...args) => contract.fetchStatus(...args),
    updateBlockStatus:  (...args) => contract.updateBlockStatus(...args),
    addOrEditContact:   (...args) => contract.addOrEditContact(...args),
    removeContact:      (...args) => contract.removeContact(...args),

    groupMetadata:           (...args) => contract.groupMetadata(...args),
    groupParticipantsUpdate: (...args) => contract.groupParticipantsUpdate(...args),
    groupUpdateSubject:      (...args) => contract.groupUpdateSubject(...args),
    groupUpdateDescription:  (...args) => contract.groupUpdateDescription(...args),
    groupInviteCode:         (...args) => contract.groupInviteCode(...args),
    groupRevokeInvite:       (...args) => contract.groupRevokeInvite(...args),

    updateProfilePicture: (...args) => contract.updateProfilePicture(...args),
    updateProfileName:    (...args) => contract.updateProfileName(...args),
    updateProfileStatus:  (...args) => contract.updateProfileStatus(...args),

    me: () => contract.me(),

    downloadMedia: (...args) => contract.downloadMedia(...args),

    getHistory: contract.getHistory
      ? (...args) => contract.getHistory!(...args)
      : undefined,
  };
}