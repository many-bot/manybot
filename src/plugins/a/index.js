import { forcaAtiva } from "../forca/index.js";

export default async function ({ msg }) {
  if (msg.body.trim().toLowerCase() !== "a") return;
  if (msg.args.length > 1) return;
  if (forcaAtiva) return;

  await msg.reply("B!");
} 