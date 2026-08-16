import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { signupLimiter, loginIpLimiter, loginEmailLimiter } from "../middleware/authRateLimit.js";
import { isValidEmail, isValidPassword, isValidName } from "../lib/validators.js";

const router = Router();

export const BCRYPT_COST = 12;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed expiry

// promptme.host (Vercel) and the Render backend are different registrable
// domains — cross-site from the cookie spec's point of view — so a
// cross-origin fetch() with credentials only carries the cookie if it's
// SameSite=None (which requires Secure). Locally, frontend and backend are
// both on "localhost" (different ports, same site), where Lax already works
// and Secure would block the cookie entirely over plain http.
const isProd = process.env.NODE_ENV === "production";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: SESSION_MAX_AGE_MS,
  path: "/",
};

export function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: row.created_at,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEndsAt: row.current_period_ends_at,
  };
}

// tokenVersion is embedded in every issued JWT and checked against the
// users row on every authenticated request (see requireAuth.js/
// requirePaid.js) — it's how a password change invalidates every
// previously-issued token without a separate revocation-list table.
// Callers that just changed it (routes/account.js's password change) pass
// the fresh value straight through so this request's own new cookie is
// already in sync, rather than re-reading it back from the DB.
export function issueSessionCookie(res, userId, tokenVersion) {
  const token = jwt.sign({ user_id: userId, token_version: tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: `${SESSION_MAX_AGE_MS / 1000}s`,
  });
  res.cookie("session", token, SESSION_COOKIE_OPTIONS);
}

router.post("/signup", signupLimiter, async (req, res) => {
  const { email, password, firstName, lastName } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (!isValidName(firstName)) {
    return res.status(400).json({ error: "First name is required." });
  }
  if (!isValidName(lastName)) {
    return res.status(400).json({ error: "Last name is required." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name, created_at, subscription_status, trial_ends_at,
                 current_period_ends_at, token_version`,
      [normalizedEmail, passwordHash, firstName.trim(), lastName.trim()]
    );
    const user = rows[0];

    issueSessionCookie(res, user.id, user.token_version);
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    // 23505 = unique_violation on users.email. The pre-check above closes
    // this window in the common case, but two signups for the same email
    // racing each other can both pass it before either INSERTs — the DB
    // constraint is what actually prevents a duplicate account, so the
    // loser of that race lands here rather than the friendlier check above.
    // Same response either way, not a generic 500.
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    console.error("[prompt-builder] /api/auth/signup error:", err);
    res.status(500).json({ error: "Something went wrong creating your account. Please try again." });
  }
});

router.post("/login", loginIpLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, first_name, last_name, created_at, subscription_status,
              trial_ends_at, current_period_ends_at, token_version
       FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    const user = rows[0];

    // Same error for "no such user" and "wrong password" — don't leak which
    // one it was, that's a user-enumeration vector.
    if (!user) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    issueSessionCookie(res, user.id, user.token_version);
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("[prompt-builder] /api/auth/login error:", err);
    res.status(500).json({ error: "Something went wrong logging you in. Please try again." });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("session", { ...SESSION_COOKIE_OPTIONS, maxAge: undefined });
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, first_name, last_name, created_at, subscription_status, trial_ends_at,
              current_period_ends_at
       FROM users WHERE id = $1`,
      [req.userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("[prompt-builder] /api/auth/me error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
