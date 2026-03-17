import fs               from "fs";
import path             from "path";
import os               from "os";
import { execFile }     from "child_process";
import { promisify }    from "util";

import pkg              from "whatsapp-web.js";
import { createSticker } from "wa-sticker-formatter";

import { client }          from "../../client/whatsappClient.js";
import { botMsg }          from "../../utils/botMsg.js";
import { emptyFolder }     from "../../utils/file.js";
import { stickerSessions } from "./stickerSessions.js";  // ← sem circular
import { logger }          from "../../logger/logger.js";

const { MessageMedia } = pkg;
const execFileAsync = promisify(execFile);

// ── Constantes ────────────────────────────────────────────────
const DOWNLOADS_DIR    = path.resolve("downloads");
const FFMPEG           = os.platform() === "win32" ? ".\\bin\\ffmpeg.exe" : "./bin/ffmpeg";
const MAX_STICKER_SIZE = 900 * 1024;
const SESSION_TIMEOUT  = 2 * 60 * 1000;
const MAX_MEDIA        = 30;

// ── Helpers ───────────────────────────────────────────────────
function ensureDownloadsDir() {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function cleanupFiles(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignora */ }
  }
}

async function convertVideoToGif(inputPath, outputPath, fps = 12) {
  const clampedFps = Math.min(fps, 12);
  const filter = [
    `fps=${clampedFps},scale=512:512:flags=lanczos,split[s0][s1]`,
    `[s0]palettegen=max_colors=256:reserve_transparent=1[p]`,
    `[s1][p]paletteuse=dither=bayer`,
  ].join(";");

  await execFileAsync(FFMPEG, ["-i", inputPath, "-filter_complex", filter, "-loop", "0", "-y", outputPath]);
}

async function resizeToSticker(inputPath, outputPath) {
  await execFileAsync(FFMPEG, ["-i", inputPath, "-vf", "scale=512:512:flags=lanczos", "-y", outputPath]);
}

async function createStickerWithFallback(stickerInputPath, isAnimated) {
  for (const quality of [80, 60, 40, 20]) {
    const buffer = await createSticker(fs.readFileSync(stickerInputPath), {
      pack:       "Criada por ManyBot\n",
      author:     "\ngithub.com/synt-xerror/manybot",
      type:       isAnimated ? "FULL" : "STATIC",
      categories: ["🤖"],
      quality,
    });

    if (buffer.length <= MAX_STICKER_SIZE) return buffer;
  }

  throw new Error("Não foi possível reduzir o sticker para menos de 900 KB.");
}

// ── Textos ────────────────────────────────────────────────────
export const help =
  "📌 *Como criar figurinhas:*\n\n" +
  "1️⃣ Digite `!figurinha` para iniciar\n" +
  "2️⃣ Envie as imagens, GIFs ou vídeos que quer transformar\n" +
  "3️⃣ Digite `!figurinha criar` para gerar as figurinhas\n\n" +
  "⏳ A sessão expira em 2 minutos se nenhuma mídia for enviada.";

// ── Sessão ────────────────────────────────────────────────────
export function iniciarSessao(chatId, author, msg) {
  if (stickerSessions.has(chatId)) return false;

  const timeout = setTimeout(async () => {
    stickerSessions.delete(chatId);
    try {
      await msg.reply(botMsg(
        "⏰ *Sessão expirada!*\n\n" +
        "Você demorou mais de 2 minutos para enviar as mídias.\n" +
        "Digite `!figurinha` para começar de novo."
      ));
    } catch (err) {
      logger.warn(`Erro ao notificar expiração da sessão: ${err.message}`);
    }
  }, SESSION_TIMEOUT);

  stickerSessions.set(chatId, { author, medias: [], timeout });
  return true;
}

// ── Coleta de mídia ───────────────────────────────────────────
export async function coletarMidia(msg) {
  const chat    = await msg.getChat();
  const chatId  = chat.id._serialized;
  const session = stickerSessions.get(chatId);

  if (!session) return;

  const sender = msg.author || msg.from;
  if (sender !== session.author) return;
  if (!msg.hasMedia) return;

  const media = await msg.downloadMedia();
  if (!media) return;

  const isGif =
    media.mimetype === "image/gif" ||
    (media.mimetype === "video/mp4" && msg._data?.isGif);

  const isSupported =
    media.mimetype?.startsWith("image/") ||
    media.mimetype?.startsWith("video/") ||
    isGif;

  if (!isSupported) return;

  if (session.medias.length < MAX_MEDIA) {
    session.medias.push(media);
  }
}

// ── Geração de stickers ───────────────────────────────────────
export async function gerarSticker(msg, chatId) {
  const sender  = msg.author || msg.from;
  const session = stickerSessions.get(chatId);

  if (!session) {
    return msg.reply(botMsg("❌ *Nenhuma sessão ativa.*\n\n" + help));
  }

  if (session.author !== sender) {
    return msg.reply(botMsg("🚫 Só quem digitou `!figurinha` pode usar `!figurinha criar`."));
  }

  if (!session.medias.length) {
    return msg.reply(botMsg("📭 *Você ainda não enviou nenhuma mídia!*\n\n" + help));
  }

  clearTimeout(session.timeout);
  await msg.reply(botMsg("⏳ Gerando suas figurinhas, aguarde um momento..."));
  ensureDownloadsDir();

  for (const media of session.medias) {
    try {
      const ext        = media.mimetype.split("/")[1];
      const isVideo    = media.mimetype.startsWith("video/");
      const isGif      = media.mimetype === "image/gif";
      const isAnimated = isVideo || isGif;

      const id          = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const inputPath   = path.join(DOWNLOADS_DIR, `${id}.${ext}`);
      const gifPath     = path.join(DOWNLOADS_DIR, `${id}.gif`);
      const resizedPath = path.join(DOWNLOADS_DIR, `${id}-scaled.${ext}`);

      fs.writeFileSync(inputPath, Buffer.from(media.data, "base64"));

      let stickerInputPath;

      if (isAnimated) {
        await convertVideoToGif(inputPath, gifPath, isVideo ? 12 : 24);
        stickerInputPath = gifPath;
      } else {
        await resizeToSticker(inputPath, resizedPath);
        stickerInputPath = resizedPath;
      }

      const stickerBuffer = await createStickerWithFallback(stickerInputPath, isAnimated);
      const stickerMedia  = new MessageMedia("image/webp", stickerBuffer.toString("base64"));

      await client.sendMessage(chatId, stickerMedia, { sendMediaAsSticker: true });
      cleanupFiles(inputPath, gifPath, resizedPath);

    } catch (err) {
      logger.error(`Erro ao gerar sticker: ${err.message}`);
      await msg.reply(botMsg(
        "⚠️ Não consegui criar uma das figurinhas.\n" +
        "Tente reenviar essa mídia ou use outro formato (JPG, PNG, GIF, MP4)."
      ));
    }
  }

  await msg.reply(botMsg("✅ *Figurinhas criadas com sucesso!*\nSalve as que quiser no seu WhatsApp. 😄"));

  stickerSessions.delete(chatId);
  emptyFolder("downloads");
}