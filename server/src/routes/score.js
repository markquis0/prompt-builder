import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import { getCritiqueSystemPrompt, buildCritiqueUserMessage, CRITIQUE_META_PROMPT_VERSION } from "../lib/prompts.js";
import { stripCodeFences } from "../lib/jsonUtils.js";
import { requirePaid } from "../middleware/requirePaid.js";
import { pool } from "../db/pool.js";

const router = Router();

const DIMENSIONS = ["task", "audience", "format", "context", "constraints", "example", "success_criteria"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCritiquePayload(payload) {
  if (!payload || typeof payload.dimensions !== "object" || payload.dimensions === null) return false;
  return DIMENSIONS.every((dim) => {
    const d = payload.dimensions[dim];
    return (
      d &&
      typeof d.present === "boolean" &&
      [0, 1, 2].includes(d.score) &&
      typeof d.diagnosis === "string" &&
      typeof d.fix === "string"
    );
  });
}

// On-demand only — never called automatically after assembly (that would
// spend a paid user's API cost on every single build, including ones they
// never look at the score for). Gated by requirePaid, not requireAuth —
// Layer 1 (client-side, completeness.js) is the free tier; this is Layer 2.
router.post("/critique", requirePaid, async (req, res) => {
  const { originalPrompt, assembledPrompt, sessionId } = req.body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
  }
  if (typeof assembledPrompt !== "string" || assembledPrompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'assembledPrompt' is required." });
  }

  try {
    const raw = await callClaude({
      system: getCritiqueSystemPrompt(),
      userMessage: buildCritiqueUserMessage({ originalPrompt, assembledPrompt }),
      maxTokens: 1536,
    });

    let parsed;
    try {
      parsed = JSON.parse(stripCodeFences(raw));
    } catch {
      console.error("[prompt-builder] Failed to parse critique JSON:", raw);
      return res.status(502).json({ error: "The model returned a response we couldn't parse. Please try again." });
    }
    if (!isValidCritiquePayload(parsed)) {
      console.error("[prompt-builder] Critique payload failed validation:", parsed);
      return res.status(502).json({ error: "The model returned an unexpected response. Please try again." });
    }

    // Best-effort persistence, same pattern as the fire-and-forget session
    // save in PromptBuilder.jsx — a user waiting on their critique result
    // shouldn't be blocked by (or see an error from) a DB write they didn't
    // consciously ask for. sessionId is optional: the client only has one
    // once the earlier auto-save (see PromptBuilder.jsx) has resolved.
    if (typeof sessionId === "string" && UUID_RE.test(sessionId)) {
      pool
        .query(
          `UPDATE sessions
           SET llm_critique = $1, critique_version = $2, scored_at = now()
           WHERE id = $3 AND user_id = $4`,
          [JSON.stringify(parsed.dimensions), CRITIQUE_META_PROMPT_VERSION, sessionId, req.userId]
        )
        .catch((err) => {
          console.error("[prompt-builder] Failed to persist critique to session:", err);
        });
    }

    res.json({ dimensions: parsed.dimensions, critiqueVersion: CRITIQUE_META_PROMPT_VERSION });
  } catch (err) {
    console.error("[prompt-builder] POST /api/score/critique error:", err);
    res.status(500).json({ error: "Failed to grade this prompt. Please try again." });
  }
});

export default router;
