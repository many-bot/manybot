import { spawn }       from "child_process";
import { execFile }    from "child_process";
import { promisify }   from "util";
import fs              from "fs";
import path            from "path";
import os              from "os";
import { logger }      from "../logger/logger.js";

const execFileAsync = promisify(execFile);

const DOWNLOADS_DIR = path.resolve("downloads");
const YT_DLP  = os.platform() === "win32" ? ".\\bin\\yt-dlp.exe"  : "./bin/yt-dlp";
const FFMPEG  = os.platform() === "win32" ? ".\\bin\\ffmpeg.exe"   : "./bin/ffmpeg";

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
];

// Ambos baixam como vídeo — áudio é convertido depois via ffmpeg
const ARGS_BY_TYPE = {
  video: ["-f", "bv+ba/best"],
  audio: ["-f", "bv+ba/best"],  // baixa vídeo, converte depois
};

/**
 * Baixa um vídeo ou áudio via yt-dlp.
 * Para áudio, baixa o vídeo e converte para mp3 com ffmpeg.
 * @param {"video"|"audio"} type
 * @param {string} url
 * @param {string} id
 * @returns {Promise<string>} caminho do arquivo final
 */
export async function download(type, url, id) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const output   = path.join(DOWNLOADS_DIR, `${id}.%(ext)s`);
  const args     = [...ARGS_BASE, ...ARGS_BY_TYPE[type], "--output", output, url];
  const videoPath = await runProcess(YT_DLP, args, type);

  if (type === "audio") {
    return convertToMp3(videoPath, id);
  }

  return videoPath;
}

/**
 * Converte um arquivo de vídeo para mp3 via ffmpeg.
 * Remove o vídeo original após a conversão.
 * @param {string} videoPath
 * @param {string} id
 * @returns {Promise<string>} caminho do mp3
 */
async function convertToMp3(videoPath, id) {
  const mp3Path = path.join(DOWNLOADS_DIR, `${id}.mp3`);

  await execFileAsync(FFMPEG, [
    "-i", videoPath,
    "-vn",                    // sem vídeo
    "-ar", "44100",           // sample rate
    "-ac", "2",               // stereo
    "-b:a", "192k",           // bitrate
    "-y",                     // sobrescreve se existir
    mp3Path,
  ]);

  fs.unlinkSync(videoPath);   // remove o vídeo intermediário
  return mp3Path;
}

// ── Compat ────────────────────────────────────────────────────
export const get_video = (url, id) => download("video", url, id);
export const get_audio = (url, id) => download("audio", url, id);

// ── Interno ───────────────────────────────────────────────────
function runProcess(cmd, args, type) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout  = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { logger.warn(`yt-dlp [${type}]: ${data.toString().trim()}`); });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(
          `Não foi possível baixar o ${type}. Verifique se o link é válido e tente novamente.`
        ));
      }

      const filepath = stdout.trim().split("\n").filter(Boolean).at(-1);

      if (!filepath || !fs.existsSync(filepath)) {
        return reject(new Error(
          "O download foi concluído, mas o arquivo não foi encontrado. Tente novamente."
        ));
      }

      resolve(filepath);
    });
  });
}