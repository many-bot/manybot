/**
 * CLI utility to discover chat/group IDs.
 *
 * Usage:
 *   node get_id.js groups|contacts          – list all groups or contacts
 *   node get_id.js <term> [term2] ...       – search by name, number or ID fragment
 *   node get_id.js <term> --json            – export results as JSON
 *   node get_id.js <term> --csv             – export results as CSV
 *
 * Search matches against: display name, phone number, serialized ID.
 */

import pkg     from "whatsapp-web.js";
import qrcode  from "qrcode-terminal";
import fs      from "fs";
import { resolvePuppeteerConfig } from "#client/environment";

const CLIENT_ID = "getId";
const { Client, LocalAuth } = pkg;

// ── Parse args ────────────────────────────────────────────────────────────────
const rawArgs  = process.argv.slice(2);
const exportJson = rawArgs.includes("--json");
const exportCsv  = rawArgs.includes("--csv");
const terms = rawArgs.filter(a => !a.startsWith("--")).map(a => a.toLowerCase());

if (!terms.length) {
  console.log([
    "Usage:",
    "  node get_id.js me                  – show your own number and ID",
    "  node get_id.js groups|contacts",
    "  node get_id.js <term> [term2] ...  – search name, number or ID fragment",
    "  Add --json or --csv to export results",
  ].join("\n"));
  process.exit(0);
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", ...(resolvePuppeteerConfig().args || [])],
    ...resolvePuppeteerConfig(),
  },
});

client.on("qr", (qr) => {
  console.log("[QR] Scan to authenticate:");
  qrcode.generate(qr, { small: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function matches(chat, term) {
  const name   = (chat.name              || "").toLowerCase();
  const number = (chat.id?.user          || "").toLowerCase();
  const serial = (chat.id?._serialized   || "").toLowerCase();
  return name.includes(term) || number.includes(term) || serial.includes(term);
}

function buildRow(chat) {
  return {
    name:   chat.name || chat.id?.user || "",
    number: chat.id?.user || "",
    id:     chat.id?._serialized || "",
    group:  chat.isGroup,
  };
}

function printTable(rows) {
  const LINE = "─".repeat(48);
  rows.forEach(r => {
    console.log(LINE);
    console.log("Name:  ", r.name);
    console.log("Number:", r.number);
    console.log("ID:    ", r.id);
    if (r.phone) console.log("Phone: ", r.phone);
    console.log("Group: ", r.group);
  });
  console.log(LINE);
  console.log(`\n${rows.length} result(s) found.`);
}

function exportResults(rows) {
  if (exportJson) {
    const file = "get_id_results.json";
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`\nExported to ${file}`);
  }
  if (exportCsv) {
    const file = "get_id_results.csv";
    const header = "name,number,id,group";
    const lines  = rows.map(r =>
      [r.name, r.number, r.id, r.group].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
    );
    fs.writeFileSync(file, [header, ...lines].join("\n"));
    console.log(`Exported to ${file}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
client.on("ready", async () => {
  console.log("[OK] Connected. Searching…\n");

  const [first, ...rest] = terms;

  if (first === "me") {
    const info = client.info;

    // Attempt to resolve own LID via internal Store (may be unavailable on older WA versions)
    let lid = null;
    try {
      const serialized = client.info.wid._serialized;
      lid = await client.pupPage.evaluate((s) => {
        const wid = window.Store.WidFactory.createWid(s);
        const resolved = window.Store.LidUtils.getCurrentLid(wid);
        return resolved?._serialized ?? null;
      }, serialized);
    } catch (_) { /* LID unavailable */ }

    const LINE = "─".repeat(48);
    console.log(LINE);
    console.log("Name:  ", info.pushname || "(no name)");
    console.log("Number:", info.wid?.user || "");
    console.log("ID:    ", info.wid?._serialized || "");
    if (lid) console.log("LID:   ", lid);
    console.log(LINE);
    await client.destroy();
    process.exit(0);
  }

  const chats = await client.getChats();

  let filtered;
  if (first === "groups") {
    filtered = chats.filter(c => c.isGroup);
  } else if (first === "contacts") {
    filtered = chats.filter(c => !c.isGroup);
  } else {
    // All terms must match (AND logic across multiple terms)
    filtered = chats.filter(c => terms.every(t => matches(c, t)));
  }

  if (!filtered.length) {
    console.log("No results found.");
  } else {
    const rows = filtered.map(buildRow);

    // For contacts with @lid, resolve the @c.us phone ID in bulk
    const lidRows = rows.filter(r => !r.group && r.id.endsWith("@lid"));
    if (lidRows.length) {
      try {
        const serializedIds = lidRows.map(r => r.id);
        const phoneMap = await client.pupPage.evaluate((ids) => {
          const result = {};
          for (const id of ids) {
            try {
              const wid = window.Store.WidFactory.createWid(id);
              const phone = window.Store.LidUtils.getPhoneNumber(wid);
              result[id] = phone?._serialized ?? null;
            } catch (_) { result[id] = null; }
          }
          return result;
        }, serializedIds);
        for (const row of lidRows) row.phone = phoneMap[row.id] || null;
      } catch (_) { /* LID resolution unavailable */ }
    }

    printTable(rows);
    exportResults(rows);
  }

  await client.destroy();
  process.exit(0);
});

client.initialize();
