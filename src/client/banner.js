const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",

  blue: "\x1b[94m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
  gray: "\x1b[90m",
  yellow: "\x1b[93m",
};

export function printBanner() {
  const banner = [
    `                             _           _  `,
    `                            | |         | | `,
    ` _ __ ___   __ _ _ __  _   _| |__   ___ | |_`,
    `| '_ \` _ \\ / _\` | '_ \\| | | | '_ \\ / _ \\| __`,
    `| | | | | | (_| | | | | |_| | |_) | (_) | |_`,
    `|_| |_| |_|\\__,_|_| |_|\\__, |_.__/ \\___/ \\__`,
    `                        __/ |               `,
    `                       |___/                `
  ];

  console.log(`${C.bold}${C.blue}`);
  console.log(banner.join("\n"));
  console.log(C.reset);

  console.log(
    `  made with ${C.magenta}<3${C.reset} by ${C.bold}${C.cyan}SyntaxError!${C.reset} ${C.gray}<me@stxerr.dev>${C.reset}`
  );

  console.log();

  console.log(
    `  ${C.gray}website${C.reset} : ${C.yellow}https://manybot.stxerr.dev${C.reset}`
  );

  console.log(
    `  ${C.gray}github ${C.reset} : ${C.yellow}https://github.com/many-bot${C.reset}`
  );

  console.log();
}
