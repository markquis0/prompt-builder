import { forwardRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import posthog from "posthog-js";
import { scrollToElement } from "../scrollToElement.js";
import { truncate, formatRelative } from "../formatSession.js";
import { openPromptInBuilder } from "../promptResume.js";
import "./WelcomeBackHero.css";

// Shown instead of the marketing hero for authenticated users who've built
// at least one prompt before (per the sessions table populated since the
// monetisation gate) — GET /api/sessions already returns everything needed,
// no new backend work.
const WelcomeBackHero = forwardRef(function WelcomeBackHero({ prompts }, ref) {
  const navigate = useNavigate();
  const [resumingId, setResumingId] = useState(null);

  // `prompts` is the lean list shape from GET /api/prompts (id, name,
  // updatedAt) — resuming needs the full current version, which
  // openPromptInBuilder fetches before navigating.
  async function handleResume(prompt) {
    if (resumingId) return;
    setResumingId(prompt.id);
    try {
      await openPromptInBuilder(navigate, prompt.id);
      posthog.capture("home_resume_session", { prompt_id: prompt.id });
    } catch (err) {
      console.error("[prompt-builder] Failed to resume prompt:", err);
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
        {prompts.map((prompt) => (
          <li key={prompt.id}>
            <button
              type="button"
              className="welcome-back-session-item"
              onClick={() => handleResume(prompt)}
              disabled={resumingId === prompt.id}
            >
              <span className="welcome-back-session-text">
                {resumingId === prompt.id ? "Loading…" : truncate(prompt.name)}
              </span>
              <span className="welcome-back-session-date">{formatRelative(prompt.updatedAt)}</span>
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
