import rateLimit from "express-rate-limit";

// Shared by /api/questions and /api/assemble — both are unauthenticated and
// each trigger one paid Anthropic API call, so a per-IP cap here is the only
// thing standing between "reachable with a bare curl loop" and unbounded
// LLM spend. One shared limiter (not one per route) so a script alternating
// between the two endpoints still hits a single combined per-IP ceiling.
//
// 60, not the original 30 — this app's own prompt library targets an
// "Enterprise" audience, exactly the population most likely to share one
// outbound IP behind a corporate NAT/proxy. A per-IP-only limit means
// several legitimate concurrent users behind that one IP split a single
// budget; 60 gives real headroom for that case (each full funnel run is
// only 2-4 requests) without meaningfully loosening the abuse protection
// this exists for.
export const llmCallLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a bit and try again." },
});
