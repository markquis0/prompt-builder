import rateLimit from "express-rate-limit";

// POST /api/score/critique sits behind requirePaid, so req.userId (set by
// requirePaid from the verified JWT) is already available by the time this
// runs — keying on it instead of IP means the limit tracks the actual paid
// account, not whatever address it happens to connect from. Falls back to
// req.ip only as a defensive default; requirePaid guarantees req.userId is
// set on every request that reaches this middleware.
export const critiqueLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a bit and try again." },
  keyGenerator: (req) => req.userId || req.ip,
});
