import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import {
  FINAL_ASSEMBLER_SYSTEM_PROMPT,
  buildFinalAssemblerUserMessage,
} from "../lib/prompts.js";

const router = Router();

router.post("/", async (req, res) => {
  const { originalPrompt, supportingContext, qaPairs } = req.body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
  }

  const safeQaPairs = Array.isArray(qaPairs) ? qaPairs : [];

  try {
    const finalPrompt = await callClaude({
      system: FINAL_ASSEMBLER_SYSTEM_PROMPT,
      userMessage: buildFinalAssemblerUserMessage({
        originalPrompt,
        supportingContext: typeof supportingContext === "string" ? supportingContext : "",
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
