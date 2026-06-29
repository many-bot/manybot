// ── Untyped packages ──────────────────────────────────────────────────────────

declare module "qrcode-terminal" {
  interface QRCode {
    generate(text: string, opts?: { small?: boolean }): void;
    setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
    error(err: string): void;
  }
  const qrcode: QRCode;
  export = qrcode;
}

declare module "node-cron" {
  interface ScheduledTask {
    stop(): void;
    start(): void;
    destroy(): void;
  }
  function schedule(expression: string, fn: () => void, options?: Record<string, unknown>): ScheduledTask;
  function validate(expression: string): boolean;
  export = { schedule, validate };
}

// ── whatsapp-web.js type shim ─────────────────────────────────────────────────
// The package uses `export = WAWebJS` (CJS namespace), so named
// `import type { X }` doesn't work directly in ESM source.
// We expose the types under the #wwjs alias via an ambient module declaration.

declare module "#wwjs" {
  import pkg = require("whatsapp-web.js");
  export type Client       = pkg.Client;
  export type Chat         = pkg.Chat;
  export type GroupChat    = pkg.GroupChat;
  export type Message      = pkg.Message;
  export type Contact      = pkg.Contact;
  export type MessageMedia = pkg.MessageMedia;
  export type MessageId    = pkg.MessageId;
  export type PollVote     = pkg.PollVote;
}

// ── whatsapp-web.js field augmentations ──────────────────────────────────────
// Fields that exist at runtime but are absent from the bundled .d.ts.

declare module "whatsapp-web.js" {
  namespace WAWebJS {
    interface Chat {
      isCommunity?: boolean;
      groupMetadata?: {
        parentGroup?:    { _serialized: string };
        subGroupsId?:    Array<{ _serialized?: string } | string>;
        linkedSubgroups?: Array<{ _serialized?: string } | string>;
        subgroups?:      Array<{ _serialized?: string } | string>;
        isDefaultSubgroup?: boolean;
      };
    }
    interface GroupParticipant {
      id: { _serialized: string };
      isAdmin: boolean;
      isSuperAdmin: boolean;
    }
    interface GroupChat {
      isCommunity?:  boolean;
      groupMetadata?: Chat["groupMetadata"];
      participants?: GroupParticipant[];
    }
  }
}
