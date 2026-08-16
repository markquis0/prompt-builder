// Shared by WelcomeBackHero.jsx (home page) and HistoryPage.jsx
// (/history) — both render the same "past prompt" list item shape.
export function truncate(text, max = 80) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export function formatRelative(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
