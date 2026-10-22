import { UUID_RE } from "./promptAccess.js";

// Team counterpart of promptAccess.js: a user is the team's 'owner', a
// 'member', or has no access (404 — same "indistinguishable from not
// existing" rule as prompts). Returns the team row plus the caller's `role`.
export async function getTeamAccess(db, userId, teamId) {
  if (typeof teamId !== "string" || !UUID_RE.test(teamId)) return null;
  const { rows } = await db.query(
    `SELECT t.*, tm.role, tm.id AS membership_id
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
     WHERE t.id = $2`,
    [userId, teamId]
  );
  return rows[0] || null;
}

// Express middleware for routes with a :id team param. Attaches req.team.
// { ownerOnly: true } for everything that changes the team or what it holds.
export function loadTeam({ ownerOnly = false } = {}, db) {
  return async function loadTeamMiddleware(req, res, next) {
    try {
      const team = await getTeamAccess(db, req.userId, req.params.id);
      if (!team) {
        return res.status(404).json({ error: "Team not found." });
      }
      if (ownerOnly && team.role !== "owner") {
        return res.status(403).json({ error: "Only the team owner can do that." });
      }
      req.team = team;
      next();
    } catch (err) {
      console.error("[prompt-builder] team access check error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}
