import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import BeforeAfter from "../components/BeforeAfter.jsx";
import PromptBuilder from "../components/PromptBuilder.jsx";
import WelcomeBackHero from "../components/WelcomeBackHero.jsx";
import { loadSession } from "../storage.js";
import { useAuth } from "../context/AuthContext.jsx";
import { listServerSessions } from "../api.js";
import "./HomePage.css";

const STEPS = [
  {
    number: 1,
    title: "Type your rough idea",
    body: "It can be a sentence, a paragraph, or just a few words. You don't need to know prompt engineering.",
  },
  {
    number: 2,
    title: "Answer a few quick questions",
    body: "PromptMe asks 3–5 targeted questions to fill in what your prompt is missing — audience, format, tone, constraints. Skip any that don't apply.",
  },
  {
    number: 3,
    title: "Copy your structured prompt",
    body: null, // rendered specially below — has an inline link
  },
];

// Fires each section's view event once, the moment it actually enters the
// viewport (not on mount) — this is what makes the funnel show where
// visitors actually stop scrolling.
function useSectionViewTracking(refs) {
  useEffect(() => {
    const seen = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const section = entry.target.dataset.section;
          if (entry.isIntersecting && section && !seen.has(section)) {
            seen.add(section);
            posthog.capture("home_section_viewed", { section });
          }
        });
      },
      { threshold: 0.4 }
    );
    refs.forEach((ref) => ref.current && observer.observe(ref.current));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function HomePage() {
  const heroRef = useRef(null);
  const beforeAfterRef = useRef(null);
  const howItWorksRef = useRef(null);
  const builderRef = useRef(null);
  const { user } = useAuth();
  const [recentSessions, setRecentSessions] = useState(null);

  useSectionViewTracking([heroRef, beforeAfterRef, howItWorksRef, builderRef]);

  // Only for authenticated users — anonymous visitors' localStorage-based
  // returning-visitor behavior (below) is unchanged and unaffected by this.
  useEffect(() => {
    if (!user) {
      setRecentSessions(null);
      return;
    }
    listServerSessions()
      .then(({ sessions }) => setRecentSessions(sessions.slice(0, 5)))
      .catch((err) => {
        console.error("[prompt-builder] Failed to load recent sessions:", err);
        setRecentSessions([]);
      });
  }, [user]);

  // Returning visitors (existing localStorage session with real content) or
  // anyone arriving via a #builder link land straight on the tool instead of
  // the pitch. PromptBuilder writes an empty default session to localStorage
  // on every mount, so presence alone isn't enough — check actual content,
  // the same way the builder's own "Start Over" confirmation does.
  useEffect(() => {
    const session = loadSession();
    const hasContent = Boolean(
      session &&
        (session.prompt ||
          session.rawAssembled ||
          Object.values(session.answers || {}).some(Boolean))
    );
    const wantsBuilder = window.location.hash === "#builder";
    if (hasContent || wantsBuilder) {
      document.getElementById("builder")?.scrollIntoView();
      if (hasContent) {
        posthog.capture("home_returning_autoscroll");
      }
    }
    // Run once on mount only — this is a landing-behavior decision, not a
    // reactive one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleHeroCtaClick(e) {
    e.preventDefault();
    posthog.capture("hero_cta_clicked");
    const el = document.getElementById("builder");
    if (el) {
      try {
        el.scrollIntoView({ behavior: "smooth" });
      } catch {
        // iOS Safari has historically had issues with smooth-scroll options.
        el.scrollIntoView();
      }
    }
  }

  function handleLearnLinkClick() {
    posthog.capture("home_learn_link_clicked");
  }

  function handleProLinkClick() {
    posthog.capture("home_pro_link_clicked");
  }

  return (
    <div className="app-shell home-shell">
      <Helmet>
        <title>PromptMe — Turn a Rough Idea into a Prompt That Works</title>
        <meta
          name="description"
          content="Type what you want in plain language. PromptMe asks a few smart questions, then gives you a structured prompt for Claude, ChatGPT, Gemini, or any AI tool. Free."
        />
        <meta property="og:title" content="PromptMe — Turn a Rough Idea into a Prompt That Works" />
        <meta
          property="og:description"
          content="You write the idea. We write the prompt. Free, no sign-up required."
        />
        <meta property="og:url" content="https://promptme.host/" />
        <link rel="canonical" href="https://promptme.host/" />
      </Helmet>

      <NavHeader />

      <main className="home-main">
        {user && recentSessions && recentSessions.length > 0 ? (
          <WelcomeBackHero ref={heroRef} sessions={recentSessions} />
        ) : (
          <section className="home-hero" id="hero" ref={heroRef} data-section="hero">
            <h1>You write the idea. We write the prompt.</h1>
            <p className="home-hero-subhead">
              Describe what you want in plain language. PromptMe asks a few smart questions, then
              gives you a structured prompt you can paste into Claude, ChatGPT, Gemini, or any AI
              tool.
            </p>
            <a href="#builder" className="btn btn-primary home-hero-cta" onClick={handleHeroCtaClick}>
              {/* Registered users (even ones who haven't built anything yet)
                  already know this is free — that pitch is for anonymous
                  visitors deciding whether to try it at all. */}
              {user ? "Build a prompt →" : "Build a prompt — it's free →"}
            </a>
          </section>
        )}

        <section
          className="home-before-after"
          id="before-after"
          ref={beforeAfterRef}
          data-section="before_after"
        >
          <p className="home-section-label">This is what 5 questions and 30 seconds turns into.</p>
          <BeforeAfter />
          <p className="home-credibility">
            Based on prompting research from Anthropic, OpenAI, and Google.{" "}
            <Link to="/learn" onClick={handleLearnLinkClick}>
              See what the research says →
            </Link>
          </p>
        </section>

        <section
          className="home-how-it-works"
          id="how-it-works"
          ref={howItWorksRef}
          data-section="how_it_works"
        >
          <h2>How it works</h2>
          <div className="home-steps">
            {STEPS.map((step) => (
              <div className="home-step" key={step.number}>
                <span className="home-step-number" aria-hidden="true">
                  {step.number}
                </span>
                <h3>{step.title}</h3>
                {step.number === 3 ? (
                  <p>
                    Get a detailed, tagged prompt ready to paste into any AI tool. See a
                    completeness check for free, or unlock formatting for Claude, ChatGPT, and
                    Gemini specifically.{" "}
                    <Link to="/pro" onClick={handleProLinkClick}>
                      See what Pro adds →
                    </Link>
                  </p>
                ) : (
                  <p>{step.body}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section
          className="home-builder-section"
          id="builder"
          ref={builderRef}
          data-section="builder"
        >
          <h2 className="home-builder-heading">Try it now</h2>
          <PromptBuilder />
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-footer-col">
          <p className="home-footer-heading">Product</p>
          <Link to="/#builder">Build a prompt</Link>
          <Link to="/pro">Pro features</Link>
        </div>
        <div className="home-footer-col">
          <p className="home-footer-heading">Learn</p>
          <Link to="/learn/what-works">What works</Link>
          <Link to="/learn/what-doesnt">What doesn't work</Link>
          <Link to="/learn/by-model">Prompting by model</Link>
          <Link to="/learn/resources">Resources</Link>
        </div>
        <div className="home-footer-col">
          <p className="home-footer-heading">Company</p>
          <a href="mailto:markquisjohn91@gmail.com">Contact</a>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
          <Link to="/refund-policy">Refund Policy</Link>
        </div>
      </footer>
    </div>
  );
}
