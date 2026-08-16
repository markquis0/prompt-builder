import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

// Same "paid" rule as isPaidUser in client/src/context/AuthContext.jsx —
// keep these two in sync if subscription_status values ever change.
const PAID_STATUSES = ["trialing", "active"];

// Standalone rather than requireAuth + a second check, because this needs
// a fresh DB read of subscription_status — requireAuth only verifies the
// JWT and never touches the database, so it can't tell paid from free.
export async function requirePaid(req, res, next) {
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
  const userId = payload.user_id;

  try {
    const { rows } = await pool.query("SELECT subscription_status, token_version FROM users WHERE id = $1", [
      userId,
    ]);
    if (!rows[0]) {
      return res.status(401).json({ error: "Invalid session" });
    }
    // Same token_version check as requireAuth.js — a token from before a
    // password change (or from before this column existed, treated as 0)
    // shouldn't reach a paid-gated route any more than any other route.
    const claimedVersion = payload.token_version ?? 0;
    if (claimedVersion !== rows[0].token_version) {
      return res.status(401).json({ error: "Invalid session" });
    }
    if (!PAID_STATUSES.includes(rows[0].subscription_status)) {
      return res.status(403).json({ error: "This feature requires PromptMe Pro." });
    }
    req.userId = userId;
    next();
  } catch (err) {
    console.error("[prompt-builder] requirePaid DB error:", err);
    res.status(500).json({ error: "Internal error checking subscription status." });
  }
}
