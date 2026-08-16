import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import posthog from "posthog-js";
import IntakeForm from "./IntakeForm.jsx";
import BuilderStepper from "./BuilderStepper.jsx";
import QAFlow from "./QAFlow.jsx";
import ResultPreview from "./ResultPreview.jsx";
import { fetchQuestions, assemblePrompt, saveServerSession } from "../api.js";
import { loadSession, saveSession, clearSession } from "../storage.js";
import { useAuth } from "../context/AuthContext.jsx";
import { scoreCompleteness, COMPLETENESS_BEFORE_EDIT_KEY } from "../completeness.js";
import { scrollToElement } from "../scrollToElement.js";
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
  serverSessionId: null,
};

// Three ways this component can start: prefilled from the Prompt Library
// ("Build on this"), resumed from a saved server session, or (the common
// case) whatever's already in local storage.
function getInitialSession(location) {
  const prefillPrompt = location.state?.prefillPrompt;
  if (prefillPrompt) {
    return { ...EMPTY_SESSION, prompt: prefillPrompt };
  }
  const resumeSession = location.state?.resumeSession;
  if (resumeSession) {
    // qaPairs from the API don't carry the original per-question ids
    // (only question text + answer) — synthesized here from array index.
    // Only matters if the user clicks "Edit answers" afterward; doesn't
    // need to match whatever ids existed when this was first built.
    const questions = (resumeSession.qaPairs || []).map((pair, i) => ({
      id: `q${i}`,
      text: pair.question,
    }));
    const answers = Object.fromEntries((resumeSession.qaPairs || []).map((pair, i) => [`q${i}`, pair.answer]));
    return {
      ...EMPTY_SESSION,
      stage: "result",
      prompt: resumeSession.originalPrompt,
      supportingContext: resumeSession.supportingContext || "",
      promptObject: resumeSession.promptObject,
      rawAssembled: resumeSession.rawAssembled,
      questions,
      answers,
      currentIndex: Math.max(0, questions.length - 1),
      serverSessionId: resumeSession.id,
    };
  }
  return loadSession() || EMPTY_SESSION;
}

// The intake/QA/result stage machine — previously App.jsx owned both this
// and the `/` route. Now it's a self-contained, embeddable component so it
// can live inside HomePage.jsx alongside marketing content. Behavior is
// unchanged from before the extraction; only where it's mounted changed.
export default function PromptBuilder() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Checked in the lazy initializer, not an effect — IntakeForm reads
  // `initialPrompt` into its own local state only once, on its first
  // mount (see IntakeForm.jsx), so the prefill has to already be correct
  // by the time session.prompt is first computed, not patched in afterward.
  const [session, setSession] = useState(() => getInitialSession(location));
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState(null);
  const [assembleLoading, setAssembleLoading] = useState(false);
  const [assembleError, setAssembleError] = useState(null);
  const [lastIntakeSubmission, setLastIntakeSubmission] = useState(null);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  // "Build on this" from the Prompt Library (PromptCard.jsx) navigates here
  // with this state set. Scroll to the builder same as the Phase 2c
  // returning-visitor autoscroll, then clear the state via replace so a
  // later browser-back doesn't silently re-apply an old prefill.
  useEffect(() => {
    if (location.state?.prefillPrompt || location.state?.resumeSession) {
      scrollToElement(document.getElementById("builder"));
      navigate(location.pathname, { replace: true, state: {} });
    }
    // Only on the state actually changing, not on every navigate() call
    // this effect itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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
      // serverSessionId reset here, not just left stale from a previous
      // assembly — insertSession always creates a new row, so the old id
      // no longer points at this result. Layer 2 critique (see
      // ResultPreview.jsx) works fine with no id yet; it just can't
      // persist until the save below resolves.
      patchSession({ stage: "result", promptObject, rawAssembled, serverSessionId: null });

      // Additive only — anonymous users are completely unaffected. Fire-
      // and-forget: a failed save shouldn't interrupt someone looking at
      // the result they just got, so it's logged, not surfaced in the UI.
      if (user) {
        saveServerSession({ ...current, promptObject, rawAssembled })
          .then(({ session: saved }) => {
            patchSession({ serverSessionId: saved.id });
          })
          .catch((err) => {
            console.error("[prompt-builder] Failed to save session:", err);
          });
      }
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
    if (session.promptObject) {
      const { score } = scoreCompleteness(session.promptObject);
      sessionStorage.setItem(COMPLETENESS_BEFORE_EDIT_KEY, String(score));
    }
    patchSession({
      stage: "qa",
      currentIndex: Math.max(0, session.questions.length - 1),
      serverSessionId: null,
    });
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
      <BuilderStepper stage={session.stage} />
      {session.stage === "qa" && (
        <div className="prompt-builder-toolbar">
          <button type="button" className="btn btn-ghost" onClick={startOver}>
            New prompt
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
          sessionId={session.serverSessionId}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}
