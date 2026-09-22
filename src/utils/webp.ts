/**
 * src/utils/webp.ts
 *
 * Shared animated-WebP helpers. WhatsApp reports stickers as mimetype
 * "image/webp" whether animated or not, so callers can't tell from the
 * mimetype alone — this is the single place that inspects the actual bytes.
 *
 * ffmpeg's native webp decoder cannot read animated WebP (it silently
 * skips the ANIM/ANMF chunks and fails with "image data not found"), so
 * any downstream processing must demux frames with node-webpmux first.
 */

import WebP from "node-webpmux";

export interface WebpFrame {
  data:    Buffer;
  delayMs: number;
}

export async function isAnimatedWebp(input: Buffer | string): Promise<boolean> {
  try {
    const img = new WebP.Image();
    await img.load(input);
    return img.hasAnim;
  } catch {
    return false;
  }
}

export async function demuxWebpFrames(input: Buffer | string): Promise<WebpFrame[]> {
  const img = new WebP.Image();
  await img.load(input);
  const buffers = await img.demux({ buffers: true });
  // WebP spec treats a 0ms delay as implementation-defined; fall back to 100ms.
  const delays = (img.frames ?? []).map(f => (f.delay > 0 ? f.delay : 100));
  return buffers.map((data, i) => ({ data, delayMs: delays[i] ?? 100 }));
}

