/**
 * errorDetail.ts
 *
 * Node's global fetch (undici) wraps the real network failure behind a
 * generic `TypeError: fetch failed`, with the actual reason (ECONNRESET,
 * ETIMEDOUT, EAI_AGAIN, a TLS error, ...) only reachable via `error.cause`
 * — sometimes nested a couple of levels deep, or as an `AggregateError`
 * holding one cause per attempted address.
 *
 * `describeError()` walks that chain and returns a single-line string
 * safe to drop into a log call, instead of the top-level message alone.
 */

interface NodeSystemError extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  address?: string;
  port?: number;
}

function formatOne(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as NodeSystemError;
  const parts = [`${e.name}: ${e.message}`];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.syscall) parts.push(`syscall=${e.syscall}`);
  if (e.address) parts.push(`address=${e.address}${e.port ? `:${e.port}` : ""}`);
  return parts.join(" ");
}

/**
 * Error codes that indicate a transient network hiccup (timeout, reset,
 * DNS blip, connection refused) rather than something a retry can't fix.
 * Includes undici's own timeout codes, since Node's fetch surfaces those
 * instead of the plain POSIX errno on some paths.
 */
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH",
  "EAI_AGAIN", "EPIPE", "ENOTFOUND", "ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

/**
 * True if `err` (or anything in its `.cause` chain, or any entry of an
 * `AggregateError`) carries one of `TRANSIENT_CODES` — i.e. worth
 * retrying. A plain `TypeError: fetch failed` with no `.cause` at all
 * also counts as transient: undici sometimes drops the cause on certain
 * paths, and a bare "fetch failed" from a WhatsApp CDN download is
 * overwhelmingly a network blip, not a programming error.
 */
export function isTransientNetworkError(err: unknown, maxDepth = 5): boolean {
  let current: unknown = err;
  let depth = 0;

  while (current instanceof Error && depth < maxDepth) {
    const code = (current as NodeSystemError).code;
    if (code && TRANSIENT_CODES.has(code)) return true;

    if (current instanceof AggregateError && current.errors?.length) {
      if (current.errors.some(e => isTransientNetworkError(e, maxDepth - depth - 1))) return true;
    }

    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined) {
      return !code && /fetch failed/i.test(current.message);
    }
    current = cause;
    depth++;
  }
  return false;
}

/**
 * Renders `error` plus its full `.cause` chain (and, for an
 * `AggregateError`, every entry in `.errors`) as one "->"-joined line.
 *
 * Example: `TypeError: fetch failed -> Error: connect ETIMEDOUT code=ETIMEDOUT syscall=connect address=157.240.12.1:443`
 */
export function describeError(err: unknown, maxDepth = 5): string {
  const chain: string[] = [];
  let current: unknown = err;
  let depth = 0;

  while (current && depth < maxDepth) {
    chain.push(formatOne(current));

    if (current instanceof AggregateError && current.errors?.length) {
      const inner = current.errors.map(e => formatOne(e)).join(" | ");
      chain.push(`aggregated[${current.errors.length}]: ${inner}`);
      break;
    }

    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
    depth++;
  }

  return chain.join(" -> ");
}
