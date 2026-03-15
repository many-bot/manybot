import { get_video } from "./video.js";
import { spawn } from "child_process";
import os from "os";

const so = os.platform();

export async function get_audio(url, id) {
  const video = await get_video(url, id);
  const output = `downloads/${id}.mp3`;

  const cmd = so === "win32" ? ".\\bin\\ffmpeg.exe" : "./bin/ffmpeg";
  const args = ["-i", video, "-vn", "-acodec", "libmp3lame", "-q:a", "2", output];

  await runCmd(cmd, args);
  return output;
}

async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);

    proc.stdout.on("data", data => console.log("[cmd]", data.toString()));
    proc.stderr.on("data", data => console.error("[cmd ERR]", data.toString()));

    proc.on("close", code => {
      if (code !== 0) {
        return reject(new Error(
          "Não foi possível converter o áudio. Tente novamente com outro link."
        ));
      }
      resolve();
    });
  });
}