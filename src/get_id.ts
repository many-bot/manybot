/**
 * CLI utility to discover chat/group IDs.
 *
 * Usage:
 *   node get_id.ts groups|contacts          – list all groups or contacts
 *   node get_id.ts <term> [term2] ...       – search by name, number or ID fragment
 *   node get_id.ts <term> --json            – export results as JSON
 *   node get_id.ts <term> --csv             – export results as CSV
 *
 * Search matches against: display name, phone number, serialized ID.
 */

import pkg     from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import fs      from "fs";
// resolvePuppeteerConfig was removed — puppeteer args are inlined below

const CLIENT_ID = "getId";
// @ts-ignore -- pkg is WAWebJS namespace; destructuring works at runtime via tsx/esModuleInterop
const { Client, LocalAuth } = pkg;

// ── Parse args ────────────────────────────────────────────────────────────────
const rawArgs  = process.argv.slice(2);
const exportJson = rawArgs.includes("--json");
const exportCsv  = rawArgs.includes("--csv");
const terms = rawArgs.filter(a => !a.startsWith("--")).map(a => a.toLowerCase());

if (!terms.length) {
  console.log([
    "Usage:",
    "  node get_id.ts me                  – show your own number and ID",
    "  node get_id.ts groups|contacts",
    "  node get_id.ts <term> [term2] ...  – search name, number or ID fragment",
    "  Add --json or --csv to export results",
  ].join("\n"));
  process.exit(0);
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ clientId: CLIENT_ID }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr: string) => {
  console.log("[QR] Scan to authenticate:");
  qrcode.generate(qr, { small: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function matches(chat: { name?: string; id?: { user?: string; _serialized?: string } }, term: string): boolean {
  const name   = (chat.name              || "").toLowerCase();
  const number = (chat.id?.user          || "").toLowerCase();
  const serial = (chat.id?._serialized   || "").toLowerCase();
  return name.includes(term) || number.includes(term) || serial.includes(term);
}

function buildRow(chat: { name?: string; id?: { user?: string; _serialized?: string }; isGroup: boolean }) {
  return {
    name:   chat.name || chat.id?.user || "",
    number: chat.id?.user || "",
    id:     chat.id?._serialized || "",
    group:  chat.isGroup,
  };
}

function printTable(rows: Array<{ name: string; number: string; id: string; group: boolean; phone?: string | null }>): void {
  const LINE = "─".repeat(48);
  rows.forEach(r => {
    console.log(LINE);
    console.log("Name:  ", r.name);
    console.log("Number:", r.number);
    console.log("ID:    ", r.id);
    if ((r as Record<string, unknown>).phone) console.log("Phone: ", (r as Record<string, unknown>).phone);
    console.log("Group: ", r.group);
  });
  console.log(LINE);
  console.log(`\n${rows.length} result(s) found.`);
}

function exportResults(rows: Array<Record<string, unknown>>): void {
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
      lid = await client.pupPage!.evaluate((s: string) => {
        // @ts-ignore — window.Store is injected by Puppeteer
        const wid = window.Store.WidFactory.createWid(s);
        // @ts-ignore — window.Store is injected by Puppeteer
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
    filtered = chats.filter((c: { isGroup: boolean }) => c.isGroup);
  } else if (first === "contacts") {
    filtered = chats.filter((c: { isGroup: boolean }) => !c.isGroup);
  } else {
    // All terms must match (AND logic across multiple terms)
    filtered = chats.filter((c: { name?: string; id?: { user?: string; _serialized?: string }; isGroup: boolean }) => terms.every(t => matches(c, t)));
  }

  if (!filtered.length) {
    console.log("No results found.");
  } else {
    const rows = filtered.map(buildRow);

    // For contacts with @lid, resolve the @c.us phone ID in bulk
    const lidRows = rows.filter((r: { group: boolean; id: string }) => !r.group && r.id.endsWith("@lid"));
    if (lidRows.length) {
      try {
        const serializedIds = lidRows.map((r: { id: string }) => r.id);
        const phoneMap = await client.pupPage!.evaluate((ids: string[]) => {
          const result: Record<string, string | null> = {};
          for (const id of ids) {
            try {
              // @ts-ignore — window.Store is injected by Puppeteer
              const wid = window.Store.WidFactory.createWid(id);
              // @ts-ignore — window.Store is injected by Puppeteer
              const phone = window.Store.LidUtils.getPhoneNumber(wid);
              result[id] = phone?._serialized ?? null;
            } catch (_) { result[id] = null; }
          }
          return result;
        }, serializedIds);
        for (const row of lidRows) (row as Record<string, unknown>).phone = (phoneMap as Record<string, string | null>)[(row as {id: string}).id] || null;
      } catch (_) { /* LID resolution unavailable */ }
    }

    printTable(rows);
    exportResults(rows);
  }

  await client.destroy();
  process.exit(0);
});

client.initialize();
