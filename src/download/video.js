import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const platform = os.platform();

export async function get_video(url, id) {
  const downloadsDir = path.resolve("downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });

  const cmd = platform === "win32" ? ".\\bin\\yt-dlp.exe" : "./bin/yt-dlp";
  const args = [
    "--extractor-args", "youtube:player_client=android",
    "-f", "bv+ba/best",
    "--print", "after_move:filepath",
    "--output", path.join(downloadsDir, `${id}.%(ext)s`),
    "--cookies", "cookies.txt",
    "--add-header", "User-Agent:Mozilla/5.0",
    "--add-header", "Referer:https://www.youtube.com/",
    "--retries", "4",
    "--fragment-retries", "5",
    "--socket-timeout", "15",
    "--sleep-interval", "1", "--max-sleep-interval", "4",
    "--no-playlist",
    url,
  ];

  return await runCmd(cmd, args);
}

async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";

    proc.stdout.on("data", data => stdout += data.toString());
    proc.stderr.on("data", data => console.error("[yt-dlp ERR]", data.toString()));

    proc.on("close", code => {
      if (code !== 0) {
        return reject(new Error(
          "Não foi possível baixar o vídeo. Verifique se o link é válido e tente novamente."
        ));
      }

      const lines = stdout.trim().split("\n").filter(l => l.trim());
      const filepath = lines[lines.length - 1];

      if (!fs.existsSync(filepath)) {
        return reject(new Error(
          "O download foi concluído, mas o arquivo não foi encontrado. Tente novamente."
        ));
      }

      resolve(filepath);
    });
  });
}