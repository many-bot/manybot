const c = {
    reset: "\x1b[0m",
    green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m",
    red: "\x1b[31m", blue: "\x1b[34m",
};
/**
 * ManyBot central logger.
 * Each method only handles output — no business logic or external I/O.
 */
export const logger = {
    info: (...a) => console.log(`${c.cyan}INFO  ${c.reset}`, ...a),
    success: (...a) => console.log(`${c.green}OK    ${c.reset}`, ...a),
    warn: (...a) => console.log(`${c.yellow}WARN  ${c.reset}`, ...a),
    error: (...a) => console.log(`${c.red}ERROR ${c.reset}`, ...a),
    debug: (...a) => console.log(`${c.blue}DEBUG ${c.reset}`, ...a),
};
