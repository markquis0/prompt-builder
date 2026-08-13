import { useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import BuilderNote from "../components/BuilderNote.jsx";
import Checklist from "../components/Checklist.jsx";
import { PARTS, SHORT_VERSION, PAGE_TITLE, PAGE_SUBTITLE, LAST_REVIEWED_STAMP } from "./learnContent.js";
import "./LearnPage.css";

const SITE_URL = "https://promptme.host";

// Which Part id a given /learn/* pathname should scroll to on load.
const PATH_TO_PART_ID = {
  "/learn/what-works": "what-works",
  "/learn/what-doesnt": "what-doesnt",
  "/learn/by-model": "by-model",
  "/learn/checklist": "checklist",
  "/learn/context-engineering": "context-engineering",
  "/learn/resources": "resources",
};

// The reverse: which Part id has a dedicated standalone route (for the TOC).
// Part 7 ("sources") has no dedicated route per the roadmap — it's reached
// via in-page anchor only.
const ROUTE_FOR_PART = {
  "what-works": "/learn/what-works",
  "what-doesnt": "/learn/what-doesnt",
  "by-model": "/learn/by-model",
  checklist: "/learn/checklist",
  "context-engineering": "/learn/context-engineering",
  resources: "/learn/resources",
};

const DEFAULT_META = {
  title: "What Actually Makes a Prompt Work — PromptMe",
  description:
    "A plain-language guide to prompting, built from official LLM documentation and peer-reviewed research. What works, what doesn't, and what's different for each model.",
  ogTitle: "What Actually Makes a Prompt Work",
  ogDescription: "The prompting techniques that survive testing — and four popular ones that don't.",
  url: `${SITE_URL}/learn`,
};

const ROUTE_META = {
  "/learn/what-works": {
    title: "Five Things the Research Actually Supports — PromptMe",
    description:
      "Specificity, structure, examples, explicit formatting, and instruction placement — the five prompting techniques no study has contradicted.",
    url: `${SITE_URL}/learn/what-works`,
  },
  "/learn/what-doesnt": {
    title: "Four Prompting Techniques That Don't Work as Advertised — PromptMe",
    description:
      "Persona prompting doesn't improve accuracy. Chain-of-thought is mostly redundant on modern models. Here's what the peer-reviewed research actually found.",
    url: `${SITE_URL}/learn/what-doesnt`,
  },
  "/learn/by-model": {
    title: "Prompting Claude, GPT, Gemini, and Other Models — PromptMe",
    description:
      "Same prompting principles, different dialects. What each AI lab's documentation tells you that the others don't.",
    url: `${SITE_URL}/learn/by-model`,
  },
  "/learn/checklist": {
    title: "A Prompt Checklist You Can Actually Use — PromptMe",
    description:
      "Seven things worth checking before you send a prompt: task, audience, format, context, constraints, an example, and success criteria.",
    url: `${SITE_URL}/learn/checklist`,
  },
  "/learn/context-engineering": {
    title: "Context Engineering, Explained — PromptMe",
    description:
      "\"Prompt engineering is dead, it's all context engineering now\" is overstated — but there's something real underneath it.",
    url: `${SITE_URL}/learn/context-engineering`,
  },
  "/learn/resources": {
    title: "Prompting Resources and Further Reading — PromptMe",
    description: "Guides, peer-reviewed research, and ongoing coverage worth following on AI prompting.",
    url: `${SITE_URL}/learn/resources`,
  },
};

// Lightweight inline markup — **bold**, *italic*, `code` — not a markdown
// pipeline, just enough to render the source copy's emphasis correctly.
function renderInline(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter((part) => part !== "");
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function ExternalLink({ href, section, children }) {
  function handleClick() {
    posthog.capture("learn_external_link_click", { url: href, section });
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

function ConversionHook({ hook }) {
  function handleClick() {
    posthog.capture("learn_to_builder_click", { from_section: hook.fromSection });
  }
  return (
    <p className="conversion-hook">
      {hook.text}{" "}
      <Link to="/#builder" onClick={handleClick}>
        {hook.linkText}
      </Link>
    </p>
  );
}

function Paragraphs({ items }) {
  return items.map((p, i) => <p key={i}>{renderInline(p)}</p>);
}

export default function LearnPage() {
  const { pathname } = useLocation();
  const meta = ROUTE_META[pathname] || DEFAULT_META;

  useEffect(() => {
    const section = PATH_TO_PART_ID[pathname] || "full";
    posthog.capture("learn_page_view", { section, referrer: document.referrer });
  }, [pathname]);

  useEffect(() => {
    const targetId = PATH_TO_PART_ID[pathname];
    if (targetId) {
      // Deferred a frame so this runs after layout has settled post-navigation
      // (avoids scrolling against a not-yet-laid-out viewport).
      const raf = requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ block: "start" });
      });
      return () => cancelAnimationFrame(raf);
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <Helmet>
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        <meta property="og:title" content={meta.ogTitle || meta.title} />
        <meta property="og:description" content={meta.ogDescription || meta.description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={meta.url} />
        <link rel="canonical" href={meta.url} />
      </Helmet>

      <div className="app-shell learn-shell">
        <NavHeader />

        <main className="learn-main">
          <p className="last-reviewed">{LAST_REVIEWED_STAMP}</p>

          <h1>{PAGE_TITLE}</h1>
          <p className="learn-subtitle">{PAGE_SUBTITLE}</p>

          <div className="learn-layout">
            <nav className="learn-toc" aria-label="Table of contents">
              <span className="learn-toc-label">On this page</span>
              <ol>
                {PARTS.map((part) => {
                  const route = ROUTE_FOR_PART[part.id];
                  return (
                    <li key={part.id}>
                      {route ? <Link to={route}>{part.title}</Link> : <a href={`#${part.id}`}>{part.title}</a>}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="learn-content">
              <section id="short-version">
                <p>{SHORT_VERSION.intro}</p>
                <Paragraphs items={SHORT_VERSION.paragraphs} />
              </section>

              {PARTS.map((part) => (
                <section id={part.id} key={part.id} className="learn-part">
                  <h2>{part.number ? `Part ${part.number} — ${part.title}` : part.title}</h2>
                  {part.intro && <p>{renderInline(part.intro)}</p>}

                  {part.sections &&
                    part.sections.map((sec, i) => (
                      <div key={i} className="learn-section">
                        <h3>{sec.heading}</h3>
                        <Paragraphs items={sec.paragraphs} />
                        {sec.builderNote && (
                          <BuilderNote section={sec.builderNote.section}>
                            <Paragraphs items={sec.builderNote.paragraphs} />
                            {sec.builderNote.source && (
                              <p className="builder-note-source">{sec.builderNote.source}</p>
                            )}
                          </BuilderNote>
                        )}
                      </div>
                    ))}

                  {part.paragraphs && <Paragraphs items={part.paragraphs} />}

                  {part.table && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {part.table.headers.map((h, i) => (
                              <th key={i}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {part.table.rows.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td key={j} data-label={part.table.headers[j]}>
                                  {renderInline(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {part.builderNote && !part.sections && (
                    <BuilderNote section={part.builderNote.section}>
                      <Paragraphs items={part.builderNote.paragraphs} />
                    </BuilderNote>
                  )}

                  {part.isChecklist && (
                    <>
                      <Checklist />
                      <Paragraphs items={part.afterParagraphs} />
                    </>
                  )}

                  {part.linkGroups &&
                    part.linkGroups.map((group, i) => (
                      <div key={i} className="link-group">
                        <h3>{group.heading}</h3>
                        <ul>
                          {group.links.map((link, j) => (
                            <li key={j}>
                              <ExternalLink href={link.url} section="part6_resources">
                                {link.label}
                              </ExternalLink>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}

                  {part.conversionHook && <ConversionHook hook={part.conversionHook} />}
                </section>
              ))}

              <p className="last-reviewed">{LAST_REVIEWED_STAMP}</p>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
