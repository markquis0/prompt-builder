import rateLimit from "express-rate-limit";

// Per-IP only — an attacker mass-creating accounts from one IP is the
// primary threat here (each bcrypt hash also costs real server CPU, so this
// doubles as a resource-consumption guard, not just an abuse-prevention one).
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please wait a bit and try again." },
});

// Per-IP — slows a single source hammering many different accounts.
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a bit and try again." },
});

// Per-email — a per-IP limit alone doesn't slow an attacker credential-
// stuffing one specific account from rotating IPs; keying on the submitted
// (normalized) email closes that gap. Falls back to req.ip when no usable
// email is present so malformed requests don't all pile into one shared
// bucket.
export const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts for this account. Please wait a bit and try again." },
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email || req.ip;
  },
});

// Per-user, not per-IP/email — these routes (routes/account.js) are behind
// requireAuth, so req.userId is already known and is a more precise key
// than IP (multiple legitimate users can share an IP; a single account
// changing its own password/email repeatedly is the actual thing worth
// slowing down here). Generous enough for real mistyped-password retries,
// tight enough to blunt a compromised session hammering these endpoints.
export const accountActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a bit and try again." },
  keyGenerator: (req) => req.userId || req.ip,
});
