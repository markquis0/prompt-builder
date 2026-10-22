import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { parsePagination } from "../lib/pagination.js";
import { addVersion, createPromptWithFirstVersion, promptNameFrom, VersionError } from "../lib/promptVersions.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
//
// Also records the generation as prompt version history: a new prompt with
// a v1, or — when the client sends the promptId of the prompt being
// reworked ("Edit answers" on an opened prompt) — the next version of that
// one. Both writes share a transaction so a session row never exists
// pointing at a half-created prompt. A session with no assembled text yet
// (a half-finished intake) is saved as before but doesn't become a prompt.
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
    promptId,
  } = body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
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
    const row = rows[0];

    let prompt = null;
    if (row.raw_assembled.trim() !== "") {
      const version = {
        content: row.raw_assembled,
        promptObject: row.prompt_object,
        originalPrompt: row.original_prompt,
        qaPairs: row.qa_pairs,
        supportingContext: row.supporting_context,
        sessionId: row.id,
      };
      let created;
      if (promptId !== undefined && promptId !== null) {
        if (typeof promptId !== "string" || !UUID_RE.test(promptId)) {
          throw new VersionError(404, "Prompt not found.");
        }
        created = await addVersion(client, {
          promptId,
          userId,
          buildVersion: () => ({ ...version, changeNote: "Regenerated from updated answers" }),
        });
        if (!created) throw new VersionError(404, "Prompt not found.");
      } else {
        created = await createPromptWithFirstVersion(client, {
          userId,
          name: promptNameFrom(row.original_prompt),
          promptType: row.category,
          version,
        });
      }
      prompt = {
        id: created.promptId,
        versionId: created.version.id,
        versionNumber: created.version.version_number,
      };
    }

    await client.query("COMMIT");
    return { row, prompt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const saved = await insertSession(req.userId, req.body);
    if (!saved) {
      return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
    }
    res.status(201).json({ session: sanitizeSession(saved.row), prompt: saved.prompt });
  } catch (err) {
    if (err instanceof VersionError) {
      return res.status(err.status).json({ error: err.message });
    }
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
    const saved = await insertSession(req.userId, req.body);
    if (!saved) {
      return res.status(200).json({ migrated: false });
    }
    res.status(201).json({ migrated: true, session: sanitizeSession(saved.row), prompt: saved.prompt });
  } catch (err) {
    console.error("[prompt-builder] POST /api/sessions/migrate error:", err);
    res.status(200).json({ migrated: false });
  }
});

export default router;
