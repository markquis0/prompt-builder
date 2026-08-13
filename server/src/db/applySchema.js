import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Every statement in schema.sql is IF-NOT-EXISTS, so this is safe to call on
// every boot — not just once. That matters here specifically because the
// Render free tier doesn't include Shell access, so there's no manual
// `npm run db:migrate` step available; the schema has to apply itself.
export async function applySchema() {
  if (!process.env.DATABASE_URL) {
    console.warn("[prompt-builder] Skipping schema apply — DATABASE_URL not set.");
    return;
  }
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("[prompt-builder] Schema applied successfully.");
}
