import type { Chat } from "#wwjs";

export function getChatId(chat: Chat): string {
  return chat.id._serialized;
}