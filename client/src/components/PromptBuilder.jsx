import { useEffect, useState } from "react";
import posthog from "posthog-js";
import IntakeForm from "./IntakeForm.jsx";
import QAFlow from "./QAFlow.jsx";
import ResultPreview from "./ResultPreview.jsx";
import { fetchQuestions, assemblePrompt } from "../api.js";
import { loadSession, saveSession, clearSession } from "../storage.js";
import "./PromptBuilder.css";

const EMPTY_SESSION = {
  stage: "intake",
  prompt: "",
  promptType: "",
  questions: [],
  answers: {},
  currentIndex: 0,
  supportingContext: "",
  promptObject: null,
  rawAssembled: "",
};

// The intake/QA/result stage machine — previously App.jsx owned both this
// and the `/` route. Now it's a self-contained, embeddable component so it
// can live inside HomePage.jsx alongside marketing content. Behavior is
// unchanged from before the extraction; only where it's mounted changed.
export default function PromptBuilder() {
  const [session, setSession] = useState(() => loadSession() || EMPTY_SESSION);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState(null);
  const [assembleLoading, setAssembleLoading] = useState(false);
  const [assembleError, setAssembleError] = useState(null);
  const [lastIntakeSubmission, setLastIntakeSubmission] = useState(null);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  function patchSession(patch) {
    setSession((s) => ({ ...s, ...patch }));
  }

  async function requestQuestions({ prompt, promptType }) {
    setLastIntakeSubmission({ prompt, promptType });
    setQuestionsError(null);
    setQuestionsLoading(true);
    try {
      const { questions } = await fetchQuestions({ prompt, promptType });
      posthog.capture("questions_received", { question_count: questions.length });
      setQuestionsLoading(false);
      setSession(() => ({
        ...EMPTY_SESSION,
        stage: "qa",
        prompt,
        promptType,
        questions,
      }));
    } catch (err) {
      posthog.capture("questions_request_failed");
      setQuestionsLoading(false);
      setQuestionsError(err.message);
    }
  }

  function buildQaPairs(current) {
    return current.questions.map((q) => ({
      question: q.text,
      answer: current.answers[q.id] || "",
    }));
  }

  async function requestAssembly(current) {
    setAssembleError(null);
    setAssembleLoading(true);
    try {
      const { promptObject, rawAssembled } = await assemblePrompt({
        originalPrompt: current.prompt,
        supportingContext: current.supportingContext,
        qaPairs: buildQaPairs(current),
        // One assembly call regardless of which model tab the user ends up
        // on — per-model formatting happens client-side in renderers/.
        targetModel: "generic",
      });
      posthog.capture("result_generated");
      setAssembleLoading(false);
      patchSession({ stage: "result", promptObject, rawAssembled });
    } catch (err) {
      posthog.capture("assemble_request_failed");
      setAssembleLoading(false);
      setAssembleError(err.message);
    }
  }

  function handleAnswerChange(id, value) {
    patchSession({ answers: { ...session.answers, [id]: value } });
  }

  function handleSupportingContextChange(value) {
    patchSession({ supportingContext: value });
  }

  function goToNextQuestion() {
    const isLast = session.currentIndex === session.questions.length - 1;
    if (isLast) {
      requestAssembly(session);
    } else {
      patchSession({ currentIndex: session.currentIndex + 1 });
    }
  }

  function skipQuestion() {
    const question = session.questions[session.currentIndex];
    const answers = { ...session.answers, [question.id]: "" };
    const isLast = session.currentIndex === session.questions.length - 1;
    if (isLast) {
      const next = { ...session, answers };
      setSession(next);
      requestAssembly(next);
    } else {
      patchSession({ answers, currentIndex: session.currentIndex + 1 });
    }
  }

  function goBack() {
    patchSession({ currentIndex: Math.max(0, session.currentIndex - 1) });
  }

  function skipToResult() {
    requestAssembly(session);
  }

  function editAnswers() {
    patchSession({ stage: "qa", currentIndex: Math.max(0, session.questions.length - 1) });
  }

  function startOver() {
    const hasContent =
      session.prompt || session.rawAssembled || Object.values(session.answers).some(Boolean);
    if (hasContent && !window.confirm("This will clear your current progress. Start over?")) {
      return;
    }
    clearSession();
    setSession(EMPTY_SESSION);
    setQuestionsError(null);
    setAssembleError(null);
  }

  return (
    <div className="prompt-builder">
      {session.stage !== "intake" && (
        <div className="prompt-builder-toolbar">
          <button type="button" className="btn btn-ghost" onClick={startOver}>
            Start Over
          </button>
        </div>
      )}

      {session.stage === "intake" && (
        <IntakeForm
          initialPrompt={session.prompt}
          initialPromptType={session.promptType}
          onSubmit={requestQuestions}
          loading={questionsLoading}
          error={questionsError}
          onRetry={() => lastIntakeSubmission && requestQuestions(lastIntakeSubmission)}
        />
      )}

      {session.stage === "qa" && (
        <QAFlow
          questions={session.questions}
          answers={session.answers}
          currentIndex={session.currentIndex}
          supportingContext={session.supportingContext}
          onAnswerChange={handleAnswerChange}
          onSupportingContextChange={handleSupportingContextChange}
          onBack={goBack}
          onNext={goToNextQuestion}
          onSkip={skipQuestion}
          onSkipToResult={skipToResult}
          loading={assembleLoading}
          error={assembleError}
          onRetry={() => requestAssembly(session)}
        />
      )}

      {session.stage === "result" && (
        <ResultPreview
          promptObject={session.promptObject}
          rawAssembled={session.rawAssembled}
          onEditAnswers={editAnswers}
          loading={assembleLoading}
          error={assembleError}
          onRetry={() => requestAssembly(session)}
          originalPrompt={session.prompt}
        />
      )}
    </div>
  );
}
