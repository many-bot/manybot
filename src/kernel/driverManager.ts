/**
 * driverManager.ts
 *
 * Registry for the active WhatsApp driver. Centralizes the answer to
 * "which driver do I send through right now?" without scattering that
 * decision across the codebase.
 *
 * Singleton access via getDriverManager() — same pattern as the
 * globalSock in pluginLoader.ts. Only main.ts is expected to call
 * register(); everywhere else reads through active() / get().
 *
 * Shutdown order in shutdown() is reverse-registration.
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
  private drivers    = new Map<string, WaContract>();
  private activeName = "";
  /** Insertion order — used by shutdown() to disconnect in reverse. */
  private order:     string[] = [];

  /**
   * Register a driver. The first call with isPrimary=true (or the first
   * call overall if none sets it) becomes the active driver.
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

  /**
   * Disconnect every registered driver in reverse-registration order.
   * Errors are logged, not thrown, so one stubborn driver can't block
   * another's shutdown.
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
