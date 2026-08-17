import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import CategoryChips from "../components/CategoryChips.jsx";
import PromptCard from "../components/PromptCard.jsx";
import { PROMPT_LIBRARY } from "./promptLibraryContent.js";
import { scrollToElement } from "../scrollToElement.js";
import "./PromptLibraryPage.css";

const SITE_URL = "https://promptme.host";
const SECTIONS = [
  { id: "enterprise", label: "Enterprise" },
  { id: "personal", label: "Personal" },
  { id: "cyberAiGovernance", label: "Cyber & AI Governance" },
];

function matchesSearch(prompt, query) {
  const haystack = `${prompt.label} ${prompt.text}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

// Scoped to whichever section is active, per the handoff — searching
// "budget" while on Enterprise doesn't reach into Personal's results.
function useFilteredCategories(activeSection, query) {
  return useMemo(() => {
    const categories = PROMPT_LIBRARY[activeSection].categories;
    if (!query.trim()) return categories;
    return categories
      .map((cat) => ({ ...cat, prompts: cat.prompts.filter((p) => matchesSearch(p, query)) }))
      .filter((cat) => cat.prompts.length > 0);
  }, [activeSection, query]);
}

export default function PromptLibraryPage() {
  const [activeSection, setActiveSection] = useState("enterprise");
  const [query, setQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const groupRefs = useRef({});

  const filteredCategories = useFilteredCategories(activeSection, query);

  useEffect(() => {
    posthog.capture("prompt_library_page_view");
  }, []);

  // Highlights whichever category chip corresponds to the group currently
  // near the top of the viewport — same table-of-contents interaction as
  // the homepage's section-view tracking (Phase 2c), but tracking "current"
  // rather than "seen once".
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategoryId(entry.target.dataset.categoryId);
            break;
          }
        }
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    Object.values(groupRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [filteredCategories]);

  function handleSectionChange(section) {
    if (section === activeSection) return;
    setActiveSection(section);
    setQuery("");
    posthog.capture("prompt_library_section_changed", { section });
  }

  function handleSearchChange(e) {
    const next = e.target.value;
    setQuery(next);
    if (next.trim()) {
      posthog.capture("prompt_library_search", { query: next });
    }
  }

  function handleJump(categoryId) {
    posthog.capture("prompt_library_category_jumped", { category: categoryId });
    scrollToElement(groupRefs.current[categoryId], { block: "start" });
  }

  return (
    <div className="app-shell prompt-library-shell">
      <Helmet>
        <title>Prompt Library — 297 Ready-to-Use AI Prompts — PromptMe</title>
        <meta
          name="description"
          content="A free library of 297 ready-to-use prompts — management, marketing, finance, cooking, travel, fitness, cyber security, AI governance, and more. Copy and paste into Claude, ChatGPT, or Gemini."
        />
        <meta property="og:title" content="Prompt Library — PromptMe" />
        <meta
          property="og:description"
          content="297 ready-to-copy prompts across work, personal, and cyber/AI-governance categories. Free, no sign-up."
        />
        <meta property="og:url" content={`${SITE_URL}/prompts`} />
        <link rel="canonical" href={`${SITE_URL}/prompts`} />
      </Helmet>

      <NavHeader />

      <main className="prompt-library-main">
        <h1>Prompt Library</h1>
        <p className="prompt-library-subtitle">
          297 ready-to-use prompts for work, life, cyber security, and AI governance. Copy one
          as-is, or build on it in PromptMe for something more specific.
        </p>

        <div className="prompt-library-controls">
          <input
            type="text"
            className="prompt-library-search"
            placeholder="Search prompts…"
            value={query}
            onChange={handleSearchChange}
            aria-label="Search prompts"
          />

          <div className="section-tabs" role="tablist">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={activeSection === s.id}
                className={`section-tab ${activeSection === s.id ? "active" : ""}`}
                onClick={() => handleSectionChange(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <CategoryChips categories={filteredCategories} activeCategoryId={activeCategoryId} onJump={handleJump} />
        </div>

        {filteredCategories.length === 0 && (
          <p className="prompt-library-empty">No prompts match "{query}" in this section.</p>
        )}

        {filteredCategories.map((cat) => (
          <section
            key={cat.id}
            className="prompt-library-group"
            data-category-id={cat.id}
            ref={(el) => {
              groupRefs.current[cat.id] = el;
            }}
          >
            <h2>{cat.label}</h2>
            {cat.prompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} categoryId={cat.id} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
