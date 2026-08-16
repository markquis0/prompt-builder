import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_SESSIONS_LIMIT = 20;
const MAX_SESSIONS_LIMIT = 100;

// Clamps rather than rejects — a client asking for a huge page (or an
// invalid one) just gets capped/defaulted, same as a normal pagination API,
// not treated as a validation error the way oversized content is elsewhere
// in this codebase.
function parsePagination(query) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_SESSIONS_LIMIT) : DEFAULT_SESSIONS_LIMIT;
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

function sanitizeSession(row) {
  return {
    id: row.id,
    originalPrompt: row.original_prompt,
    qaPairs: row.qa_pairs,
    supportingContext: row.supporting_context,
    promptObject: row.prompt_object,
    rawAssembled: row.raw_assembled,
    metaPromptVersion: row.meta_prompt_version,
    category: row.category,
    deterministicScore: row.deterministic_score,
    deterministicChecks: row.deterministic_checks,
    llmCritique: row.llm_critique,
    critiqueVersion: row.critique_version,
    scoredAt: row.scored_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Only what WelcomeBackHero.jsx (the sole caller of the list endpoint)
// actually renders. The detail route below still uses the full
// sanitizeSession()/SELECT * - resuming/editing a session needs everything.
function sanitizeSessionSummary(row) {
  return {
    id: row.id,
    originalPrompt: row.original_prompt,
    createdAt: row.created_at,
  };
}

// Shared by POST / (explicit save) and POST /migrate (automatic, on
// signup) — same operation either way, per the handoff. Returns null for
// a session with no real content, so callers can no-op rather than write
// an empty row (every anonymous visitor has *something* in localStorage
// from the moment the page loads — see PromptBuilder.jsx — so "exists" and
// "has content" are different questions).
async function insertSession(userId, body) {
  const {
    originalPrompt,
    qaPairs,
    supportingContext,
    promptObject,
    rawAssembled,
    category,
    deterministicScore,
    deterministicChecks,
  } = body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return null;
  }

  const { rows } = await pool.query(
    `INSERT INTO sessions
      (user_id, original_prompt, qa_pairs, supporting_context, prompt_object, raw_assembled,
       category, deterministic_score, deterministic_checks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId,
      originalPrompt,
      JSON.stringify(Array.isArray(qaPairs) ? qaPairs : []),
      typeof supportingContext === "string" ? supportingContext : "",
      promptObject ? JSON.stringify(promptObject) : null,
      typeof rawAssembled === "string" ? rawAssembled : "",
      typeof category === "string" && category.trim() ? category.trim() : null,
      Number.isInteger(deterministicScore) ? deterministicScore : null,
      Array.isArray(deterministicChecks) ? JSON.stringify(deterministicChecks) : null,
    ]
  );
  return rows[0];
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const row = await insertSession(req.userId, req.body);
    if (!row) {
      return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
    }
    res.status(201).json({ session: sanitizeSession(row) });
  } catch (err) {
    console.error("[prompt-builder] POST /api/sessions error:", err);
    res.status(500).json({ error: "Failed to save session. Please try again." });
  }
});

router.get("/", requireAuth, async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  try {
    const { rows } = await pool.query(
      "SELECT id, original_prompt, created_at FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [req.userId, limit, offset]
    );
    res.json({ sessions: rows.map(sanitizeSessionSummary), limit, offset });
  } catch (err) {
    console.error("[prompt-builder] GET /api/sessions error:", err);
    res.status(500).json({ error: "Failed to load sessions. Please try again." });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Session not found." });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM sessions WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    const row = rows[0];
    if (!row) {
      // Same response whether it doesn't exist or belongs to someone else —
      // don't let this endpoint confirm other users' session IDs.
      return res.status(404).json({ error: "Session not found." });
    }
    res.json({ session: sanitizeSession(row) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/sessions/:id error:", err);
    res.status(500).json({ error: "Failed to load session. Please try again." });
  }
});

// Triggered automatically right after signup (see AuthContext.jsx), not by
// a conscious user action — so this is silent/best-effort by design. A
// missing or failed migration should never surface as an error in the UI;
// it just means there was nothing worth saving, or it'll be tried again
// next time they complete a build while logged in.
router.post("/migrate", requireAuth, async (req, res) => {
  try {
    const row = await insertSession(req.userId, req.body);
    if (!row) {
      return res.status(200).json({ migrated: false });
    }
    res.status(201).json({ migrated: true, session: sanitizeSession(row) });
  } catch (err) {
    console.error("[prompt-builder] POST /api/sessions/migrate error:", err);
    res.status(200).json({ migrated: false });
  }
});

export default router;
