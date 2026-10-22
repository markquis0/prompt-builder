import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import InlineTitle from "../components/InlineTitle.jsx";
import ShareModal from "../components/ShareModal.jsx";
import AddToTeamModal from "../components/AddToTeamModal.jsx";
import ImprovePanel from "../components/ImprovePanel.jsx";
import DiffView from "../components/DiffView.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  getPrompt,
  listPromptVersions,
  getPromptVersion,
  restorePromptVersion,
  renamePrompt,
  copyPrompt,
} from "../api.js";
import { openPromptInBuilder } from "../promptResume.js";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import { RENDERERS } from "../renderers/index.js";
import { diffPrompts } from "../diff.js";
import { formatRelative, formatDate } from "../formatSession.js";
import "./PromptDetailPage.css";

const SITE_URL = "https://promptme.host";
const SOURCE_LABELS = {
  generated: "Generated",
  regenerated: "Regenerated",
  edited: "Edited",
  restored: "Restored",
  copied: "Copied",
};

export default function PromptDetailPage() {
  const { promptId } = useParams();
  const { user, authLoading, isPaidUser } = useAuth();
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState(null);
  const [access, setAccess] = useState(null);
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState(null);
  // Full version bodies, fetched on demand and cached by version number —
  // the list endpoint deliberately returns metadata only.
  const [bodies, setBodies] = useState({});
  const [selected, setSelected] = useState(null);
  const [activeModel, setActiveModel] = useState("generic");
  const [lockedNotice, setLockedNotice] = useState(false);
  const [compareFrom, setCompareFrom] = useState(null);
  const [compareTo, setCompareTo] = useState(null);
  const [restoringNumber, setRestoringNumber] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showAddToTeam, setShowAddToTeam] = useState(false);
  const [improving, setImproving] = useState(false);
  // Teams this prompt is an official prompt of (all of them for its owner;
  // only the viewer's own teams otherwise).
  const [teams, setTeams] = useState([]);
  const openedTracked = useRef(false);

  const isOwner = access?.role === "owner";

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
    const [{ prompt: p, access: a, teams: t }, { versions: v }] = await Promise.all([
      getPrompt(promptId),
      listPromptVersions(promptId),
    ]);
    setPrompt(p);
    setAccess(a);
    setTeams(t || []);
    setVersions(v);
    return { versions: v, access: a, teams: t || [] };
  }, [promptId]);

  useEffect(() => {
    if (!user) return;
    refresh()
      .then(({ versions: v, access: a, teams: t }) => {
        const current = v.find((x) => x.isCurrent) || v[0];
        const previous = v.find((x) => x.versionNumber === current.versionNumber - 1);
        setSelected(current.versionNumber);
        setCompareTo(current.versionNumber);
        setCompareFrom(previous ? previous.versionNumber : current.versionNumber);
        if (a.role === "viewer" && !openedTracked.current) {
          openedTracked.current = true;
          const props = {
            prompt_id: promptId,
            version_number: current.versionNumber,
            version_count: v.length,
            source_page: "detail",
          };
          // A team prompt and a directly shared one are distinct things to
          // measure ("which team prompts get used?"); one that's both counts
          // as a team open.
          if (a.via.team) posthog.capture("team_prompt_opened", { ...props, team_id: t[0]?.id });
          else posthog.capture("shared_prompt_opened", props);
        }
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
      prompt_id: promptId,
      version_number: selected,
      version_count: versions.length,
      is_current: Boolean(meta?.isCurrent),
    });
    // loadBody changes identity as the cache fills; only selection matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, versions === null]);

  const diffReady = compareFrom !== null && compareTo !== null && compareFrom !== compareTo;
  useEffect(() => {
    if (!diffReady) return;
    Promise.all([loadBody(compareFrom), loadBody(compareTo)]).catch((err) => setError(err.message));
    posthog.capture("prompt_versions_compared", {
      prompt_id: promptId,
      from_version: compareFrom,
      to_version: compareTo,
      version_count: versions?.length,
    });
    // Fires once per chosen pair, not as bodies load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareFrom, compareTo]);

  const diff = useMemo(() => {
    const from = bodies[compareFrom];
    const to = bodies[compareTo];
    if (!diffReady || !from || !to) return null;
    return diffPrompts(from.content, to.content);
  }, [bodies, compareFrom, compareTo, diffReady]);

  const selectedBody = bodies[selected];
  const hasRenderings = Boolean(selectedBody?.promptObject) && Object.values(selectedBody.promptObject).some(Boolean);
  const tabModel = hasRenderings ? activeModel : "generic";
  // Claude/ChatGPT/Gemini are renderings of THIS version's own sections —
  // computed from the selected version's promptObject, never from the
  // current/newest one — so an old version can't show a derived view of a
  // newer prompt. Generic is the version's canonical text, verbatim.
  const displayText = !selectedBody
    ? ""
    : tabModel === "generic"
      ? selectedBody.content
      : RENDERERS[tabModel].render(selectedBody.promptObject);

  function handleTabClick(key) {
    if (key !== "generic" && !isPaidUser) {
      setLockedNotice(true);
      return;
    }
    setLockedNotice(false);
    setActiveModel(key);
  }

  function handleSelectVersion(number) {
    setSelected(number);
    setActiveModel("generic");
    setLockedNotice(false);
  }

  async function handleRename(title) {
    const { prompt: updated } = await renamePrompt(promptId, title);
    setPrompt(updated);
    posthog.capture("prompt_renamed", { prompt_id: promptId, source_page: "detail" });
  }

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
        prompt_id: promptId,
        restored_from_version: versionNumber,
        new_version: version.versionNumber,
        version_count: version.versionNumber,
      });
      posthog.capture("prompt_version_created", {
        source: "restored",
        prompt_id: promptId,
        version_number: version.versionNumber,
        version_count: version.versionNumber,
      });
      const { versions: v } = await refresh();
      const current = v.find((x) => x.isCurrent) || v[0];
      handleSelectVersion(current.versionNumber);
      setCompareTo(current.versionNumber);
      setCompareFrom(versionNumber);
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoringNumber(null);
    }
  }

  // An accepted improvement is a new current version — reload and show it.
  async function handleImproved(version) {
    setImproving(false);
    const { versions: v } = await refresh();
    const current = v.find((x) => x.isCurrent) || v[0];
    handleSelectVersion(current.versionNumber);
    setCompareTo(current.versionNumber);
    setCompareFrom(version.versionNumber - 1 >= 1 ? version.versionNumber - 1 : current.versionNumber);
  }

  async function handleOpen() {
    setBusy(true);
    try {
      await openPromptInBuilder(navigate, promptId, selected);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // "Build on this": the viewer gets their own independent prompt, starting
  // from the version they're looking at, and lands in the builder with it.
  async function handleBuildOnThis() {
    setBusy(true);
    setError(null);
    try {
      const { prompt: mine } = await copyPrompt(promptId, selected);
      posthog.capture("prompt_copy_saved", {
        source: "shared",
        prompt_id: promptId,
        new_prompt_id: mine.id,
        version_number: selected,
        source_page: "detail",
      });
      if (access?.via.team) {
        posthog.capture("team_prompt_built_on", { team_id: teams[0]?.id, prompt_id: promptId, version_number: selected });
      }
      await openPromptInBuilder(navigate, mine.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (selectedBody && (await copyToClipboard(displayText))) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
      if (!isOwner) {
        const props = { prompt_id: promptId, version_number: selected, source_page: "detail" };
        if (access?.via.team) posthog.capture("team_prompt_copied", { ...props, team_id: teams[0]?.id });
        else posthog.capture("shared_prompt_copied", props);
      }
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

  return (
    <div className="app-shell">
      <Helmet>
        <title>{prompt ? `${prompt.title} — PromptMe` : "Prompt — PromptMe"}</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/history/${promptId}`} />
      </Helmet>
      <NavHeader />
      <main className="prompt-detail">
        <p className="prompt-detail-back">
          <Link to={isOwner === false ? "/history?tab=shared" : "/history"}>← History</Link>
        </p>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}

        {!prompt && !error && <p className="loading-text">Loading…</p>}

        {prompt && versions && access && (
          <>
            <InlineTitle as="h1" className="prompt-detail-name" title={prompt.title} canEdit={isOwner} onSave={handleRename} />
            {!isOwner && access.via.team && (
              <p className="prompt-detail-shared-by">
                Official Team Prompt · {teams.map((t) => t.name).join(", ")} · view only
              </p>
            )}
            {!isOwner && (access.via.direct || !access.via.team) && (
              <p className="prompt-detail-shared-by">Shared by {access.owner.name} · view only</p>
            )}
            {isOwner && teams.length > 0 && (
              <p className="prompt-detail-used-by">
                Official prompt for: {teams.map((t) => t.name).join(", ")}
              </p>
            )}
            <p className="prompt-detail-meta">
              Current version: <strong>v{current?.versionNumber}</strong> · {versions.length}{" "}
              {versions.length === 1 ? "version" : "versions"} · Updated {formatRelative(prompt.updatedAt)}
            </p>
            <div className="prompt-detail-actions prompt-detail-top-actions">
              {isOwner ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={handleOpen} disabled={busy || !selectedBody}>
                    {busy ? "Opening…" : "Open in builder"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCopy} disabled={!selectedBody}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowShare(true)}>
                    Share
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowAddToTeam(true)}>
                    {teams.length > 0 ? "Teams" : "Add to team"}
                  </button>
                  {isPaidUser ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setImproving(true)}
                      disabled={improving || selected !== current?.versionNumber || !selectedBody}
                      title={selected !== current?.versionNumber ? "Select the current version to improve it" : undefined}
                    >
                      Improve this prompt
                    </button>
                  ) : (
                    <Link to="/pro" className="btn btn-secondary">
                      Improve this prompt · Pro
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={handleCopy} disabled={!selectedBody}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleBuildOnThis} disabled={busy || !selectedBody}>
                    {busy ? "Saving your copy…" : "Build on this"}
                  </button>
                </>
              )}
            </div>
            {isOwner && improving && selectedBody && current && (
              <ImprovePanel
                promptId={promptId}
                title={prompt.title}
                currentContent={selectedBody.content}
                currentVersionNumber={current.versionNumber}
                onAccepted={handleImproved}
                onClose={() => setImproving(false)}
              />
            )}
            {!isOwner && (
              <p className="prompt-detail-hint">
                “Build on this” saves your own copy of the version you’re viewing — yours to edit, and separate from{" "}
                {access.owner.name}’s original.
              </p>
            )}

            <section className="prompt-detail-section">
              <h2>Version history</h2>
              <ul className="version-list">
                {versions.map((v) => (
                  <li key={v.id} className={`version-item ${v.versionNumber === selected ? "selected" : ""}`}>
                    <button type="button" className="version-item-main" onClick={() => handleSelectVersion(v.versionNumber)}>
                      <span className="version-item-title">
                        v{v.versionNumber}
                        {v.isCurrent && <span className="version-badge">Current</span>}
                      </span>
                      <span className="version-item-date">{formatDate(v.createdAt)}</span>
                      {v.source && SOURCE_LABELS[v.source] && (
                        <span className="version-item-source">{SOURCE_LABELS[v.source]}</span>
                      )}
                      {v.changeNote && <span className="version-item-note">{v.changeNote}</span>}
                      {v.restoredFromVersionNumber && !v.changeNote?.startsWith("Restored from") && (
                        <span className="version-item-note">Restored from v{v.restoredFromVersionNumber}</span>
                      )}
                    </button>
                    {isOwner && !v.isCurrent && (
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

              {hasRenderings && (
                <div className="model-tabs" role="tablist">
                  {Object.entries(RENDERERS).map(([key, { label, icon }]) => {
                    const locked = key !== "generic" && !isPaidUser;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={tabModel === key}
                        className={`model-tab ${tabModel === key ? "active" : ""} ${locked ? "locked" : ""}`}
                        onClick={() => handleTabClick(key)}
                      >
                        <span aria-hidden="true">{icon}</span> {label}
                        {locked && <span className="model-tab-pro-chip">Pro</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {lockedNotice && (
                <p className="prompt-detail-hint">
                  Model-specific formats are a Pro feature. <Link to="/pro">See what Pro adds →</Link>
                </p>
              )}
              {hasRenderings && tabModel !== "generic" && (
                <p className="prompt-detail-hint">Rendered from Version {selected}.</p>
              )}

              <pre className="version-content">{selectedBody ? displayText : "Loading…"}</pre>
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
                  <DiffView diff={diff} label={`Changes from v${compareFrom} to v${compareTo}`} />
                )}
              </section>
            )}
          </>
        )}
      </main>

      {showAddToTeam && prompt && (
        <AddToTeamModal
          promptId={promptId}
          promptTitle={prompt.title}
          currentTeamIds={teams.map((t) => t.id)}
          onClose={() => setShowAddToTeam(false)}
          onChanged={() => refresh().catch((err) => setError(err.message))}
        />
      )}

      {showShare && prompt && (
        <ShareModal
          promptId={promptId}
          promptTitle={prompt.title}
          sourcePage="detail"
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
