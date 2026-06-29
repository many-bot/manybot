const c: Record<string, string> = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", gray: "\x1b[90m", white: "\x1b[37m",
  blue: "\x1b[34m", magenta: "\x1b[35m",
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 */
export const logger = {
  info:    (...a: unknown[]) => console.log(`${c.cyan  }INFO  ${c.reset}`, ...a),
  success: (...a: unknown[]) => console.log(`${c.green }OK    ${c.reset}`, ...a),
  warn:    (...a: unknown[]) => console.log(`${c.yellow}WARN  ${c.reset}`, ...a),
  error:   (...a: unknown[]) => console.log(`${c.red   }ERROR ${c.reset}`, ...a),
  debug:   (...a: unknown[]) => console.log(`${c.blue  }DEBUG ${c.reset}`, ...a),

  cmd: (cmd: string, extra = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.yellow}CMD    ${c.reset}` +
      `${c.bold}${cmd}${c.reset}` +
      (extra ? `  ${c.dim}${extra}${c.reset}` : "")
    ),

  done: (cmd: string, detail = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.green}DONE   ${c.reset}` +
      `${c.dim}${cmd}${c.reset}` +
      (detail ? ` - ${detail}` : "")
    ),
};
