import "./ResultPreview.css";
import "./CompletenessScore.css";
import "./ScoringDemo.css";

// Static recreation of CompletenessScore.jsx for the /pro marketing page —
// deliberately not the real interactive component (no live scoring, no API
// call). Per the Phase 4b handoff: a static visual is enough here, and
// building a second interactive demo alongside ProDemo.jsx would be a lot
// of engineering for marginal extra persuasion. Keep this in sync with the
// real component's copy/tone/structure if either changes (this was updated
// for Stage 5's pill/progress-bar redesign) — it never calls
// getPromptCritique, the numbers below are illustrative, not live output.
const CHECKS = [
  { label: "Task", present: true },
  { label: "Audience", present: true },
  { label: "Format", present: false },
  { label: "Context", present: false },
  { label: "Constraints", present: true },
  { label: "Example", present: false },
  { label: "Success criteria", present: false },
];

export default function ScoringDemo() {
  return (
    <div className="card scoring-demo">
      <div className="completeness-score">
        <div className="completeness-header">
          <h3>Completeness: 3/7</h3>
          <span className="completeness-info-link" aria-hidden="true">
            What's this?
          </span>
        </div>

        <div className="completeness-progress-track" aria-hidden="true">
          <div className="completeness-progress-fill" style={{ width: "43%" }} />
        </div>

        <p className="completeness-before-after">2/7 → 5/7 — nice, that's more complete.</p>

        <div className="completeness-pills">
          {CHECKS.map((check) =>
            check.present ? (
              <span key={check.label} className="completeness-pill completeness-pill-complete">
                <span aria-hidden="true">✓</span> {check.label}
              </span>
            ) : (
              <span key={check.label} className="completeness-pill completeness-pill-incomplete">
                + Add {check.label}
              </span>
            )
          )}
        </div>

        <ul className="completeness-critique-detail-list">
          <li className="critique-detail">
            <p className="critique-detail-label">Format</p>
            <p className="critique-diagnosis">
              No length or structure is specified — "a blog post" could mean 300 words or 3,000.
            </p>
            <p className="critique-fix">
              <strong>Fix:</strong> Specify a target length and structure (e.g. "600–800 words,
              intro plus three sections"). <span className="link-button">Edit answers →</span>
            </p>
          </li>
        </ul>
      </div>
    </div>
  );
}
