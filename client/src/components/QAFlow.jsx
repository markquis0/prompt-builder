import QuestionCard from "./QuestionCard.jsx";
import SupportingContext from "./SupportingContext.jsx";

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
          <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={loading}>
            Skip
          </button>
        </div>
        <div className="qa-nav-right">
          <button type="button" className="btn btn-ghost" onClick={onSkipToResult} disabled={loading}>
            Skip to result
          </button>
          <button type="button" className="btn btn-primary" onClick={onNext} disabled={loading}>
            {loading ? "Building your prompt…" : isLast ? "Generate prompt" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
