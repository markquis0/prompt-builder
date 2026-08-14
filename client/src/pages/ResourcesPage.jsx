import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import ResourceFilters from "../components/ResourceFilters.jsx";
import ResourceCard from "../components/ResourceCard.jsx";
import { listResources } from "../api.js";
import "./ResourcesPage.css";

const SITE_URL = "https://promptme.host";

// Fixed display order — not alphabetical, deliberately: official docs and
// research first (highest-trust sources), tool/news last.
const CATEGORY_ORDER = ["official_docs", "research", "community", "tutorial", "tool", "news"];
const CATEGORY_LABELS = {
  official_docs: "Official docs",
  research: "Research",
  community: "Community",
  tutorial: "Tutorial",
  tool: "Tool",
  news: "News",
};

// Hand-picked, not a DB flag — four links that change rarely isn't worth a
// schema column. Shown regardless of active filters.
const BEGINNER_URLS = [
  "https://learnprompting.org/docs/introduction",
  "https://workspace.google.com/learning/content/gemini-prompt-guide",
  "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview",
  "https://www.promptingguide.ai/",
];

function matchesSearch(resource, query) {
  const haystack = `${resource.name} ${resource.description ?? ""} ${resource.curationNote}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function groupByCategory(list) {
  const groups = {};
  for (const r of list) {
    if (!groups[r.category]) groups[r.category] = [];
    groups[r.category].push(r);
  }
  return CATEGORY_ORDER.filter((c) => groups[c]?.length).map((c) => ({
    category: c,
    label: CATEGORY_LABELS[c] || c,
    items: groups[c],
  }));
}

export default function ResourcesPage() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ category: "all", audience: "all", model: "all", q: "" });

  useEffect(() => {
    posthog.capture("resources_page_view");
  }, []);

  useEffect(() => {
    listResources()
      .then(({ resources }) => setResources(resources))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function handleFiltersChange(next) {
    for (const field of ["category", "audience", "model"]) {
      if (next[field] !== filters[field]) {
        posthog.capture("resource_filter_changed", { filter: field, value: next[field] });
      }
    }
    if (next.q !== filters.q && next.q) {
      posthog.capture("resource_search", { query: next.q });
    }
    setFilters(next);
  }

  const filtered = useMemo(() => {
    return resources.filter((r) => {
      if (filters.category !== "all" && r.category !== filters.category) return false;
      if (filters.audience !== "all" && r.audience !== filters.audience) return false;
      if (filters.model !== "all" && !r.modelFamily.includes(filters.model)) return false;
      if (filters.q && !matchesSearch(r, filters.q)) return false;
      return true;
    });
  }, [resources, filters]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);
  const beginnerPicks = useMemo(
    () => BEGINNER_URLS.map((url) => resources.find((r) => r.url === url)).filter(Boolean),
    [resources]
  );

  return (
    <div className="app-shell resources-shell">
      <Helmet>
        <title>Prompting Resources — PromptMe</title>
        <meta
          name="description"
          content="A curated directory of official AI vendor documentation, peer-reviewed research, and community guides on prompt engineering."
        />
        <meta property="og:title" content="Prompting Resources — PromptMe" />
        <meta
          property="og:description"
          content="A curated directory of official AI vendor documentation, peer-reviewed research, and community guides."
        />
        <meta property="og:url" content={`${SITE_URL}/resources`} />
        <link rel="canonical" href={`${SITE_URL}/resources`} />
      </Helmet>

      <NavHeader />

      <main className="resources-main">
        <h1>Prompting Resources</h1>
        <p className="resources-subtitle">
          A curated directory of official docs, research, and guides.{" "}
          <a href="/learn">See our full research process →</a>
        </p>

        {beginnerPicks.length > 0 && (
          <div className="resources-beginner-strip">
            <p className="resources-beginner-label">New here? Start with these</p>
            <div className="resources-beginner-grid">
              {beginnerPicks.map((r) => (
                <ResourceCard key={r.id} resource={r} />
              ))}
            </div>
          </div>
        )}

        <ResourceFilters filters={filters} onChange={handleFiltersChange} />

        {loading && <p className="loading-text">Loading resources…</p>}

        {error && (
          <div className="error-banner">
            <span>Couldn't load resources: {error}</span>
          </div>
        )}

        {!loading && !error && grouped.length === 0 && (
          <p className="resources-empty">No resources match these filters.</p>
        )}

        {grouped.map((group) => (
          <section key={group.category} className="resources-group">
            <h2>{group.label}</h2>
            {group.items.map((r) => (
              <ResourceCard key={r.id} resource={r} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
