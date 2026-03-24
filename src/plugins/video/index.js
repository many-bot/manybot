/**
 * plugins/video/index.js
 *
 * Baixa vídeo via yt-dlp e envia no chat.
 * Todo o processo (download + envio + limpeza) fica aqui.
 */

import { spawn }        from "child_process";
import fs               from "fs";
import path             from "path";
import os               from "os";
import { enqueue }      from "../../download/queue.js";
import { emptyFolder }  from "../../utils/file.js";
import { CMD_PREFIX } from "../../config.js";

const logStream = fs.createWriteStream("logs/video-error.log", { flags: "a" });

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP = os.platform() === "win32" ? ".\\bin\\yt-dlp.exe" : "./bin/yt-dlp";

const ARGS_BASE = [
  "--extractor-args",     "youtube:player_client=android",
  "--print",              "after_move:filepath",
  "--cookies",            "cookies.txt",
  "--add-header",         "User-Agent:Mozilla/5.0",
  "--add-header",         "Referer:https://www.youtube.com/",
  "--retries",            "4",
  "--fragment-retries",   "5",
  "--socket-timeout",     "15",
  "--sleep-interval",     "1",
  "--max-sleep-interval", "4",
  "--no-playlist",
  "-f", "bv+ba/best",
];

function downloadVideo(url, id) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

    const output = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);
    const proc   = spawn(YT_DLP, [...ARGS_BASE, "--output", output, url]);
    let stdout   = "";

    proc.on("error", err => reject(new Error(
      err.code === "EACCES"
        ? "Sem permissão para executar o yt-dlp. Rode: chmod +x ./bin/yt-dlp"
        : err.code === "ENOENT"
        ? "yt-dlp não encontrado em ./bin/yt-dlp"
        : `Erro ao iniciar o yt-dlp: ${err.message}`
    )));

    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => logStream.write(d));

    proc.on("close", code => {
      if (code !== 0) return reject(new Error(
        "Não foi possível baixar o vídeo. Verifique se o link é válido e tente novamente."
      ));

      const filePath = stdout.trim().split("\n").filter(Boolean).at(-1);
      if (!filePath || !fs.existsSync(filePath)) return reject(new Error(
        "Download concluído mas arquivo não encontrado. Tente novamente."
      ));

      resolve(filePath);
    });
  });
}

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "video")) return;

  const url = msg.args[1];

  if (!url) {
    await msg.reply(`❌ Você precisa informar um link.\n\nExemplo: \`${CMD_PREFIX}video https://youtube.com/...\``);
    return;
  }

  await msg.reply("⏳ Baixando o vídeo, aguarde...");

  enqueue(
    async () => {
      const filePath = await downloadVideo(url, `video-${Date.now()}`);
      await api.sendVideo(filePath);
      fs.unlinkSync(filePath);
      emptyFolder(DOWNLOADS_DIR);
      api.log.info(`${CMD_PREFIX}video concluído → ${url}`);
    },
    async () => {
      await msg.reply(
        "❌ Não consegui baixar o vídeo.\n\n" +
        "Verifique se o link é válido e tente novamente.\n" +
        "Se o problema persistir, o conteúdo pode estar indisponível ou protegido."
      );
    }
  );
}