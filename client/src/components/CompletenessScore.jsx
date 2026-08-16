import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import { scoreCompleteness, COMPLETENESS_BEFORE_EDIT_KEY } from "../completeness.js";
import { getPromptCritique } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import "./CompletenessScore.css";

const DIMENSION_KEY_MAP = {
  task: "task",
  audience: "audience",
  format: "format",
  context: "context",
  constraints: "constraints",
  examples: "example", // Layer 1's field name vs. Layer 2's dimension key (see prompts.js)
  successCriteria: "success_criteria",
};

export default function CompletenessScore({ promptObject, originalPrompt, rawAssembled, sessionId, onEditAnswers }) {
  const { isPaidUser } = useAuth();
  const [showInfo, setShowInfo] = useState(false);
  const [critique, setCritique] = useState(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const [critiqueError, setCritiqueError] = useState(null);
  const [beforeScore, setBeforeScore] = useState(null);

  const { score, total, checks } = scoreCompleteness(promptObject);
  const percent = Math.round((score / total) * 100);

  // Stage 4 before/after: one-shot read. If this result screen exists
  // because the user just came back from "Edit answers," show the delta
  // once, then clear the flag so a page refresh or a later visit doesn't
  // keep re-showing a stale comparison.
  useEffect(() => {
    const stored = sessionStorage.getItem(COMPLETENESS_BEFORE_EDIT_KEY);
    if (stored !== null) {
      setBeforeScore(Number(stored));
      sessionStorage.removeItem(COMPLETENESS_BEFORE_EDIT_KEY);
    }
    // Re-run whenever a genuinely new result lands (rawAssembled changes),
    // not on every render — this must fire once per assembly, not once
    // per mount, since ResultPreview stays mounted across edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAssembled]);

  // Same condition as the .completeness-before-after render below — fires
  // exactly when that comparison text actually becomes visible, not on
  // every render while it's showing.
  useEffect(() => {
    if (beforeScore !== null && beforeScore !== score) {
      posthog.capture("score_before_after_viewed", {
        before: beforeScore,
        after: score,
        improved: score > beforeScore,
      });
    }
    // Only on beforeScore transitioning to a real value (set by the effect
    // above) — score itself is a plain derived value recomputed every
    // render, not a dependency worth re-triggering this on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeScore]);

  async function handleGradeClick() {
    setCritiqueError(null);
    setCritiqueLoading(true);
    posthog.capture("completeness_critique_requested");
    try {
      const result = await getPromptCritique({
        originalPrompt,
        assembledPrompt: rawAssembled,
        sessionId,
      });
      setCritique(result.dimensions);
      posthog.capture("completeness_critique_received");
    } catch (err) {
      setCritiqueError(err.message);
      posthog.capture("completeness_critique_failed");
    } finally {
      setCritiqueLoading(false);
    }
  }

  function handleUpgradeClick() {
    posthog.capture("completeness_upgrade_clicked");
  }

  // Generic re-entry into the Q&A flow, same destination "Edit answers"
  // always used — there's no per-question dimension tag stored anywhere
  // (questions are freely LLM-generated per prompt, not drawn from a fixed
  // per-dimension pool), so this can't jump to a specific question yet.
  function handlePillClick(field) {
    // DIMENSION_KEY_MAP (above) translates Layer 1's internal field name to
    // the canonical dimension id used everywhere else this concept appears
    // (the Layer 2 critique API, and CHECKLIST_ITEMS on /learn/checklist) —
    // "examples"/"successCriteria" here would otherwise never match
    // "example"/"success_criteria" elsewhere in any PostHog analysis that
    // joins on dimension. Analytics-facing fix only; field itself (and the
    // underlying scoring data model) is untouched.
    posthog.capture("completeness_pill_clicked", { dimension: DIMENSION_KEY_MAP[field] });
    onEditAnswers();
  }

  return (
    <div className="completeness-score">
      <div className="completeness-header">
        <h3>
          Completeness: {score}/{total}
        </h3>
        <button type="button" className="completeness-info-link" onClick={() => setShowInfo((v) => !v)}>
          What's this?
        </button>
      </div>

      <div className="completeness-progress-track" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={total}>
        <div className="completeness-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {showInfo && (
        <p className="completeness-info-text">
          This checks which sections are present, not a quality score — it measures whether your
          prompt specifies the 7 things that make a prompt easy to act on. See the{" "}
          <a href="/learn/checklist" target="_blank" rel="noopener noreferrer">
            full checklist
          </a>
          .
        </p>
      )}

      {beforeScore !== null && beforeScore !== score && (
        <p className="completeness-before-after">
          {beforeScore}/{total} → {score}/{total}
          {score > beforeScore ? " — nice, that's more complete." : ""}
        </p>
      )}

      <div className="completeness-pills">
        {checks.map((check) =>
          check.present ? (
            <span key={check.field} className="completeness-pill completeness-pill-complete">
              <span aria-hidden="true">✓</span> {check.label}
            </span>
          ) : (
            <button
              key={check.field}
              type="button"
              className="completeness-pill completeness-pill-incomplete"
              onClick={() => handlePillClick(check.field)}
            >
              + Add {check.label}
            </button>
          )
        )}
      </div>

      {critique && (
        <ul className="completeness-critique-detail-list">
          {checks.map((check) => {
            const critiqueDim = critique[DIMENSION_KEY_MAP[check.field]];
            if (!critiqueDim || critiqueDim.score >= 2) return null;
            return (
              <li key={check.field} className="critique-detail">
                <p className="critique-detail-label">{check.label}</p>
                <p className="critique-diagnosis">{critiqueDim.diagnosis}</p>
                <p className="critique-fix">
                  <strong>Fix:</strong> {critiqueDim.fix}{" "}
                  <button type="button" className="link-button" onClick={onEditAnswers}>
                    Edit answers →
                  </button>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {isPaidUser ? (
        <div className="completeness-layer2-panel">
          {!critique ? (
            <>
              <div className="completeness-layer2-copy">
                <p className="completeness-layer2-title">Get AI-graded critique</p>
                <p className="completeness-layer2-desc">Per-section diagnosis with fix suggestions.</p>
              </div>
              <button
                type="button"
                className="btn btn-primary completeness-layer2-btn"
                onClick={handleGradeClick}
                disabled={critiqueLoading}
              >
                {critiqueLoading ? "Grading…" : "Grade this prompt"}
              </button>
            </>
          ) : (
            <p className="completeness-layer2-done">✓ Graded — see fixes above for incomplete sections.</p>
          )}
          {critiqueError && <p className="critique-error">Couldn't grade this prompt: {critiqueError}</p>}
        </div>
      ) : (
        <p className="completeness-upsell">
          PromptMe Pro members get an AI-graded critique — a diagnosis and specific fix for each
          dimension, not just presence/absence.{" "}
          <Link to="/pro" onClick={handleUpgradeClick}>
            Learn more →
          </Link>
        </p>
      )}
    </div>
  );
}
