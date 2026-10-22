// The one place that decides who can touch a prompt. Three outcomes:
//
//   owner   — prompts.user_id matches
//   viewer  — an explicit prompt_shares row for this user
//   (null)  — no access
//
// Every /api/prompts route resolves access through here (via loadPrompt
// below) instead of repeating ownership checks, and versions inherit their
// parent prompt's access — a version id or number alone never grants
// anything. "No access" is deliberately indistinguishable from "doesn't
// exist" (a 404 either way), so probing IDs confirms nothing.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the prompt row plus `role` ('owner' | 'viewer') and the owner's
// name, or null if this user has no access (or the id isn't a UUID).
export async function getPromptAccess(db, userId, promptId) {
  if (typeof promptId !== "string" || !UUID_RE.test(promptId)) return null;
  const { rows } = await db.query(
    `SELECT p.*,
            u.first_name AS owner_first_name,
            u.last_name  AS owner_last_name,
            CASE WHEN p.user_id = $1 THEN 'owner' ELSE 'viewer' END AS role
     FROM prompts p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN prompt_shares s ON s.prompt_id = p.id AND s.shared_with_user_id = $1
     WHERE p.id = $2 AND (p.user_id = $1 OR s.id IS NOT NULL)`,
    [userId, promptId]
  );
  return rows[0] || null;
}

// Express middleware for routes with a :id param. Attaches req.prompt (with
// .role). Default allows owner or viewer; { ownerOnly: true } is for anything
// that changes the prompt or who can see it.
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
