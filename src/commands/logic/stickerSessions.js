/**
 * Armazena sessões ativas de criação de figurinha.
 * Módulo neutro — não importa nada do projeto, pode ser importado por qualquer um.
 *
 * @type {Map<string, { author: string, medias: object[], timeout: NodeJS.Timeout }>}
 */
export const stickerSessions = new Map();