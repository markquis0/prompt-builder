import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { listServerSessions, getServerSession } from "../api.js";
import { truncate, formatRelative } from "../formatSession.js";
import "./HistoryPage.css";

const SITE_URL = "https://promptme.host";

export default function HistoryPage() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);
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
    listServerSessions()
      .then(({ sessions }) => setSessions(sessions))
      .catch((err) => setError(err.message));
  }, [user]);

  // Same fetch-full-detail-then-navigate flow as WelcomeBackHero.jsx's
  // handleResume — the list here only has id/originalPrompt/createdAt, and
  // the builder's resume logic needs qaPairs/promptObject/rawAssembled too.
  async function handleOpen(session) {
    if (resumingId) return;
    setResumingId(session.id);
    try {
      const { session: full } = await getServerSession(session.id);
      posthog.capture("history_item_opened", { session_id: session.id });
      navigate("/", { state: { resumeSession: full } });
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

        {sessions === null && !error && <p className="loading-text">Loading…</p>}

        {sessions && sessions.length === 0 && (
          <p className="history-empty">You haven't built any prompts yet.</p>
        )}

        {sessions && sessions.length > 0 && (
          <ul className="history-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="history-item"
                  onClick={() => handleOpen(session)}
                  disabled={resumingId === session.id}
                >
                  <span className="history-item-text">
                    {resumingId === session.id ? "Loading…" : truncate(session.originalPrompt, 100)}
                  </span>
                  <span className="history-item-date">{formatRelative(session.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
