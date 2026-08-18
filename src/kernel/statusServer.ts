/**
 * kernel/statusServer.ts
 *
 * Minimal HTTP endpoint exposing the bot's connection state as JSON,
 * for an external status page (or any other consumer) to poll.
 */

import http from "http";
import { logger } from "#logger";

interface Status {
  online: boolean;
  since: string;
  lastError?: string;
}

let status: Status = {
  online: false,
  since: new Date().toISOString(),
};

export function setStatus(online: boolean, lastError?: string): void {
  // Same-state updates are a no-op for `online` / `since` so polling the
  // status page doesn't see the timestamp flicker on every redundant
  // call (the connection.update listener fires more than once per
  // reconnect). An explicit `lastError` always wins — if the caller is
  // reporting a new failure while we're already marked offline, that
  // message is more useful than the stale one from before.
  if (status.online === online && !lastError) return;
  status = {
    online,
    since: status.online === online ? status.since : new Date().toISOString(),
    ...(lastError ? { lastError } : {}),
  };
}

export function getStatus(): Status {
  return status;
}

export function startStatusServer(port: number): import("http").Server {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(getStatus()));
  });

  server.on("error", (err) => {
    logger.error(`[status] Failed to start status server: ${(err as Error).message}`);
  });

  server.listen(port, () => {
    logger.info(`[status] JSON endpoint em http://localhost:${port}`);
  });
  return server;
}
