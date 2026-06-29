#!/usr/bin/env node

/**
 * main.js
 *
 * ManyBot entry point.
 * Initializes WhatsApp client and loads plugins.
 */

import Module from "module";
import path from "path";
import fs from "fs";

process.env.NODE_PATH = path.resolve(process.cwd(), "node_modules");
Module._initPaths();

import client, { handleQR, handlePairingCode } from "#client/whatsappClient";
import { handleMessage }                       from "#kernel/messageHandler";
import { loadPlugins, setupPlugins }           from "#kernel/pluginLoader";
import { logger }                              from "#logger";
import { PLUGINS, CLIENT_ID }                  from "#config";
import { t }                                   from "#i18n";
import { printBanner }                         from "#client/banner";

// ── --getid mode ──────────────────────────────────────────────────────────────
const _argv       = process.argv.slice(2);
const GET_ID_MODE = _argv.includes("--getid");
const _getIdArgs  = _argv.slice(_argv.indexOf("--getid") + 1);
const _exportJson = _getIdArgs.includes("--json");
const _exportCsv  = _getIdArgs.includes("--csv");
const _terms      = _getIdArgs.filter(a => !a.startsWith("--")).map(a => a.toLowerCase());

function _matches(chat, term) {
  return (chat.name             || "").toLowerCase().includes(term)
      || (chat.id?.user         || "").toLowerCase().includes(term)
      || (chat.id?._serialized  || "").toLowerCase().includes(term);
}

function _buildRow(chat) {
  return { name: chat.name || chat.id?.user || "", number: chat.id?.user || "",
           id: chat.id?._serialized || "", group: chat.isGroup };
}

function _printTable(rows) {
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

function _exportResults(rows, csvHeader = "name,number,id,group") {
  if (_exportJson) {
    const f = "get_id_results.json";
    fs.writeFileSync(f, JSON.stringify(rows, null, 2));
    console.log(`\nExported to ${f}`);
  }
  if (_exportCsv) {
    const f    = "get_id_results.csv";
    const keys = csvHeader.split(",");
    fs.writeFileSync(f, [csvHeader,
      ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))
    ].join("\n"));
    console.log(`Exported to ${f}`);
  }
}

if (!GET_ID_MODE) logger.info(t("bot.starting"));

// Global safety net — no error should crash the bot
process.on("uncaughtException", (err) => {
  logger.error(`${t("bot.error.uncaught")} — ${err.message}`,
    `\n             ${t("errors.stack")}: ${err.stack?.split("\n")[1]?.trim() ?? ""}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error(`${t("bot.error.unhandled")} — ${msg}`);
});

// Clean shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown)
    return;

  shuttingDown = true;
  logger.warn(
    t("bot.signal.sigterm", {
      signal
    })
  );

  try {
    await client.destroy();
  } catch {}

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

let state = "BOOT";
// BOOT → AUTH → SYNC → READY

function setState(next) {
  state = next;
}

client.on("authenticated", () => {
  setState("AUTH");
});

client.on("loading_screen", (p, msg) => {
  setState("SYNC");
  if (!GET_ID_MODE) logger.info(`loading ${p}% ${msg}`);
});

client.on("ready", async () => {
  setState("READY_INIT");

  // ── --getid mode: list/search chats and exit ───────────────────────────────
  if (GET_ID_MODE) {
    console.log("[OK] Connected. Searching…\n");
    const [first] = _terms;

    if (first === "me") {
      const info   = client.info;
      const LINE   = "─".repeat(48);
      let lid = null;
      try {
        const serialized = info.wid._serialized;
        lid = await client.pupPage.evaluate((s) => {
          const wid      = window.Store.WidFactory.createWid(s);
          const resolved = window.Store.LidUtils.getCurrentLid(wid);
          return resolved?._serialized ?? null;
        }, serialized);
      } catch (_) { /* LID unavailable */ }

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

    if (first === "communities") {
      const communities = chats.filter(c => c.isCommunity);

      if (!communities.length) {
        console.log("No communities found.");
        await client.destroy();
        process.exit(0);
      }

      // Index chats by serialized ID for fast lookup
      const chatIndex = new Map(chats.map(c => [c.id?._serialized, c]));

      const LINE = "─".repeat(52);
      let total = 0;
      const exportRows = [];

      for (const community of communities) {
        const communityId  = community.id?._serialized;
        const meta         = community.groupMetadata;
        const cachedIds    = new Set(chats.map(c => c.id?._serialized));

        // Collect all known subgroup IDs from metadata (field name varies by wwebjs version)
        const knownIds = new Set([
          ...(meta?.subGroupsId     || []).map(id => id?._serialized ?? id),
          ...(meta?.linkedSubgroups || []).map(id => id?._serialized ?? id),
          ...(meta?.subgroups       || []).map(id => id?._serialized ?? id),
        ].filter(Boolean));

        // Fetch any subgroup not already in getChats()
        const fetched = await Promise.all(
          [...knownIds]
            .filter(id => !chatIndex.has(id))
            .map(id => client.getChatById(id).catch(() => null))
        );
        fetched.filter(Boolean).forEach(c => chatIndex.set(c.id?._serialized, c));

        // Build final subgroup list: parentGroup match OR in knownIds
        const subgroups = [...chatIndex.values()].filter(c =>
          c.isGroup &&
          !c.isCommunity &&
          (c.groupMetadata?.parentGroup?._serialized === communityId ||
           knownIds.has(c.id?._serialized))
        );

        // Sort: default subgroup first, then alphabetical
        subgroups.sort((a, b) => {
          const aDefault = a.groupMetadata?.isDefaultSubgroup ?? false;
          const bDefault = b.groupMetadata?.isDefaultSubgroup ?? false;
          if (aDefault !== bDefault) return aDefault ? -1 : 1;
          return (a.name || "").localeCompare(b.name || "");
        });

        console.log(LINE);
        console.log(`Community  ${community.name}`);
        console.log(`ID         ${communityId}`);
        console.log();

        subgroups.forEach((sg, i) => {
          const isLast    = i === subgroups.length - 1;
          const branch    = isLast ? "└─" : "├─";
          const isDefault = sg.groupMetadata?.isDefaultSubgroup ?? false;
          const tag       = isDefault ? " [announcements]" : "";
          const wasFetched = !cachedIds.has(sg.id?._serialized) ? " [fetched]" : "";
          console.log(`  ${branch} ${sg.name}${tag}${wasFetched}`);
          console.log(`     ${isLast ? " " : "│"}  ${sg.id?._serialized}`);
        });

        if (!subgroups.length) console.log("  (no subgroups visible)");
        total += subgroups.length;

        exportRows.push(...subgroups.map(sg => ({
          community:   community.name,
          communityId,
          name:        sg.name,
          number:      sg.id?.user || "",
          id:          sg.id?._serialized || "",
          default:     sg.groupMetadata?.isDefaultSubgroup ?? false,
        })));
      }

      console.log(LINE);
      console.log(`\n${communities.length} community(ies), ${total} subgroup(s).`);
      _exportResults(exportRows, "community,communityId,name,number,id,default");

      await client.destroy();
      process.exit(0);
    }

    let filtered;
    if      (first === "groups")   filtered = chats.filter(c => c.isGroup);
    else if (first === "contacts") filtered = chats.filter(c => !c.isGroup);
    else                           filtered = chats.filter(c => _terms.every(term => _matches(c, term)));

    if (!filtered.length) {
      console.log("No results found.");
    } else {
      const rows = filtered.map(_buildRow);

      // Resolve @lid → @c.us phone IDs in bulk
      const lidRows = rows.filter(r => !r.group && r.id.endsWith("@lid"));
      if (lidRows.length) {
        try {
          const phoneMap = await client.pupPage.evaluate((ids) => {
            const result = {};
            for (const id of ids) {
              try {
                const wid   = window.Store.WidFactory.createWid(id);
                const phone = window.Store.LidUtils.getPhoneNumber(wid);
                result[id]  = phone?._serialized ?? null;
              } catch (_) { result[id] = null; }
            }
            return result;
          }, lidRows.map(r => r.id));
          for (const row of lidRows) row.phone = phoneMap[row.id] || null;
        } catch (_) { /* LID resolution unavailable */ }
      }

      _printTable(rows);
      _exportResults(rows);
    }

    await client.destroy();
    process.exit(0);
  }
  // ── Normal boot ────────────────────────────────────────────────────────────

  logger.success(t("system.connected"));
  logger.info(t("system.clientId", { id: CLIENT_ID }));

  printBanner();

  await loadPlugins(PLUGINS);
  await setupPlugins(client);

  // buffer anti-replay / sync ghost messages
  setTimeout(() => {
    setState("READY");
  }, 2000);
});

client.on("message_create", async (msg) => {
  if (state !== "READY") return;

  if (!msg.body && !msg.hasMedia) return;

  try {
    await handleMessage(msg);
  } catch (err) {
    logger.error(
      `${err.message}\n${err.stack}`
    );
  }
});

client.on("disconnected", (reason) => {

  logger.warn(
    t("system.disconnected", { reason })
  );

  if (
    String(reason)
      .includes("LOGOUT")
  ) {
    return;
  }

  setTimeout(() => {
    client.initialize();
  }, 5000);

});

// -- Events ----------------------------------------------------
client.on("code", (code) => {
  handlePairingCode(code);
});

client.on("qr", (qr) => {
  handleQR(qr);
});

client.initialize();
logger.info(t("bot.initialized"));
