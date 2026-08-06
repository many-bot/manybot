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
 * Shutdown order in shutdown() is reverse-registration, so a driver
 * that was added later (e.g. whatsmeow) is disconnected before the
 * primary one (typically Baileys). Re-registering the same name
 * overwrites the previous instance — the old driver is NOT disconnected
 * automatically, callers must disconnect it first if they want it torn
 * down.
 *
 * See CLAUDE.md §2 (interface) and §8 (cooldown semantics).
 */

import { logger } from "#logger";
import type { WaContract } from "#kernel/waContract.js";

type DriverName = "baileys" | "whatsmeow";

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
   * Promote a different driver to active. Used by tests / hot-swap;
   * the production sendFallbackGuard never calls this — fallback uses
   * the secondary by direct call, leaving activeName untouched so the
   * primary gets retried after the cooldown (CLAUDE.md §7/§8).
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
