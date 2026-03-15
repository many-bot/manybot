import { get_video } from "./video.js";
import { get_audio } from "./audio.js";
import pkg from "whatsapp-web.js";
import fs from "fs";
import { botMsg } from "../utils/botMsg.js";
import { emptyFolder } from "../utils/file.js";
import client from "../client/whatsappClient.js";

const { MessageMedia } = pkg;

let downloadQueue = [];
let processingQueue = false;

export function enqueueDownload(type, url, msg, chatId) {
  downloadQueue.push({ type, url, msg, chatId });
  if (!processingQueue) processQueue();
}

async function processQueue() {
  processingQueue = true;

  while (downloadQueue.length) {
    const job = downloadQueue.shift();
    const label = job.type === "video" ? "vídeo" : "áudio";

    try {
      const filePath = job.type === "video"
        ? await get_video(job.url, job.msg.id._serialized)
        : await get_audio(job.url, job.msg.id._serialized);

      const file = fs.readFileSync(filePath);
      const media = new MessageMedia(
        job.type === "video" ? "video/mp4" : "audio/mpeg",
        file.toString("base64"),
        filePath.split("/").pop()
      );

      await client.sendMessage(job.chatId, media);
      fs.unlinkSync(filePath);
      emptyFolder("downloads");

    } catch (err) {
      console.error(`[queue] Erro ao baixar ${label}:`, err.message);
      await job.msg.reply(botMsg(
        `❌ Não consegui baixar o ${label}.\n\n` +
        "Verifique se o link é válido e tente novamente.\n" +
        "Se o problema persistir, o conteúdo pode estar indisponível ou protegido."
      ));
    }
  }

  processingQueue = false;
}