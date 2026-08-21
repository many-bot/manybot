const c: Record<string, string> = {
  reset: "\x1b[0m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", blue: "\x1b[34m",
};

let debugEnabled = process.argv.includes("--debug");

/**
 * Startup log verbosity (Phase 9). Independent from `--debug`, which is a
 * separate, always-opt-in axis for troubleshooting.
 *
 *   normal  — everything (default): info + success + warn + error
 *   clean   — drops routine `info` chatter, keeps success/warn/error
 *   minimal — only what actually needs attention: warn + error
 *
 * `warn`/`error` are never suppressed by level — they always carry signal
 * worth seeing. Set via LOG_LEVEL in manybot.toml, applied by main.ts on
 * boot (config.ts itself may log before that point — those early
 * bootstrap lines always show, which is fine).
 */
export type LogLevel = "normal" | "clean" | "minimal";

let logLevel: LogLevel = "normal";

export function setLogLevel(level: LogLevel): void { logLevel = level; }
export function getLogLevel(): LogLevel { return logLevel; }

/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 *
 * `debug` is silent by default to keep production logs clean. Pass
 * `--debug` on the command line to enable it. The check is a single
 * `Array.includes` on argv, cheap enough to do per call and avoids
 * requiring logger consumers to know about a global toggle.
 */
export const logger = {
  info:    (...a: unknown[]) => {
    if (logLevel === "normal") console.log(`${c.cyan  }INFO  ${c.reset}`, ...a);
  },
  success: (...a: unknown[]) => {
    if (logLevel !== "minimal") console.log(`${c.green }OK    ${c.reset}`, ...a);
  },
  warn:    (...a: unknown[]) => console.log(`${c.yellow}WARN  ${c.reset}`, ...a),
  error:   (...a: unknown[]) => console.log(`${c.red   }ERROR ${c.reset}`, ...a),
  debug:   (...a: unknown[]) => {
    if (debugEnabled) console.log(`${c.blue  }DEBUG ${c.reset}`, ...a);
  },
};

export function enableDebug(): void { debugEnabled = true; }
export function isDebugEnabled(): boolean { return debugEnabled; }

