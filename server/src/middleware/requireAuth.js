import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

// Now does one DB read per call (it didn't before token_version existed) —
// a JWT's signature being valid no longer means the session itself is
// still valid, since a password change bumps token_version to invalidate
// every token issued before it. There's no way to invalidate an
// already-issued, unexpired JWT purely client-side, so this is the
// tradeoff: every authenticated request pays one indexed primary-key
// lookup. At this app's scale (see the scalability review — sub-ms
// query times even at thousands of rows) that's not a meaningful cost.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }

  try {
    const { rows } = await pool.query("SELECT token_version FROM users WHERE id = $1", [payload.user_id]);
    const currentVersion = rows[0]?.token_version;
    // A token signed before this column existed carries no token_version
    // claim at all — treat that as 0, matching every pre-existing row's
    // DEFAULT, so already-logged-in users don't get silently signed out
    // the moment this deploys. Only an actual password change (which bumps
    // the DB value) invalidates anything, same as a token that explicitly
    // claims a stale version.
    const claimedVersion = payload.token_version ?? 0;
    if (currentVersion === undefined || claimedVersion !== currentVersion) {
      return res.status(401).json({ error: "Invalid session" });
    }
    req.userId = payload.user_id;
    next();
  } catch (err) {
    console.error("[prompt-builder] requireAuth DB error:", err);
    res.status(500).json({ error: "Internal error checking session." });
  }
}
