import { BOT_PREFIX } from "../config.js";

export function botMsg(text) {
    return `${BOT_PREFIX}\n${text}`;
}