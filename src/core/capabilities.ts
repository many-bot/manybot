/**
 * core/capabilities.ts
 *
 * Optional features a driver may or may not support. The kernel checks
 * `adapter.capabilities.has(...)` before calling an optional method,
 * instead of assuming every platform behaves like WhatsApp.
 */

export type Capability =
  | "media"        // image/video/audio/sticker sending
  | "reactions"    // emoji reactions on messages
  | "groupAdmin"   // kick/promote/demote/updateSubject
  | "polls"
  | "presence"     // typing/composing indicator
  | "viewOnce";    // WhatsApp-only ephemeral media

export class CapabilitySet {
  private readonly set: Set<Capability>;

  constructor(capabilities: Capability[]) {
    this.set = new Set(capabilities);
  }

  has(capability: Capability): boolean {
    return this.set.has(capability);
  }
}
