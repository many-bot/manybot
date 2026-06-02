/**
 * pluginState.js
 *
 * Tracks plugin execution state per chat.
 * Used to implement the service vs non-service behavior:
 * - Services (service: true) can run regardless of state
 * - Non-services are blocked when another plugin is running in the same chat
 */

import { logger } from "#logger";

/**
 * Map<chatId, { pluginName: string, startedAt: Date }>
 * Tracks which plugin is currently "holding the lock" in each chat
 */
const runningPlugins = new Map();

/**
 * Check if any plugin is currently running in a specific chat
 * @param {string} chatId - Chat ID (serialized)
 * @returns {boolean}
 */
export function isPluginRunning(chatId) {
  return runningPlugins.has(chatId);
}

/**
 * Get info about the plugin running in a chat
 * @param {string} chatId - Chat ID (serialized)
 * @returns {{ pluginName: string, startedAt: Date } | null}
 */
export function getRunningPlugin(chatId) {
  return runningPlugins.get(chatId) ?? null;
}

/**
 * Mark a plugin as running in a chat
 * @param {string} chatId - Chat ID (serialized)
 * @param {string} pluginName - Name of the plugin taking the lock
 */
export function startPluginRun(chatId, pluginName) {
  runningPlugins.set(chatId, {
    pluginName,
    startedAt: new Date()
  });
  logger.debug(`Plugin "${pluginName}" started in chat ${chatId}`);
}

/**
 * Mark a plugin as finished in a chat
 * @param {string} chatId - Chat ID (serialized)
 * @param {string} pluginName - Name of the plugin releasing the lock
 */
export function endPluginRun(chatId, pluginName) {
  const current = runningPlugins.get(chatId);
  if (current && current.pluginName === pluginName) {
    runningPlugins.delete(chatId);
    logger.debug(`Plugin "${pluginName}" ended in chat ${chatId}`);
  }
}

/**
 * Force clear the running state for a chat
 * Useful for cleanup or admin commands
 * @param {string} chatId - Chat ID (serialized)
 */
export function clearPluginRun(chatId) {
  runningPlugins.delete(chatId);
}

/**
 * Get all chats where a specific plugin is running
 * @param {string} pluginName - Plugin name
 * @returns {string[]} Array of chat IDs
 */
export function getChatsWithPlugin(pluginName) {
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
 * @returns {{ total: number, byPlugin: Record<string, number> }}
 */
export function getStats() {
  const byPlugin = {};
  for (const info of runningPlugins.values()) {
    byPlugin[info.pluginName] = (byPlugin[info.pluginName] || 0) + 1;
  }
  return {
    total: runningPlugins.size,
    byPlugin
  };
}
