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
//
// This IS actively exercised, not a hypothetical path — .github/workflows/
// check-links.yml and vendor-doc-monitor.yml both run on a schedule with
// DATABASE_SSL=true against DATABASE_URL_EXTERNAL, since GitHub's runners
// aren't on Render's private network.
//
// rejectUnauthorized: true, no custom `ca` supplied — Render's docs confirm
// TLS certs across their products (web services, static sites, custom
// domains) are issued via Let's Encrypt and Google Trust Services, both
// public CAs already in Node's default trusted root store; no evidence
// found that Postgres's external endpoint uses a different pipeline. If
// this ever starts failing with a chain-verification error (e.g. "unable
// to verify the first certificate" / "self-signed certificate in
// certificate chain"), that most likely means the server isn't sending a
// complete intermediate chain rather than a truly untrusted cert — the fix
// in that case is supplying the missing intermediate via `ca:`, not
// reverting to rejectUnauthorized: false.
const useSSL = process.env.DATABASE_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: true } : false,
});

// Without this, an error on an idle pooled client (e.g. the DB connection
// dropping entirely, not just a bad query) is an unhandled 'error' event on
// the Pool itself — Node treats that as an uncaught exception and kills the
// whole process. pg's Pool already discards and replaces a broken idle
// client the next time one is checked out; this handler's only job is to
// stop that error from being unhandled, not to reconnect or retry anything.
pool.on("error", (err) => {
  console.error("[prompt-builder] Unexpected error on idle Postgres client:", err);
});
