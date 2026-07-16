/**
 * core/adapter.ts
 *
 * Contract every messaging driver (whatsapp, discord, telegram, ...)
 * must implement. The kernel talks only to this interface, never to a
 * driver's native client.
 *
 * Required methods must work on every driver. Optional methods are gated
 * by `capabilities.has(...)` before being called - a driver that doesn't
 * support a capability simply omits the method.
 */
export {};
