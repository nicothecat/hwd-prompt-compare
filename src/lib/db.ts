import { drizzle as drizzleSqlite, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema-sqlite";

// --- SQLite setup ---
// SQLite (better-sqlite3, rollback-journal/DELETE mode) is the sole storage
// backend. Zero-config: the database lives at ./data/local.db and is
// created on first run. Not WAL mode — see the comment in createSqliteDb.
function createSqliteDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const fs = require("fs");
  const path = require("path");

  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "local.db");

  let sqlite: InstanceType<typeof Database>;
  try {
    sqlite = new Database(dbPath);

    // NOTE: WAL mode was tried here and reverted (2026-07-06). On this app's
    // Docker deployment, ./data is a host bind mount, and Next.js's dev
    // server (Turbopack) instantiates this module separately per API route
    // — each instance opens its own better-sqlite3 handle to the same file.
    // WAL mode requires a shared-memory (.db-shm, mmap'd) index across every
    // handle, and that mmap-based coordination does not work across
    // separate handles on this bind mount: any handle opened after the
    // first throws SQLITE_CANTOPEN. Confirmed by reproduction: a second
    // handle to a WAL-mode file on this mount fails to open 100% of the
    // time (15/15 retries over 15s), while a second handle to the same file
    // in the default DELETE (rollback-journal) mode opens and reads/writes
    // successfully every time. Concretely this caused (a) GET
    // /api/runs/[id] to 500 with an HTML page on its first (cold-compiled)
    // request, because the crash happened at module-evaluation time —
    // before the route handler's own try/catch could run — and (b) any
    // external reader (host-side sqlite queries, docker exec, etc.) opened
    // against the live file while the app held it open would also fail to
    // open and could be mistaken for "the run never persisted" when the
    // row was in fact committed and visible via the app's own API.
    // DELETE mode gives up WAL's multi-writer throughput, which this
    // single-container local tool doesn't need, in exchange for actually
    // working on this filesystem.
    sqlite.pragma("journal_mode = DELETE");
  } catch (err) {
    console.error(
      `[db] Failed to open or configure SQLite database at ${dbPath}:`,
      err
    );
    throw err;
  }

  return drizzleSqlite(sqlite, { schema: sqliteSchema });
}

// --- Global singleton ---
type DbInstance = BetterSQLite3Database<typeof sqliteSchema>;

const globalForDb = globalThis as unknown as {
  db: DbInstance | undefined;
};

function getDb(): DbInstance {
  if (globalForDb.db) return globalForDb.db;

  const instance = createSqliteDb();

  if (process.env.NODE_ENV !== "production") {
    globalForDb.db = instance;
  }

  return instance;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = getDb();

// Re-export the schema's tables so routes import from one place.
export const brands = sqliteSchema.brands;
export const models = sqliteSchema.models;
export const prompts = sqliteSchema.prompts;
export const runs = sqliteSchema.runs;
export const runBrands = sqliteSchema.runBrands;
export const responses = sqliteSchema.responses;
export const parsedComparisons = sqliteSchema.parsedComparisons;
export const sources = sqliteSchema.sources;
export const conceptScores = sqliteSchema.conceptScores;
export const visibilityRuns = sqliteSchema.visibilityRuns;
export const visibilityResponses = sqliteSchema.visibilityResponses;

// Retained (const false) so existing consumers keep compiling; there is no
// longer a Postgres path.
export const isPostgres = false;

/** Returns an ISO-8601 timestamp string for SQLite text date columns. */
export function now(): string {
  return new Date().toISOString();
}
