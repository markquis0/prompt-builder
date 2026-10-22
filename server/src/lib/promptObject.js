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

// Extracts the XML-tagged text into a structured object so the frontend can
// render model-specific variants without a second LLM call. Order-independent
// — works regardless of which order the tags actually appear in. Shared by
// /api/assemble (fresh generation) and /api/prompts (a user-edited version
// has to be re-parsed the same way, so its model tabs stay in sync).
export function parseAssembledPrompt(rawText) {
  const result = {};
  for (const [xmlTag, key] of PROMPT_OBJECT_TAGS) {
    const regex = new RegExp(`<${xmlTag}>\\s*([\\s\\S]*?)\\s*</${xmlTag}>`, "i");
    const match = rawText.match(regex);
    result[key] = match ? match[1].trim() : null;
  }
  return result;
}
