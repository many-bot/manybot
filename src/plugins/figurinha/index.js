/**
 * plugins/figurinha/index.js
 *
 * Modos de uso:
 *   comando + mídia anexa              → cria 1 sticker direto
 *   comando + respondendo mídia        → cria 1 sticker direto
 *   comando + mídia anexa + respondendo mídia → cria 2 stickers direto
 *   comando (sem mídia nenhuma)        → abre sessão
 *   comando criar (com sessão aberta)  → processa as mídias da sessão
 */

import fs            from "fs";
import path          from "path";
import os            from "os";
import { execFile }  from "child_process";
import { promisify } from "util";

import { createSticker } from "wa-sticker-formatter";
import { emptyFolder }   from "../../utils/file.js";
import { CMD_PREFIX } from "../../config.js";

const execFileAsync = promisify(execFile);

// ── Constantes ────────────────────────────────────────────────
const DOWNLOADS_DIR    = path.resolve("downloads");
const FFMPEG           = os.platform() === "win32" ? ".\\bin\\ffmpeg.exe" : "./bin/ffmpeg";
const MAX_STICKER_SIZE = 900 * 1024;
const SESSION_TIMEOUT  = 2 * 60 * 1000;
const MAX_MEDIA        = 30;

const HELP =
  "📌 *Como criar figurinhas:*\n\n" +
  `1️⃣ Envie \`${CMD_PREFIX}figurinha\` junto com uma mídia, ou respondendo uma mídia\n` +
  "   — o sticker é criado na hora\n\n" +
  "2️⃣ Ou use o modo sessão para várias mídias de uma vez:\n" +
  `   — \`${CMD_PREFIX}figurinha\` sem mídia para iniciar\n` +
  "   — envie as imagens, GIFs ou vídeos\n" +
  `   — \`${CMD_PREFIX}figurinha criar\` para gerar todas\n\n` +
  "⏳ A sessão expira em 2 minutos se nenhuma mídia for enviada.";

// ── Estado interno ────────────────────────────────────────────
// { chatId → { author, medias[], timeout } }
const sessions = new Map();

// ── Conversão ─────────────────────────────────────────────────
function ensureDir() {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { }
  }
}

async function convertToGif(input, output, fps = 12) {
  const filter = [
    `fps=${Math.min(fps, 12)},scale=512:512:flags=lanczos,split[s0][s1]`,
    `[s0]palettegen=max_colors=256:reserve_transparent=1[p]`,
    `[s1][p]paletteuse=dither=bayer`,
  ].join(";");
  await execFileAsync(FFMPEG, ["-i", input, "-filter_complex", filter, "-loop", "0", "-y", output]);
}

async function resizeImage(input, output) {
  await execFileAsync(FFMPEG, ["-i", input, "-vf", "scale=512:512:flags=lanczos", "-y", output]);
}

async function buildSticker(inputPath, isAnimated) {
  for (const quality of [80, 60, 40, 20]) {
    const buf = await createSticker(fs.readFileSync(inputPath), {
      pack:       "Criada por ManyBot\n",
      author:     "\ngithub.com/synt-xerror/manybot",
      type:       isAnimated ? "FULL" : "STATIC",
      categories: ["🤖"],
      quality,
    });
    if (buf.length <= MAX_STICKER_SIZE) return buf;
  }
  throw new Error("Não foi possível reduzir o sticker para menos de 900 KB.");
}

/**
 * Converte um objeto { mimetype, data } em sticker e envia.
 * Retorna true se ok, false se falhou.
 */
async function processarUmaMedia(media, isGif, api, msg) {
  ensureDir();

  const ext        = media.mimetype.split("/")[1];
  const isVideo    = media.mimetype.startsWith("video/");
  const isAnimated = isVideo || isGif;

  const id          = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath   = path.join(DOWNLOADS_DIR, `${id}.${ext}`);
  const gifPath     = path.join(DOWNLOADS_DIR, `${id}.gif`);
  const resizedPath = path.join(DOWNLOADS_DIR, `${id}-scaled.${ext}`);

  try {
    fs.writeFileSync(inputPath, Buffer.from(media.data, "base64"));

    let stickerInput;
    if (isAnimated) {
      await convertToGif(inputPath, gifPath, isVideo ? 12 : 24);
      stickerInput = gifPath;
    } else {
      await resizeImage(inputPath, resizedPath);
      stickerInput = resizedPath;
    }

    const buf = await buildSticker(stickerInput, isAnimated);
    await api.sendSticker(buf);
    return true;
  } catch (err) {
    api.log.error(`Erro ao gerar sticker: ${err.message}`);
    await msg.reply(
      "⚠️ Não consegui criar uma das figurinhas.\n" +
      "Tente reenviar essa mídia ou use outro formato (JPG, PNG, GIF, MP4)."
    );
    return false;
  } finally {
    cleanup(inputPath, gifPath, resizedPath);
  }
}

/**
 * Verifica se uma mídia é suportada para sticker.
 */
function isSupported(media, isGif) {
  return (
    media.mimetype?.startsWith("image/") ||
    media.mimetype?.startsWith("video/") ||
    isGif
  );
}

// ── Plugin ────────────────────────────────────────────────────
export default async function ({ msg, api }) {
  const chatId = api.chat.id;

  if (!msg.is(CMD_PREFIX + "figurinha")) {
    // ── Coleta de mídia durante sessão ──────────────────────
    const session = sessions.get(chatId);
    if (!session) return;
    if (!msg.hasMedia) return;
    if (msg.sender !== session.author) return;

    const media = await msg.downloadMedia();
    if (!media) return;

    const gif = media.mimetype === "image/gif" ||
      (media.mimetype === "video/mp4" && msg.isGif);

    if (isSupported(media, gif) && session.medias.length < MAX_MEDIA) {
      session.medias.push({ media, isGif: gif });
    }
    return;
  }

  // ── figurinha criar ──────────────────────────────────────
  const sub = msg.args[1];

  if (sub === "criar") {
    const session = sessions.get(chatId);

    if (!session) {
      await msg.reply(`❌ *Nenhuma sessão ativa.*\n\n${HELP}`);
      return;
    }
    if (!session.medias.length) {
      await msg.reply(`📭 *Você ainda não enviou nenhuma mídia!*\n\n${HELP}`);
      return;
    }

    clearTimeout(session.timeout);
    await msg.reply("⏳ Gerando suas figurinhas, aguarde um momento...");

    for (const { media, isGif } of session.medias) {
      await processarUmaMedia(media, isGif, api, msg);
    }

    await msg.reply("✅ *Figurinhas criadas com sucesso!*\nSalve as que quiser no seu WhatsApp. 😄");
    sessions.delete(chatId);
    emptyFolder(DOWNLOADS_DIR);
    return;
  }

  // ── figurinha com mídia direta ───────────────────────────
  const mediasParaCriar = [];

  // Mídia anexa à própria mensagem
  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    if (media) {
      const gif = media.mimetype === "image/gif" ||
        (media.mimetype === "video/mp4" && msg.isGif);
      if (isSupported(media, gif)) mediasParaCriar.push({ media, isGif: gif });
    }
  }

  // Mídia da mensagem citada
  if (msg.hasReply) {
    const quoted = await msg.getReply();
    if (quoted?.hasMedia) {
      const media = await quoted.downloadMedia();
      if (media) {
        const gif = media.mimetype === "image/gif" ||
          (media.mimetype === "video/mp4" && quoted.isGif);
        if (isSupported(media, gif)) mediasParaCriar.push({ media, isGif: gif });
      }
    }
  }

  // Tem mídia para criar direto
  if (mediasParaCriar.length > 0) {
    await msg.reply("⏳ Gerando figurinha, aguarde...");
    for (const { media, isGif } of mediasParaCriar) {
      await processarUmaMedia(media, isGif, api, msg);
    }
    emptyFolder(DOWNLOADS_DIR);
    return;
  }

  // ── figurinha sem mídia → abre sessão ───────────────────
  if (sessions.has(chatId)) {
    await msg.reply(
      "⚠️ Já existe uma sessão aberta.\n\n" +
      `Envie as mídias e depois use \`${CMD_PREFIX}figurinha criar\`.\n` +
      "Ou aguarde 2 minutos para a sessão expirar."
    );
    return;
  }

  const timeout = setTimeout(async () => {
    sessions.delete(chatId);
    try {
      await msg.reply(
        "⏰ *Sessão expirada!*\n\n" +
        "Você demorou mais de 2 minutos para enviar as mídias.\n" +
        `Digite \`${CMD_PREFIX}figurinha\` para começar de novo.`
      );
    } catch { }
  }, SESSION_TIMEOUT);

  sessions.set(chatId, { author: msg.sender, medias: [], timeout });
  await msg.reply(`✅ Sessão iniciada por *${msg.senderName}*!\n\n${HELP}`);
}