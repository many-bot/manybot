import { c } from "../logger/formatter.js";

export function printBanner() {

  const banner = [
`   _____             _____     _   `,
`  |     |___ ___ _ _| __  |___| |_ `,
`  | | | | . |   | | | __ -| . |  _|`,
`  |_|_|_|__,|_|_|_  |_____|___|_|  `,
`                |___|              `
  ];

  const pony = [
`  ⠴⢮⠭⠍⠉⠉⠒⠤⣀`,
` ⢀⢊           ⢱⠊⠑⡀`,
` ⠋⡎  ⣀⡠⠤⠠⠖⠋⢉⠉ ⡄⢸`,
` ⣘⡠⠊⣩⡅  ⣴⡟⣯⠙⣊ ⢁⠜`,
`     ⣿⡇⢸⣿⣷⡿⢀⠇⢀⢎`,
`    ⠰⡉ ⠈⠛⠛⠋⠁⢀⠜ ⢂`,
`     ⠈⠒⠒⡲⠂⣠⣔⠁   ⡇  ⢀⡴⣾⣛⡛⠻⣦`,
`       ⢠⠃  ⢠⠞   ⡸⠉⠲⣿⠿⢿⣿⣿⣷⡌⢷`,
`   ⢀⠔⠂⢼   ⡎⡔⡄⠰⠃    ⢣ ⢻⣿⣿⣿⠘⣷`,
`  ⡐⠁   ⠸⡀ ⠏ ⠈⠃     ⢸  ⣿⣿⣿⡇⣿⡇`,
`  ⡇   ⡎⠉⠉⢳  ⡤⠤⡤⠲⡀ ⢇   ⣿⣿⣿⣇⣿⣷`,
`  ⡇  ⡠⠃  ⡸  ⡇  ⡇ ⢱⡀ ⢣  ⣿⣿⣿⣿⣿⡄`,
`  ⠑⠊    ⢰   ⠇ ⢸  ⡇⡇  ⡇  ⢳⣿⣿⣿⣿⡇`,
`      ⢠⠃   ⡸ ⡎   ⡜⡇   ⡇   ⠻⡏⠻⣿⣿⣄`,
`     ⣔⣁⣀⣀⡠⠁ ⠈⠉⠉⠁⣎⣀⣀⣀⡸`
  ];



  console.log(`${c.blue}${c.bold}`);

  const max = Math.max(banner.length, pony.length);

  for (let i = 0; i < max; i++) {
    const left = banner[i] || " ".repeat(banner[0].length);
    const right = pony[i] || "";
    console.log(left + "   " + right);
  }

  console.log();
  console.log(`  website : ${c.reset}${c.cyan}www.mlplovers.com.br/manybot${c.reset}`);
  console.log(`  repo    : ${c.reset}${c.cyan}github.com/synt-xerror/manybot${c.reset}`);
  console.log();
}

