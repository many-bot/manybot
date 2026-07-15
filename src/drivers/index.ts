import { whatsappDriver } from "./whatsapp/index.js";
import { PLATFORM } from "#config";

import { applyPatches } from "./patches/index.js";

applyPatches();

export interface BotDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void> | void;
  /**
   * Optional diagnostic mode: connects, waits for the next message to
   * arrive from any chat (without the usual CHATS/fromMe filters), prints
   * the normalized JID, and exits. Used by `--getid` in main.ts.
   */
  getId?(): Promise<void>;
}

const DRIVERS: Record<string, BotDriver> = {
  whatsapp: whatsappDriver,
};

export function initializeSelectedDriver(): BotDriver {
  const driver = DRIVERS[PLATFORM];
  if (!driver) {
    throw new Error(`Unsupported platform/driver: ${PLATFORM}`);
  }
  return driver;
}
