import { useEffect, useState } from "react";
import { useForm } from "@formspree/react";
import posthog from "posthog-js";

const QUESTIONS_USEFUL_OPTIONS = ["Yes", "Kind of", "Felt like busywork"];
const WOULD_USE_OPTIONS = ["Yes", "With edits", "No"];
const WOULD_RETURN_OPTIONS = [
  "Better/more relevant questions",
  "Ability to save my results and come back later",
  "More output format options",
  "It's already good as-is",
  "Other",
];

// Cold, public traffic (Reddit/HN) — no account, no DB. Submits via the
// official @formspree/react SDK; see README "Deploy" for how the form ID
// is set (VITE_FEEDBACK_FORM_ID).
export default function FeedbackWidget({ originalPrompt }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [questionsUseful, setQuestionsUseful] = useState(null);
  const [wouldUseAsIs, setWouldUseAsIs] = useState(null);
  const [wouldReturnFor, setWouldReturnFor] = useState(null);
  const [comments, setComments] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);

  const formId = import.meta.env.VITE_FEEDBACK_FORM_ID;
  // useForm must be called unconditionally; submission itself is guarded
  // below so an unset formId never fires a request against a bogus key.
  const [formState, submitFeedback] = useForm(formId || "unconfigured");

  // Fires once per mount — i.e. once per result shown, not once per
  // interaction with the widget (re-renders from expanding/answering
  // don't re-run this, since the dependency array is empty).
  useEffect(() => {
    posthog.capture("feedback_widget_shown");
  }, []);

  // Fires exactly once, on the render where `succeeded` flips from false to
  // true — not on every subsequent re-render while it stays true.
  useEffect(() => {
    if (formState.succeeded) {
      posthog.capture("feedback_submitted", {
        questions_useful: questionsUseful,
        would_use_as_is: wouldUseAsIs,
      });
    }
  }, [formState.succeeded]);

  function handleDismiss() {
    posthog.capture("feedback_dismissed");
    setDismissed(true);
  }

  function handleSelectWouldReturnFor(opt) {
    setWouldReturnFor(opt);
    // Hidden fields shouldn't silently carry stale input into the payload —
    // clear any typed text if the user backs off of "Other".
    if (opt !== "Other") {
      setComments("");
    }
  }

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
      would_return_for: wouldReturnFor,
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
      <div className="feedback-collapsed">
        <button type="button" className="link-button feedback-collapsed-cta" onClick={() => setExpanded(true)}>
          Got a sec for quick feedback?
        </button>
        <button
          type="button"
          className="feedback-collapsed-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss feedback prompt"
        >
          ×
        </button>
      </div>
    );
  }

  const failed = notConfigured || Boolean(formState.errors);
  const canSubmit =
    Boolean(questionsUseful) &&
    Boolean(wouldUseAsIs) &&
    Boolean(wouldReturnFor) &&
    !formState.submitting;

  return (
    <div className="card feedback-widget">
      <div className="feedback-header">
        <h3>Quick feedback</h3>
        <button
          type="button"
          className="btn btn-ghost feedback-close"
          onClick={handleDismiss}
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

      <p className="feedback-question">What would make you more likely to use this again?</p>
      <div className="chip-row" role="group" aria-label="What would make you more likely to use this again?">
        {WOULD_RETURN_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`chip ${wouldReturnFor === opt ? "chip-selected" : ""}`}
            aria-pressed={wouldReturnFor === opt}
            onClick={() => handleSelectWouldReturnFor(opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      {wouldReturnFor === "Other" && (
        <>
          <label className="field-label" htmlFor="feedback-comments">
            Anything specific that confused you or felt off?{" "}
            <span className="optional">(totally optional)</span>
          </label>
          <textarea
            id="feedback-comments"
            className="feedback-comments"
            rows={2}
            autoFocus
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
        </>
      )}

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
        <button type="button" className="link-button" onClick={handleDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
