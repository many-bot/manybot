import { iniciarSessao, gerarSticker, help } from "../logic/figurinha.js";
import { stickerSessions }                  from "../logic/stickerSessions.js";
import { botMsg }                           from "../../utils/botMsg.js";

export async function cmdFigurinha(msg, chat, _chatId, args) {
  const author  = msg.author || msg.from;
  const name    = msg._data?.notifyName || author.replace(/(:\d+)?@.*$/, "");
  const groupId = chat.id._serialized;

  if (args[0] === "criar") {
    await gerarSticker(msg, groupId);
    return;
  }

  if (stickerSessions.has(groupId)) {
    await msg.reply(botMsg(
      "⚠️ Já existe uma sessão aberta.\n\n" +
      "Envie as mídias e depois use `!figurinha criar`.\n" +
      "Ou aguarde 2 minutos para a sessão expirar."
    ));
    return;
  }

  iniciarSessao(groupId, author, msg);
  await msg.reply(botMsg(`✅ Sessão iniciada por *${name}*!\n\n${help}`));
}