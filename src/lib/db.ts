import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as sqliteSchema from "./schema-sqlite";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema: sqliteSchema });

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

export const isPostgres = false;

/** Returns an ISO-8601 timestamp string for SQLite text date columns. */
export function now(): string {
  return new Date().toISOString();
}
