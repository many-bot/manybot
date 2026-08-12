/**
 * supervisor.ts
 *
 * Lifecycle manager for the Go whatsmeow subprocess. Two responsibilities:
 *
 *   1. Spawn the binary, watch for crashes, restart with exponential
 *      backoff (same circuit-breaker pattern the Baileys driver uses in
 *      drivers/baileys/index.ts:98-106). After MAX_RECONNECT_ATTEMPTS
 *      consecutive failures, halt permanently and fire
 *      `whatsmeow_subprocess_halted` — ManyBot keeps running on Baileys
 *      alone.
 *   2. Block `whenReady()` until the gRPC server has answered
 *      `HealthCheck{ready:true}` at least once. Without this, callers
 *      race ahead of the subprocess and try to `connect()` against an
 *      empty SQLite / pre-auth state.
 *
 * Resolution of the binary path: `CONFIG.drivers.whatsmeow.binaryPath`
 * wins; if empty, falls back to the env var `WM_BINARY_PATH`, then
 * `<cwd>/whatsmeow-service/bin/whatsmeow-service` (dev), then the
 * npm-global install layout. Falls open into a logged fatal if nothing
 * matches — `enabled=true` without a binary is a setup bug, not a
 * silent degradation.
 *
 * `config.drivers.whatsmeow.enabled = false` (TOML:
 * `driver_whatsmeow_enabled = false`) ⇒ no supervisor at all
 * (`null` return from `startWhatsmeowSupervisor`); the rest of the
 * codebase is unaware anything is missing — it just never sees a
 * ready whatsmeow.
 *
 * See the lifecycle contract this implements.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, CONFIG_DIR, CLIENT_ID } from "#config";
import { logger } from "#logger";
import { fireAlert } from "#kernel/alerts.js";
import { getDriverManager } from "#kernel/driverManager.js";

// ── Tunables (mirror drivers/baileys/index.ts:98-106) ──────────────────────
const RECONNECT_BASE_MS        = 1000;
const RECONNECT_MAX_MS         = 60_000;
const MAX_RECONNECT_ATTEMPTS   = 6;
const HEALTHCHECK_INTERVAL_MS  = 500;
const HEALTHCHECK_TIMEOUT_MS   = 5_000;
const SHUTDOWN_GRACE_MS        = 5_000;

// ── Public surface ─────────────────────────────────────────────────────────

export interface WhatsmeowSupervisor {
  /**
   * Resolves once the subprocess is running AND the gRPC server answered
   * `HealthCheck{ready:true}` at least once. Rejects if the circuit
   * breaker opens before that — caller should treat rejection as
   * "whatsmeow unavailable; run on Baileys only".
   */
  whenReady(): Promise<void>;

  /** True iff the subprocess is alive and the last HealthCheck returned ready. */
  isReady(): boolean;

  /** True iff the subprocess is currently spawned (regardless of ready state). */
  isAlive(): boolean;

  /**
   * Stop the subprocess and disable automatic restart. Idempotent —
   * calling twice is a no-op. Sends SIGTERM, waits SHUTDOWN_GRACE_MS,
   * then SIGKILL. Used by driverManager.shutdown() at global bot
   * shutdown and by tests for cleanup.
   */
  shutdown(): Promise<void>;

  /** Subprocess PID, or null if not currently spawned. For diagnostics. */
  pid(): number | null;
}

// ── Resolution helpers ─────────────────────────────────────────────────────

/**
 * Walks the conventional locations looking for the binary. Returns the
 * first match that exists and is a regular file. Order:
 *   1. CONFIG.drivers.whatsmeow.binaryPath (explicit user choice)
 *   2. env WM_BINARY_PATH (escape hatch for exotic installs)
 *   3. stable config dir (~/.manybot/whatsmeow-service/bin/whatsmeow-service)
 *   4. dev layout (<cwd>/whatsmeow-service/bin/whatsmeow-service)
 *   4. npm-global layout (sibling of the node binary, /usr/local style)
 */
function resolveBinaryPath(): string | null {
  const candidates: string[] = [];

  const fromConfig = CONFIG.drivers.whatsmeow.binaryPath;
  if (fromConfig) candidates.push(path.resolve(fromConfig));

  const fromEnv = process.env.WM_BINARY_PATH;
  if (fromEnv) candidates.push(path.resolve(fromEnv));

  // Stable config dir: ~/.manybot/whatsmeow-service/bin/whatsmeow-service
  candidates.push(
    path.resolve(CONFIG_DIR, "whatsmeow-service", "bin", "whatsmeow-service")
  );

  // Dev: `<repo>/whatsmeow-service/bin/whatsmeow-service`
  candidates.push(
    path.resolve(process.cwd(), "whatsmeow-service", "bin", "whatsmeow-service")
  );

  // Global npm install: `<prefix>/bin/../share/manybot/bin/whatsmeow-service`
  // `<prefix>` is the parent of the running node binary on most setups.
  const prefix = path.dirname(path.dirname(process.execPath));
  candidates.push(
    path.join(prefix, "share", "manybot", "bin", "whatsmeow-service")
  );
  // Belt-and-suspenders: macOS/Linux homebrew-style shared dir.
  candidates.push(
    path.join(prefix, "lib", "node_modules", "manybot", "whatsmeow-service", "bin", "whatsmeow-service")
  );

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── gRPC health check (no proto/contract dependency) ───────────────────────

interface GrpcHealthResult { ready: boolean; error?: string; }

/**
 * Single HealthCheck RPC against `addr`. Implemented with the low-level
 * @grpc/grpc-js client API so the supervisor doesn't need the rest of
 * the whatsmeow driver to be importable (the supervisor can outlive a
 * broken contract, e.g. when the proto is being regenerated).
 *
 * Uses an in-memory `.proto` with the bare minimum types needed for
 * HealthCheck so we don't depend on the driver module's loader cache.
 */
async function probeHealth(addr: string): Promise<GrpcHealthResult> {
  // Lazy imports keep the fast path (enabled=false) cheap.
  const grpc        = await import("@grpc/grpc-js");
  const protoLoader = await import("@grpc/proto-loader");

  // Resolve the .proto relative to this compiled module — works under
  // `node dist/main.js` (proto is copied into dist/drivers/whatsmeow/
  // by the build script), under a global npm install (proto ships in
  // the package's `dist/`), and in dev (`tsx src/main.ts`, where the
  // proto sits next to this source file). ESM has no `__dirname`, so
  // use `import.meta.url`.
  const protoPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "whatsmeow.proto"
  );
  if (!existsSync(protoPath)) {
    return { ready: false, error: `proto not found at ${protoPath}` };
  }

  const def = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const Service = (grpc.loadPackageDefinition(def) as any).whatsmeow.WhatsmeowService;
  const client  = new Service(addr, grpc.credentials.createInsecure());

  return new Promise<GrpcHealthResult>((resolve) => {
    const timer = setTimeout(() => {
      try { client.close(); } catch {}
      resolve({ ready: false, error: "healthcheck timeout" });
    }, HEALTHCHECK_TIMEOUT_MS);

    client.HealthCheck({}, (err: Error | null, resp: any) => {
      clearTimeout(timer);
      try { client.close(); } catch {}
      if (err) return resolve({ ready: false, error: err.message });
      resolve({ ready: !!resp?.ready, error: resp?.last_error || undefined });
    });
  });
}

// ── Implementation ─────────────────────────────────────────────────────────

interface InternalState {
  proc:            ReturnType<typeof spawn> | null;
  pid:             number | null;
  addr:            string;
  binary:          string;
  sessionDir:      string;
  reconnectTries:  number;
  halted:          boolean;
  /** True only after the first HealthCheck{ready:true}. */
  ready:           boolean;
  /** Resolved once `ready` first flips to true. */
  readyDeferred:   { resolve: () => void; reject: (e: Error) => void } | null;
  /** Re-rejected in shutdown so pending waiters don't dangle. */
  shuttingDown:    boolean;
  restartTimer:    NodeJS.Timeout | null;
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Spawn the subprocess, register lifecycle handlers, and kick the
 * healthcheck loop. Returns the supervisor handle, or `null` if
 * `enabled = false`. Throws only on fatal startup conditions (binary
 * not found, spawn() failed synchronously); transient RPC failures are
 * logged + backed off, never thrown.
 */
export async function startWhatsmeowSupervisor(): Promise<WhatsmeowSupervisor | null> {
  if (!CONFIG.drivers.whatsmeow.enabled) {
    logger.info("[supervisor] disabled by config (driver_whatsmeow_enabled = false)");
    return null;
  }

  const binary = resolveBinaryPath();
  if (!binary) {
    logger.error(
      "[supervisor] whatsmeow-service binary not found. Set `driver_whatsmeow_binary_path` in manybot.toml, " +
      "set env WM_BINARY_PATH, or place the binary at " +
      "whatsmeow-service/bin/whatsmeow-service relative to cwd. Bot will run on Baileys only."
    );
    return null;
  }

  logger.info(`[supervisor] using binary: ${binary}`);
  const grpcAddress = CONFIG.drivers.whatsmeow.grpcAddress || "localhost:50051";

  const sessionDir  = path.resolve(CONFIG_DIR, "sessions", CLIENT_ID, "whatsmeow", "session.db");
  // Ensure the parent directory exists before the Go subprocess tries to
  // create/open the SQLite file.
  mkdirSync(path.dirname(sessionDir), { recursive: true });

  const state: InternalState = {
    proc:            null,
    pid:             null,
    addr:            grpcAddress,
    binary,
    sessionDir,
    reconnectTries:  0,
    halted:          false,
    ready:           false,
    readyDeferred:   null,
    shuttingDown:    false,
    restartTimer:    null,
  };

  // First ready promise — created lazily on the first `whenReady()` so
  // a never-called instance doesn't carry dangling deferreds.
  function ensureReadyPromise(): Promise<void> {
    if (state.ready) return Promise.resolve();
    if (state.halted) return Promise.reject(new Error("whatsmeow supervisor halted"));
    if (!state.readyDeferred) {
      let resolve!: () => void;
      let reject!:  (e: Error) => void;
      const p = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      state.readyDeferred = { resolve, reject };
    }
    return new Promise<void>((resolve, reject) => {
      // Re-attach so callers can `await` multiple times.
      const d = state.readyDeferred!;
      const origResolve = d.resolve;
      const origReject  = d.reject;
      d.resolve = () => { origResolve(); resolve(); };
      d.reject  = (e) => { origReject(e); reject(e); };
    });
  }

  function markReady(): void {
    if (state.ready) return;
    state.ready = true;
    state.reconnectTries = 0; // healthy again → reset circuit breaker
    state.readyDeferred?.resolve();
  }

  function markHalted(reason: string): void {
    state.halted = true;
    state.ready  = false;
    state.readyDeferred?.reject(new Error(reason));
    getDriverManager().markDegraded("whatsmeow", 600_000);
    fireAlert("whatsmeow_subprocess_halted", { reason });
  }

  function scheduleRestart(): void {
    if (state.shuttingDown || state.halted) return;
    if (state.reconnectTries >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `[supervisor] exhausted ${MAX_RECONNECT_ATTEMPTS} reconnect attempts — halting`
      );
      markHalted(`exhausted ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** state.reconnectTries,
      RECONNECT_MAX_MS
    );
    state.reconnectTries += 1;
    logger.warn(`[supervisor] scheduling restart in ${delay}ms (attempt ${state.reconnectTries}/${MAX_RECONNECT_ATTEMPTS})`);
    state.restartTimer = setTimeout(() => {
      state.restartTimer = null;
      void spawnAndWatch();
    }, delay);
  }

  async function spawnAndWatch(): Promise<void> {
    if (state.shuttingDown || state.halted) return;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(state.binary, ["--grpc-addr", state.addr, "--session-dir", state.sessionDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      // Forward Go service stdout/stderr to the bot log so we can see
      // crashes, missing dependencies, port-in-use, etc. Without this
      // `stdio: "ignore"` would discard everything and a crashed
      // subprocess would only surface as an exit code.
      proc.stdout?.on("data", (chunk: Buffer) => {
        process.stdout.write(`[whatsmeow-stdout] ${chunk}`);
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[whatsmeow-stderr] ${chunk}`);
      });
    } catch (e) {
      logger.error(`[supervisor] spawn failed: ${(e as Error).message}`);
      scheduleRestart();
      return;
    }

    state.proc = proc;
    state.pid  = proc.pid ?? null;

    proc.on("error", (err) => {
      logger.warn(`[supervisor] subprocess error: ${err.message}`);
      // Don't restart here — the `exit` handler will fire on ENOENT etc.
    });
    proc.on("exit", (code, signal) => {
      logger.warn(
        `[supervisor] subprocess exited code=${code} signal=${signal} ready=${state.ready}`
      );
      state.proc = null;
      state.pid  = null;
      state.ready = false;
      if (!state.shuttingDown && !state.halted) scheduleRestart();
    });

    logger.info(`[supervisor] subprocess started (pid=${state.pid}, binary=${state.binary})`);

    // Don't await — healthcheck loop runs in its own cycle.
    void runHealthLoop();
  }

  async function runHealthLoop(): Promise<void> {
    while (!state.shuttingDown && !state.halted) {
      await waitMs(HEALTHCHECK_INTERVAL_MS);
      if (!state.proc) break; // subprocess died; `exit` handler owns restart
      const result = await probeHealth(state.addr);
      if (result.ready) {
        if (!state.ready) logger.info("[supervisor] healthcheck ready");
        markReady();
        // Once ready, keep polling at the same cadence to detect
        // when the subprocess silently dies. A slow poll would mean
        // we miss the reconnect window.
      } else if (result.error) {
        logger.debug(`[supervisor] healthcheck: not ready (${result.error})`);
      }
    }
  }

  const supervisor: WhatsmeowSupervisor = {
    whenReady: ensureReadyPromise,

    isReady: () => state.ready && !!state.proc,

    isAlive: () => !!state.proc,

    pid: () => state.pid,

    async shutdown() {
      if (state.shuttingDown) return;
      state.shuttingDown = true;
      if (state.restartTimer) {
        clearTimeout(state.restartTimer);
        state.restartTimer = null;
      }
      state.readyDeferred?.reject(new Error("supervisor shutting down"));
      const proc = state.proc;
      if (!proc) return;
      try { proc.kill("SIGTERM"); } catch {}
      const exited = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch {}
          resolve(true);
        }, SHUTDOWN_GRACE_MS);
        proc.once("exit", () => { clearTimeout(t); resolve(true); });
      });
      state.proc = null;
      state.pid  = null;
      void exited;
    },
  };

  // Kick off — intentionally not awaited. The supervisor handle is
  // returned synchronously so callers can stash it / attach shutdown
  // hooks; the spawn + healthcheck loop runs in the background.
  void spawnAndWatch();
  return supervisor;
}
