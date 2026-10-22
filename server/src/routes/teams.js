import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { teamMemberLimiter } from "../middleware/shareRateLimit.js";
import { loadTeam } from "../lib/teamAccess.js";
import { getPromptAccess, UUID_RE } from "../lib/promptAccess.js";

const router = Router();

const TEAM_NAME_MAX = 80;
// A backstop against someone scripting thousands of empty teams, not a
// product limit anyone should meet.
const MAX_OWNED_TEAMS = 20;

const anyMember = loadTeam({}, pool);
const ownerOnly = loadTeam({ ownerOnly: true }, pool);

function cleanName(raw) {
  if (typeof raw !== "string") return { error: "A team name is required." };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0) return { error: "A team name can't be empty." };
  if (name.length > TEAM_NAME_MAX) return { error: `Team names can be up to ${TEAM_NAME_MAX} characters.` };
  return { name };
}

function sanitizeTeam(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

// Emails are the owner's to see (they typed them to add people); members
// see names only.
function sanitizeMember(row, includeEmail) {
  return {
    id: row.membership_id,
    role: row.role,
    joinedAt: row.joined_at,
    user: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      ...(includeEmail ? { email: row.email } : {}),
    },
  };
}

const MEMBER_SELECT = `
  SELECT tm.id AS membership_id, tm.role, tm.created_at AS joined_at,
         u.id AS user_id, u.first_name, u.last_name, u.email
  FROM team_members tm
  JOIN users u ON u.id = tm.user_id
`;

// --- Teams ---------------------------------------------------------------

router.post("/", requireAuth, async (req, res) => {
  const parsed = cleanName(req.body?.name);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: countRows } = await client.query("SELECT COUNT(*)::int AS n FROM teams WHERE created_by = $1", [
      req.userId,
    ]);
    if (countRows[0].n >= MAX_OWNED_TEAMS) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `You can own up to ${MAX_OWNED_TEAMS} teams.` });
    }
    const { rows } = await client.query("INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING *", [
      parsed.name,
      req.userId,
    ]);
    // The creator is the owner — one transaction, so a team never exists
    // without its owner membership.
    await client.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [
      rows[0].id,
      req.userId,
    ]);
    await client.query("COMMIT");
    res.status(201).json({ team: { ...sanitizeTeam(rows[0]), role: "owner" } });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[prompt-builder] POST /api/teams error:", err);
    res.status(500).json({ error: "Failed to create team. Please try again." });
  } finally {
    client.release();
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, tm.role,
              (SELECT COUNT(*)::int FROM team_members WHERE team_id = t.id) AS member_count,
              (SELECT COUNT(*)::int FROM team_prompts WHERE team_id = t.id) AS prompt_count,
              ou.first_name AS owner_first_name, ou.last_name AS owner_last_name
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
       JOIN users ou ON ou.id = t.created_by
       ORDER BY t.name`,
      [req.userId]
    );
    res.json({
      teams: rows.map((row) => ({
        ...sanitizeTeam(row),
        role: row.role,
        memberCount: row.member_count,
        promptCount: row.prompt_count,
        ownerName: `${row.owner_first_name} ${row.owner_last_name}`.trim(),
      })),
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/teams error:", err);
    res.status(500).json({ error: "Failed to load teams. Please try again." });
  }
});

router.get("/:id", requireAuth, anyMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM team_members WHERE team_id = $1) AS member_count,
              (SELECT COUNT(*)::int FROM team_prompts WHERE team_id = $1) AS prompt_count,
              u.first_name, u.last_name
       FROM users u WHERE u.id = $2`,
      [req.team.id, req.team.created_by]
    );
    res.json({
      team: {
        ...sanitizeTeam(req.team),
        role: req.team.role,
        memberCount: rows[0].member_count,
        promptCount: rows[0].prompt_count,
        ownerName: `${rows[0].first_name} ${rows[0].last_name}`.trim(),
      },
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/teams/:id error:", err);
    res.status(500).json({ error: "Failed to load team. Please try again." });
  }
});

// Renaming touches the team row only — memberships and published prompts
// reference the team by id, so they're unaffected.
router.patch("/:id", requireAuth, ownerOnly, async (req, res) => {
  const parsed = cleanName(req.body?.name);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const { rows } = await pool.query("UPDATE teams SET name = $1, updated_at = now() WHERE id = $2 RETURNING *", [
      parsed.name,
      req.team.id,
    ]);
    res.json({ team: { ...sanitizeTeam(rows[0]), role: "owner" } });
  } catch (err) {
    console.error("[prompt-builder] PATCH /api/teams/:id error:", err);
    res.status(500).json({ error: "Failed to rename team. Please try again." });
  }
});

// Cascades to team_members and team_prompts only. The prompts themselves are
// owned by users, not by the team — deleting a team removes a publication,
// never a prompt.
router.delete("/:id", requireAuth, ownerOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM teams WHERE id = $1", [req.team.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error("[prompt-builder] DELETE /api/teams/:id error:", err);
    res.status(500).json({ error: "Failed to delete team. Please try again." });
  }
});

// --- Members -------------------------------------------------------------

router.get("/:id/members", requireAuth, anyMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${MEMBER_SELECT} WHERE tm.team_id = $1 ORDER BY (tm.role = 'owner') DESC, u.first_name, u.last_name`,
      [req.team.id]
    );
    res.json({ members: rows.map((row) => sanitizeMember(row, req.team.role === "owner")) });
  } catch (err) {
    console.error("[prompt-builder] GET /api/teams/:id/members error:", err);
    res.status(500).json({ error: "Failed to load members. Please try again." });
  }
});

router.post("/:id/members", requireAuth, ownerOnly, teamMemberLimiter, async (req, res) => {
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
    const { rows: inserted } = await pool.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (team_id, user_id) DO NOTHING
       RETURNING id`,
      [req.team.id, userRows[0].id]
    );
    if (!inserted[0]) {
      // Covers the owner adding themselves too — they're already a member.
      return res.status(409).json({ error: "That person is already on this team." });
    }
    const { rows } = await pool.query(`${MEMBER_SELECT} WHERE tm.id = $1`, [inserted[0].id]);
    res.status(201).json({ member: sanitizeMember(rows[0], true) });
  } catch (err) {
    console.error("[prompt-builder] POST /api/teams/:id/members error:", err);
    res.status(500).json({ error: "Failed to add member. Please try again." });
  }
});

router.delete("/:id/members/:memberId", requireAuth, ownerOnly, async (req, res) => {
  if (!UUID_RE.test(req.params.memberId)) {
    return res.status(404).json({ error: "Member not found." });
  }
  try {
    // Scoped to this team, and never the owner's own row — a team must keep
    // its owner. (To go away, an owner deletes the team.)
    const { rowCount } = await pool.query(
      "DELETE FROM team_members WHERE id = $1 AND team_id = $2 AND role = 'member'",
      [req.params.memberId, req.team.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Member not found." });
    }
    res.json({ removed: true });
  } catch (err) {
    console.error("[prompt-builder] DELETE /api/teams/:id/members/:memberId error:", err);
    res.status(500).json({ error: "Failed to remove member. Please try again." });
  }
});

// A member leaving on their own. The owner can't — they'd leave the team
// ownerless; they delete it instead (ownership transfer isn't built yet).
router.post("/:id/leave", requireAuth, anyMember, async (req, res) => {
  if (req.team.role === "owner") {
    return res.status(400).json({
      error: "You own this team, so you can't leave it. Delete the team instead.",
    });
  }
  try {
    await pool.query("DELETE FROM team_members WHERE id = $1", [req.team.membership_id]);
    res.json({ left: true });
  } catch (err) {
    console.error("[prompt-builder] POST /api/teams/:id/leave error:", err);
    res.status(500).json({ error: "Failed to leave team. Please try again." });
  }
});

// --- Team prompts --------------------------------------------------------

router.get("/:id/prompts", requireAuth, anyMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, cv.version_number AS current_version_number,
              tp.created_at AS published_at,
              (SELECT COUNT(*)::int FROM prompt_versions WHERE prompt_id = p.id) AS version_count,
              (SELECT COUNT(*)::int FROM prompts c WHERE c.copied_from_prompt_id = p.id) AS build_count,
              u.first_name AS owner_first_name, u.last_name AS owner_last_name
       FROM team_prompts tp
       JOIN prompts p ON p.id = tp.prompt_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN prompt_versions cv ON cv.id = p.current_version_id
       WHERE tp.team_id = $1
       ORDER BY p.updated_at DESC`,
      [req.team.id]
    );
    res.json({
      prompts: rows.map((row) => ({
        id: row.id,
        title: row.name,
        currentVersionNumber: row.current_version_number,
        versionCount: row.version_count,
        buildCount: row.build_count,
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
        ownerName: `${row.owner_first_name} ${row.owner_last_name}`.trim(),
      })),
    });
  } catch (err) {
    console.error("[prompt-builder] GET /api/teams/:id/prompts error:", err);
    res.status(500).json({ error: "Failed to load team prompts. Please try again." });
  }
});

// Publishes a prompt the caller OWNS to a team they own. An association, not
// a copy: members see whatever the prompt's current version is, always.
router.post("/:id/prompts", requireAuth, ownerOnly, async (req, res) => {
  const { promptId } = req.body || {};
  try {
    const prompt = await getPromptAccess(pool, req.userId, promptId);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }
    if (prompt.role !== "owner") {
      return res.status(403).json({ error: "You can only add prompts you own to a team." });
    }
    const { rows } = await pool.query(
      `INSERT INTO team_prompts (team_id, prompt_id, published_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (team_id, prompt_id) DO NOTHING
       RETURNING id`,
      [req.team.id, prompt.id, req.userId]
    );
    if (!rows[0]) {
      return res.status(409).json({ error: "This prompt is already on that team." });
    }
    res.status(201).json({ teamPrompt: { id: rows[0].id, teamId: req.team.id, promptId: prompt.id } });
  } catch (err) {
    console.error("[prompt-builder] POST /api/teams/:id/prompts error:", err);
    res.status(500).json({ error: "Failed to add prompt to team. Please try again." });
  }
});

router.delete("/:id/prompts/:promptId", requireAuth, ownerOnly, async (req, res) => {
  if (!UUID_RE.test(req.params.promptId)) {
    return res.status(404).json({ error: "Prompt not found on this team." });
  }
  try {
    const { rowCount } = await pool.query("DELETE FROM team_prompts WHERE team_id = $1 AND prompt_id = $2", [
      req.team.id,
      req.params.promptId,
    ]);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Prompt not found on this team." });
    }
    res.json({ removed: true });
  } catch (err) {
    console.error("[prompt-builder] DELETE /api/teams/:id/prompts/:promptId error:", err);
    res.status(500).json({ error: "Failed to remove prompt from team. Please try again." });
  }
});

export default router;
