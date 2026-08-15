import { useState } from "react";
import { useNavigate } from "react-router-dom";
import posthog from "posthog-js";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import "./PromptCard.css";

// Splits on [bracketed] segments so placeholders render visually distinct
// from the surrounding instruction text — the whole point being that a
// user scanning the card can immediately see what needs customizing.
function PromptText({ text }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <p className="prompt-text">
      {parts.map((part, i) =>
        part.startsWith("[") ? (
          <span key={i} className="prompt-placeholder">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

export default function PromptCard({ prompt, categoryId }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyToClipboard(prompt.text)) {
      setCopied(true);
      posthog.capture("prompt_library_copy", { prompt_id: prompt.id, category: categoryId });
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
    }
  }

  function handleBuildOnThis() {
    posthog.capture("prompt_library_build_on_this", { prompt_id: prompt.id, category: categoryId });
    // Raw text, brackets and all — the user edits [placeholders] themselves
    // in the intake field, same as they would if they'd typed the whole
    // thing manually. See PromptBuilder.jsx for the receiving end.
    navigate("/", { state: { prefillPrompt: prompt.text } });
  }

  return (
    <div className="prompt-card">
      <h3 className="prompt-label">{prompt.label}</h3>
      <PromptText text={prompt.text} />
      <div className="prompt-card-actions">
        <button type="button" className="btn btn-secondary copy-button" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
        <button type="button" className="link-button" onClick={handleBuildOnThis}>
          Build on this →
        </button>
      </div>
    </div>
  );
}
