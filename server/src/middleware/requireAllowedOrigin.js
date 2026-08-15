import { allowedOrigins } from "../lib/allowedOrigins.js";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originFromReferer(referer) {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Defense-in-depth against CSRF. The session cookie is SameSite=None (see
// auth.js's SESSION_COOKIE_OPTIONS) because the frontend and this API are
// on different registrable domains — that means it's attached even to
// genuinely cross-site requests (e.g. a malicious page's auto-submitting
// <form>). CORS (see index.js) already blocks disallowed non-empty Origins
// for browser fetch/XHR calls, but it deliberately lets no-Origin requests
// through (curl, server-to-server health checks) — a gap a plain HTML-form
// CSRF can walk straight through, since form-triggered navigations aren't
// governed by CORS at all. This closes that gap for every state-changing
// request: Origin (or, failing that, Referer) must match the exact same
// allowlist CORS already enforces, or the request is rejected outright.
//
// Applied globally in index.js rather than per-route, so any future
// state-changing route inherits this automatically instead of depending on
// it happening to require a JSON body (the previous, accidental defense).
// The Stripe webhook route is registered before this middleware and is
// fully handled by handleStripeWebhook without calling next(), so it never
// reaches this check — it has its own, stronger protection via Stripe's
// signature verification instead.
export function requireAllowedOrigin(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.headers.origin || originFromReferer(req.headers.referer);
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Request origin not allowed." });
  }
  next();
}
