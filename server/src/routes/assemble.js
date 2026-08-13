import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import {
  ASSEMBLER_META_PROMPT_VERSION,
  getAssemblerSystemPrompt,
  buildFinalAssemblerUserMessage,
} from "../lib/prompts.js";

const router = Router();

// The frontend always sends "generic" for the single assembly call —
// per-model formatting now happens client-side (see client/src/renderers/),
// not by re-steering this LLM call per model. targetModel stays wired
// through to getAssemblerSystemPrompt for any direct API caller, and the
// allowlist keeps an unrecognized value from silently changing assembler
// behavior in an untested way.
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

// Maps each XML tag the assembler prompt is instructed to use onto a
// camelCase key, matching this app's JSON wire-format convention
// (tag names themselves stay snake_case — that's XML naming from the
// meta-prompt, unrelated to the JSON key convention).
const PROMPT_OBJECT_TAGS = [
  ["task", "task"],
  ["context", "context"],
  ["audience", "audience"],
  ["tone", "tone"],
  ["format", "format"],
  ["constraints", "constraints"],
  ["examples", "examples"],
  ["success_criteria", "successCriteria"],
  ["background", "background"],
];

// The assembler already emits XML-tagged text; this just extracts it into
// a structured object so the frontend can render model-specific variants
// without a second LLM call. Order-independent — works regardless of which
// order the tags actually appear in.
function parseAssembledPrompt(rawText) {
  const result = {};
  for (const [xmlTag, key] of PROMPT_OBJECT_TAGS) {
    const regex = new RegExp(`<${xmlTag}>\\s*([\\s\\S]*?)\\s*</${xmlTag}>`, "i");
    const match = rawText.match(regex);
    result[key] = match ? match[1].trim() : null;
  }
  return result;
}

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

    const rawAssembled = finalPrompt.trim();
    res.json({
      promptObject: parseAssembledPrompt(rawAssembled),
      rawAssembled,
    });
  } catch (err) {
    console.error("[prompt-builder] /api/assemble error:", err);
    res.status(502).json({ error: "Failed to assemble the final prompt. Please try again." });
  }
});

export default router;
