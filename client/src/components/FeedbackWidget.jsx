import { useState } from "react";
import { useForm } from "@formspree/react";

const QUESTIONS_USEFUL_OPTIONS = ["Yes", "Kind of", "Felt like busywork"];
const WOULD_USE_OPTIONS = ["Yes", "With edits", "No"];

// Cold, public traffic (Reddit/HN) — no account, no DB. Submits via the
// official @formspree/react SDK; see README "Deploy" for how the form ID
// is set (VITE_FEEDBACK_FORM_ID).
export default function FeedbackWidget({ originalPrompt }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [questionsUseful, setQuestionsUseful] = useState(null);
  const [wouldUseAsIs, setWouldUseAsIs] = useState(null);
  const [comments, setComments] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);

  const formId = import.meta.env.VITE_FEEDBACK_FORM_ID;
  // useForm must be called unconditionally; submission itself is guarded
  // below so an unset formId never fires a request against a bogus key.
  const [formState, submitFeedback] = useForm(formId || "unconfigured");

  function handleSubmit() {
    if (!formId) {
      setNotConfigured(true);
      return;
    }
    setNotConfigured(false);
    // useForm's handleSubmit accepts a plain data object directly, not just
    // a form submit event — no hidden <form>/<input> plumbing needed for
    // this button-driven, non-native-form UI.
    submitFeedback({
      questions_useful: questionsUseful,
      would_use_as_is: wouldUseAsIs,
      comments,
      original_prompt: originalPrompt,
    });
  }

  if (dismissed) return null;

  if (formState.succeeded) {
    return (
      <div className="card feedback-widget">
        <p className="feedback-thanks">Thanks — this helps.</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="card feedback-widget feedback-collapsed">
        <span className="feedback-prompt-text">Got a sec for quick feedback?</span>
        <div className="feedback-collapsed-actions">
          <button type="button" className="link-button" onClick={() => setExpanded(true)}>
            Give feedback
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDismissed(true)}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  const failed = notConfigured || Boolean(formState.errors);
  const canSubmit =
    Boolean(questionsUseful) && Boolean(wouldUseAsIs) && !formState.submitting;

  return (
    <div className="card feedback-widget">
      <div className="feedback-header">
        <h3>Quick feedback</h3>
        <button
          type="button"
          className="btn btn-ghost feedback-close"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss feedback"
        >
          ×
        </button>
      </div>

      <p className="feedback-question">Were the clarifying questions useful?</p>
      <div className="chip-row" role="group" aria-label="Were the clarifying questions useful?">
        {QUESTIONS_USEFUL_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`chip ${questionsUseful === opt ? "chip-selected" : ""}`}
            aria-pressed={questionsUseful === opt}
            onClick={() => setQuestionsUseful(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      <p className="feedback-question">Would you use this prompt as-is?</p>
      <div className="chip-row" role="group" aria-label="Would you use this prompt as-is?">
        {WOULD_USE_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`chip ${wouldUseAsIs === opt ? "chip-selected" : ""}`}
            aria-pressed={wouldUseAsIs === opt}
            onClick={() => setWouldUseAsIs(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="feedback-comments">
        Anything confusing, missing, or that would make you come back?{" "}
        <span className="optional">(optional)</span>
      </label>
      <textarea
        id="feedback-comments"
        className="feedback-comments"
        rows={2}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
      />

      {failed && (
        <div className="error-banner">
          <span>Couldn't send — mind trying again?</span>
          <button type="button" className="btn btn-secondary" onClick={handleSubmit}>
            Retry
          </button>
        </div>
      )}

      <div className="feedback-actions">
        <button
          type="button"
          className="btn btn-primary feedback-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {formState.submitting ? "Sending…" : "Submit"}
        </button>
        <button type="button" className="link-button" onClick={() => setDismissed(true)}>
          Not now
        </button>
      </div>
    </div>
  );
}
