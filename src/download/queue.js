import fs                   from "fs";
import path                 from "path";
import pkg                  from "whatsapp-web.js";
import { download }          from "./downloader.js";
import { resolveMediaType }  from "./mediaType.js";
import { botMsg }           from "../utils/botMsg.js";
import { emptyFolder }      from "../utils/file.js";
import { logger }           from "../logger/logger.js";
import client               from "../client/whatsappClient.js";

const { MessageMedia } = pkg;

/**
 * @typedef {{ type: "video"|"audio", url: string, msg: object, chatId: string }} DownloadJob
 */

/** @type {DownloadJob[]} */
let queue = [];
let processing = false;

/**
 * Adiciona um job à fila e inicia o processamento se estiver idle.
 * @param {"video"|"audio"} type
 * @param {string} url
 * @param {object} msg
 * @param {string} chatId
 */
export function enqueueDownload(type, url, msg, chatId) {
  queue.push({ type, url, msg, chatId });
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;

  while (queue.length) {
    const job = queue.shift();
    await processJob(job);
  }

  processing = false;
}

/**
 * Executa um único job: baixa, envia e limpa.
 * @param {DownloadJob} job
 */
async function processJob(job) {
  const { mime, label } = resolveMediaType(job.type);

  try {
    const filePath = await download(job.type, job.url, job.msg.id._serialized);

    const media = new MessageMedia(
      mime,
      fs.readFileSync(filePath).toString("base64"),
      path.basename(filePath)
    );

    await client.sendMessage(job.chatId, media);

    fs.unlinkSync(filePath);
    emptyFolder("downloads");

    logger.done(`download:${job.type}`, job.url);
  } catch (err) {
    logger.error(`Falha ao baixar ${label} — ${err.message}`);
    await job.msg.reply(botMsg(
      `❌ Não consegui baixar o ${label}.\n\n` +
      "Verifique se o link é válido e tente novamente.\n" +
      "Se o problema persistir, o conteúdo pode estar indisponível ou protegido."
    ));
  }
}