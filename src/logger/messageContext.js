import client from "../client/whatsappClient.js";

/**
 * Extrai o número limpo de uma mensagem.
 * @param {import("whatsapp-web.js").Message} msg
 * @returns {Promise<string>}
 */
export async function getNumber(msg) {
  if (msg.fromMe) return String(msg.from).split("@")[0];
  const contact = await msg.getContact();
  return contact.number;
}

/**
 * Monta o contexto completo de uma mensagem para logging.
 * Resolve contato, quoted message e metadados do chat.
 *
 * @param {import("whatsapp-web.js").Message} msg
 * @param {import("whatsapp-web.js").Chat} chat
 * @param {string} botPrefix
 * @returns {Promise<MessageContext>}
 *
 * @typedef {Object} MessageContext
 * @property {string} chatName
 * @property {string} chatId
 * @property {boolean} isGroup
 * @property {string} senderName
 * @property {string} senderNumber
 * @property {string} type
 * @property {string} body
 * @property {{ name: string, number: string, preview: string } | null} quoted
 */
export async function buildMessageContext(msg, chat, botPrefix) {
  const chatId   = chat.id._serialized;
  const isGroup  = /@g\.us$/.test(chatId);
  const number   = await getNumber(msg);
  const name     = msg._data?.notifyName || String(msg.from).replace(/(:\d+)?@.*$/, "");

  const quoted = await resolveQuotedMessage(msg);

  return {
    chatName:     chat.name || chat.id.user,
    chatId,
    isGroup,
    senderName:   name,
    senderNumber: number,
    type:         msg?.type || "text",
    body:         msg.body,
    quoted,
  };
}

/**
 * Resolve os dados da mensagem citada, se existir.
 * Retorna null em caso de erro ou ausência.
 *
 * @param {import("whatsapp-web.js").Message} msg
 * @returns {Promise<{ name: string, number: string, preview: string } | null>}
 */
async function resolveQuotedMessage(msg) {
  if (!msg?.hasQuotedMsg) return null;

  try {
    const quoted       = await msg.getQuotedMessage();
    const quotedNumber = String(quoted.from).split("@")[0];

    let quotedName = quotedNumber;
    try {
      const contact = await client.getContactById(quoted.from);
      quotedName    = contact?.pushname || contact?.formattedName || quotedNumber;
    } catch { /* contato não encontrado — usa o número */ }

    const quotedPreview = quoted.body?.trim()
      ? `"${quoted.body.length > 80 ? quoted.body.slice(0, 80) + "…" : quoted.body}"`
      : `<${quoted.type}>`;

    return { name: quotedName, number: quotedNumber, preview: quotedPreview };
  } catch {
    return null;
  }
}