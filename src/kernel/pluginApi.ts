/**
 * kernel/pluginApi.ts (DEPRECATED)
 *
 * This file is now a re-export from the WhatsApp driver.
 * Plugins should continue to work without any changes.
 *
 * All logic is now in: drivers/whatsapp/api/
 * This file exists for backward compatibility.
 */

// Re-export everything from the WhatsApp driver's plugin API
export * from "#drivers/whatsapp/api/index.js";
