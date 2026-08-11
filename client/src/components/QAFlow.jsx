import posthog from "posthog-js";
import QuestionCard from "./QuestionCard.jsx";
import SupportingContext from "./SupportingContext.jsx";

// Tallies answered vs. skipped across all questions given a snapshot of the
// answers dict. A missing/empty answer counts as skipped, matching how
// App.jsx's buildQaPairs() treats it when assembling the final prompt.
function tallyAnswers(questions, answersSnapshot) {
  let answeredCount = 0;
  let skippedCount = 0;
  questions.forEach((q) => {
    if (answersSnapshot[q.id]) {
      answeredCount += 1;
    } else {
      skippedCount += 1;
    }
  });
  return { answered_count: answeredCount, skipped_count: skippedCount };
}

export default function QAFlow({
  questions,
  answers,
  currentIndex,
  supportingContext,
  onAnswerChange,
  onSupportingContextChange,
  onBack,
  onNext,
  onSkip,
  onSkipToResult,
  loading,
  error,
  onRetry,
}) {
  const question = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;

  function handleNext() {
    if (isLast) {
      // The current question's answer is already reflected in `answers`
      // (QuestionCard fires onAnswerChange on every keystroke), so this
      // snapshot is accurate as-is.
      posthog.capture("qa_completed", tallyAnswers(questions, answers));
    }
    onNext();
  }

  function handleSkip() {
    if (isLast) {
      // Unlike handleNext, the parent hasn't committed this question's skip
      // into `answers` yet at this point — override it locally so the tally
      // matches what's about to be sent to the assembler.
      posthog.capture(
        "qa_completed",
        tallyAnswers(questions, { ...answers, [question.id]: "" })
      );
    }
    onSkip();
  }

  function handleSkipToResult() {
    // Can fire from any question index. Anything never reached is absent
    // from `answers`, which tallyAnswers already counts as skipped.
    posthog.capture("qa_completed", tallyAnswers(questions, answers));
    onSkipToResult();
  }

  return (
    <div className="card qa-flow">
      <div className="qa-progress">
        Question {currentIndex + 1} of {questions.length}
      </div>

      <QuestionCard
        key={question.id}
        question={question}
        value={answers[question.id] ?? ""}
        onChange={(val) => onAnswerChange(question.id, val)}
      />

      <SupportingContext value={supportingContext} onChange={onSupportingContextChange} />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="qa-nav">
        <div className="qa-nav-left">
          <button type="button" className="btn btn-secondary" onClick={onBack} disabled={currentIndex === 0}>
            Back
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleSkip} disabled={loading}>
            Skip
          </button>
        </div>
        <div className="qa-nav-right">
          <button type="button" className="btn btn-ghost" onClick={handleSkipToResult} disabled={loading}>
            Skip to result
          </button>
          <button type="button" className="btn btn-primary" onClick={handleNext} disabled={loading}>
            {loading ? "Building your prompt…" : isLast ? "Generate prompt" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
