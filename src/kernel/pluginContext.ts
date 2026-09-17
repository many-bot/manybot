/**
 * kernel/pluginContext.ts
 *
 * Tracks which plugin is currently executing, using AsyncLocalStorage
 * so the context survives across the whole async continuation chain —
 * including promises a plugin creates but never awaits/catches
 * ("fire-and-forget"). That's precisely the case a plain try/catch
 * around `await run` cannot cover: if a plugin calls
 * `ctx.msg.react(badEmoji)` without awaiting it, the rejection surfaces
 * later as a process-level `unhandledRejection`, after the plugin's
 * own try/catch already exited. The global handlers in main.ts read
 * this store to attribute that rejection back to the right plugin.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface PluginContextStore {
  pluginName: string;
}

const storage = new AsyncLocalStorage<PluginContextStore>();

/** Run `fn` with `pluginName` attached to the async context. */
export function runWithPlugin<T>(pluginName: string, fn: () => T): T {
  return storage.run({ pluginName }, fn);
}

/** Name of the plugin currently executing on this async chain, if any. */
export function getCurrentPluginName(): string | null {
  return storage.getStore()?.pluginName ?? null;
}
