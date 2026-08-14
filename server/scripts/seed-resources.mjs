// One-time import of the real research inventory into the `resources`
// table. Run manually (not part of the boot sequence — unlike
// seedStarterResources() in db/seedResources.js, which exists only because
// Render's free tier has no Shell to run a one-off script like this one):
//
//   cd server && npm install
//   node scripts/seed-resources.mjs /path/to/sources-inventory.csv
//
// Point it at DATABASE_URL for whichever environment you're seeding —
// local dev, or Render's EXTERNAL Database URL if running this from a
// machine that isn't on Render's private network (this script runs
// wherever you invoke it from, not on Render itself).
import "dotenv/config";
import { parse } from "csv-parse/sync";
import { readFileSync } from "node:fs";
import { pool } from "../src/db/pool.js";

const CSV_PATH = process.argv[2] || "./sources-inventory.csv";

const rows = parse(readFileSync(CSV_PATH, "utf-8"), {
  columns: true,
  skip_empty_lines: true,
});

// CSV: name, organization, category, audience, url, status,
//      download_type, download_url, model_family, notes
// DB:  name, organization, category, audience, url, verification_status,
//      is_downloadable, download_url, model_family (array), curation_note
function mapStatus(csvStatus) {
  const map = { verified: "verified", moved: "moved", stale: "stale", excluded: null };
  return map[(csvStatus || "").trim().toLowerCase()] ?? null; // null -> skip excluded/unknown rows
}

async function seed() {
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows) {
    const verificationStatus = mapStatus(row.status);
    if (!verificationStatus) {
      skipped++;
      continue;
    }
    if (!row.notes || row.notes.trim() === "") {
      console.warn(`⚠ Skipping "${row.name}" — no curation note (curation_note is NOT NULL)`);
      skipped++;
      continue;
    }

    const { rows: existing } = await pool.query("SELECT id FROM resources WHERE url = $1", [row.url]);
    if (existing.length > 0) {
      duplicates++;
      continue;
    }

    const modelFamily = row.model_family
      ? row.model_family.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    await pool.query(
      `INSERT INTO resources
        (name, url, description, organization, category, audience,
         model_family, is_downloadable, download_url, curation_note,
         source_type, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'curated',$11)`,
      [
        row.name,
        row.url,
        null,
        row.organization || null,
        row.category,
        row.audience || "practitioner",
        modelFamily,
        row.download_type === "direct",
        row.download_url || null,
        row.notes,
        verificationStatus,
      ]
    );
    inserted++;
  }

  console.log(`Seeded ${inserted} resources, skipped ${skipped}, ${duplicates} already present (by URL).`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
