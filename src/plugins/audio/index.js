/**
 * plugins/audio/index.js
 *
 * Baixa vídeo via yt-dlp, converte para mp3 via ffmpeg e envia no chat.
 * Todo o processo (download + conversão + envio + limpeza) fica aqui.
 */

import { spawn }        from "child_process";
import { execFile }     from "child_process";
import { promisify }    from "util";
import fs               from "fs";
import path             from "path";
import os               from "os";
import { enqueue }      from "../../download/queue.js";
import { emptyFolder }  from "../../utils/file.js";
import { CMD_PREFIX } from "../../config.js";

const logStream = fs.createWriteStream("logs/audio-error.log", { flags: "a" });

const execFileAsync = promisify(execFile);

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP  = os.platform() === "win32" ? ".\\bin\\yt-dlp.exe" : "./bin/yt-dlp";
const FFMPEG  = os.platform() === "win32" ? ".\\bin\\ffmpeg.exe"  : "./bin/ffmpeg";

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

function downloadRaw(url, id) {
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
        "Não foi possível baixar o áudio. Verifique se o link é válido e tente novamente."
      ));

      const filePath = stdout.trim().split("\n").filter(Boolean).at(-1);
      if (!filePath || !fs.existsSync(filePath)) return reject(new Error(
        "Download concluído mas arquivo não encontrado. Tente novamente."
      ));

      resolve(filePath);
    });
  });
}

async function convertToMp3(videoPath, id) {
  const mp3Path = path.join(DOWNLOADS_DIR, `${id}.mp3`);

  await execFileAsync(FFMPEG, [
    "-i", videoPath,
    "-vn",          // sem vídeo
    "-ar", "44100", // sample rate
    "-ac", "2",     // stereo
    "-b:a", "192k", // bitrate
    "-y",           // sobrescreve se existir
    mp3Path,
  ]);

  fs.unlinkSync(videoPath); // remove o vídeo intermediário
  return mp3Path;
}

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "audio")) return;

  const url = msg.args[1];

  if (!url) {
    await msg.reply(`❌ Você precisa informar um link.\n\nExemplo: \`${CMD_PREFIX}audio https://youtube.com/...\``);
    return;
  }

  await msg.reply("⏳ Baixando o áudio, aguarde...");

  const id = `audio-${Date.now()}`;

  enqueue(
    async () => {
      const videoPath = await downloadRaw(url, id);
      const mp3Path   = await convertToMp3(videoPath, id);
      await api.sendAudio(mp3Path);
      fs.unlinkSync(mp3Path);
      emptyFolder(DOWNLOADS_DIR);
      api.log.info(`${CMD_PREFIX}audio concluído → ${url}`);
    },
    async () => {
      await msg.reply(
        "❌ Não consegui baixar o áudio.\n\n" +
        "Verifique se o link é válido e tente novamente.\n" +
        "Se o problema persistir, o conteúdo pode estar indisponível ou protegido."
      );
    }
  );
}