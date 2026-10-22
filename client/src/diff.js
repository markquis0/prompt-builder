// Line-level diff (longest common subsequence). Prompts here are short,
// multi-line, XML-tagged text, so whole-line changes are the natural unit —
// a changed tone line shows as one removal plus one addition. Returns
// [{ type: "same" | "add" | "remove", text }] in display order.
const MAX_CELLS = 4_000_000;

export function diffLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");

  // Pathologically large inputs: skip the O(n*m) table and show a plain
  // replace rather than freezing the tab. Saved prompts are capped well
  // below this (20k chars), so this is a backstop, not a normal path.
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ type: "remove", text })), ...b.map((text) => ({ type: "add", text }))];
  }

  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "remove", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ type: "remove", text: a[i++] });
  while (j < b.length) out.push({ type: "add", text: b[j++] });
  return out;
}

// Blank-line and trailing-whitespace differences aren't real edits — the
// Generic renderer normalizes spacing, so a hand-edited version and a freshly
// generated (or AI-improved) one routinely differ only in blank lines.
// Diffing those would bury the actual changes in noise.
export function normalizeForDiff(text) {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .join("\n");
}

export function diffPrompts(before, after) {
  return diffLines(normalizeForDiff(before), normalizeForDiff(after));
}
