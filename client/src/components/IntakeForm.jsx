import { useState } from "react";

const PROMPT_TYPES = ["Writing", "Coding", "Analysis", "Creative", "Research", "Other"];
const MAX_LENGTH = 5000;

export default function IntakeForm({ initialPrompt, initialPromptType, onSubmit, loading, error, onRetry }) {
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [promptType, setPromptType] = useState(initialPromptType || "");

  const trimmed = prompt.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !loading;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ prompt: trimmed, promptType });
  }

  return (
    <form className="card intake-form" onSubmit={handleSubmit}>
      <h1>Prompt Builder</h1>
      <p className="subtitle">
        Type a rough idea of what you want. We'll ask a few quick questions, then hand you a
        detailed, well-structured prompt to paste into Claude, ChatGPT, or any AI tool.
      </p>

      <label htmlFor="prompt" className="field-label">
        Your rough prompt
      </label>
      <textarea
        id="prompt"
        className="prompt-textarea"
        placeholder='e.g. "Write me a marketing email"'
        value={prompt}
        maxLength={MAX_LENGTH}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        autoFocus
      />
      <div className="char-count">
        {trimmed.length} / {MAX_LENGTH}
      </div>

      <label htmlFor="promptType" className="field-label">
        Prompt type <span className="optional">(optional)</span>
      </label>
      <select
        id="promptType"
        className="prompt-type-select"
        value={promptType}
        onChange={(e) => setPromptType(e.target.value)}
      >
        <option value="">I'm not sure</option>
        {PROMPT_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
        {loading ? "Thinking of questions…" : "Get clarifying questions"}
      </button>
    </form>
  );
}
