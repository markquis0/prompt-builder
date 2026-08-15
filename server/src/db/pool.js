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
// rejectUnauthorized: false is a known, currently-accepted gap (see
// Finding 9.1 in the security review — MITM risk on this specific path),
// not an oversight: Render's own docs don't document a downloadable CA
// certificate for external Postgres connections, and multiple independent
// reports of connecting node-postgres to Render's external URL describe
// rejectUnauthorized: false as required, i.e. Render's cert chain doesn't
// appear to be covered by Node's default trusted root store the way (e.g.)
// a Let's Encrypt-issued cert would be. Flipping this to `true` without a
// verified-working CA would very likely just break both scheduled
// workflows outright (TLS handshake failure) rather than close the gap.
// To fix properly: get the actual CA certificate from Render (dashboard or
// support), then set `{ rejectUnauthorized: true, ca: <cert> }` here and
// confirm both workflows still connect before relying on it.
const useSSL = process.env.DATABASE_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});
