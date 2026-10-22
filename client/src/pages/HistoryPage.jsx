import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { listPrompts } from "../api.js";
import { openPromptInBuilder } from "../promptResume.js";
import { truncate, formatRelative } from "../formatSession.js";
import "./HistoryPage.css";

const SITE_URL = "https://promptme.host";

export default function HistoryPage() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState(null);
  const [error, setError] = useState(null);
  const [resumingId, setResumingId] = useState(null);

  // No dedicated login page in this app — same redirect-to-"/" pattern as
  // SettingsPage.jsx.
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    posthog.capture("history_viewed");
    listPrompts()
      .then(({ prompts }) => setPrompts(prompts))
      .catch((err) => setError(err.message));
  }, [user]);

  // Opens the prompt's current version in the builder — same resume path
  // as the welcome-back list and the prompt detail page.
  async function handleOpen(prompt) {
    if (resumingId) return;
    setResumingId(prompt.id);
    try {
      await openPromptInBuilder(navigate, prompt.id);
      posthog.capture("history_item_opened", { prompt_id: prompt.id });
    } catch (err) {
      setError(err.message);
      setResumingId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="app-shell">
        <NavHeader />
        <main>
          <p className="loading-text">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Helmet>
        <title>History — PromptMe</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/history`} />
      </Helmet>
      <NavHeader />
      <main className="history-page">
        <h1>History</h1>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}

        {prompts === null && !error && <p className="loading-text">Loading…</p>}

        {prompts && prompts.length === 0 && (
          <p className="history-empty">You haven't built any prompts yet.</p>
        )}

        {prompts && prompts.length > 0 && (
          <ul className="history-list">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="history-row">
                <button
                  type="button"
                  className="history-item"
                  onClick={() => handleOpen(prompt)}
                  disabled={resumingId === prompt.id}
                >
                  <span className="history-item-text">
                    {resumingId === prompt.id ? "Loading…" : truncate(prompt.name, 100)}
                  </span>
                  <span className="history-item-date">
                    v{prompt.currentVersionNumber} · {formatRelative(prompt.updatedAt)}
                  </span>
                </button>
                <Link to={`/history/${prompt.id}`} className="history-versions-link">
                  Versions{prompt.versionCount > 1 ? ` (${prompt.versionCount})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
