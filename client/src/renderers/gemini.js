// The one renderer with real structural differences: Gemini's own docs
// recommend context before task when context is long, with a grounding
// phrase anchoring the task to it. Also nudges toward a conversational
// tone when asked for one, since Gemini 3.x is terse by default.
const LONG_CONTEXT_THRESHOLD = 2000;
const CONVERSATIONAL_KEYWORDS = ["casual", "friendly", "conversational", "warm", "chatty"];

function lowercaseFirst(str) {
  if (!str) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function render(p) {
  if (!p) return "";
  const sections = [];
  const hasLongContext = Boolean(p.context) && p.context.length > LONG_CONTEXT_THRESHOLD;

  if (hasLongContext) {
    sections.push(`## Context\n${p.context}`);
    if (p.task) {
      sections.push(`## Task\nBased on the context provided above, ${lowercaseFirst(p.task)}`);
    }
  } else {
    if (p.task) sections.push(`## Task\n${p.task}`);
    if (p.context) sections.push(`## Context\n${p.context}`);
  }

  if (p.audience) sections.push(`## Audience\n${p.audience}`);

  if (p.tone) {
    const isCasual = CONVERSATIONAL_KEYWORDS.some((k) => p.tone.toLowerCase().includes(k));
    const toneText = isCasual
      ? `${p.tone}\n\nNote: Please use a conversational, approachable style rather than being overly concise.`
      : p.tone;
    sections.push(`## Tone\n${toneText}`);
  }

  if (p.format) sections.push(`## Format\n${p.format}`);
  if (p.constraints) sections.push(`## Constraints\n${p.constraints}`);
  if (p.examples) sections.push(`## Examples\n${p.examples}`);
  if (p.successCriteria) sections.push(`## Success Criteria\n${p.successCriteria}`);
  if (p.background) sections.push(`## Background\n${p.background}`);
  return sections.join("\n\n");
}
