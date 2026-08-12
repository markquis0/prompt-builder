import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import {
  ASSEMBLER_META_PROMPT_VERSION,
  getAssemblerSystemPrompt,
  buildFinalAssemblerUserMessage,
} from "../lib/prompts.js";

const router = Router();

// Phase 2 will add the model-selector UI; the frontend always sends
// "generic" for now. Keep the allowlist so an unrecognized value can't
// silently change assembler behavior in an untested way.
const VALID_TARGET_MODELS = [
  "generic",
  "claude",
  "openai",
  "gemini",
  "grok",
  "deepseek",
  "llama",
  "mistral",
];

router.post("/", async (req, res) => {
  const { originalPrompt, supportingContext, qaPairs, targetModel } = req.body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
  }

  const safeQaPairs = Array.isArray(qaPairs) ? qaPairs : [];
  const safeSupportingContext = typeof supportingContext === "string" ? supportingContext : "";
  const safeTargetModel = VALID_TARGET_MODELS.includes(targetModel) ? targetModel : "generic";

  console.log(
    `[assemble] version=${ASSEMBLER_META_PROMPT_VERSION} target=${safeTargetModel} context_len=${safeSupportingContext.length}`
  );

  try {
    const finalPrompt = await callClaude({
      system: getAssemblerSystemPrompt(safeTargetModel, safeSupportingContext.length),
      userMessage: buildFinalAssemblerUserMessage({
        originalPrompt,
        supportingContext: safeSupportingContext,
        qaPairs: safeQaPairs,
      }),
      maxTokens: 2048,
    });

    res.json({ prompt: finalPrompt.trim() });
  } catch (err) {
    console.error("[prompt-builder] /api/assemble error:", err);
    res.status(502).json({ error: "Failed to assemble the final prompt. Please try again." });
  }
});

export default router;
