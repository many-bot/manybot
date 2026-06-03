const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
  red: "\x1b[31m", gray: "\x1b[90m", white: "\x1b[37m",
  blue: "\x1b[34m", magenta: "\x1b[35m",
};

/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 */
export const logger = {
  info:    (...a) => console.log(`${c.cyan  }INFO  ${c.reset}`, ...a),
  success: (...a) => console.log(`${c.green }OK    ${c.reset}`, ...a),
  warn:    (...a) => console.log(`${c.yellow}WARN  ${c.reset}`, ...a),
  error:   (...a) => console.log(`${c.red   }ERROR ${c.reset}`, ...a),

  cmd: (cmd, extra = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.yellow}CMD    ${c.reset}` +
      `${c.bold}${cmd}${c.reset}` +
      (extra ? `  ${c.dim}${extra}${c.reset}` : "")
    ),

  done: (cmd, detail = "") =>
    console.log(
      `${c.gray}${now()}${c.reset}${c.green}DONE   ${c.reset}` +
      `${c.dim}${cmd}${c.reset}` +
      (detail ? ` — ${detail}` : "")
    ),
};
