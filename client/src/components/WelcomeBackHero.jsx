import { forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import posthog from "posthog-js";
import { scrollToElement } from "../scrollToElement.js";
import "./WelcomeBackHero.css";

function truncate(text, max = 80) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function formatRelative(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Shown instead of the marketing hero for authenticated users who've built
// at least one prompt before (per the sessions table populated since the
// monetisation gate) — GET /api/sessions already returns everything needed,
// no new backend work.
const WelcomeBackHero = forwardRef(function WelcomeBackHero({ sessions }, ref) {
  const navigate = useNavigate();

  function handleResume(session) {
    posthog.capture("home_resume_session", { session_id: session.id });
    // Same location.state handoff PromptBuilder.jsx already handles for
    // the Prompt Library's "Build on this" prefill, extended with a second
    // key carrying the whole cached result rather than just raw text.
    navigate("/", { state: { resumeSession: session } });
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
            <button type="button" className="welcome-back-session-item" onClick={() => handleResume(session)}>
              <span className="welcome-back-session-text">{truncate(session.originalPrompt)}</span>
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
