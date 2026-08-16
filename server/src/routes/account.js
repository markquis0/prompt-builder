import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { accountActionLimiter } from "../middleware/authRateLimit.js";
import { isValidEmail, isValidPassword, isValidName } from "../lib/validators.js";
import { BCRYPT_COST, sanitizeUser, issueSessionCookie } from "./auth.js";
import { getStripe } from "./billing.js";

const router = Router();

// Both routes below treat this as a sensitive action, not a normal profile
// edit — every request re-verifies the current password, even though
// requireAuth already confirms the request is coming from a valid session.
// A stolen/left-open session shouldn't be enough on its own to take over
// the account's email or lock other sessions out.
async function getPasswordHash(userId) {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  return rows[0]?.password_hash;
}

router.patch("/email", requireAuth, accountActionLimiter, async (req, res) => {
  const { currentPassword, newEmail } = req.body || {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return res.status(400).json({ error: "Current password is required." });
  }
  if (!isValidEmail(newEmail)) {
    return res.status(400).json({ error: "A valid email is required." });
  }

  try {
    const passwordHash = await getPasswordHash(req.userId);
    if (!passwordHash) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const passwordMatches = await bcrypt.compare(currentPassword, passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const normalizedEmail = newEmail.trim().toLowerCase();

    const { rows: currentRows } = await pool.query(
      `SELECT id, email, first_name, last_name, stripe_customer_id, created_at, subscription_status,
              trial_ends_at, current_period_ends_at
       FROM users WHERE id = $1`,
      [req.userId]
    );
    const current = currentRows[0];

    // Genuinely unchanged — succeed as a no-op rather than a false
    // "already in use" 409 against the user's own current email.
    if (current.email === normalizedEmail) {
      return res.json({ user: sanitizeUser(current) });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND id != $2", [
      normalizedEmail,
      req.userId,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That email is already in use." });
    }

    let updated;
    try {
      const { rows } = await pool.query(
        `UPDATE users SET email = $1 WHERE id = $2
         RETURNING id, email, first_name, last_name, stripe_customer_id, created_at, subscription_status,
                   trial_ends_at, current_period_ends_at`,
        [normalizedEmail, req.userId]
      );
      updated = rows[0];
    } catch (err) {
      // Same defensive backstop as signup's 23505 handling (auth.js) — the
      // pre-check above closes the common case, but two requests changing
      // to the same not-yet-taken email can still race past it.
      if (err.code === "23505") {
        return res.status(409).json({ error: "That email is already in use." });
      }
      throw err;
    }

    // Keeps Stripe's billing emails/receipts in sync, but a Stripe hiccup
    // here shouldn't fail an account update that already succeeded in our
    // own database — log and move on.
    if (updated.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
      try {
        await getStripe().customers.update(updated.stripe_customer_id, { email: normalizedEmail });
      } catch (err) {
        console.error("[prompt-builder] Failed to sync new email to Stripe customer:", err);
      }
    }

    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error("[prompt-builder] PATCH /api/account/email error:", err);
    res.status(500).json({ error: "Something went wrong updating your email. Please try again." });
  }
});

// Same edit/save pattern as PATCH /email above — current-password-gated,
// even though a name change carries none of that route's uniqueness/
// Stripe-sync complexity, for consistency: every account mutation in this
// app re-verifies the current password rather than trusting the session
// alone.
router.patch("/profile", requireAuth, accountActionLimiter, async (req, res) => {
  const { currentPassword, firstName, lastName } = req.body || {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return res.status(400).json({ error: "Current password is required." });
  }
  if (!isValidName(firstName)) {
    return res.status(400).json({ error: "First name is required." });
  }
  if (!isValidName(lastName)) {
    return res.status(400).json({ error: "Last name is required." });
  }

  try {
    const passwordHash = await getPasswordHash(req.userId);
    if (!passwordHash) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const passwordMatches = await bcrypt.compare(currentPassword, passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const { rows } = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3
       RETURNING id, email, first_name, last_name, created_at, subscription_status, trial_ends_at,
                 current_period_ends_at`,
      [firstName.trim(), lastName.trim(), req.userId]
    );

    res.json({ user: sanitizeUser(rows[0]) });
  } catch (err) {
    console.error("[prompt-builder] PATCH /api/account/profile error:", err);
    res.status(500).json({ error: "Something went wrong updating your name. Please try again." });
  }
});

router.patch("/password", requireAuth, accountActionLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return res.status(400).json({ error: "Current password is required." });
  }
  // Same rule signup enforces (lib/validators.js) — not a second, possibly
  // divergent check.
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  try {
    const passwordHash = await getPasswordHash(req.userId);
    if (!passwordHash) {
      return res.status(401).json({ error: "Invalid session" });
    }
    const passwordMatches = await bcrypt.compare(currentPassword, passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

    // token_version + 1 invalidates every session's JWT except the one
    // this request re-issues below — see requireAuth.js/requirePaid.js for
    // where that's enforced. Never logging currentPassword/newPassword
    // themselves, hashed or not — only the query text and non-sensitive
    // columns end up in any log line here or in requestLogger.js.
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1
       WHERE id = $2
       RETURNING id, email, first_name, last_name, created_at, subscription_status, trial_ends_at,
                 current_period_ends_at, token_version`,
      [newPasswordHash, req.userId]
    );
    const updated = rows[0];

    // Keeps the current request's own session alive despite the version
    // bump above — this cookie is signed with the new value already.
    issueSessionCookie(res, updated.id, updated.token_version);

    res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error("[prompt-builder] PATCH /api/account/password error:", err);
    res.status(500).json({ error: "Something went wrong updating your password. Please try again." });
  }
});

export default router;
