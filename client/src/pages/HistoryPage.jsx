import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import ShareModal from "../components/ShareModal.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { listPrompts, listSharedPrompts, getPrompt, copyPrompt } from "../api.js";
import { openPromptInBuilder } from "../promptResume.js";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import { truncate, formatRelative } from "../formatSession.js";
import "./HistoryPage.css";

const SITE_URL = "https://promptme.host";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function HistoryPage() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "shared" ? "shared" : "mine";

  const [prompts, setPrompts] = useState(null);
  const [shared, setShared] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [sharing, setSharing] = useState(null); // the prompt whose Share modal is open

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
    listSharedPrompts()
      .then(({ prompts }) => setShared(prompts))
      .catch((err) => setError(err.message));
  }, [user]);

  function selectTab(next) {
    setSearchParams(next === "shared" ? { tab: "shared" } : {}, { replace: true });
  }

  // Runs one row action, with that row disabled while it's in flight.
  async function run(promptId, fn) {
    if (busyId) return;
    setBusyId(promptId);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  const handleOpen = (prompt) =>
    run(prompt.id, async () => {
      await openPromptInBuilder(navigate, prompt.id);
      posthog.capture("history_item_opened", { prompt_id: prompt.id });
    });

  // Same current-version text the builder would show, no navigation.
  const handleCopy = (prompt, { isShared }) =>
    run(prompt.id, async () => {
      const { currentVersion } = await getPrompt(prompt.id);
      if (currentVersion && (await copyToClipboard(currentVersion.content))) {
        setCopiedId(prompt.id);
        setTimeout(() => setCopiedId(null), COPY_CONFIRMATION_MS);
        if (isShared) {
          posthog.capture("shared_prompt_copied", {
            prompt_id: prompt.id,
            version_number: currentVersion.versionNumber,
            source_page: "history",
          });
        }
      }
      setBusyId(null);
    });

  // "Build on this": saves the viewer their own independent copy, then
  // opens it in the builder.
  const handleBuildOnThis = (prompt) =>
    run(prompt.id, async () => {
      const { prompt: mine } = await copyPrompt(prompt.id);
      posthog.capture("prompt_copy_saved", {
        source: "shared",
        prompt_id: prompt.id,
        new_prompt_id: mine.id,
        source_page: "history",
      });
      await openPromptInBuilder(navigate, mine.id);
    });

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

  const list = tab === "mine" ? prompts : shared;

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

        <div className="history-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className={`history-tab ${tab === "mine" ? "active" : ""}`}
            onClick={() => selectTab("mine")}
          >
            My Prompts{prompts ? ` (${prompts.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shared"}
            className={`history-tab ${tab === "shared" ? "active" : ""}`}
            onClick={() => selectTab("shared")}
          >
            Shared With Me{shared ? ` (${shared.length})` : ""}
          </button>
        </div>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}

        {list === null && !error && <p className="loading-text">Loading…</p>}

        {list && list.length === 0 && (
          <p className="history-empty">
            {tab === "mine"
              ? "You haven't built any prompts yet."
              : "Nothing has been shared with you yet. When someone shares a prompt with your PromptMe email, it will show up here."}
          </p>
        )}

        {list && list.length > 0 && (
          <ul className="history-list">
            {list.map((prompt) => {
              const isShared = tab === "shared";
              const busy = busyId === prompt.id;
              return (
                <li key={prompt.id} className="history-card">
                  <button
                    type="button"
                    className="history-item"
                    onClick={() => (isShared ? navigate(`/history/${prompt.id}`) : handleOpen(prompt))}
                    disabled={busy}
                  >
                    <span className="history-item-text">{truncate(prompt.title, 100)}</span>
                    <span className="history-item-date">
                      v{prompt.currentVersionNumber} · Updated {formatRelative(prompt.updatedAt)}
                    </span>
                  </button>
                  <p className="history-item-meta">
                    {isShared
                      ? `Shared by ${prompt.sharedBy.name}`
                      : plural(prompt.versionCount, "version") +
                        (prompt.shareCount > 0 ? ` · Shared with ${prompt.shareCount}` : "")}
                    {isShared && ` · ${plural(prompt.versionCount, "version")}`}
                  </p>
                  <div className="history-actions">
                    {!isShared && (
                      <button type="button" className="link-button" onClick={() => handleOpen(prompt)} disabled={busy}>
                        Open
                      </button>
                    )}
                    <button type="button" className="link-button" onClick={() => handleCopy(prompt, { isShared })} disabled={busy}>
                      {copiedId === prompt.id ? "Copied!" : "Copy"}
                    </button>
                    <Link to={`/history/${prompt.id}`} className="history-versions-link">
                      Version history
                    </Link>
                    {isShared ? (
                      <button type="button" className="link-button" onClick={() => handleBuildOnThis(prompt)} disabled={busy}>
                        Build on this
                      </button>
                    ) : (
                      <button type="button" className="link-button" onClick={() => setSharing(prompt)}>
                        Share
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {sharing && (
        <ShareModal
          promptId={sharing.id}
          promptTitle={sharing.title}
          sourcePage="history"
          onClose={() => setSharing(null)}
          onChanged={(count) =>
            setPrompts((prev) => prev.map((p) => (p.id === sharing.id ? { ...p, shareCount: count } : p)))
          }
        />
      )}
    </div>
  );
}
