// Manual CLI entry point — `npm run db:migrate` — for local dev or any
// environment where you *do* have shell access. In production on Render's
// free tier (no Shell), the app applies the same schema automatically on
// boot instead; see applySchema.js and its call in index.js.
import "dotenv/config";
import { applySchema } from "./applySchema.js";
import { pool } from "./pool.js";

applySchema()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[prompt-builder] Migration failed:", err);
    process.exit(1);
  });
