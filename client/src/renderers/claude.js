// Claude's native preference: XML tags, task-first. Same shape as generic
// today — kept as its own module since Claude-specific tweaks (e.g. tag
// choice, section emphasis) are expected to diverge from generic over time.
export function render(p) {
  if (!p) return "";
  const sections = [];
  if (p.task) sections.push(`<task>\n${p.task}\n</task>`);
  if (p.context) sections.push(`<context>\n${p.context}\n</context>`);
  if (p.audience) sections.push(`<audience>\n${p.audience}\n</audience>`);
  if (p.tone) sections.push(`<tone>\n${p.tone}\n</tone>`);
  if (p.format) sections.push(`<format>\n${p.format}\n</format>`);
  if (p.constraints) sections.push(`<constraints>\n${p.constraints}\n</constraints>`);
  if (p.examples) sections.push(`<examples>\n${p.examples}\n</examples>`);
  if (p.successCriteria) sections.push(`<success_criteria>\n${p.successCriteria}\n</success_criteria>`);
  if (p.background) sections.push(`<background>\n${p.background}\n</background>`);
  return sections.join("\n\n");
}
