// Verifies every resources.url still resolves — distinct from the vendor
// doc monitor, which detects *changed* content. This only checks the URL
// is still alive. Run weekly via .github/workflows/check-links.yml, not on
// Render — needs DATABASE_URL (the External URL, since GitHub's runners
// aren't on Render's private network) as a repo secret.
import "dotenv/config";
import { pool } from "../src/db/pool.js";

async function checkOne(url) {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    // Some sites reject HEAD but allow GET — retry before trusting a
    // non-2xx/404 result from a HEAD request.
    if (!res.ok && res.status !== 404) {
      res = await fetch(url, { method: "GET", redirect: "follow" });
    }
    if (res.ok) return "verified";
    if (res.status === 404) return "broken";
    return "stale"; // non-404 errors get a softer flag
  } catch {
    return "broken";
  }
}

async function checkLinks() {
  const { rows } = await pool.query("SELECT id, url FROM resources");
  let brokenCount = 0;

  for (const { id, url } of rows) {
    const status = await checkOne(url);
    await pool.query(
      "UPDATE resources SET verification_status = $1, last_verified_at = now() WHERE id = $2",
      [status, id]
    );
    if (status === "broken") brokenCount++;
    await new Promise((r) => setTimeout(r, 500)); // politeness delay
  }

  console.log(`Checked ${rows.length} links, ${brokenCount} broken`);
  await pool.end();
  if (brokenCount > 0) {
    // Non-zero exit so the GitHub Actions run shows as failed/flagged —
    // easy to notice without having to go read the log.
    process.exitCode = 1;
  }
}

checkLinks().catch((err) => {
  console.error(err);
  process.exit(1);
});
