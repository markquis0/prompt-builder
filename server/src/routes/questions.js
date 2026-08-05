import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import {
  QUESTION_GENERATOR_SYSTEM_PROMPT,
  buildQuestionGeneratorUserMessage,
} from "../lib/prompts.js";

const router = Router();

// Strips ```json ... ``` or ``` ... ``` fences some models wrap JSON in
// despite instructions not to.
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function isValidQuestionsPayload(payload) {
  if (!payload || !Array.isArray(payload.questions)) return false;
  return payload.questions.every(
    (q) =>
      typeof q.id === "string" &&
      typeof q.text === "string" &&
      Array.isArray(q.options) &&
      q.options.every((opt) => typeof opt === "string")
  );
}

router.post("/", async (req, res) => {
  const { prompt, promptType } = req.body || {};

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'prompt' is required." });
  }
  if (prompt.length > 5000) {
    return res.status(400).json({ error: "Prompt exceeds 5,000 character limit." });
  }

  try {
    const raw = await callClaude({
      system: QUESTION_GENERATOR_SYSTEM_PROMPT,
      userMessage: buildQuestionGeneratorUserMessage({
        promptType,
        originalPrompt: prompt,
      }),
      maxTokens: 1024,
    });

    let parsed;
    try {
      parsed = JSON.parse(stripCodeFences(raw));
    } catch {
      console.error("[prompt-builder] Failed to parse questions JSON:", raw);
      return res.status(502).json({
        error: "The model returned a response we couldn't parse. Please try again.",
      });
    }

    if (!isValidQuestionsPayload(parsed)) {
      console.error("[prompt-builder] Questions payload failed shape validation:", parsed);
      return res.status(502).json({
        error: "The model returned an unexpected response shape. Please try again.",
      });
    }

    res.json({ questions: parsed.questions });
  } catch (err) {
    console.error("[prompt-builder] /api/questions error:", err);
    res.status(502).json({ error: "Failed to generate clarifying questions. Please try again." });
  }
});

export default router;
