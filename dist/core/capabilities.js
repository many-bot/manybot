/**
 * core/capabilities.ts
 *
 * Optional features a driver may or may not support. The kernel checks
 * `adapter.capabilities.has(...)` before calling an optional method,
 * instead of assuming every platform behaves like WhatsApp.
 */
export class CapabilitySet {
    set;
    constructor(capabilities) {
        this.set = new Set(capabilities);
    }
    has(capability) {
        return this.set.has(capability);
    }
}
