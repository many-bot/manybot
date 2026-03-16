import { enqueueDownload } from "../../download/queue.js";
import { botMsg }          from "../../utils/botMsg.js";
import { logger }          from "../../logger/logger.js";

export async function cmdAudio(msg, chat, chatId, args) {
  if (!args[0]) {
    await msg.reply(botMsg("❌ Você precisa informar um link.\n\nExemplo: `!audio https://youtube.com/...`"));
    logger.warn("!audio sem link");
    return;
  }

  await msg.reply(botMsg("⏳ Baixando o áudio, aguarde..."));
  enqueueDownload("audio", args[0], msg, chatId);
  logger.done("!audio", `enfileirado → ${args[0]}`);
}