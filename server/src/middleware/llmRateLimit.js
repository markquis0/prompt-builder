import rateLimit from "express-rate-limit";

// Shared by /api/questions and /api/assemble — both are unauthenticated and
// each trigger one paid Anthropic API call, so a per-IP cap here is the only
// thing standing between "reachable with a bare curl loop" and unbounded
// LLM spend. One shared limiter (not one per route) so a script alternating
// between the two endpoints still hits a single combined per-IP ceiling.
export const llmCallLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a bit and try again." },
});
