#!/usr/bin/env node
// scripts/smoke-whatsmeow.mjs
//
// Minimal gRPC smoke test: assumes `whatsmeow-service` is already running
// on $WM_ADDR (default localhost:50051). Connects, calls HealthCheck,
// and prints the response. Exits non-zero on any failure.
//
// Usage:
//   WM_ADDR=localhost:50051 node scripts/smoke-whatsmeow.mjs

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(here, "../src/drivers/whatsmeow/whatsmeow.proto");
const addr = process.env.WM_ADDR ?? "localhost:50051";

const def = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const Service = grpc.loadPackageDefinition(def).whatsmeow.WhatsmeowService;
const client = new Service(addr, grpc.credentials.createInsecure());

function call(method, req = {}) {
  return new Promise((resolve, reject) => {
    client[method](req, (err, resp) => (err ? reject(err) : resolve(resp)));
  });
}

try {
  const health = await call("HealthCheck", {});
  console.log("[smoke] HealthCheck:", JSON.stringify(health));
  process.exit(health.ready ? 0 : 2);
} catch (e) {
  console.error("[smoke] failed:", e.message);
  process.exit(1);
}