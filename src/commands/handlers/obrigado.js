import { botMsg } from "../../utils/botMsg.js";

export async function cmdObrigado(msg) {
  await msg.reply(botMsg("😊 Por nada!"));
}