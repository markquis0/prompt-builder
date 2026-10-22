import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { getPrompt, listPromptVersions, getPromptVersion, restorePromptVersion } from "../api.js";
import { openPromptInBuilder } from "../promptResume.js";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import { diffLines } from "../diff.js";
import { formatRelative } from "../formatSession.js";
import "./PromptDetailPage.css";

const SITE_URL = "https://promptme.host";

// Blank-line and trailing-whitespace differences aren't real edits — the
// Generic renderer normalizes spacing, so a hand-edited version and a
// freshly generated one routinely differ only in blank lines. Diffing those
// would bury the actual changes in noise.
function normalizeForDiff(text) {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .join("\n");
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function PromptDetailPage() {
  const { promptId } = useParams();
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState(null);
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState(null);
  // Full version bodies, fetched on demand and cached by version number —
  // the list endpoint deliberately returns metadata only.
  const [bodies, setBodies] = useState({});
  const [selected, setSelected] = useState(null);
  const [compareFrom, setCompareFrom] = useState(null);
  const [compareTo, setCompareTo] = useState(null);
  const [restoringNumber, setRestoringNumber] = useState(null);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);

  // Same redirect-to-"/" pattern as HistoryPage/SettingsPage.
  useEffect(() => {
    if (!authLoading && !user) navigate("/", { replace: true });
  }, [authLoading, user, navigate]);

  const loadBody = useCallback(
    async (versionNumber) => {
      if (bodies[versionNumber]) return bodies[versionNumber];
      const { version } = await getPromptVersion(promptId, versionNumber);
      setBodies((prev) => ({ ...prev, [versionNumber]: version }));
      return version;
    },
    [bodies, promptId]
  );

  const refresh = useCallback(async () => {
    const [{ prompt: p }, { versions: v }] = await Promise.all([getPrompt(promptId), listPromptVersions(promptId)]);
    setPrompt(p);
    setVersions(v);
    return v;
  }, [promptId]);

  useEffect(() => {
    if (!user) return;
    refresh()
      .then((v) => {
        const current = v.find((x) => x.isCurrent) || v[0];
        const previous = v.find((x) => x.versionNumber === current.versionNumber - 1);
        setSelected(current.versionNumber);
        setCompareTo(current.versionNumber);
        setCompareFrom(previous ? previous.versionNumber : current.versionNumber);
      })
      .catch((err) => setError(err.message));
    // Only when the user/prompt changes, not when refresh's identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, promptId]);

  // Load + track whichever version is being viewed.
  useEffect(() => {
    if (selected === null || !versions) return;
    loadBody(selected).catch((err) => setError(err.message));
    const meta = versions.find((v) => v.versionNumber === selected);
    posthog.capture("prompt_version_viewed", {
      version_number: selected,
      is_current: Boolean(meta?.isCurrent),
    });
    // loadBody changes identity as the cache fills; only selection matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, versions === null]);

  const diffReady = compareFrom !== null && compareTo !== null && compareFrom !== compareTo;
  useEffect(() => {
    if (!diffReady) return;
    Promise.all([loadBody(compareFrom), loadBody(compareTo)]).catch((err) => setError(err.message));
    posthog.capture("prompt_versions_compared", { from_version: compareFrom, to_version: compareTo });
    // Fires once per chosen pair, not as bodies load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareFrom, compareTo]);

  const diff = useMemo(() => {
    const from = bodies[compareFrom];
    const to = bodies[compareTo];
    if (!diffReady || !from || !to) return null;
    return diffLines(normalizeForDiff(from.content), normalizeForDiff(to.content));
  }, [bodies, compareFrom, compareTo, diffReady]);

  async function handleRestore(versionNumber) {
    if (restoringNumber) return;
    const ok = window.confirm(
      `Restore version ${versionNumber}? This saves it as a new version — your existing versions stay exactly as they are.`
    );
    if (!ok) return;
    setRestoringNumber(versionNumber);
    setError(null);
    try {
      const { version } = await restorePromptVersion(promptId, versionNumber);
      posthog.capture("prompt_version_restored", {
        restored_from_version: versionNumber,
        new_version: version.versionNumber,
      });
      posthog.capture("prompt_version_created", { source: "restored", version_number: version.versionNumber });
      const v = await refresh();
      const current = v.find((x) => x.isCurrent) || v[0];
      setSelected(current.versionNumber);
      setCompareTo(current.versionNumber);
      setCompareFrom(versionNumber);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoringNumber(null);
    }
  }

  async function handleOpen() {
    setOpening(true);
    try {
      await openPromptInBuilder(navigate, promptId, selected);
    } catch (err) {
      setError(err.message);
      setOpening(false);
    }
  }

  async function handleCopy() {
    const body = bodies[selected];
    if (body && (await copyToClipboard(body.content))) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
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

  const current = versions?.find((v) => v.isCurrent);
  const selectedMeta = versions?.find((v) => v.versionNumber === selected);
  const selectedBody = bodies[selected];

  return (
    <div className="app-shell">
      <Helmet>
        <title>{prompt ? `${prompt.name} — PromptMe` : "Prompt — PromptMe"}</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/history/${promptId}`} />
      </Helmet>
      <NavHeader />
      <main className="prompt-detail">
        <p className="prompt-detail-back">
          <Link to="/history">← History</Link>
        </p>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}

        {!prompt && !error && <p className="loading-text">Loading…</p>}

        {prompt && versions && (
          <>
            <h1 className="prompt-detail-name">{prompt.name}</h1>
            <p className="prompt-detail-meta">
              Current version: <strong>v{current?.versionNumber}</strong> · {versions.length}{" "}
              {versions.length === 1 ? "version" : "versions"} · Updated {formatRelative(prompt.updatedAt)}
            </p>

            <section className="prompt-detail-section">
              <h2>Version history</h2>
              <ul className="version-list">
                {versions.map((v) => (
                  <li key={v.id} className={`version-item ${v.versionNumber === selected ? "selected" : ""}`}>
                    <button type="button" className="version-item-main" onClick={() => setSelected(v.versionNumber)}>
                      <span className="version-item-title">
                        v{v.versionNumber}
                        {v.isCurrent && <span className="version-badge">Current</span>}
                      </span>
                      <span className="version-item-date">{formatDate(v.createdAt)}</span>
                      {v.changeNote && <span className="version-item-note">{v.changeNote}</span>}
                      {v.restoredFromVersionNumber && !v.changeNote?.startsWith("Restored from") && (
                        <span className="version-item-note">Restored from v{v.restoredFromVersionNumber}</span>
                      )}
                    </button>
                    {!v.isCurrent && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleRestore(v.versionNumber)}
                        disabled={restoringNumber !== null}
                      >
                        {restoringNumber === v.versionNumber ? "Restoring…" : "Restore"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="prompt-detail-section">
              <h2>
                Version {selected}
                {selectedMeta?.isCurrent ? " (current)" : ""}
              </h2>
              <div className="prompt-detail-actions">
                <button type="button" className="btn btn-primary" onClick={handleOpen} disabled={opening || !selectedBody}>
                  {opening ? "Opening…" : "Open in builder"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleCopy} disabled={!selectedBody}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="version-content">{selectedBody ? selectedBody.content : "Loading…"}</pre>
            </section>

            {versions.length > 1 && (
              <section className="prompt-detail-section">
                <h2>Compare versions</h2>
                <div className="compare-controls">
                  <label>
                    From
                    <select value={compareFrom ?? ""} onChange={(e) => setCompareFrom(Number(e.target.value))}>
                      {versions.map((v) => (
                        <option key={v.id} value={v.versionNumber}>
                          v{v.versionNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span aria-hidden="true">→</span>
                  <label>
                    To
                    <select value={compareTo ?? ""} onChange={(e) => setCompareTo(Number(e.target.value))}>
                      {versions.map((v) => (
                        <option key={v.id} value={v.versionNumber}>
                          v{v.versionNumber}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {!diffReady && <p className="prompt-detail-hint">Pick two different versions to see what changed.</p>}
                {diffReady && !diff && <p className="loading-text">Loading…</p>}
                {diff && diff.every((d) => d.type === "same") && (
                  <p className="prompt-detail-hint">No differences apart from spacing.</p>
                )}
                {diff && diff.some((d) => d.type !== "same") && (
                  <pre className="diff-output" aria-label={`Changes from v${compareFrom} to v${compareTo}`}>
                    {diff.map((d, i) => (
                      <span key={i} className={`diff-line diff-${d.type}`}>
                        <span className="diff-marker" aria-hidden="true">
                          {d.type === "add" ? "+" : d.type === "remove" ? "−" : " "}
                        </span>
                        {d.text}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
