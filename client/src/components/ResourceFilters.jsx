import "./ResourceFilters.css";

const CATEGORIES = [
  { value: "official_docs", label: "Official docs" },
  { value: "research", label: "Research" },
  { value: "community", label: "Community" },
  { value: "tutorial", label: "Tutorial" },
  { value: "tool", label: "Tool" },
  { value: "news", label: "News" },
];

const AUDIENCES = [
  { value: "beginner", label: "Beginner" },
  { value: "practitioner", label: "Practitioner" },
  { value: "builder", label: "Builder" },
];

const MODELS = [
  { value: "claude", label: "Claude" },
  { value: "gpt", label: "GPT" },
  { value: "gemini", label: "Gemini" },
  { value: "llama", label: "Llama" },
  { value: "mistral", label: "Mistral" },
];

export default function ResourceFilters({ filters, onChange }) {
  function handleField(field) {
    return (e) => onChange({ ...filters, [field]: e.target.value });
  }

  return (
    <div className="resource-filters">
      <input
        type="text"
        className="resource-search"
        placeholder="Search resources…"
        value={filters.q}
        onChange={handleField("q")}
        aria-label="Search resources"
      />

      <div className="resource-filter-selects">
        <select value={filters.category} onChange={handleField("category")} aria-label="Filter by category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select value={filters.audience} onChange={handleField("audience")} aria-label="Filter by audience">
          <option value="all">All audiences</option>
          {AUDIENCES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>

        <select value={filters.model} onChange={handleField("model")} aria-label="Filter by model">
          <option value="all">All models</option>
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
