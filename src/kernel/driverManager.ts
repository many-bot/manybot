/**
 * driverManager.ts
 *
 * Registry for the active WhatsApp driver and any fallback drivers
 * registered alongside it. Centralizes the answer to "which driver do
 * I send through right now?" so sendFallbackGuard can pick the primary,
 * notice when it's degraded, and reach for the secondary without
 * scattering that decision across the codebase.
 *
 * Singleton access via getDriverManager() — same pattern as the
 * globalSock in pluginLoader.ts. Only main.ts is expected to call
 * register(); everywhere else reads through active() / get() / isDegraded.
 *
 * Shutdown order in shutdown() is reverse-registration.
 *
 * See the interface and cooldown semantics.
 */

import { logger } from "#logger";
import type { WaContract } from "#kernel/waContract.js";

/**
 * Driver names are open-ended strings — registration accepts whatever
 * `WaContract.name` declares, and lookup is keyed by the same string.
 * Narrowing the type to a literal union would force every site that
 * reads `primary.name` back through `as` casts after the driver set
 * changes; widening keeps the surface stable as drivers come and go.
 */
type DriverName = string;

class DriverManager {
  private drivers       = new Map<string, WaContract>();
  private activeName    = "";
  /** Insertion order — used by shutdown() to disconnect in reverse. */
  private order:        string[] = [];
  private degradedUntil = new Map<string, number>();

  /**
   * Register a driver. The first call with isPrimary=true (or the first
   * call overall if none sets it) becomes the active driver. Subsequent
   * calls with isPrimary=false are stored as fallbacks.
   */
  register(driver: WaContract, opts: { isPrimary?: boolean } = {}): void {
    const name = driver.name;
    if (this.drivers.has(name)) {
      logger.warn(`[driverManager] re-registering driver "${name}" — old instance NOT disconnected`);
    } else {
      this.order.push(name);
    }
    this.drivers.set(name, driver);

    if (opts.isPrimary || !this.activeName) {
      this.activeName = name;
    }
  }

  active(): WaContract {
    const d = this.drivers.get(this.activeName);
    if (!d) {
      throw new Error(`[driverManager] no active driver registered (activeName="${this.activeName}")`);
    }
    return d;
  }

  get(name: DriverName): WaContract | undefined {
    return this.drivers.get(name);
  }

  activeName_(): DriverName {
    return this.activeName as DriverName;
  }

  /** True if `name` is registered AND its connect() has resolved with state="open". */
  isReady(name: DriverName): boolean {
    return this.drivers.get(name)?.isReady() ?? false;
  }

  isDegraded(name: DriverName): boolean {
    const until = this.degradedUntil.get(name);
    return !!until && Date.now() < until;
  }

  markDegraded(name: DriverName, durationMs: number): void {
    this.degradedUntil.set(name, Date.now() + durationMs);
  }

  /**
   * Drop the degradation entry for `name` so the next `isDegraded()`
   * check returns false. Used after a successful send to clear the
   * cooldown that the most recent failed send had set, without waiting
   * for the timer to expire.
   */
  clearDegraded(name: DriverName): void {
    this.degradedUntil.delete(name);
  }

  /**
   * Promote a different driver to active. Used by tests / hot-swap;
   * the production sendFallbackGuard never calls this — fallback uses
   * the secondary by direct call, leaving activeName untouched so the
   * primary gets retried after the cooldown.
   */
  switchTo(name: DriverName): void {
    if (!this.drivers.has(name)) {
      throw new Error(`[driverManager] cannot switch to unregistered driver "${name}"`);
    }
    this.activeName = name;
  }

  /**
   * Disconnect every registered driver in reverse-registration order.
   * Errors are logged, not thrown, so a stubborn secondary can't block
   * the primary's shutdown (or vice versa).
   */
  async shutdown(): Promise<void> {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const name = this.order[i];
      const d    = this.drivers.get(name);
      if (!d) continue;
      try {
        await d.disconnect();
      } catch (e) {
        logger.warn(`[driverManager] error disconnecting "${name}": ${(e as Error).message}`);
      }
    }
    this.drivers.clear();
    this.order.length = 0;
    this.degradedUntil.clear();
    this.activeName = "";
  }
}

let instance: DriverManager | null = null;

export function getDriverManager(): DriverManager {
  if (!instance) instance = new DriverManager();
  return instance;
}

/** Test-only — reset the singleton so unit tests start clean. */
export function _resetDriverManagerForTests(): void {
  instance = null;
}
