/**
 * Utilitário CLI para descobrir IDs de chats/grupos.
 * Uso: node src/utils/get_id.js grupos|contatos|<nome>
 */
import pkg      from "whatsapp-web.js";
import qrcode   from "qrcode-terminal";
import { resolvePuppeteerConfig } from "../client/environment.js";

const CLIENT_ID="getId"
const { Client, LocalAuth } = pkg;

const arg = process.argv[2];

if (!arg) {
  console.log("Uso: node get_id.js grupos|contatos|<nome>");
  process.exit(0);
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(resolvePuppeteerConfig().args || [])
    ],
    ...resolvePuppeteerConfig()
  },
});

client.on("qr", (qr) => {
  console.log("[QR] Escaneie para autenticar:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("[OK] Conectado. Buscando chats...\n");

  const chats = await client.getChats();
  const search = arg.toLowerCase();

  const filtered =
    search === "grupos"   ? chats.filter(c => c.isGroup) :
    search === "contatos" ? chats.filter(c => !c.isGroup) :
    chats.filter(c => (c.name || c.id.user).toLowerCase().includes(search));

  if (!filtered.length) {
    console.log("Nenhum resultado encontrado.");
  } else {
    filtered.forEach(c => {
      console.log("─".repeat(40));
      console.log("Nome:  ", c.name || c.id.user);
      console.log("ID:    ", c.id._serialized);
      console.log("Grupo: ", c.isGroup);
    });
  }

  await client.destroy();
  process.exit(0);
});

client.initialize();