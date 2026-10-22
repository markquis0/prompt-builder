import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePaid } from "../middleware/requirePaid.js";
import { critiqueLimiter } from "../middleware/scoreRateLimit.js";
import { shareLimiter } from "../middleware/shareRateLimit.js";
import { llm } from "../lib/llm.js";
import { stripCodeFences } from "../lib/jsonUtils.js";
import { isValidCritiquePayload, totalScore, MAX_SCORE } from "../lib/critique.js";
import { getImproveSystemPrompt, buildImproveUserMessage, IMPROVE_META_PROMPT_VERSION } from "../lib/prompts.js";
import { parsePagination } from "../lib/pagination.js";
import { parseAssembledPrompt } from "../lib/promptObject.js";
import { loadPrompt, UUID_RE } from "../lib/promptAccess.js";
import {
  addVersion,
  createPromptWithFirstVersion,
  TITLE_MAX_LENGTH,
  VersionError,
} from "../lib/promptVersions.js";

const router = Router();

// Same ceiling score.js already applies to an assembled prompt.
const MAX_CONTENT_LENGTH = 20000;
const MAX_CHANGE_NOTE_LENGTH = 500;

const anyAccess = loadPrompt({}, pool);
const ownerOnly = loadPrompt({ ownerOnly: true }, pool);

// One SELECT shape for every version read, so the summary/full sanitizers
// below always have is_current and the restored-from number available.
// Authorization is NOT done here — callers have already resolved access to
// the parent prompt (loadPrompt), and a version is only ever looked up
// *within* that prompt, so a version id/number alone grants nothing.
const VERSION_SELECT = `
  SELECT v.*, r.version_number AS restored_from_version_number,
         (p.current_version_id = v.id) AS is_current
  FROM prompt_versions v
  JOIN prompts p ON p.id = v.prompt_id
  LEFT JOIN prompt_versions r ON r.id = v.restored_from_version_id
`;

// `title` in the API, `name` in the database — see schema.sql.
function sanitizePrompt(row) {
  return {
    id: row.id,
    title: row.name,
    promptType: row.prompt_type,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ownerName(row) {
  return `${row.owner_first_name || ""} ${row.owner_last_name || ""}`.trim();
}

// `via` says which route(s) gave a viewer access — direct share, a team, or
// both. They're equivalent (both read-only); it's here so the UI can say
// "Official Team Prompt" vs "Shared by".
function sanitizeAccess(row) {
  return {
    role: row.role,
    via: { direct: Boolean(row.via_direct), team: Boolean(row.via_team) },
    owner: { name: ownerName(row) },
  };
}

// Everything except the bodies — what the version-history list renders.
function sanitizeVersionSummary(row) {
  return {
    id: row.id,
    promptId: row.prompt_id,
    versionNumber: row.version_number,
    changeNote: row.change_note,
    source: row.source,
    parentVersionId: row.parent_version_id,
    restoredFromVersionId: row.restored_from_version_id,
    restoredFromVersionNumber: row.restored_from_version_number,
    isCurrent: row.is_current,
    createdAt: row.created_at,
  };
}

// A viewer gets the prompt itself (text + its parsed sections, which is what
// the model tabs render from) but NOT what it was generated from: the
// owner's original rough prompt, their Q&A answers and any pasted supporting
// context can contain material they never meant to hand to a teammate.
function sanitizeVersion(row, role) {
  const version = {
    ...sanitizeVersionSummary(row),
    content: row.content,
    promptObject: row.prompt_object,
  };
  if (role === "owner") {
    version.originalPrompt = row.original_prompt;
    version.qaPairs = row.qa_pairs;
    version.supportingContext = row.supporting_context;
    version.sessionId = row.session_id;
  }
  return version;
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

// --- Lists ---------------------------------------------------------------

router.get("/", requireAuth, async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  try {
    const { rows } = await pool.query(
      `SELECT p.*, cv.version_number AS current_version_number,
              (SELECT COUNT(*)::int FROM prompt_versions WHERE prompt_id = p.id) AS version_count,
              (SELECT COUNT(*)::int FROM prompt_shares WHERE prompt_id = p.id) AS share_count,
              -- Real, stored activity: how many people built their own prompt
              -- from this one ("Build on this"), via copy provenance.
              (SELECT COUNT(*)::int FROM prompts c WHERE c.copied_from_prompt_id = p.id) AS build_count,
              ARRAY(
                SELECT t.name FROM team_prompts tp JOIN teams t ON t.id = tp.team_id
                WHERE tp.prompt_id = p.id ORDER BY t.name
              ) AS team_names
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
        shareCount: row.share_count,
        buildCount: row.build_count,
        teamNames: row.team_names,
      })),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts error:", err);
    res.status(500).json({ error: "Failed to load prompts. Please try again." });
  }
});

// Registered before /:id so "shared" isn't parsed as a prompt id.
router.get("/shared", requireAuth, async (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name,
              s.created_at AS shared_at, cv.version_number AS current_version_number,
              (SELECT COUNT(*)::int FROM prompt_versions WHERE prompt_id = p.id) AS version_count
       FROM prompt_shares s
       JOIN prompts p ON p.id = s.prompt_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN prompt_versions cv ON cv.id = p.current_version_id
       WHERE s.shared_with_user_id = $1
       ORDER BY p.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );
    res.json({
      prompts: rows.map((row) => ({
        ...sanitizePrompt(row),
        currentVersionNumber: row.current_version_number,
        versionCount: row.version_count,
        sharedBy: { name: ownerName(row) },
        sharedAt: row.shared_at,
      })),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/shared error:", err);
    res.status(500).json({ error: "Failed to load shared prompts. Please try again." });
  }
});

// --- One prompt ----------------------------------------------------------

router.get("/:id", requireAuth, anyAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [req.prompt.current_version_id]);
    // The teams this prompt is an official prompt of — all of them for its
    // owner, and only the ones the viewer belongs to for everyone else
    // (membership in other teams isn't theirs to see).
    const { rows: teamRows } = await pool.query(
      `SELECT t.id, t.name
       FROM team_prompts tp
       JOIN teams t ON t.id = tp.team_id
       WHERE tp.prompt_id = $1
         AND ($2 OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.user_id = $3))
       ORDER BY t.name`,
      [req.prompt.id, req.prompt.role === "owner", req.userId]
    );
    res.json({
      prompt: sanitizePrompt(req.prompt),
      access: sanitizeAccess(req.prompt),
      teams: teamRows,
      currentVersion: rows[0] ? sanitizeVersion(rows[0], req.prompt.role) : null,
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id error:", err);
    res.status(500).json({ error: "Failed to load prompt. Please try again." });
  }
});

// Rename. Metadata only — never creates a version, and deliberately doesn't
// touch updated_at (that's "last time the prompt's content changed", which is
// what History sorts and labels by).
router.patch("/:id", requireAuth, ownerOnly, async (req, res) => {
  const { title } = req.body || {};
  if (typeof title !== "string") {
    return res.status(400).json({ error: "A 'title' is required." });
  }
  // Collapse runs of whitespace/newlines: a title is one line.
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return res.status(400).json({ error: "A title can't be empty." });
  }
  if (cleaned.length > TITLE_MAX_LENGTH) {
    return res.status(400).json({ error: `Titles can be up to ${TITLE_MAX_LENGTH} characters.` });
  }
  try {
    const { rows } = await pool.query("UPDATE prompts SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *", [
      cleaned,
      req.prompt.id,
      req.userId,
    ]);
    if (!rows[0]) {
      return res.status(404).json({ error: "Prompt not found." });
    }
    res.json({ prompt: sanitizePrompt(rows[0]) });
  } catch (err) {
    console.error("[prompt-builder] PATCH /api/prompts/:id error:", err);
    res.status(500).json({ error: "Failed to rename prompt. Please try again." });
  }
});

// --- Versions ------------------------------------------------------------

router.get("/:id/versions", requireAuth, anyAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.prompt_id = $1 ORDER BY v.version_number DESC`, [
      req.prompt.id,
    ]);
    res.json({ versions: rows.map(sanitizeVersionSummary) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id/versions error:", err);
    res.status(500).json({ error: "Failed to load version history. Please try again." });
  }
});

router.get("/:id/versions/:number", requireAuth, anyAccess, async (req, res) => {
  const number = parseVersionNumber(req.params.number);
  if (number === null) {
    return res.status(404).json({ error: "Version not found." });
  }
  try {
    const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.prompt_id = $1 AND v.version_number = $2`, [
      req.prompt.id,
      number,
    ]);
    if (!rows[0]) {
      return res.status(404).json({ error: "Version not found." });
    }
    res.json({ version: sanitizeVersion(rows[0], req.prompt.role) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id/versions/:number error:", err);
    res.status(500).json({ error: "Failed to load version. Please try again." });
  }
});

// "Save new version": the owner edited the prompt text and is saving it as
// the next version. The generation inputs (original prompt, answers,
// supporting context) carry forward unchanged from the current version —
// editing the text doesn't change what it was generated from.
//
// The saved content is the canonical (Generic) text. Claude/ChatGPT/Gemini
// are renderings of a version's parsed sections (prompt_object, re-derived
// here from the text), not separately versioned things.
router.post("/:id/versions", requireAuth, ownerOnly, async (req, res) => {
  const { content, changeNote, source, baseVersionNumber } = req.body || {};
  if (typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'content' is required." });
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({
      error: `Prompt exceeds ${MAX_CONTENT_LENGTH.toLocaleString()} character limit.`,
    });
  }
  // Only two sources can arrive here: a hand edit, or an accepted Improve
  // suggestion. Anything else is a plain edit rather than an error.
  const versionSource = source === "improved" ? "improved" : "edited";
  const hasBase = baseVersionNumber !== undefined && baseVersionNumber !== null;
  if (hasBase && !Number.isInteger(baseVersionNumber)) {
    return res.status(400).json({ error: "Invalid baseVersionNumber." });
  }

  const result = await withTransaction(res, "POST /api/prompts/:id/versions", (client) =>
    addVersion(client, {
      promptId: req.prompt.id,
      userId: req.userId,
      buildVersion: (current) => {
        const note = validateChangeNote(changeNote);
        // A suggestion was generated from a specific version; if the prompt
        // has moved on since (another tab, a restore), saving it as the next
        // version would silently discard those newer changes.
        if (hasBase && current && current.version_number !== baseVersionNumber) {
          throw new VersionError(
            409,
            "This prompt changed since the suggestion was made. Run Improve again on the latest version."
          );
        }
        if (current && current.content === content) {
          throw new VersionError(409, "This matches the current version — nothing to save.");
        }
        return {
          content,
          promptObject: parseAssembledPrompt(content),
          originalPrompt: current?.original_prompt,
          qaPairs: current?.qa_pairs,
          supportingContext: current?.supporting_context,
          changeNote: note || (versionSource === "improved" ? "Improved with PromptMe suggestions" : null),
          source: versionSource,
        };
      },
    })
  );
  if (result === undefined) return; // withTransaction already responded
  if (result === null) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [result.version.id]);
  res.status(201).json({ version: sanitizeVersion(rows[0], "owner") });
});

// Restore never rewrites history: it copies an old version's content into a
// brand-new latest version that records where it came from. Older versions
// (including everything between the restored one and now) stay as they are.
router.post("/:id/versions/:number/restore", requireAuth, ownerOnly, async (req, res) => {
  const number = parseVersionNumber(req.params.number);
  if (number === null) {
    return res.status(404).json({ error: "Version not found." });
  }
  const { changeNote } = req.body || {};

  const result = await withTransaction(res, "POST /api/prompts/:id/versions/:number/restore", (client) =>
    addVersion(client, {
      promptId: req.prompt.id,
      userId: req.userId,
      buildVersion: async (current) => {
        const note = validateChangeNote(changeNote);
        const { rows } = await client.query(
          "SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version_number = $2",
          [req.prompt.id, number]
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
          source: "restored",
        };
      },
    })
  );
  if (result === undefined) return;
  if (result === null) {
    return res.status(404).json({ error: "Prompt not found." });
  }
  const { rows } = await pool.query(`${VERSION_SELECT} WHERE v.id = $1`, [result.version.id]);
  res.status(201).json({ version: sanitizeVersion(rows[0], "owner") });
});

// --- Improve this prompt -------------------------------------------------

// One model call that grades the prompt with the same rubric as the Pro
// critique AND proposes a rewrite — see getImproveSystemPrompt. Nothing is
// saved here: the suggestion comes back for the owner to review as a diff,
// optionally edit, and explicitly accept (POST /:id/versions with
// source "improved"). It improves the canonical Generic text; the
// Claude/ChatGPT/Gemini views are re-derived from whatever gets saved.
//
// Pro-only like the existing critique (it spends the same paid model call),
// owner-only (a viewer must "Build on this" first and improve their own
// copy), and sharing the critique's per-user hourly budget.
router.post("/:id/improve", requirePaid, ownerOnly, critiqueLimiter, async (req, res) => {
  const { versionNumber } = req.body || {};
  let wanted = null;
  if (versionNumber !== undefined && versionNumber !== null) {
    wanted = parseVersionNumber(String(versionNumber));
    if (wanted === null) {
      return res.status(400).json({ error: "Invalid version number." });
    }
  }

  try {
    const { rows } =
      wanted === null
        ? await pool.query("SELECT * FROM prompt_versions WHERE id = $1", [req.prompt.current_version_id])
        : await pool.query("SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version_number = $2", [
            req.prompt.id,
            wanted,
          ]);
    const base = rows[0];
    if (!base) {
      return res.status(404).json({ error: "Version not found." });
    }

    const raw = await llm.call({
      system: getImproveSystemPrompt(),
      userMessage: buildImproveUserMessage({ prompt: base.content }),
      maxTokens: 3072,
      timeoutMs: 30000,
    });

    let parsed;
    try {
      parsed = JSON.parse(stripCodeFences(raw));
    } catch {
      console.error("[prompt-builder] Failed to parse improve JSON:", raw);
      return res.status(502).json({ error: "The model returned a response we couldn't parse. Please try again." });
    }
    const improved = parsed?.improvedPrompt;
    if (
      !isValidCritiquePayload(parsed) ||
      typeof improved !== "string" ||
      improved.trim().length === 0 ||
      improved.length > MAX_CONTENT_LENGTH ||
      // A usable rewrite still has a <task> — otherwise it isn't a prompt
      // in this app's format and shouldn't be offered.
      !parseAssembledPrompt(improved).task
    ) {
      console.error("[prompt-builder] Improve payload failed validation:", parsed);
      return res.status(502).json({ error: "The model returned an unexpected response. Please try again." });
    }

    res.json({
      baseVersionNumber: base.version_number,
      baseIsCurrent: base.id === req.prompt.current_version_id,
      critique: {
        dimensions: parsed.dimensions,
        score: totalScore(parsed.dimensions),
        maxScore: MAX_SCORE,
      },
      improvedContent: improved.trim(),
      unchanged: improved.trim() === base.content.trim(),
      improveVersion: IMPROVE_META_PROMPT_VERSION,
    });
  } catch (err) {
    console.error("[prompt-builder] POST /api/prompts/:id/improve error:", err);
    res.status(500).json({ error: "Failed to improve this prompt. Please try again." });
  }
});

// --- Copy ("Build on this" / "Save a copy") -----------------------------

// Creates a brand-new prompt owned by the caller, whose v1 is the chosen
// version (default: current) of this one. Independent from then on —
// nothing the copier does touches the original. Works for an owner copying
// their own prompt and for a shared viewer.
//
// A viewer's copy carries the prompt text only, not the owner's generation
// inputs (see sanitizeVersion) — so it starts with no Q&A of its own.
router.post("/:id/copy", requireAuth, anyAccess, async (req, res) => {
  const { versionNumber } = req.body || {};
  let wanted = null;
  if (versionNumber !== undefined && versionNumber !== null) {
    wanted = parseVersionNumber(String(versionNumber));
    if (wanted === null) {
      return res.status(400).json({ error: "Invalid version number." });
    }
  }
  const keepInputs = req.prompt.role === "owner";

  const created = await withTransaction(res, "POST /api/prompts/:id/copy", async (client) => {
    const { rows } =
      wanted === null
        ? await client.query("SELECT * FROM prompt_versions WHERE id = $1", [req.prompt.current_version_id])
        : await client.query("SELECT * FROM prompt_versions WHERE prompt_id = $1 AND version_number = $2", [
            req.prompt.id,
            wanted,
          ]);
    const source = rows[0];
    if (!source) throw new VersionError(404, "Version not found.");

    return createPromptWithFirstVersion(client, {
      userId: req.userId,
      name: req.prompt.name,
      promptType: req.prompt.prompt_type,
      copiedFromPromptId: req.prompt.id,
      copiedFromVersionId: source.id,
      version: {
        content: source.content,
        promptObject: source.prompt_object,
        originalPrompt: keepInputs ? source.original_prompt : req.prompt.name,
        qaPairs: keepInputs ? source.qa_pairs : null,
        supportingContext: keepInputs ? source.supporting_context : null,
        changeNote: `Saved a copy of "${req.prompt.name}" (v${source.version_number})`,
        source: "copied",
      },
    });
  });
  if (created === undefined) return;
  res.status(201).json({
    prompt: {
      id: created.promptId,
      title: req.prompt.name,
      versionId: created.version.id,
      versionNumber: created.version.version_number,
      versionCreatedAt: created.version.created_at,
    },
  });
});

// --- Sharing (owner only) ------------------------------------------------

function sanitizeShare(row) {
  return {
    id: row.id,
    permission: row.permission,
    createdAt: row.created_at,
    user: { id: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email },
  };
}

const SHARE_SELECT = `
  SELECT s.id, s.permission, s.created_at, u.id AS user_id, u.first_name, u.last_name, u.email
  FROM prompt_shares s
  JOIN users u ON u.id = s.shared_with_user_id
`;

router.get("/:id/shares", requireAuth, ownerOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(`${SHARE_SELECT} WHERE s.prompt_id = $1 ORDER BY s.created_at`, [
      req.prompt.id,
    ]);
    res.json({ shares: rows.map(sanitizeShare) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/prompts/:id/shares error:", err);
    res.status(500).json({ error: "Failed to load sharing. Please try again." });
  }
});

router.post("/:id/shares", requireAuth, ownerOnly, shareLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
    return res.status(400).json({ error: "Enter the email address of a PromptMe account." });
  }
  // Same normalization signup/login use, so lookups match stored emails.
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows: userRows } = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (!userRows[0]) {
      return res.status(404).json({ error: "No PromptMe account exists for that email yet." });
    }
    if (userRows[0].id === req.userId) {
      return res.status(400).json({ error: "That's your own prompt — you already have access." });
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO prompt_shares (prompt_id, shared_with_user_id, permission)
       VALUES ($1, $2, 'viewer')
       ON CONFLICT (prompt_id, shared_with_user_id) DO NOTHING
       RETURNING id`,
      [req.prompt.id, userRows[0].id]
    );
    if (!inserted[0]) {
      return res.status(409).json({ error: "This prompt is already shared with that person." });
    }
    const { rows } = await pool.query(`${SHARE_SELECT} WHERE s.id = $1`, [inserted[0].id]);
    res.status(201).json({ share: sanitizeShare(rows[0]) });
  } catch (err) {
    console.error("[prompt-builder] POST /api/prompts/:id/shares error:", err);
    res.status(500).json({ error: "Failed to share prompt. Please try again." });
  }
});

router.delete("/:id/shares/:shareId", requireAuth, ownerOnly, async (req, res) => {
  if (!UUID_RE.test(req.params.shareId)) {
    return res.status(404).json({ error: "Share not found." });
  }
  try {
    // Scoped to this prompt, so an owner can't remove shares on someone
    // else's prompt by guessing a share id.
    const { rowCount } = await pool.query("DELETE FROM prompt_shares WHERE id = $1 AND prompt_id = $2", [
      req.params.shareId,
      req.prompt.id,
    ]);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Share not found." });
    }
    res.json({ removed: true });
  } catch (err) {
    console.error("[prompt-builder] DELETE /api/prompts/:id/shares/:shareId error:", err);
    res.status(500).json({ error: "Failed to remove access. Please try again." });
  }
});

export default router;
