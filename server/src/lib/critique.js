// Shared by /api/score/critique (grade only) and /api/prompts/:id/improve
// (grade + rewrite) so both validate the model's grading identically.
export const DIMENSIONS = ["task", "audience", "format", "context", "constraints", "example", "success_criteria"];
export const MAX_SCORE = DIMENSIONS.length * 2;

export function isValidCritiquePayload(payload) {
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

// Total out of MAX_SCORE (7 dimensions x 0-2). Reported as-is — this is a
// completeness grade, not a percentage of anything.
export function totalScore(dimensions) {
  return DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim].score, 0);
}
