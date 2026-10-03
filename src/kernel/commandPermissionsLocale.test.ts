import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkPermission } from "#kernel/commandPermissions.js";
import { resolvePermissions, type CommandEntry } from "#kernel/commandRegistry.js";
import { setChatLocale, clearChatLocale } from "#kernel/chatOverrides.js";
import { tFor } from "#i18n";

const chatId = "5511955554444@c.us";

function entryWith(msgs?: { senderNotAdmin?: string }): CommandEntry {
  return {
    cmd: "x",
    pluginName: "t",
    permissions: resolvePermissions({ admin: true, scope: "any" }, msgs as never),
  } as unknown as CommandEntry;
}

const ctx = {
  isGroup: true,
  chatId,
  sender: { lid: null, pn: "5511900001111@c.us" },
  isSenderAdmin: async () => false,
  isBotAdmin: async () => true,
};

describe("checkPermission default messages follow the chat language", () => {
  beforeEach(() => clearChatLocale(chatId));

  test("uses the chat's locale for built-in default messages", async () => {
    setChatLocale(chatId, "es");
    const res = await checkPermission(entryWith(), ctx);
    assert.deepEqual(res, { allowed: false, message: tFor("es", "commandPermissions.senderNotAdmin") });
    setChatLocale(chatId, "pt");
    const res2 = await checkPermission(entryWith(), ctx);
    assert.deepEqual(res2, { allowed: false, message: tFor("pt", "commandPermissions.senderNotAdmin") });
  });

  test("keeps custom (YAML) messages untouched", async () => {
    setChatLocale(chatId, "es");
    const res = await checkPermission(entryWith({ senderNotAdmin: "Admin only!" }), ctx);
    assert.deepEqual(res, { allowed: false, message: "Admin only!" });
  });

  test("owner-only denial has no default message (silent) and keeps a configured one literal", async () => {
    const ownerEntry = (msgs?: { ownerOnly?: string }) =>
      ({
        cmd: "x",
        pluginName: "t",
        permissions: resolvePermissions({ owner: true, scope: "any" }, msgs as never),
      }) as unknown as CommandEntry;

    setChatLocale(chatId, "es");
    assert.deepEqual(await checkPermission(ownerEntry(), ctx), { allowed: false, message: undefined });
    assert.deepEqual(await checkPermission(ownerEntry({ ownerOnly: "Owners only" }), ctx), {
      allowed: false,
      message: "Owners only",
    });
  });
});

