#!/usr/bin/env node
// scripts/build-whatsmeow-release.mjs
//
// Cross-compiles the whatsmeow-service Go binary for every supported
// release target and writes a checksums.txt alongside them. Used by
// hooks/release.sh at release time — NOT part of `npm run build`
// (that keeps using build-whatsmeow.mjs for a single local-arch dev
// build). Requires `go` on PATH; exits non-zero on any build failure
// so the release hook aborts instead of publishing a partial set.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const srcDir = resolve(root, "whatsmeow-service");
const outDir = resolve(srcDir, "dist-release");

const TARGETS = [
  { goos: "linux", goarch: "amd64", name: "whatsmeow-service-linux-x64" },
  { goos: "linux", goarch: "arm64", name: "whatsmeow-service-linux-arm64" },
  { goos: "windows", goarch: "amd64", name: "whatsmeow-service-windows-x64.exe" },
];

const probe = spawnSync("go", ["version"], { stdio: "ignore" });
if (probe.status !== 0) {
  console.error("[build-whatsmeow-release] `go` not on PATH — aborting release build.");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const target of TARGETS) {
  const outBin = resolve(outDir, target.name);
  console.log(`[build-whatsmeow-release] building ${target.goos}/${target.goarch} → ${target.name}`);

  const result = spawnSync("go", ["build", "-trimpath", "-o", outBin, "."], {
    cwd: srcDir,
    stdio: "inherit",
    env: {
      ...process.env,
      GOOS: target.goos,
      GOARCH: target.goarch,
      CGO_ENABLED: "0",
    },
  });

  if (result.status !== 0) {
    console.error(`[build-whatsmeow-release] build failed for ${target.goos}/${target.goarch}`);
    process.exit(result.status ?? 1);
  }
}

console.log("[build-whatsmeow-release] writing checksums.txt");
const lines = TARGETS.map((target) => {
  const bytes = readFileSync(resolve(outDir, target.name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return `${sha256}  ${target.name}`;
});
writeFileSync(resolve(outDir, "checksums.txt"), lines.join("\n") + "\n");

console.log(`[build-whatsmeow-release] OK — ${TARGETS.length} binaries in ${outDir}`);
