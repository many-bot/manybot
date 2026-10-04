/**
 * kernel/telemetryDb.ts
 *
 * Pseudonymous, aggregate-only telemetry backed by SQLite (separate file
 * from settings.db — different lifecycle/consumer, dashboard tooling
 * reads this independently).
 *
 * Tables:
 *   instance       — one row, identifies this installation
 *   user           — one row per hashed lid, first/last seen (no message content)
 *   group          — one row per hashed group jid, join/leave timestamps
 *                    (joined_at is NULL when the join time is unknown, e.g.
 *                    a group first seen through an account scan)
 *   group_sync     — one row, when the last successful account scan ran
 *   telemetry_salt — one row, per-installation salt used to hash lid/jid
 *   message_stats  — one row, running "processed" counter
 *   plugin         — one row per plugin key, version/enabled state
 *
 * All timestamps are stored as unix epoch seconds (UTC by construction —
 * `unixepoch()` is timezone-independent). Local-time rendering belongs to
 * the presentation/dashboard layer, never here.
 *
 * lid/jid are never persisted in clear: ids are HMAC-SHA256(salt, lid|jid),
 * where the salt is random, generated once per installation and never exposed.
 * No message content is ever persisted by this module.
 */

import { DatabaseSync } from "node:sqlite";
import path      from "path";
import crypto    from "crypto";
import { mkdirSync } from "fs";
import { logger }    from "#logger";
import { CONFIG_DIR } from "#config";

export interface InstanceInfo {
  instanceId:     string;
  startedAt:      number;
  manybotVersion: string;
  backend:        string;
  backendVersion: string;
}

export interface UserInfo {
  id:        string;
  firstSeen: number;
  lastSeen:  number;
}

export interface GroupInfo {
  id:       string;
  joinedAt: number | null;
  leftAt:   number | null;
}

export interface GroupSyncResult {
  /** True when an empty scan was ignored because active groups exist (partial/failed fetch assumed). */
  skipped:     boolean;
  added:       number;
  reactivated: number;
  closed:      number;
  active:      number;
}

export interface PluginInfo {
  key:     string;
  version: string;
  enabled: boolean;
}

const DB_PATH = process.env.NODE_ENV === "test" ? ":memory:" : path.join(CONFIG_DIR, "telemetry.db");

type Stmts = {
  getInstance:       ReturnType<DatabaseSync["prepare"]>;
  upsertInstance:    ReturnType<DatabaseSync["prepare"]>;

  touchUserNew:      ReturnType<DatabaseSync["prepare"]>;
  getUser:           ReturnType<DatabaseSync["prepare"]>;

  joinGroup:         ReturnType<DatabaseSync["prepare"]>;
  leaveGroup:        ReturnType<DatabaseSync["prepare"]>;
  getGroup:          ReturnType<DatabaseSync["prepare"]>;
  allGroups:         ReturnType<DatabaseSync["prepare"]>;
  insertSyncedGroup: ReturnType<DatabaseSync["prepare"]>;
  reactivateGroup:   ReturnType<DatabaseSync["prepare"]>;
  closeGroup:        ReturnType<DatabaseSync["prepare"]>;
  countActiveGroups: ReturnType<DatabaseSync["prepare"]>;
  getGroupSyncedAt:  ReturnType<DatabaseSync["prepare"]>;
  setGroupSyncedAt:  ReturnType<DatabaseSync["prepare"]>;

  incrementProcessed: ReturnType<DatabaseSync["prepare"]>;
  getProcessed:       ReturnType<DatabaseSync["prepare"]>;

  upsertPlugin:      ReturnType<DatabaseSync["prepare"]>;
  setPluginEnabled:  ReturnType<DatabaseSync["prepare"]>;
  getPlugin:         ReturnType<DatabaseSync["prepare"]>;
  getAllPlugins:     ReturnType<DatabaseSync["prepare"]>;
};

// Lazy open — same rationale as settingsDb.ts: importing this module must
// not touch disk or leave an idle WAL connection on bots that never read
// telemetry back.
const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

let dbInstance: DatabaseSync | null = null;
let stmts: Stmts | null = null;
let salt = "";
let checkpointTimer: NodeJS.Timeout | null = null;

function checkpoint(): void {
  if (!dbInstance) return;
  try {
    dbInstance.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    logger.warn(`[telemetryDb] wal checkpoint failed: ${(err as Error).message}`);
  }
}

/** Flush and stop the checkpoint timer (process shutdown). Safe if the DB was never opened. */
export function stopTelemetryDb(): void {
  if (checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
  checkpoint();
}

function hashId(raw: string): string {
  return crypto.createHmac("sha256", salt).update(raw).digest("hex");
}

function migrateHashedIds(db: DatabaseSync): void {
  const renameColumn = (table: string, oldCol: string): void => {
    const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(oldCol)) return;
    const rows = db.prepare(`SELECT "${oldCol}" AS raw FROM "${table}"`).all() as { raw: string }[];
    db.exec("BEGIN");
    try {
      db.exec(`ALTER TABLE "${table}" RENAME COLUMN "${oldCol}" TO id`);
      const update = db.prepare(`UPDATE "${table}" SET id = ? WHERE id = ?`);
      for (const { raw } of rows) update.run(hashId(raw), raw);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
  renameColumn("user", "lid");
  renameColumn("group", "jid");
}

const SCHEMA_VERSION = 1;

/** v1: group.joined_at becomes nullable (unknown join time is stored as NULL instead of a fabricated timestamp). */
function makeGroupJoinedAtNullable(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info("group")').all() as { name: string; notnull: number }[];
  if (!cols.some((c) => c.name === "joined_at" && c.notnull === 1)) return;
  db.exec(`
    CREATE TABLE "group_v1" (
      id          TEXT PRIMARY KEY,
      joined_at   INTEGER,
      left_at     INTEGER
    );
    INSERT INTO "group_v1" (id, joined_at, left_at) SELECT id, joined_at, left_at FROM "group";
    DROP TABLE "group";
    ALTER TABLE "group_v1" RENAME TO "group";
  `);
}

/** Versioned via PRAGMA user_version so each step runs exactly once, regardless of what columns exist later. */
function migrateSchema(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= SCHEMA_VERSION) return;
  db.exec("BEGIN");
  try {
    if (version < 1) makeGroupJoinedAtNullable(db);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function getStmts(): Stmts {
  if (stmts) return stmts;

  if (DB_PATH !== ":memory:") {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  dbInstance = db;

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS instance (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      instance_id     TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      manybot_version TEXT NOT NULL,
      backend         TEXT NOT NULL,
      backend_version TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry_salt (
      id   INTEGER PRIMARY KEY CHECK (id = 1),
      salt TEXT NOT NULL
    );
    INSERT OR IGNORE INTO telemetry_salt (id, salt) VALUES (1, lower(hex(randomblob(32))));

    CREATE TABLE IF NOT EXISTS user (
      id          TEXT PRIMARY KEY,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "group" (
      id          TEXT PRIMARY KEY,
      joined_at   INTEGER,
      left_at     INTEGER
    );

    CREATE TABLE IF NOT EXISTS group_sync (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      synced_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_stats (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      processed   INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO message_stats (id, processed) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS plugin (
      key     TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);

  salt = (db.prepare("SELECT salt FROM telemetry_salt WHERE id = 1").get() as { salt: string }).salt;
  migrateHashedIds(db);
  migrateSchema(db);

  const pluginCols = (db.prepare("PRAGMA table_info(plugin)").all() as { name: string }[]).map((c) => c.name);
  if (pluginCols.includes("installed_at")) db.exec("ALTER TABLE plugin DROP COLUMN installed_at");
  if (pluginCols.includes("active"))       db.exec("ALTER TABLE plugin RENAME COLUMN active TO enabled");

  stmts = {
    getInstance: db.prepare(
      "SELECT instance_id, started_at, manybot_version, backend, backend_version FROM instance WHERE id = 1"
    ),
    upsertInstance: db.prepare(`
      INSERT INTO instance (id, instance_id, started_at, manybot_version, backend, backend_version)
      VALUES (1, ?, unixepoch(), ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        started_at      = unixepoch(),
        manybot_version = excluded.manybot_version,
        backend         = excluded.backend,
        backend_version = excluded.backend_version
    `),

    touchUserNew: db.prepare(`
      INSERT INTO user (id, first_seen, last_seen)
      VALUES (?, unixepoch(), unixepoch())
      ON CONFLICT (id) DO UPDATE SET last_seen = unixepoch()
    `),
    getUser: db.prepare(
      "SELECT id, first_seen, last_seen FROM user WHERE id = ?"
    ),

    // Re-fires harmlessly for groups the bot is already in (e.g. every
    // "groups.upsert" on reconnect history-sync): joined_at only moves
    // forward on a genuine rejoin (previous left_at was set).
    joinGroup: db.prepare(`
      INSERT INTO "group" (id, joined_at, left_at)
      VALUES (?, unixepoch(), NULL)
      ON CONFLICT (id) DO UPDATE SET
        joined_at = CASE WHEN "group".left_at IS NOT NULL THEN unixepoch() ELSE "group".joined_at END,
        left_at   = NULL
    `),
    leaveGroup: db.prepare(`
      INSERT INTO "group" (id, joined_at, left_at)
      VALUES (?, NULL, unixepoch())
      ON CONFLICT (id) DO UPDATE SET left_at = unixepoch()
    `),
    getGroup: db.prepare(
      'SELECT id, joined_at, left_at FROM "group" WHERE id = ?'
    ),
    allGroups: db.prepare(
      'SELECT id, joined_at, left_at FROM "group"'
    ),
    insertSyncedGroup: db.prepare(
      'INSERT INTO "group" (id, joined_at, left_at) VALUES (?, NULL, NULL)'
    ),
    reactivateGroup: db.prepare(
      'UPDATE "group" SET joined_at = NULL, left_at = NULL WHERE id = ?'
    ),
    closeGroup: db.prepare(
      'UPDATE "group" SET left_at = unixepoch() WHERE id = ?'
    ),
    countActiveGroups: db.prepare(
      'SELECT COUNT(*) AS n FROM "group" WHERE left_at IS NULL'
    ),
    getGroupSyncedAt: db.prepare(
      "SELECT synced_at FROM group_sync WHERE id = 1"
    ),
    setGroupSyncedAt: db.prepare(`
      INSERT INTO group_sync (id, synced_at) VALUES (1, ?)
      ON CONFLICT (id) DO UPDATE SET synced_at = excluded.synced_at
    `),

    incrementProcessed: db.prepare(
      "UPDATE message_stats SET processed = processed + 1 WHERE id = 1"
    ),
    getProcessed: db.prepare(
      "SELECT processed FROM message_stats WHERE id = 1"
    ),

    upsertPlugin: db.prepare(`
      INSERT INTO plugin (key, version, enabled)
      VALUES (?, ?, 1)
      ON CONFLICT (key) DO UPDATE SET version = excluded.version
    `),
    setPluginEnabled: db.prepare(
      "UPDATE plugin SET enabled = ? WHERE key = ?"
    ),
    getPlugin: db.prepare(
      "SELECT key, version, enabled FROM plugin WHERE key = ?"
    ),
    getAllPlugins: db.prepare(
      "SELECT key, version, enabled FROM plugin"
    ),
  };

  if (DB_PATH !== ":memory:") {
    checkpointTimer = setInterval(checkpoint, CHECKPOINT_INTERVAL_MS);
    checkpointTimer.unref();
  }

  return stmts;
}

// ── instance ─────────────────────────────────────────────────────────────────

/** Call once on startup: updates started_at and version/backend info, generating instance_id on first run and keeping it afterwards. */
export function recordInstanceStartup(manybotVersion: string, backend: string, backendVersion: string): void {
  const row = getStmts().getInstance.get() as { instance_id: string } | undefined;
  const instanceId = row?.instance_id ?? crypto.randomUUID();
  getStmts().upsertInstance.run(instanceId, manybotVersion, backend, backendVersion);
}

export function getInstanceInfo(): InstanceInfo | null {
  const row = getStmts().getInstance.get() as
    | { instance_id: string; started_at: number; manybot_version: string; backend: string; backend_version: string }
    | undefined;
  if (!row) return null;
  return {
    instanceId:     row.instance_id,
    startedAt:      row.started_at,
    manybotVersion: row.manybot_version,
    backend:        row.backend,
    backendVersion: row.backend_version,
  };
}

// ── user ─────────────────────────────────────────────────────────────────────

/** Records a processed interaction from `lid` (stored only as a salted hash): sets first_seen on first call, always bumps last_seen. */
export function touchUser(lid: string): void {
  getStmts().touchUserNew.run(hashId(lid));
}

export function getUserInfo(lid: string): UserInfo | null {
  const row = getStmts().getUser.get(hashId(lid)) as { id: string; first_seen: number; last_seen: number } | undefined;
  if (!row) return null;
  return { id: row.id, firstSeen: row.first_seen, lastSeen: row.last_seen };
}

// ── group ────────────────────────────────────────────────────────────────────

/** Records the bot joining `jid`. Re-joining after a previous leave resets left_at to NULL. */
export function recordGroupJoin(jid: string): void {
  getStmts().joinGroup.run(hashId(jid));
}

/** Records the bot leaving `jid`. The row is never deleted. */
export function recordGroupLeave(jid: string): void {
  getStmts().leaveGroup.run(hashId(jid));
}

export function getGroupInfo(jid: string): GroupInfo | null {
  const row = getStmts().getGroup.get(hashId(jid)) as { id: string; joined_at: number | null; left_at: number | null } | undefined;
  if (!row) return null;
  return { id: row.id, joinedAt: row.joined_at, leftAt: row.left_at };
}

/**
 * Reconciles the `group` table with a full account scan (`jids` = every group
 * the bot currently participates in). `snapshotAt` (unix seconds) MUST be
 * captured before the scan starts: join/leave events recorded at or after it
 * are newer than the scan and win over it, so a group joined mid-fetch is not
 * closed and one left mid-fetch is not reactivated.
 *
 * - unknown group in the scan   → inserted active, joined_at NULL
 * - closed group in the scan    → reactivated (joined_at reset to NULL: the real rejoin time is unknown)
 * - active group not in the scan → closed
 * - empty scan while groups are active → ignored (`skipped`): a failed or partial
 *   fetch must not close everything. Missing a real "left every group" is the lesser evil.
 *
 * Runs in one transaction; `active` is the count after the changes.
 *
 * Caller contract: scans must be serialized (never two `syncGroups` for
 * overlapping fetches). Protection of rows created mid-fetch relies on
 * `joined_at >= snapshotAt`, which only event-created rows carry; a row
 * with `joined_at` NULL inserted by a concurrent scan looks like an older
 * one and would be closed. `syncGroupTelemetry` enforces this with its
 * `running` guard — call that, not this, from production code.
 */
export function syncGroups(jids: string[], snapshotAt: number): GroupSyncResult {
  const s  = getStmts();
  const db = dbInstance!;
  const seen = new Set(jids.map(hashId));
  const result: GroupSyncResult = { skipped: false, added: 0, reactivated: 0, closed: 0, active: 0 };

  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = s.allGroups.all() as { id: string; joined_at: number | null; left_at: number | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const activeRows = rows.filter((r) => r.left_at === null);

    if (seen.size === 0 && activeRows.length > 0) {
      result.skipped = true;
      result.active  = activeRows.length;
      db.exec("COMMIT");
      return result;
    }

    for (const id of seen) {
      const row = byId.get(id);
      if (!row) {
        s.insertSyncedGroup.run(id);
        result.added++;
      } else if (row.left_at !== null && row.left_at < snapshotAt) {
        s.reactivateGroup.run(id);
        result.reactivated++;
      }
    }

    for (const row of activeRows) {
      if (seen.has(row.id)) continue;
      if (row.joined_at !== null && row.joined_at >= snapshotAt) continue;
      s.closeGroup.run(row.id);
      result.closed++;
    }

    result.active = (s.countActiveGroups.get() as { n: number }).n;
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Unix seconds of the last successful account scan, or `null` if none ran yet. Persisted, so it survives restarts. */
export function getGroupSyncedAt(): number | null {
  const row = getStmts().getGroupSyncedAt.get() as { synced_at: number } | undefined;
  return row?.synced_at ?? null;
}

export function markGroupSynced(at: number): void {
  getStmts().setGroupSyncedAt.run(at);
}

// ── message_stats ────────────────────────────────────────────────────────────

export function incrementProcessedMessages(): void {
  getStmts().incrementProcessed.run();
}

export function getProcessedMessageCount(): number {
  const row = getStmts().getProcessed.get() as { processed: number } | undefined;
  return row?.processed ?? 0;
}

// ── plugin ───────────────────────────────────────────────────────────────────

/** Registers/updates an installed plugin. Always marks enabled. */
export function upsertPlugin(key: string, version: string): void {
  getStmts().upsertPlugin.run(key, version);
}

export function setPluginEnabled(key: string, enabled: boolean): void {
  getStmts().setPluginEnabled.run(enabled ? 1 : 0, key);
}

export function getPluginInfo(key: string): PluginInfo | null {
  const row = getStmts().getPlugin.get(key) as
    | { key: string; version: string; enabled: number }
    | undefined;
  if (!row) return null;
  return { key: row.key, version: row.version, enabled: !!row.enabled };
}

export function getAllPlugins(): PluginInfo[] {
  const rows = getStmts().getAllPlugins.all() as
    { key: string; version: string; enabled: number }[];
  return rows.map((r) => ({ key: r.key, version: r.version, enabled: !!r.enabled }));
}
