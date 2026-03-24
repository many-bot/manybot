/**
 * src/download/queue.js
 *
 * Fila de execução sequencial para jobs pesados (downloads, conversões).
 * Garante que apenas um job roda por vez — sem sobrecarregar yt-dlp ou ffmpeg.
 *
 * O plugin passa uma `workFn` que faz tudo: baixar, converter, enviar.
 * A fila só garante a sequência e trata erros.
 *
 * Uso:
 *   import { enqueue } from "../../src/download/queue.js";
 *   enqueue(async () => { ... toda a lógica do plugin ... }, onError);
 */

import { logger } from "../logger/logger.js";

/**
 * @typedef {{
 *   workFn:   () => Promise<void>,
 *   errorFn:  (err: Error) => Promise<void>,
 * }} Job
 */

/** @type {Job[]} */
let queue = [];
let processing = false;

/**
 * Adiciona um job à fila e inicia o processamento se estiver idle.
 *
 * @param {Function} workFn   — async () => void  — toda a lógica do plugin
 * @param {Function} errorFn  — async (err) => void  — chamado se workFn lançar
 */
export function enqueue(workFn, errorFn) {
  queue.push({ workFn, errorFn });
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (queue.length) {
    await processJob(queue.shift());
  }
  processing = false;
}

async function processJob({ workFn, errorFn }) {
  try {
    await workFn();
  } catch (err) {
    logger.error(`Falha no job — ${err.message}`);
    try { await errorFn(err); } catch { }
  }
}