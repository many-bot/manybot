import { botMsg } from "../../utils/botMsg.js";

export async function cmdA(msg, _chat, _chatId, args) {
  if (!args[0]) await msg.reply(botMsg("B!"));
}