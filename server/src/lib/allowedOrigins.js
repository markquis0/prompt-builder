// Comma-separated list of origins allowed to call this API. Defaults to the
// Vite dev server; set ALLOWED_ORIGIN in production to the deployed
// frontend's origin(s). http://localhost:4888 is always allowed on top of
// that list — it's the static server client/scripts/prerender.mjs boots
// during `npm run build` (see index.js's CORS setup for the full
// rationale). Shared by the CORS config and the CSRF Origin/Referer check
// in middleware/requireAllowedOrigin.js so the two can never drift apart.
export const allowedOrigins = (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat("http://localhost:4888");
