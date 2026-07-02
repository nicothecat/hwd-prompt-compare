import { drizzle as drizzleSqlite, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./schema-sqlite";

// --- SQLite setup ---
// SQLite (better-sqlite3, WAL mode) is the sole storage backend. Zero-config:
// the database lives at ./data/local.db and is created on first run.
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
  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  sqlite.pragma("journal_mode = WAL");

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
