import { useEffect, useMemo, useRef, useState } from "react";
import posthog from "posthog-js";
import DiffView from "./DiffView.jsx";
import { improvePrompt, savePromptVersion } from "../api.js";
import { diffPrompts } from "../diff.js";
import "./ImprovePanel.css";

const DIMENSION_LABELS = {
  task: "Task",
  audience: "Audience",
  format: "Format",
  context: "Context",
  constraints: "Constraints",
  example: "Example",
  success_criteria: "Success criteria",
};

// "Improve this prompt": grade the CURRENT version, show what PromptMe found,
// and propose a rewrite as a reviewable diff. Nothing is saved until the
// owner clicks Accept — which creates the next immutable version through the
// ordinary save path (source "improved"), based explicitly on the version the
// suggestion was made from (the server refuses it if the prompt has moved on).
// Only ever offered on the current version of a prompt the user owns; a
// viewer builds their own copy first.
//
// Analytics carry ids, version numbers and counts only — never prompt text.
export default function ImprovePanel({ promptId, title, currentContent, currentVersionNumber, onAccepted, onClose }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error | saving
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [suggestion, setSuggestion] = useState("");
  const [editing, setEditing] = useState(false);

  // Runs once per mount: the panel is only mounted when the user clicks
  // Improve. The ref guard matters — React's dev StrictMode runs effects
  // twice, and this one spends a paid model call.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    posthog.capture("prompt_improvement_started", { prompt_id: promptId, version_number: currentVersionNumber });
    improvePrompt(promptId, currentVersionNumber)
      .then((r) => {
        setResult(r);
        setSuggestion(r.improvedContent);
        setStatus("ready");
        posthog.capture("prompt_improvement_generated", {
          prompt_id: promptId,
          version_number: currentVersionNumber,
          opportunity_count: Object.values(r.critique.dimensions).filter((d) => d.score < 2).length,
          grade: r.critique.score,
          max_grade: r.critique.maxScore,
          unchanged: r.unchanged,
        });
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, [promptId, currentVersionNumber]);

  const edited = result !== null && suggestion !== result.improvedContent;
  const opportunities = useMemo(
    () =>
      result
        ? Object.entries(result.critique.dimensions)
            .filter(([, d]) => d.score < 2)
            .map(([key, d]) => ({ key, ...d }))
        : [],
    [result]
  );
  const diff = useMemo(() => diffPrompts(currentContent, suggestion), [currentContent, suggestion]);
  const hasChanges = diff.some((d) => d.type !== "same");

  async function accept() {
    setStatus("saving");
    setError(null);
    try {
      const { version } = await savePromptVersion(promptId, {
        content: suggestion,
        source: "improved",
        baseVersionNumber: currentVersionNumber,
        changeNote: edited ? "Improved with PromptMe suggestions, then edited" : undefined,
      });
      posthog.capture("prompt_improvement_accepted", {
        prompt_id: promptId,
        base_version: currentVersionNumber,
        new_version: version.versionNumber,
        edited,
      });
      posthog.capture("prompt_version_created", {
        source: "improved",
        prompt_id: promptId,
        version_number: version.versionNumber,
        version_count: version.versionNumber,
      });
      await onAccepted(version);
    } catch (err) {
      setError(err.message);
      setStatus("ready");
    }
  }

  function cancel() {
    // Only counts as a cancel if there was a suggestion to walk away from.
    if (status === "ready" || status === "saving") {
      posthog.capture("prompt_improvement_canceled", {
        prompt_id: promptId,
        base_version: currentVersionNumber,
        edited,
      });
    }
    onClose();
  }

  return (
    <section className="improve-panel" aria-label={`Improve ${title}`}>
      <div className="improve-header">
        <h2>Improve {title}</h2>
        <p className="improve-sub">
          Current version <strong>v{currentVersionNumber}</strong>
          {result && (
            <>
              {" "}
              · Completeness grade{" "}
              <strong>
                {result.critique.score}/{result.critique.maxScore}
              </strong>
            </>
          )}
        </p>
      </div>

      {status === "loading" && <p className="loading-text">Grading your prompt and drafting an improvement…</p>}

      {status === "error" && (
        <>
          <div className="error-banner">
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </>
      )}

      {(status === "ready" || status === "saving") && result && (
        <>
          {opportunities.length === 0 ? (
            <p className="improve-found">
              Nothing to fix — this prompt already specifies all 7 areas well.
            </p>
          ) : (
            <>
              <p className="improve-found">
                PromptMe found {opportunities.length} {opportunities.length === 1 ? "opportunity" : "opportunities"}:
              </p>
              <ol className="improve-opportunities">
                {opportunities.map((o) => (
                  <li key={o.key}>
                    <strong>{DIMENSION_LABELS[o.key]}</strong> — {o.diagnosis}
                    <span className="improve-fix">Fix: {o.fix}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          <h3 className="improve-subheading">Proposed improvement</h3>
          {!hasChanges ? (
            <p className="improve-found">The suggestion is the same as your current version.</p>
          ) : (
            <DiffView diff={diff} label={`Changes from v${currentVersionNumber} to the suggestion`} />
          )}

          {editing && (
            <div className="improve-edit">
              <label htmlFor="improve-edit-text">Edit the suggestion before saving</label>
              <textarea
                id="improve-edit-text"
                value={suggestion}
                rows={14}
                onChange={(e) => setSuggestion(e.target.value)}
              />
              {edited && (
                <button type="button" className="link-button" onClick={() => setSuggestion(result.improvedContent)}>
                  Reset to PromptMe’s suggestion
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          <div className="improve-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={accept}
              disabled={status === "saving" || !hasChanges || suggestion.trim() === ""}
            >
              {status === "saving" ? "Saving…" : `Accept and create v${currentVersionNumber + 1}`}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing((v) => !v)} disabled={status === "saving"}>
              {editing ? "Done editing" : "Edit first"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancel} disabled={status === "saving"}>
              Cancel
            </button>
          </div>
          <p className="improve-note">
            Nothing is saved until you accept. Your current version stays exactly as it is, and the Claude, ChatGPT and
            Gemini views update from whatever you save.
          </p>
        </>
      )}
    </section>
  );
}
