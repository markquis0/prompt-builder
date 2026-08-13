import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const BCRYPT_COST = 12;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEndsAt: row.current_period_ends_at,
  };
}

function issueSessionCookie(res, userId) {
  const token = jwt.sign({ user_id: userId }, process.env.JWT_SECRET, {
    expiresIn: `${SESSION_MAX_AGE_MS / 1000}s`,
  });
  res.cookie("session", token, SESSION_COOKIE_OPTIONS);
}

router.post("/signup", async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "A valid email is required." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, created_at, subscription_status, trial_ends_at, current_period_ends_at`,
      [normalizedEmail, passwordHash]
    );
    const user = rows[0];

    issueSessionCookie(res, user.id);
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("[prompt-builder] /api/auth/signup error:", err);
    res.status(500).json({ error: "Something went wrong creating your account. Please try again." });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, created_at, subscription_status, trial_ends_at, current_period_ends_at
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

    issueSessionCookie(res, user.id);
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
      `SELECT id, email, created_at, subscription_status, trial_ends_at, current_period_ends_at
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
