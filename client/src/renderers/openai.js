// GPT is trained on far more Markdown than XML — use headers instead of
// tags, plus a reasoning-effort hint for GPT-5.x users.
export function render(p) {
  if (!p) return "";
  const sections = [
    '<!-- Tip: For GPT-5.x, set reasoning effort to "medium" or "high" for ' +
      'complex tasks. Use "none" for straightforward tasks where you want ' +
      "speed over deliberation. -->",
  ];
  if (p.task) sections.push(`## Task\n${p.task}`);
  if (p.context) sections.push(`## Context\n${p.context}`);
  if (p.audience) sections.push(`## Audience\n${p.audience}`);
  if (p.tone) sections.push(`## Tone\n${p.tone}`);
  if (p.format) sections.push(`## Format\n${p.format}`);
  if (p.constraints) sections.push(`## Constraints\n${p.constraints}`);
  if (p.examples) sections.push(`## Examples\n${p.examples}`);
  if (p.successCriteria) sections.push(`## Success Criteria\n${p.successCriteria}`);
  if (p.background) sections.push(`## Background\n${p.background}`);
  return sections.join("\n\n");
}
