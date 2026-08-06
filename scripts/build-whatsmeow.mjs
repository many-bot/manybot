#!/usr/bin/env node
// scripts/build-whatsmeow.mjs
//
// Builds the Go whatsmeow gRPC service binary and drops it into
// `whatsmeow-service/bin/whatsmeow-service`. Skips silently when Go
// isn't on PATH — the bot is allowed to run Baileys-only without
// whatsmeow (CLAUDE.md §17). When `go` IS available but the build
// fails (e.g. proxy issue, missing dep) the script exits non-zero so
// CI catches it.

import { spawnSync } from "node:child_process";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcDir = resolve(root, "whatsmeow-service");
const outDir = resolve(srcDir, "bin");
const outBin = resolve(outDir, "whatsmeow-service");

// 1. Skip silently if `go` isn't installed.
const probe = spawnSync("go", ["version"], { stdio: "ignore" });
if (probe.status !== 0) {
  console.log("[build-whatsmeow] `go` not on PATH — skipping (Baileys-only build).");
  process.exit(0);
}

// 2. Build the binary. Use `go build` with -o so output is deterministic
//    regardless of caller cwd. Cross-compile is left to whoever runs
//    the script; default target is whatever GOOS/GOARCH are set to.
mkdirSync(outDir, { recursive: true });

console.log(`[build-whatsmeow] building → ${outBin}`);
const result = spawnSync("go", ["build", "-o", outBin, "."], {
  cwd: srcDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error("[build-whatsmeow] go build failed");
  process.exit(result.status ?? 1);
}

chmodSync(outBin, 0o755);
console.log("[build-whatsmeow] OK");
