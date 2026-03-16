/**
 * Retorna o MIME type e extensão para cada tipo de download suportado.
 * @param {"video"|"audio"} type
 * @returns {{ mime: string, label: string }}
 */
export function resolveMediaType(type) {
  const types = {
    video: { mime: "video/mp4",   label: "vídeo" },
    audio: { mime: "audio/mpeg",  label: "áudio" },
  };

  const resolved = types[type];
  if (!resolved) throw new Error(`Tipo de mídia desconhecido: ${type}`);
  return resolved;
}