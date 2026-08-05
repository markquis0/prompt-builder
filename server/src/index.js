import "dotenv/config";
import express from "express";
import cors from "cors";
import questionsRouter from "./routes/questions.js";
import assembleRouter from "./routes/assemble.js";

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
  })
);
app.use(express.json({ limit: "1mb" }));

// Plain, unprefixed health check for hosting-platform probes (Render, etc).
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/questions", questionsRouter);
app.use("/api/assemble", assembleRouter);

app.use((err, _req, res, _next) => {
  console.error("[prompt-builder] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`[prompt-builder] Server listening on http://localhost:${PORT}`);
});
