import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import questionsRouter from "./routes/questions.js";
import assembleRouter from "./routes/assemble.js";
import authRouter from "./routes/auth.js";
import sessionsRouter from "./routes/sessions.js";
import billingRouter, { handleStripeWebhook } from "./routes/billing.js";
import { applySchema } from "./db/applySchema.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Comma-separated list of allowed origins. Defaults to the Vite dev server;
// set ALLOWED_ORIGIN in production to the deployed frontend's origin(s).
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
app.use(cookieParser());

// Registered BEFORE express.json() below, and deliberately not part of
// billingRouter — Stripe's webhook signature verification needs the raw,
// unparsed request body. If this were mounted the normal way (after
// express.json() has already consumed and reserialized the body), the
// signature check would fail on every event. See handleStripeWebhook's
// own comment in routes/billing.js for more.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

app.use(express.json({ limit: "1mb" }));

// Plain, unprefixed health check for hosting-platform probes (Render, etc).
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/questions", questionsRouter);
app.use("/api/assemble", assembleRouter);
app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/billing", billingRouter);

app.use((err, _req, res, _next) => {
  console.error("[prompt-builder] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// Applied before accepting traffic, but a failure here doesn't stop the
// server from booting — /api/questions and /api/assemble don't depend on
// the database, and shouldn't go down because of an unrelated DB problem.
applySchema()
  .catch((err) => {
    console.error("[prompt-builder] Schema apply failed at startup:", err);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`[prompt-builder] Server listening on http://localhost:${PORT}`);
    });
  });
