import { enqueueDownload } from "../../download/queue.js";
import { botMsg }          from "../../utils/botMsg.js";
import { logger }          from "../../logger/logger.js";

export async function cmdVideo(msg, chat, chatId, args) {
  if (!args[0]) {
    await msg.reply(botMsg("❌ Você precisa informar um link.\n\nExemplo: `!video https://youtube.com/...`"));
    logger.warn("!video sem link");
    return;
  }

  await msg.reply(botMsg("⏳ Baixando o vídeo, aguarde..."));
  enqueueDownload("video", args[0], msg, chatId);
  logger.done("!video", `enfileirado → ${args[0]}`);
}