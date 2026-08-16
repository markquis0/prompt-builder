import { forwardRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import posthog from "posthog-js";
import { scrollToElement } from "../scrollToElement.js";
import { truncate, formatRelative } from "../formatSession.js";
import { getServerSession } from "../api.js";
import "./WelcomeBackHero.css";

// Shown instead of the marketing hero for authenticated users who've built
// at least one prompt before (per the sessions table populated since the
// monetisation gate) — GET /api/sessions already returns everything needed,
// no new backend work.
const WelcomeBackHero = forwardRef(function WelcomeBackHero({ sessions }, ref) {
  const navigate = useNavigate();
  const [resumingId, setResumingId] = useState(null);

  // sessions here only ever carries the lean {id, originalPrompt,
  // createdAt} shape GET /api/sessions returns (see HomePage.jsx) — the
  // builder's resume logic (PromptBuilder.jsx's getInitialSession) needs
  // qaPairs/promptObject/rawAssembled too, so the full row has to be
  // fetched before navigating, not just the list item that was clicked.
  async function handleResume(session) {
    if (resumingId) return;
    setResumingId(session.id);
    try {
      const { session: full } = await getServerSession(session.id);
      posthog.capture("home_resume_session", { session_id: session.id });
      navigate("/", { state: { resumeSession: full } });
    } catch (err) {
      console.error("[prompt-builder] Failed to resume session:", err);
      setResumingId(null);
    }
  }

  function handleNewPrompt() {
    posthog.capture("home_new_prompt_clicked");
    scrollToElement(document.getElementById("builder"));
  }

  return (
    <section className="home-hero home-welcome-back" id="hero" ref={ref} data-section="hero">
      <h1>Welcome back.</h1>
      <p className="home-hero-subhead">Pick up a recent prompt, or start something new.</p>

      <ul className="welcome-back-sessions">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className="welcome-back-session-item"
              onClick={() => handleResume(session)}
              disabled={resumingId === session.id}
            >
              <span className="welcome-back-session-text">
                {resumingId === session.id ? "Loading…" : truncate(session.originalPrompt)}
              </span>
              <span className="welcome-back-session-date">{formatRelative(session.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn-primary home-hero-cta" onClick={handleNewPrompt}>
        + New prompt
      </button>
    </section>
  );
});

export default WelcomeBackHero;
