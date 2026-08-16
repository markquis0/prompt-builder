import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import NavHeader from "../components/NavHeader.jsx";
import WelcomeBackHero from "../components/WelcomeBackHero.jsx";
import PromptBuilder from "../components/PromptBuilder.jsx";
import { listServerSessions } from "../api.js";
import { useBuilderAutoscroll } from "../useBuilderAutoscroll.js";
import "./HomePage.css";

// The authenticated "Build a Prompt" experience — rendered by HomePage.jsx
// once a user is known to be logged in, replacing the marketing tree
// entirely rather than threading auth-gated content through it. Never
// reached by the Puppeteer prerender pipeline (that always runs
// unauthenticated), so no SEO/crawler considerations apply here — hence
// the noindex below.
export default function BuilderPage() {
  const [recentSessions, setRecentSessions] = useState(null);

  useEffect(() => {
    listServerSessions()
      .then(({ sessions }) => setRecentSessions(sessions.slice(0, 5)))
      .catch((err) => {
        console.error("[prompt-builder] Failed to load recent sessions:", err);
        setRecentSessions([]);
      });
  }, []);

  useBuilderAutoscroll();

  return (
    <div className="app-shell home-shell">
      <Helmet>
        <title>Build a Prompt — PromptMe</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <NavHeader />

      <main className="home-main">
        {recentSessions && recentSessions.length > 0 && <WelcomeBackHero sessions={recentSessions} />}

        <section className="home-builder-section" id="builder">
          <h2 className="home-builder-heading">Try it now</h2>
          <PromptBuilder />
        </section>
      </main>
    </div>
  );
}
