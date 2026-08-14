// Strips ```json ... ``` or ``` ... ``` fences some models wrap JSON in
// despite instructions not to. Shared by every route that asks Claude for
// a raw JSON response (questions, score/critique).
export function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
