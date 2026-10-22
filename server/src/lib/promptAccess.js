// The one place that decides who can touch a prompt. A user can reach a
// prompt by up to three routes:
//
//   owner          — prompts.user_id matches
//   direct share   — an explicit prompt_shares row for this user
//   team           — membership in a team the prompt is published to
//
// Effective access is the strongest of whatever routes exist: owner, else
// viewer, else none. Both viewer routes are read-only and equivalent, so a
// user holding both is simply a viewer — and losing one route while the other
// remains changes nothing. Access is only denied when every route is gone.
//
// Every /api/prompts route resolves access through here (via loadPrompt
// below), and versions only ever resolve *within* an already-authorized
// prompt, so a version id/number alone never grants anything. "No access" is
// deliberately indistinguishable from "doesn't exist" (a 404 either way), so
// probing IDs confirms nothing.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the prompt row plus:
//   role        'owner' | 'viewer'
//   via_direct  true if an individual share exists for this user
//   via_team    true if a team the user belongs to has the prompt published
// and the owner's name — or null if this user has no access (or the id isn't
// a UUID).
export async function getPromptAccess(db, userId, promptId) {
  if (typeof promptId !== "string" || !UUID_RE.test(promptId)) return null;
  const { rows } = await db.query(
    `SELECT p.*,
            u.first_name AS owner_first_name,
            u.last_name  AS owner_last_name,
            CASE WHEN p.user_id = $1 THEN 'owner' ELSE 'viewer' END AS role,
            EXISTS (
              SELECT 1 FROM prompt_shares s
              WHERE s.prompt_id = p.id AND s.shared_with_user_id = $1
            ) AS via_direct,
            EXISTS (
              SELECT 1 FROM team_prompts tp
              JOIN team_members tm ON tm.team_id = tp.team_id
              WHERE tp.prompt_id = p.id AND tm.user_id = $1
            ) AS via_team
     FROM prompts p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = $2
       AND (
         p.user_id = $1
         OR EXISTS (SELECT 1 FROM prompt_shares s WHERE s.prompt_id = p.id AND s.shared_with_user_id = $1)
         OR EXISTS (
           SELECT 1 FROM team_prompts tp
           JOIN team_members tm ON tm.team_id = tp.team_id
           WHERE tp.prompt_id = p.id AND tm.user_id = $1
         )
       )`,
    [userId, promptId]
  );
  return rows[0] || null;
}

// Express middleware for routes with a :id param. Attaches req.prompt (with
// .role). Default allows owner or viewer; { ownerOnly: true } is for anything
// that changes the prompt, who can see it, or spends the owner's AI budget.
export function loadPrompt({ ownerOnly = false } = {}, db) {
  return async function loadPromptMiddleware(req, res, next) {
    try {
      const prompt = await getPromptAccess(db, req.userId, req.params.id);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found." });
      }
      if (ownerOnly && prompt.role !== "owner") {
        return res.status(403).json({ error: "Only the owner of this prompt can do that." });
      }
      req.prompt = prompt;
      next();
    } catch (err) {
      console.error("[prompt-builder] prompt access check error:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  };
}
