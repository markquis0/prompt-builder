import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "[prompt-builder] DATABASE_URL is not set — auth/session routes will fail. Set it once Postgres is provisioned."
  );
}

// Render's Internal Database URL (same-region, private network) doesn't need
// SSL. Only the External Database URL does. If you're pointed at the
// external URL for any reason, set DATABASE_SSL=true to switch this on.
const useSSL = process.env.DATABASE_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});
