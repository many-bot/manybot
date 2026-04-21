/**
 * CLI utility to discover chat/group IDs.
 * Usage: node src/utils/get_id.js groups|contacts|<name>
 */
import pkg      from "whatsapp-web.js";
import qrcode   from "qrcode-terminal";
import { resolvePuppeteerConfig } from "../client/environment.js";

const CLIENT_ID="getId"
const { Client, LocalAuth } = pkg;

const arg = process.argv[2];

if (!arg) {
  console.log("Usage: node get_id.js groups|contacts|<name>");
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
  console.log("[QR] Scan to authenticate:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("[OK] Connected. Searching chats...\n");

  const chats = await client.getChats();
  const search = arg.toLowerCase();

  const filtered =
    search === "groups"   ? chats.filter(c => c.isGroup) :
    search === "contacts" ? chats.filter(c => !c.isGroup) :
    chats.filter(c => (c.name || c.id.user).toLowerCase().includes(search));

  if (!filtered.length) {
    console.log("No results found.");
  } else {
    filtered.forEach(c => {
      console.log("─".repeat(40));
      console.log("Name:  ", c.name || c.id.user);
      console.log("ID:    ", c.id._serialized);
      console.log("Group: ", c.isGroup);
    });
  }

  await client.destroy();
  process.exit(0);
});

client.initialize();