import { Router } from "express";
import { callClaude } from "../lib/anthropic.js";
import {
  ASSEMBLER_META_PROMPT_VERSION,
  getAssemblerSystemPrompt,
  buildFinalAssemblerUserMessage,
} from "../lib/prompts.js";
import { llmCallLimiter } from "../middleware/llmRateLimit.js";

const router = Router();

// Mirrors MAX_LENGTH in client/src/components/IntakeForm.jsx, same as
// questions.js's MAX_PROMPT_LENGTH. No shared module between client and
// server in this project, so this has to be kept in sync by hand.
const MAX_PROMPT_LENGTH = 5000;
// Supporting context is meant for pasted background docs/notes, so it gets
// more headroom than the original prompt itself.
const MAX_SUPPORTING_CONTEXT_LENGTH = 10000;
// The question generator asks for 3-6 questions (see prompts.js) — this
// caps well above that to allow for legitimate variance while still
// rejecting a tampered client sending an unbounded qaPairs array.
const MAX_QA_PAIRS = 20;
const MAX_ANSWER_LENGTH = 2000;

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

router.post("/", llmCallLimiter, async (req, res) => {
  const { originalPrompt, supportingContext, qaPairs, targetModel } = req.body || {};

  if (typeof originalPrompt !== "string" || originalPrompt.trim().length === 0) {
    return res.status(400).json({ error: "A non-empty 'originalPrompt' is required." });
  }
  if (originalPrompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error: `Prompt exceeds ${MAX_PROMPT_LENGTH.toLocaleString()} character limit.`,
    });
  }
  if (typeof supportingContext === "string" && supportingContext.length > MAX_SUPPORTING_CONTEXT_LENGTH) {
    return res.status(400).json({
      error: `Supporting context exceeds ${MAX_SUPPORTING_CONTEXT_LENGTH.toLocaleString()} character limit.`,
    });
  }
  if (Array.isArray(qaPairs)) {
    if (qaPairs.length > MAX_QA_PAIRS) {
      return res.status(400).json({ error: `Too many question/answer pairs (max ${MAX_QA_PAIRS}).` });
    }
    const answerTooLong = qaPairs.some(
      (pair) => typeof pair?.answer === "string" && pair.answer.length > MAX_ANSWER_LENGTH
    );
    if (answerTooLong) {
      return res.status(400).json({
        error: `An answer exceeds the ${MAX_ANSWER_LENGTH.toLocaleString()} character limit.`,
      });
    }
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
      // Longer than the shared 20s client default (see anthropic.js) —
      // this call requests roughly double the output of questions/score
      // and measurably showed a heavier latency tail in production (up to
      // 8.65s on a realistic heavy payload) even under normal Anthropic
      // conditions, so it gets its own headroom instead of loosening the
      // default for every caller.
      timeoutMs: 25000,
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
