import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkPermission,
  clearCooldowns,
  matchId,
  matchesAny,
  type PermissionContext
} from "./commandPermissions.js";
import { resolvePermissions, type CommandEntry } from "./commandRegistry.js";
import type { CommandPermissions, CommandMessages } from "./commandsConfig.js";

function senderOf(pn: string): { lid: string | null; pn: string | null } {
  return { lid: null, pn };
}

function createMockContext(overrides?: Partial<PermissionContext>): PermissionContext {
  return {
    isGroup: false,
    chatId: "123456789@c.us",
    sender: senderOf("5511999999999@c.us"),
    isSenderAdmin: async () => false,
    isBotAdmin: async () => false,
    ...overrides,
  };
}

function createMockEntry(
  specPerms?: CommandPermissions | null,
  specMsgs?: CommandMessages | null,
  pluginPerms?: CommandPermissions | null,
  defaultsPerms?: CommandPermissions | null,
  defaultsMsgs?: CommandMessages | null
): CommandEntry {
  const permissions = resolvePermissions(
    specPerms,
    specMsgs,
    pluginPerms,
    defaultsPerms,
    defaultsMsgs
  );
  return {
    id: "test::command",
    cmd: "test",
    aliases: [],
    desc: "Test command",
    category: null,
    group: null,
    manual: null,
    source: "plugin",
    pluginName: "testPlugin",
    function: null,
    functions: [],
    loading: null,
    handler: async () => "ok",
    text: null,
    permissions,
    arguments: [],
    subcommands: {},
    categoryHiddenInScope: null,
    hiddenOutsideScope: null,
  };
}

describe("commandPermissions", () => {
  test("matching utilities (matchId, matchesAny)", () => {
    assert.equal(matchId("5511999999999@c.us", "5511999999999"), true);
    assert.equal(matchId("5511999999999@s.whatsapp.net", "5511999999999@c.us"), true);
    assert.equal(matchId("5511999999999", "5511888888888"), false);
    assert.equal(matchesAny("5511999999999@c.us", ["5511888888888", "5511999999999"]), true);
    assert.equal(matchesAny("5511777777777@c.us", ["5511888888888", "5511999999999"]), false);
  });

  test("permission resolution hierarchy (yaml > plugin > defaults)", () => {
    const entry = createMockEntry(
      { admin: true, cooldownSeconds: 10 },
      { senderNotAdmin: "Admin only!" },
      { admin: false, botAdmin: true },
      { cooldownSeconds: 60 },
      { senderNotAdmin: "Default admin msg", botNotAdmin: "Default bot admin msg" }
    );

    assert.equal(entry.permissions.admin, true); // yaml overrides plugin
    assert.equal(entry.permissions.botAdmin, true); // from plugin
    assert.equal(entry.permissions.cooldownSeconds, 10); // yaml overrides global default
    assert.equal(entry.permissions.messages.senderNotAdmin, "Admin only!"); // yaml msg overrides default
    assert.equal(entry.permissions.messages.botNotAdmin, "Default bot admin msg"); // fallback to global default msg
  });

  test("owner permission check", async () => {
    const ownerEntry = createMockEntry({ owner: true }, { ownerOnly: "Only owner allowed" });
    const nonOwnerCtx = createMockContext({ sender: senderOf("5511888888888@c.us") });

    // When OWNER_NUMBER is not set or sender does not match
    const res = await checkPermission(ownerEntry, nonOwnerCtx);
    assert.equal(res.allowed, false);
    if (!res.allowed) assert.equal(res.message, "Only owner allowed");
  });

  test("scope permission check", async () => {
    const groupEntry = createMockEntry({ scope: "group" }, { wrongScope: "Group only" });
    const dmEntry = createMockEntry({ scope: "dm" }, { wrongScope: "DM only" });

    const dmCtx = createMockContext({ isGroup: false });
    const groupCtx = createMockContext({ isGroup: true, chatId: "12036301234567890@g.us" });

    const res1 = await checkPermission(groupEntry, dmCtx);
    assert.equal(res1.allowed, false);
    if (!res1.allowed) assert.equal(res1.message, "Group only");

    const res2 = await checkPermission(groupEntry, groupCtx);
    assert.equal(res2.allowed, true);

    const res3 = await checkPermission(dmEntry, groupCtx);
    assert.equal(res3.allowed, false);
    if (!res3.allowed) assert.equal(res3.message, "DM only");

    const res4 = await checkPermission(dmEntry, dmCtx);
    assert.equal(res4.allowed, true);
  });

  test("dono permission check (specific-owner JID, independent of OWNER_NUMBER)", async () => {
    const donoEntry = createMockEntry(
      { dono: "5511999999999@c.us" },
      { donoOnly: "Only the dono can use this" }
    );

    const nonDonoCtx = createMockContext({ sender: senderOf("5511888888888@c.us") });
    const res1 = await checkPermission(donoEntry, nonDonoCtx);
    assert.equal(res1.allowed, false);
    if (!res1.allowed) assert.equal(res1.message, "Only the dono can use this");

    const donoCtx = createMockContext({ sender: senderOf("5511999999999@c.us") });
    const res2 = await checkPermission(donoEntry, donoCtx);
    assert.equal(res2.allowed, true);
  });

  test("dono check accepts either LID or PN form of the sender", async () => {
    const donoEntry = createMockEntry({ dono: "5511999999999" });
    const lidOnlyCtx = createMockContext({ sender: { lid: "5511999999999@lid", pn: null } });

    assert.equal((await checkPermission(donoEntry, lidOnlyCtx)).allowed, true);
  });

  test("allowedChats check (closed list of chats the command may run in)", async () => {
    const entry = createMockEntry(
      { allowedChats: ["120363111111111111@g.us"] },
      { allowedChats: "This command doesn't run here" }
    );

    const allowedCtx = createMockContext({ isGroup: true, chatId: "120363111111111111@g.us" });
    const disallowedCtx = createMockContext({ isGroup: true, chatId: "120363999999999999@g.us" });

    const resAllowed = await checkPermission(entry, allowedCtx);
    assert.equal(resAllowed.allowed, true);

    const resDisallowed = await checkPermission(entry, disallowedCtx);
    assert.equal(resDisallowed.allowed, false);
    if (!resDisallowed.allowed) assert.equal(resDisallowed.message, "This command doesn't run here");
  });

  test("allowedChats check is skipped entirely when the list is empty/unset", async () => {
    const entry = createMockEntry({ allowedChats: [] });
    const anyChatCtx = createMockContext({ isGroup: true, chatId: "120363000000000000@g.us" });

    assert.equal((await checkPermission(entry, anyChatCtx)).allowed, true);
  });

  test("blacklist check", async () => {
    const entry = createMockEntry({
      blacklist: {
        groups: ["120363999999999999@g.us"],
        users: ["5511888888888@c.us"],
      },
    });

    const blacklistedUserCtx = createMockContext({ sender: senderOf("5511888888888@c.us") });
    const blacklistedGroupCtx = createMockContext({ isGroup: true, chatId: "120363999999999999@g.us" });
    const allowedCtx = createMockContext({ sender: senderOf("5511999999999@c.us") });

    assert.equal((await checkPermission(entry, blacklistedUserCtx)).allowed, false);
    assert.equal((await checkPermission(entry, blacklistedGroupCtx)).allowed, false);
    assert.equal((await checkPermission(entry, allowedCtx)).allowed, true);
  });

  test("whitelist check", async () => {
    const entry = createMockEntry({
      whitelist: {
        groups: ["120363111111111111@g.us"],
        users: ["5511999999999@c.us"],
      },
    });

    const whitelistedUserCtx = createMockContext({ sender: senderOf("5511999999999@c.us") });
    const unwhitelistedUserCtx = createMockContext({ sender: senderOf("5511888888888@c.us") });

    assert.equal((await checkPermission(entry, whitelistedUserCtx)).allowed, true);
    assert.equal((await checkPermission(entry, unwhitelistedUserCtx)).allowed, false);
  });

  test("admin and botAdmin checks", async () => {
    const adminEntry = createMockEntry({ admin: true }, { senderNotAdmin: "Need admin" });
    const botAdminEntry = createMockEntry({ botAdmin: true }, { botNotAdmin: "Need bot admin" });

    const nonAdminGroupCtx = createMockContext({
      isGroup: true,
      isSenderAdmin: async () => false,
      isBotAdmin: async () => false,
    });

    const adminGroupCtx = createMockContext({
      isGroup: true,
      isSenderAdmin: async () => true,
      isBotAdmin: async () => true,
    });

    const resAdmin = await checkPermission(adminEntry, nonAdminGroupCtx);
    assert.equal(resAdmin.allowed, false);
    if (!resAdmin.allowed) assert.equal(resAdmin.message, "Need admin");

    const resBotAdmin = await checkPermission(botAdminEntry, nonAdminGroupCtx);
    assert.equal(resBotAdmin.allowed, false);
    if (!resBotAdmin.allowed) assert.equal(resBotAdmin.message, "Need bot admin");

    assert.equal((await checkPermission(adminEntry, adminGroupCtx)).allowed, true);
    assert.equal((await checkPermission(botAdminEntry, adminGroupCtx)).allowed, true);
  });

  test("cooldown check and state consumption", async () => {
    clearCooldowns();
    const entry = createMockEntry({ cooldownSeconds: 30 }, { cooldown: "Wait {{seconds}}s" });
    const ctx = createMockContext({ sender: senderOf("5511999999999@c.us") });

    // First invocation passes and sets cooldown
    const res1 = await checkPermission(entry, ctx);
    assert.equal(res1.allowed, true);

    // Immediate second invocation fails
    const res2 = await checkPermission(entry, ctx);
    assert.equal(res2.allowed, false);
    if (!res2.allowed) {
      assert.match(res2.message ?? "", /Wait 30s/);
    }

    // Resetting cooldown allows next call
    clearCooldowns();
    const res3 = await checkPermission(entry, ctx);
    assert.equal(res3.allowed, true);
  });

  test("evaluation order: dono is checked before allowedChats/blacklist", async () => {
    const entry = createMockEntry(
      {
        dono: "5511999999999@c.us",
        allowedChats: ["120363111111111111@g.us"],
        blacklist: { groups: [], users: ["5511888888888@c.us"] },
      },
      { donoOnly: "dono message", allowedChats: "chats message", blacklist: "blacklist message" }
    );

    // Sender fails dono AND would also fail allowedChats/blacklist — dono's
    // message must win since it's evaluated first.
    const ctx = createMockContext({
      sender: senderOf("5511888888888@c.us"),
      isGroup: true,
      chatId: "120363999999999999@g.us",
    });

    const res = await checkPermission(entry, ctx);
    assert.equal(res.allowed, false);
    if (!res.allowed) assert.equal(res.message, "dono message");
  });

  test("cooldown is NOT consumed when an earlier check fails", async () => {
    clearCooldowns();
    const entry = createMockEntry(
      { scope: "group", cooldownSeconds: 30 },
      { wrongScope: "Group only" }
    );
    const dmCtx = createMockContext({ isGroup: false });

    // Scope check fails
    const res1 = await checkPermission(entry, dmCtx);
    assert.equal(res1.allowed, false);

    // Now test in group context — first group call should pass because cooldown was never recorded
    const groupCtx = createMockContext({ isGroup: true, chatId: "120363111@g.us" });
    const res2 = await checkPermission(entry, groupCtx);
    assert.equal(res2.allowed, true);
  });
});

