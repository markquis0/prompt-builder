// Layer 1 of Phase 4's completeness score: free, client-side, zero API
// cost. Deliberately dumb — it checks which of the 7 checklist dimensions
// (see /learn/checklist, CHECKLIST_ITEMS in learnContent.js — this list is
// the same 7 items, not a separate taxonomy) survived into the assembled
// prompt, since the assembler is already instructed to "skip any section
// that has no real content" (see getFinalAssemblerSystemPrompt in
// server/src/lib/prompts.js). A null field means the user never gave that
// information; a filled field means they did. No NLP, no guessing at
// "quality" — presence/absence only. This is why the score is named
// "completeness," never "quality": it cannot and does not claim the
// output will be good, only that the spec going in was well-formed.
const COMPLETENESS_DIMENSIONS = [
  { field: "task", label: "Task", checklistLabel: "The task — what you want, as a verb." },
  { field: "audience", label: "Audience", checklistLabel: "The audience — who reads the output." },
  { field: "format", label: "Format", checklistLabel: "The format — length, structure, medium." },
  { field: "context", label: "Context", checklistLabel: "The context — background the model can't guess." },
  { field: "constraints", label: "Constraints", checklistLabel: "The constraints — what to avoid, what to include." },
  { field: "examples", label: "Example", checklistLabel: "An example of the output you want." },
  { field: "successCriteria", label: "Success criteria", checklistLabel: "How you'll know it worked." },
];

// Stage 4's before/after comparison: PromptBuilder.jsx writes the
// pre-edit score here right before sending the user back into the Q&A
// flow; CompletenessScore.jsx reads it once after the next assembly
// completes, then clears it. A one-shot handoff across the edit
// round-trip, not persistent state.
export const COMPLETENESS_BEFORE_EDIT_KEY = "pb_completeness_before_edit";

function hasContent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Pure function: promptObject in, score out. No side effects, no network —
// safe to call on every render if needed.
export function scoreCompleteness(promptObject) {
  const checks = COMPLETENESS_DIMENSIONS.map(({ field, label }) => ({
    field,
    label,
    present: hasContent(promptObject?.[field]),
  }));
  const score = checks.filter((c) => c.present).length;
  return { score, total: checks.length, checks };
}
