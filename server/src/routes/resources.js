import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public, no auth — same as /learn. A `moved` entry still points at real
// content (just a stale URL to fix eventually); a `broken` one doesn't, so
// it's excluded by default rather than shown with a dead link.
router.get("/", async (req, res) => {
  const { category, audience, model_family: modelFamily, q } = req.query;
  const conditions = ["verification_status != 'broken'"];
  const params = [];

  if (typeof category === "string" && category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (typeof audience === "string" && audience) {
    params.push(audience);
    conditions.push(`audience = $${params.length}`);
  }
  if (typeof modelFamily === "string" && modelFamily) {
    params.push(modelFamily);
    conditions.push(`$${params.length} = ANY(model_family)`);
  }
  if (typeof q === "string" && q) {
    params.push(`%${q}%`);
    const p = params.length;
    conditions.push(`(name ILIKE $${p} OR description ILIKE $${p} OR curation_note ILIKE $${p})`);
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, url, description, organization, category, audience,
              model_family AS "modelFamily", is_downloadable AS "isDownloadable",
              download_url AS "downloadUrl", curation_note AS "curationNote",
              verification_status AS "verificationStatus", published_at AS "publishedAt"
       FROM resources
       WHERE ${conditions.join(" AND ")}
       ORDER BY category, name`,
      params
    );
    res.json({ resources: rows });
  } catch (err) {
    console.error("[prompt-builder] GET /api/resources error:", err);
    res.status(500).json({ error: "Failed to load resources. Please try again." });
  }
});

router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Resource not found." });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, url, description, organization, category, audience,
              model_family AS "modelFamily", is_downloadable AS "isDownloadable",
              download_url AS "downloadUrl", curation_note AS "curationNote",
              verification_status AS "verificationStatus", published_at AS "publishedAt"
       FROM resources
       WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Resource not found." });
    }
    res.json({ resource: rows[0] });
  } catch (err) {
    console.error("[prompt-builder] GET /api/resources/:id error:", err);
    res.status(500).json({ error: "Failed to load resource. Please try again." });
  }
});

export default router;
