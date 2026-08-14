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

  return (
    <div className="completeness-score">
      <div className="completeness-header">
        <h3>
          Completeness: {score}/{total}
        </h3>
        <button
          type="button"
          className="completeness-info-btn"
          aria-label="What's this?"
          onClick={() => setShowInfo((v) => !v)}
        >
          What's this?
        </button>
      </div>

      {showInfo && (
        <p className="completeness-info-text">
          This measures whether your prompt specifies the 7 things that make a prompt easy to act
          on — not whether the output will be good. See the{" "}
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

      <ul className="completeness-checklist">
        {checks.map((check) => {
          const critiqueDim = critique?.[DIMENSION_KEY_MAP[check.field]];
          return (
            <li key={check.field} className={check.present ? "check-present" : "check-missing"}>
              <span className="check-icon" aria-hidden="true">
                {check.present ? "✓" : "○"}
              </span>
              <span className="check-label">{check.label}</span>
              {critiqueDim && (
                <div className="critique-detail">
                  <p className="critique-diagnosis">{critiqueDim.diagnosis}</p>
                  {critiqueDim.score < 2 && (
                    <p className="critique-fix">
                      <strong>Fix:</strong> {critiqueDim.fix}{" "}
                      <button type="button" className="link-button" onClick={onEditAnswers}>
                        Edit answers →
                      </button>
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isPaidUser ? (
        <div className="completeness-layer2">
          {!critique && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGradeClick}
              disabled={critiqueLoading}
            >
              {critiqueLoading ? "Grading…" : "Get AI-graded critique"}
            </button>
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
