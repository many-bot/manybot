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
  if (status.online === online) return;
  status = {
    online,
    since: new Date().toISOString(),
    ...(lastError ? { lastError } : {}),
  };
}

export function getStatus(): Status {
  return status;
}

export function startStatusServer(port: number): void {
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
}
