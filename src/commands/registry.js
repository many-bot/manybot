import { cmdMany }        from "./handlers/many.js";
import { cmdVideo }       from "./handlers/video.js";
import { cmdAudio }       from "./handlers/audio.js";
import { cmdFigurinha }   from "./handlers/figurinha.js";
import { cmdAdivinhacao } from "./handlers/adivinhacao.js";
import { cmdObrigado }    from "./handlers/obrigado.js";
import { cmdA }           from "./handlers/a.js";

/**
 * Mapa de comando → handler.
 * Cada handler tem a assinatura: (msg, chat, chatId, args) => Promise<void>
 *
 * @type {Map<string, Function>}
 */
export const commandRegistry = new Map([
  ["!many",        cmdMany],
  ["!video",       cmdVideo],
  ["!audio",       cmdAudio],
  ["!figurinha",   cmdFigurinha],
  ["!adivinhação", cmdAdivinhacao],
  ["!obrigado",    cmdObrigado],
  ["!valeu",       cmdObrigado],
  ["!brigado",     cmdObrigado],
  ["a",            cmdA],
]);