import { CMD_PREFIX } from "../../config.js";
const gatilhos = ["obrigado", "valeu", "brigado"];

export default async function ({ msg }) {
  if (!gatilhos.some(g => msg.is(CMD_PREFIX + g))) return;

  await msg.reply("😊 Por nada!");
}