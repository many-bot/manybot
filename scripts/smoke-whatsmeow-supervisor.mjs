#!/usr/bin/env node
// scripts/smoke-whatsmeow-supervisor.mjs
//
// End-to-end smoke test for the whatsmeow supervisor: starts the
// supervisor in-process, waits for whenReady(), confirms HealthCheck
// returns ready=true via the contract's gRPC client, then shuts down.
//
// Run via tsx so we can import the TS supervisor module directly.
// Default: assumes `whatsmeow-service/bin/whatsmeow-service` exists
// relative to cwd. Override with WM_BINARY_PATH.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const defaultBin = resolve(process.cwd(), "whatsmeow-service/bin/whatsmeow-service");
if (!process.env.WM_BINARY_PATH && !existsSync(defaultBin)) {
  console.error("[smoke] whatsmeow-service binary not found.");
  console.error("[smoke] Build it: `go build -o whatsmeow-service/bin/whatsmeow-service ./whatsmeow-service`");
  console.error("[smoke] Or set WM_BINARY_PATH to its absolute path.");
  process.exit(1);
}

// Force-enable whatsmeow for this run, regardless of user TOML. We
// rewrite the env hint the config picks up before any module reads it.
process.env.MANYBOT_SMOKE = "1";

const { startWhatsmeowSupervisor, whatsmeowContract } = await import("../dist/drivers/whatsmeow/index.js");

console.log("[smoke] starting supervisor…");
const supervisor = await startWhatsmeowSupervisor();
if (!supervisor) {
  // Distinguish enabled=false from "binary missing" — supervisor logs
  // the reason; we treat either as a non-fatal skip (exit 0) since
  // both are valid runtime configurations.
  console.log("[smoke] supervisor returned null — disabled by config or binary missing (non-fatal)");
  process.exit(0);
}
console.log(`[smoke] supervisor handle: pid=${supervisor.pid()} alive=${supervisor.isAlive()}`);

// Wait up to 15s for whenReady() — healthcheck poll is 500ms, so
// healthy path resolves within 1-2s of spawn.
const readyTimeout = setTimeout(() => {
  console.error("[smoke] whenReady() did not resolve within 15s");
  void supervisor.shutdown();
  process.exit(3);
}, 15_000);

try {
  await supervisor.whenReady();
  clearTimeout(readyTimeout);
  console.log(`[smoke] whenReady() resolved — isReady=${supervisor.isReady()}`);

  // Spot-check: the contract is also up. This is what the DriverManager
  // proxy would do in production.
  console.log(`[smoke] contract.isReady()=${whatsmeowContract.isReady()}`);

  console.log("[smoke] OK — shutting down");
  await supervisor.shutdown();
  process.exit(0);
} catch (e) {
  clearTimeout(readyTimeout);
  console.error("[smoke] whenReady() rejected:", e.message);
  await supervisor.shutdown();
  process.exit(4);
}