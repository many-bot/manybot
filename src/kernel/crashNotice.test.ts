import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";
import { CONFIG } from "#config";
import { noticeRunFailure, recoverInterruptedRuns, renderNotice } from "#kernel/crashNotice.js";
import { LEGACY_ENGAGED_AFTER_MS, beginRun, takeInterruptedRuns, _startNewBootForTests, type RunOrigin } from "#kernel/runState.js";
import { getDriverManager, _resetDriverManagerForTests } from "#kernel/driverManager.js";
import { buildSettingsApi } from "#kernel/settingsDb.js";
import { normalizeJid } from "#drivers/jid.js";
import type { WaContract } from "#kernel/waContract.js";

CONFIG.LANGUAGE = "en";

interface Sent { jid: string; text: string; quoted?: { id?: string | null } }

let sent: Sent[];
let failSends: boolean;
let msgSeq = 0;

function uniqueKey(): { id: string; remoteJid: string; fromMe: boolean; participant: string } {
  return { id: `MSG-${++msgSeq}`, remoteJid: "chat@g.us", fromMe: false, participant: "sender@lid" };
}

function origin(kind: RunOrigin["kind"] = "command", overrides: Partial<RunOrigin> = {}): RunOrigin {
  return { chatId: "chat@g.us", key: uniqueKey(), command: "!sticker", kind, ...overrides };
}

beforeEach(() => {
  sent = [];
  failSends = false;
  _resetDriverManagerForTests();
  getDriverManager().register({
    name: "baileys",
    isReady: () => true,
    sendText: async (jid: string, text: string, opts?: { quoted?: { id?: string | null } }) => {
      if (failSends) throw new Error("socket closed");
      sent.push({ jid, text, quoted: opts?.quoted });
      return { id: "sent", chatId: jid, timestamp: Date.now() };
    },
  } as unknown as WaContract, { isPrimary: true });
});

afterEach(() => {
  mock.timers.reset();
  CONFIG.CRASH_NOTICE_ENABLED = true;
  CONFIG.CRASH_NOTICE_MESSAGE = "";
  CONFIG.CRASH_NOTICE_MAX_AGE_SECONDS = 600;
  _startNewBootForTests();
  takeInterruptedRuns();
  _resetDriverManagerForTests();
});

describe("kernel/crashNotice — renderNotice", () => {
  test("uses the built-in translated message with the command filled in", () => {
    assert.equal(
      renderNotice({ chatId: "chat@g.us", command: "!sticker" }, "figurinha"),
      "⚠️ Something went wrong while running !sticker. Please try again.",
    );
  });

  test("follows the chat's own language override", () => {
    buildSettingsApi("core", normalizeJid("ptchat@g.us")).set("chat_locale", "pt");
    assert.match(renderNotice({ chatId: "ptchat@g.us", command: "!f" }, "p"), /Algo deu errado ao executar !f/);
  });

  test("a configured message replaces the built-in one and interpolates placeholders", () => {
    CONFIG.CRASH_NOTICE_MESSAGE = "oops: {{command}} ({{plugin}}) {{unknown}}";
    assert.equal(renderNotice({ chatId: "chat@g.us", command: "!f" }, "figurinha"), "oops: !f (figurinha) {{unknown}}");
  });

  test("a blank configured message falls back to the built-in one", () => {
    CONFIG.CRASH_NOTICE_MESSAGE = "   ";
    assert.match(renderNotice({ chatId: "chat@g.us", command: "!f" }, "p"), /Something went wrong/);
  });
});

describe("kernel/crashNotice — noticeRunFailure", () => {
  test("a failed command run tells its chat and quotes the triggering message", async () => {
    const o = origin("command");
    const run = beginRun("figurinha", o);

    assert.equal(await noticeRunFailure(run), true);
    run.finish();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, "chat@g.us");
    assert.match(sent[0].text, /!sticker/);
    assert.equal(sent[0].quoted?.id, o.key!.id);
  });

  test("a run without an origin is never reported", async () => {
    const run = beginRun("passive");
    assert.equal(await noticeRunFailure(run), false);
    run.finish();
    assert.equal(sent.length, 0);
  });

  test("a legacy run that failed immediately is not reported, one that worked for a while is", async () => {
    // Only Date is mocked: the send guard's own sleeps must stay real.
    mock.timers.enable({ apis: ["Date"] });

    const quick = beginRun("legacy", origin("legacy"));
    assert.equal(await noticeRunFailure(quick), false);
    quick.finish();

    const slow = beginRun("legacy", origin("legacy"));
    mock.timers.tick(LEGACY_ENGAGED_AFTER_MS);
    assert.equal(await noticeRunFailure(slow), true);
    slow.finish();

    assert.equal(sent.length, 1);
  });

  test("the same message is only ever reported once", async () => {
    const o = origin("command");
    const a = beginRun("p1", o);
    const b = beginRun("p2", o);

    assert.equal(await noticeRunFailure(a), true);
    assert.equal(await noticeRunFailure(b), false);
    a.finish(); b.finish();

    assert.equal(sent.length, 1);
  });

  test("does nothing when disabled", async () => {
    CONFIG.CRASH_NOTICE_ENABLED = false;
    const run = beginRun("p", origin("command"));
    assert.equal(await noticeRunFailure(run), false);
    run.finish();
    assert.equal(sent.length, 0);
  });

  test("a failing send resolves to false instead of throwing", async () => {
    failSends = true;
    const run = beginRun("p", origin("command"));
    assert.equal(await noticeRunFailure(run), false);
    run.finish();
  });
});

describe("kernel/crashNotice — recoverInterruptedRuns", () => {
  test("tells the chat about a command the previous process never finished", async () => {
    const o = origin("command");
    beginRun("figurinha", o);
    _startNewBootForTests();

    assert.equal(await recoverInterruptedRuns(), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, "chat@g.us");
    assert.match(sent[0].text, /!sticker/);
    assert.equal(sent[0].quoted?.id, o.key!.id);
  });

  test("runs that finished normally are not reported", async () => {
    beginRun("p", origin("command")).finish();
    _startNewBootForTests();

    assert.equal(await recoverInterruptedRuns(), 0);
    assert.equal(sent.length, 0);
  });

  test("each interrupted run is reported once, even if recovery runs again", async () => {
    beginRun("p", origin("command"));
    _startNewBootForTests();

    assert.equal(await recoverInterruptedRuns(), 1);
    assert.equal(await recoverInterruptedRuns(), 0);
    assert.equal(sent.length, 1);
  });

  test("runs older than the max age are dropped silently", async () => {
    beginRun("p", origin("command"));
    _startNewBootForTests();
    CONFIG.CRASH_NOTICE_MAX_AGE_SECONDS = 60;

    assert.equal(await recoverInterruptedRuns(Date.now() + 61_000), 0);
    assert.equal(sent.length, 0);
    assert.equal(takeInterruptedRuns().length, 0, "the stale row was still consumed");
  });

  test("two plugins interrupted on the same message produce one notice", async () => {
    const o = origin("command");
    beginRun("p1", o);
    beginRun("p2", o);
    _startNewBootForTests();

    assert.equal(await recoverInterruptedRuns(), 1);
    assert.equal(sent.length, 1);
  });

  test("a chat whose send fails does not stop the others", async () => {
    beginRun("p1", origin("command", { chatId: "a@g.us" }));
    beginRun("p2", origin("command", { chatId: "b@g.us" }));
    _startNewBootForTests();
    const realSend = (getDriverManager().active() as unknown as { sendText: (j: string, t: string) => Promise<unknown> }).sendText;
    (getDriverManager().active() as unknown as { sendText: unknown }).sendText = async (jid: string, text: string) => {
      if (jid === "a@g.us") throw new Error("boom");
      return realSend(jid, text);
    };

    assert.equal(await recoverInterruptedRuns(), 1);
    assert.deepEqual(sent.map(s => s.jid), ["b@g.us"]);
  });

  test("when disabled it reports nothing but still clears the journal", async () => {
    beginRun("p", origin("command"));
    _startNewBootForTests();
    CONFIG.CRASH_NOTICE_ENABLED = false;

    assert.equal(await recoverInterruptedRuns(), 0);
    assert.equal(sent.length, 0);
    CONFIG.CRASH_NOTICE_ENABLED = true;
    assert.equal(takeInterruptedRuns().length, 0);
  });
});
