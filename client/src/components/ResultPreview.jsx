import { useRef, useState } from "react";
import posthog from "posthog-js";
import FeedbackWidget from "./FeedbackWidget.jsx";

function stripTags(text) {
  return text
    .replace(/<\/?[a-z_]+>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Legacy fallback for browsers/contexts where the async Clipboard API is
// unavailable or denied (e.g. insecure context, restrictive permissions policy).
function legacyCopy(text) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

export default function ResultPreview({
  prompt,
  onChange,
  onEditAnswers,
  loading,
  error,
  onRetry,
  originalPrompt,
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [plainView, setPlainView] = useState(false);
  const textareaRef = useRef(null);

  async function handleCopy() {
    posthog.capture("prompt_copied");
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    } catch {
      // fall through to legacy fallback below
    }

    if (legacyCopy(prompt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      // Last resort: select the textarea text so the user can copy manually.
      textareaRef.current?.select();
      setCopyFailed(true);
    }
  }

  if (loading) {
    return (
      <div className="card result-preview">
        <p className="loading-text">Assembling your final prompt…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card result-preview">
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card result-preview">
        <div className="result-header">
          <h2>Your structured prompt</h2>
          <div className="result-header-actions">
            <button type="button" className="link-button" onClick={onEditAnswers}>
              Edit answers
            </button>
            <label className="plain-toggle">
              <input
                type="checkbox"
                checked={plainView}
                onChange={(e) => setPlainView(e.target.checked)}
              />
              Hide tags (display only)
            </label>
          </div>
        </div>

        {plainView ? (
          <div className="result-plain-view">{stripTags(prompt)}</div>
        ) : (
          <textarea
            ref={textareaRef}
            className="result-textarea"
            value={prompt}
            onChange={(e) => onChange(e.target.value)}
            rows={16}
          />
        )}

        <div className="copy-row">
          <button type="button" className="btn btn-primary copy-btn" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
          {copyFailed && (
            <span className="copy-fallback-hint">
              Couldn't access your clipboard — text is selected, press Ctrl/Cmd+C to copy.
            </span>
          )}
        </div>
      </div>
      <FeedbackWidget originalPrompt={originalPrompt} />
    </>
  );
}
