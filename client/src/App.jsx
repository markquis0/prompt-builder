import { useEffect, useState } from "react";
import IntakeForm from "./components/IntakeForm.jsx";
import QAFlow from "./components/QAFlow.jsx";
import ResultPreview from "./components/ResultPreview.jsx";
import { fetchQuestions, assemblePrompt } from "./api.js";
import { loadSession, saveSession, clearSession } from "./storage.js";

const EMPTY_SESSION = {
  stage: "intake",
  prompt: "",
  promptType: "",
  questions: [],
  answers: {},
  currentIndex: 0,
  supportingContext: "",
  finalPrompt: "",
};

export default function App() {
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
      setQuestionsLoading(false);
      setSession(() => ({
        ...EMPTY_SESSION,
        stage: "qa",
        prompt,
        promptType,
        questions,
      }));
    } catch (err) {
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
      const { prompt: finalPrompt } = await assemblePrompt({
        originalPrompt: current.prompt,
        supportingContext: current.supportingContext,
        qaPairs: buildQaPairs(current),
      });
      setAssembleLoading(false);
      patchSession({ stage: "result", finalPrompt });
    } catch (err) {
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

  function handleFinalPromptChange(value) {
    patchSession({ finalPrompt: value });
  }

  function startOver() {
    const hasContent =
      session.prompt || session.finalPrompt || Object.values(session.answers).some(Boolean);
    if (hasContent && !window.confirm("This will clear your current progress. Start over?")) {
      return;
    }
    clearSession();
    setSession(EMPTY_SESSION);
    setQuestionsError(null);
    setAssembleError(null);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Prompt Builder</span>
        {session.stage !== "intake" && (
          <button type="button" className="btn btn-ghost" onClick={startOver}>
            Start Over
          </button>
        )}
      </header>

      <main className="app-main">
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
            prompt={session.finalPrompt}
            onChange={handleFinalPromptChange}
            onEditAnswers={editAnswers}
            loading={assembleLoading}
            error={assembleError}
            onRetry={() => requestAssembly(session)}
            originalPrompt={session.prompt}
          />
        )}
      </main>
    </div>
  );
}
