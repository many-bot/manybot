/**
 * pluginState.ts
 *
 * Tracks plugin execution state per chat.
 * Used to implement the service vs non-service behavior:
 * - Services (service: true) can run regardless of state
 * - Non-services are blocked when another plugin is running in the same chat
 */

import { logger } from "#logger";

interface RunInfo {
  pluginName: string;
  startedAt: Date;
}

const runningPlugins = new Map<string, RunInfo>();

/**
 * Check if any plugin is currently running in a specific chat
 */
export function isPluginRunning(chatId: string): boolean {
  return runningPlugins.has(chatId);
}

/**
 * Get info about the plugin running in a chat
 */
export function getRunningPlugin(chatId: string): RunInfo | null {
  return runningPlugins.get(chatId) ?? null;
}

/**
 * Mark a plugin as running in a chat
 */
export function startPluginRun(chatId: string, pluginName: string): void {
  runningPlugins.set(chatId, {
    pluginName,
    startedAt: new Date()
  });
  logger.debug(`Plugin "${pluginName}" started in chat ${chatId}`);
}

/**
 * Mark a plugin as finished in a chat
 */
export function endPluginRun(chatId: string, pluginName: string): void {
  const current = runningPlugins.get(chatId);
  if (current && current.pluginName === pluginName) {
    runningPlugins.delete(chatId);
    logger.debug(`Plugin "${pluginName}" ended in chat ${chatId}`);
  }
}

/**
 * Force clear the running state for a chat
 * Useful for cleanup or admin commands
 */
export function clearPluginRun(chatId: string): void {
  runningPlugins.delete(chatId);
}

/**
 * Get all chats where a specific plugin is running
 */
export function getChatsWithPlugin(pluginName: string): string[] {
  const chats = [];
  for (const [chatId, info] of runningPlugins.entries()) {
    if (info.pluginName === pluginName) {
      chats.push(chatId);
    }
  }
  return chats;
}

/**
 * Get stats about running plugins
 */
export function getStats(): { total: number; byPlugin: Record<string, number> } {
  const byPlugin: Record<string, number> = {};
  for (const info of runningPlugins.values()) {
    byPlugin[info.pluginName] = ((byPlugin[info.pluginName] as number) || 0) + 1;
  }
  return {
    total: runningPlugins.size,
    byPlugin
  };
}
