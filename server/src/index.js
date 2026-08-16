import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import questionsRouter from "./routes/questions.js";
import assembleRouter from "./routes/assemble.js";
import authRouter from "./routes/auth.js";
import accountRouter from "./routes/account.js";
import sessionsRouter from "./routes/sessions.js";
import billingRouter, { handleStripeWebhook } from "./routes/billing.js";
import resourcesRouter from "./routes/resources.js";
import scoreRouter from "./routes/score.js";
import { applySchema } from "./db/applySchema.js";
import { seedStarterResources } from "./db/seedResources.js";
import { allowedOrigins } from "./lib/allowedOrigins.js";
import { requireAllowedOrigin } from "./middleware/requireAllowedOrigin.js";
import { requestLogger } from "./middleware/requestLogger.js";

const app = express();
const PORT = process.env.PORT || 3001;

// First middleware in the chain so measured duration covers the full
// request, including CORS/helmet/CSRF processing below - not just
// whatever a route handler itself takes.
app.use(requestLogger);

// http://localhost:4888 is always allowed on top of the configured list —
// it's the static server client/scripts/prerender.mjs boots during
// `npm run build` (on Vercel's build machine, not a public origin anyone
// can actually send a browser request from). Any page that fetches data on
// mount — currently just /resources — needs this or the prerendered HTML
// silently bakes in an empty/error state instead of real content:
// Puppeteer's headless browser really does send `Origin: http://localhost:4888`
// on that fetch, and without this it gets rejected by CORS before ever
// reaching the route. (See lib/allowedOrigins.js — shared with the CSRF
// Origin/Referer check below so the two allowlists can't drift apart.)

app.use(
  cors({
    origin(origin, callback) {
      // No origin header (curl, server-to-server health checks) is allowed through.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    // Required for the httpOnly auth cookie to be sent/received on
    // cross-origin requests (the frontend and this API are on different
    // domains). Paired with credentials: 'include' on the frontend's fetch
    // calls, and with a non-wildcard origin above — a browser will not
    // honor credentialed requests against `Access-Control-Allow-Origin: *`.
    credentials: true,
  })
);
// Standard security headers (X-Content-Type-Options, Referrer-Policy,
// Cross-Origin-Opener-Policy, etc — see helmet's README for the full set).
// crossOriginResourcePolicy is explicitly overridden from helmet's
// "same-origin" default to "cross-origin": this API is deliberately
// consumed cross-origin (Vercel frontend, Render backend), and the
// same-origin default would tell browsers to block the frontend from
// reading these responses even though CORS above already permits it.
// Permissions-Policy isn't one of helmet's built-in headers (as of v8), so
// it's set separately right after.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
  );
  next();
});

app.use(cookieParser());

// Registered BEFORE express.json() below, and deliberately not part of
// billingRouter — Stripe's webhook signature verification needs the raw,
// unparsed request body. If this were mounted the normal way (after
// express.json() has already consumed and reserialized the body), the
// signature check would fail on every event. See handleStripeWebhook's
// own comment in routes/billing.js for more.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({ limit: "1mb" }));

// CSRF defense-in-depth for every route below — registered after the
// Stripe webhook above, which is fully handled by handleStripeWebhook
// without calling next() and so never reaches this check. See
// middleware/requireAllowedOrigin.js for the full rationale.
app.use(requireAllowedOrigin);

// Plain, unprefixed health check for hosting-platform probes (Render, etc).
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/questions", questionsRouter);
app.use("/api/assemble", assembleRouter);
app.use("/api/auth", authRouter);
app.use("/api/account", accountRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/resources", resourcesRouter);
app.use("/api/score", scoreRouter);

app.use((err, _req, res, _next) => {
  console.error("[prompt-builder] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// Applied before accepting traffic, but a failure here doesn't stop the
// server from booting — /api/questions and /api/assemble don't depend on
// the database, and shouldn't go down because of an unrelated DB problem.
applySchema()
  .then(() => seedStarterResources())
  .catch((err) => {
    console.error("[prompt-builder] Schema apply/seed failed at startup:", err);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`[prompt-builder] Server listening on http://localhost:${PORT}`);
    });
  });
