import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { parsePagination } from "../lib/pagination.js";
import { parseAssembledPrompt } from "../lib/promptObject.js";
import { addVersion, VersionError } from "../lib/promptVersions.js";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same ceiling score.js already applies to an assembled prompt.
const MAX_CONTENT_LENGTH = 20000;
const MAX_CHANGE_NOTE_LENGTH = 500;

// One SELECT shape for every version read, so the summary/full sanitizers
// below always have is_current and the restored-from number available.
const VERSION_SELECT = `
  SELECT v.*, r.version_number AS restored_from_version_number,
         (p.current_version_id = v.id) AS is_current
  FROM prompt_versions v
  JOIN prompts p ON p.id = v.prompt_id
  LEFT JOIN prompt_versions r ON r.id = v.restored_from_version_id
`;

function sanitizePrompt(row) {
  return {
    id: row.id,
    name: row.name,
    promptType: row.prompt_type,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Everything except the bodies — what the version-history list renders.
function sanitizeVersionSummary(row) {
  return {
    id: row.id,
    promptId: row.prompt_id,
    versionNumber: row.version_number,
    changeNote: row.change_note,
    parentVersionId: row.parent_version_id,
    restoredFromVersionId: row.restored_from_version_id,
    restoredFromVersionNumber: row.restored_from_version_number,
    isCurrent: row.is_current,
    createdAt: row.created_at,
  };
}

function sanitizeVersion(row) {
  return {
    ...sanitizeVersionSummary(row),
    content: row.content,
    promptObject: row.prompt_object,
    originalPrompt: row.original_prompt,
    qaPairs: row.qa_pairs,
    supportingContext: row.supporting_context,
    sessionId: row.session_id,
  };
}

function parseVersionNumber(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === raw ? n : null;
}

function validateChangeNote(changeNote) {
  if (changeNote === undefined || changeNote === null || changeNote === "") return null;
  if (typeof changeNote !== "string" || changeNote.length > MAX_CHANGE_NOTE_LENGTH) {
    throw new VersionError(400, `Change note must be ${MAX_CHANGE_NOTE_LENGTH} characters or fewer.`);
  }
  return changeNote.trim() || null;
}

// Runs fn inside a transaction on a dedicated client. VersionError becomes
// its HTTP status; anything else is a 500 and is logged.
async function withTransaction(res, label, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof VersionError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(`[prompt-builder] ${label} error:`, err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
    return undefined;
  } finally {
    client.release();
  }
}

router.get("/", requireAuth, async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  try {
    const { rows } = await pool.query(
      `SELECT p.*, cv.version_number AS current_version_number,
              (SELECT COUNT(*)::int FROM prompt_versions WHERE prompt_id = p.id) AS version_count
       FROM prompts p
       LEFT JOIN prompt_versions cv ON cv.id = p.current_version_id
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );
    res.json({
      prompts: rows.map((row) => ({
        ...sanitizePrompt(row),
        currentVersionNumber: row.current_version_number,
        versionCount: row.version_count,
      })),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts error:", err);
    res.status(500).json({ error: "Failed to load prompts. Please try again." });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM prompts WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    const prompt = rows[0];
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }
    const { rows: versionRows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [
      prompt.current_version_id,
    ]);
    res.json({
      prompt: sanitizePrompt(prompt),
      currentVersion: versionRows[0] ? sanitizeVersion(versionRows[0]) : null,
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id error:", err);
    res.status(500).json({ error: "Failed to load prompt. Please try again." });
  }
});

router.get("/:id/versions", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  try {
    const { rows: owned } = await pool.query("SELECT 1 FROM prompts WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.userId,
    ]);
    if (owned.length === 0) {
      return res.status(404).json({ error: "Prompt not found." });
    }
    const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.prompt_id = $1 ORDER BY v.version_number DESC`, [
      req.params.id,
    ]);
    res.json({ versions: rows.map(sanitizeVersionSummary) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id/versions error:", err);
    res.status(500).json({ error: "Failed to load version history. Please try again." });
  }
});

router.get("/:id/versions/:number", requireAuth, async (req, res) => {
  const number = parseVersionNumber(req.params.number);
  if (!UUID_RE.test(req.params.id) || number === null) {
    return res.status(404).json({ error: "Version not found." });
  }
  try {
    const { rows } = await pool.query(
      `${VERSION_SELECT} WHERE v.prompt_id = $1 AND v.version_number = $2 AND p.user_id = $3`,
      [req.params.id, number, req.userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Version not found." });
    }
    res.json({ version: sanitizeVersion(rows[0]) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id/versions/:number error:", err);
    res.status(500).json({ error: "Failed to load version. Please try again." });
  }
});

// "Save new version": the user edited the prompt text and is saving it as
// the next version. The generation inputs (original prompt, answers,
// supporting context) carry forward unchanged from the current version —
// editing the text doesn't change what it was generated from.
router.post("/:id/versions", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  const { content, changeNote } = req.body || {};
  if (typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'content' is required." });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({
      error: `Prompt exceeds ${MAX_CONTENT_LENGTH.toLocaleString()} character limit.`,
    });
  }

  const result = await withTransaction(res, "POST /api/prompts/:id/versions", (client) =>
    addVersion(client, {
      promptId: req.params.id,
      userId: req.userId,
      buildVersion: (current) => {
        const note = validateChangeNote(changeNote);
        if (current && current.content === content) {
          throw new VersionError(409, "This matches the current version — nothing to save.");
        }
        return {
          content,
          promptObject: parseAssembledPrompt(content),
          originalPrompt: current?.original_prompt,
          qaPairs: current?.qa_pairs,
          supportingContext: current?.supporting_context,
          changeNote: note,
        };
      },
    })
  );
  if (result === undefined) return; // withTransaction already responded
  if (result === null) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [result.version.id]);
  res.status(201).json({ version: sanitizeVersion(rows[0]) });
});

// Restore never rewrites history: it copies an old version's content into a
// brand-new latest version that records where it came from. Older versions
// (including everything between the restored one and now) stay as they are.
router.post("/:id/versions/:number/restore", requireAuth, async (req, res) => {
  const number = parseVersionNumber(req.params.number);
  if (!UUID_RE.test(req.params.id) || number === null) {
    return res.status(404).json({ error: "Version not found." });
  }
  const { changeNote } = req.body || {};

  const result = await withTransaction(res, "POST /api/prompts/:id/versions/:number/restore", (client) =>
    addVersion(client, {
      promptId: req.params.id,
      userId: req.userId,
      buildVersion: async (current) => {
        const note = validateChangeNote(changeNote);
        const { rows } = await client.query(
          "SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version_number = $2",
          [req.params.id, number]
        );
        const target = rows[0];
        if (!target) throw new VersionError(404, "Version not found.");
        if (current && target.id === current.id) {
          throw new VersionError(409, "That's already the current version.");
        }
        return {
          content: target.content,
          promptObject: target.prompt_object,
          originalPrompt: target.original_prompt,
          qaPairs: target.qa_pairs,
          supportingContext: target.supporting_context,
          changeNote: note || `Restored from v${target.version_number}`,
          restoredFromVersionId: target.id,
        };
      },
    })
  );
  if (result === undefined) return;
  if (result === null) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [result.version.id]);
  res.status(201).json({ version: sanitizeVersion(rows[0]) });
});

export default router;
