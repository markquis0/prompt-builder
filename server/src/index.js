import "dotenv/config";
import app from "./app.js";
import { applySchema } from "./db/applySchema.js";
import { seedStarterResources } from "./db/seedResources.js";

const PORT = process.env.PORT || 3001;

// The Express app itself lives in app.js so tests can import it without
// starting a server or touching the schema; this file is only the boot step.
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
