import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import FeedbackWidget from "./FeedbackWidget.jsx";
import { RENDERERS } from "../renderers/index.js";
import { useAuth } from "../context/AuthContext.jsx";
import { createCheckoutSession } from "../api.js";
import "./ResultPreview.css";

// Survives a refresh within the tab but not a new browser session — once
// dismissed, don't nag again on every subsequent locked-tab click.
const LOCKED_CARD_DISMISSED_KEY = "pb_locked_tab_card_dismissed";

function stripFormatting(text) {
  return text
    .replace(/<\/?[a-z_]+>/gi, "")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
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
  promptObject,
  rawAssembled,
  onEditAnswers,
  loading,
  error,
  onRetry,
  originalPrompt,
}) {
  const [activeModel, setActiveModel] = useState("generic");
  const [editedVariants, setEditedVariants] = useState({});
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [plainView, setPlainView] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [lockedCardModel, setLockedCardModel] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const textareaRef = useRef(null);
  const { isPaidUser, openAuthModal } = useAuth();

  // A prompt_object with every field null means either an old backend
  // build (pre-Phase-2) or a parse that found none of the expected tags —
  // degrade to a single untabbed view instead of rendering empty tabs.
  const hasPromptObject = Boolean(promptObject) && Object.values(promptObject).some(Boolean);

  const variants = useMemo(() => {
    if (!hasPromptObject) return {};
    const result = {};
    for (const [key, { render }] of Object.entries(RENDERERS)) {
      result[key] = render(promptObject);
    }
    return result;
  }, [promptObject, hasPromptObject]);

  // Edits are per-tab and local only — switching tabs shows that tab's
  // unedited render unless it's been edited too. Legacy (no-tabs) mode
  // uses a single "raw" key, same mechanism either way.
  const editKey = hasPromptObject ? activeModel : "raw";
  const baseText = hasPromptObject ? variants[activeModel] ?? rawAssembled : rawAssembled;
  const displayText = editedVariants[editKey] ?? baseText;

  function handleTabClick(key) {
    const isLocked = key !== "generic" && !isPaidUser;
    if (isLocked) {
      posthog.capture("model_tab_locked_click", { model: key });
      if (sessionStorage.getItem(LOCKED_CARD_DISMISSED_KEY) !== "1") {
        setLockedCardModel(key);
        posthog.capture("locked_tab_card_shown", { model: key });
      }
      return;
    }
    setLockedCardModel(null);
    setActiveModel(key);
    posthog.capture("model_tab_selected", { model: key });
  }

  function handleLockedCardDismiss() {
    posthog.capture("locked_tab_cta_clicked", { model: lockedCardModel, action: "dismiss" });
    sessionStorage.setItem(LOCKED_CARD_DISMISSED_KEY, "1");
    setLockedCardModel(null);
  }

  function handleLockedCardLearnMore() {
    posthog.capture("locked_tab_cta_clicked", { model: lockedCardModel, action: "learn_more" });
  }

  async function goToCheckout() {
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const { checkoutUrl } = await createCheckoutSession();
      window.location.href = checkoutUrl;
    } catch (err) {
      setCheckoutLoading(false);
      setCheckoutError(err.message);
    }
  }

  function handleStartTrial() {
    posthog.capture("locked_tab_cta_clicked", { model: lockedCardModel, action: "start_trial" });
    // openAuthModal calls its callback immediately if already logged in —
    // no modal shown, straight to checkout.
    openAuthModal(goToCheckout);
  }

  function handleEdit(newText) {
    setEditedVariants((prev) => ({ ...prev, [editKey]: newText }));
  }

  function toggleDiff() {
    const next = !showDiff;
    setShowDiff(next);
    posthog.capture("diff_view_toggled", { action: next ? "open" : "close" });
  }

  async function handleCopy() {
    posthog.capture("prompt_copied", {
      model: hasPromptObject ? activeModel : "generic",
      was_edited: Boolean(editedVariants[editKey]),
    });
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    } catch {
      // fall through to legacy fallback below
    }

    if (legacyCopy(displayText)) {
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

        {hasPromptObject && (
          <div className="model-tabs" role="tablist">
            {Object.entries(RENDERERS).map(([key, { label, icon }]) => {
              const isLocked = key !== "generic" && !isPaidUser;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeModel === key}
                  aria-disabled={isLocked}
                  className={`model-tab ${activeModel === key ? "active" : ""} ${
                    isLocked ? "locked" : ""
                  }`}
                  onClick={() => handleTabClick(key)}
                  title={isLocked ? "Subscribe to copy for specific models" : ""}
                >
                  <span className="model-icon" aria-hidden="true">
                    {icon}
                  </span>
                  {label}
                  {isLocked && (
                    <span className="lock-icon" aria-hidden="true">
                      🔒
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {lockedCardModel && (
          <div className="locked-tab-card">
            <p className="locked-tab-card-title">🔒 Model-specific formatting is a Pro feature.</p>
            <p className="locked-tab-card-body">
              Different models read your prompt differently. Pro formats it for the one you're
              using.
            </p>
            {checkoutError && (
              <div className="error-banner">
                <span>{checkoutError}</span>
                <button type="button" className="btn btn-secondary" onClick={goToCheckout}>
                  Retry
                </button>
              </div>
            )}
            <div className="locked-tab-card-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStartTrial}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? "One sec…" : "Start 7-day free trial →"}
              </button>
              <Link
                to="/pro"
                state={{ fromLockedTab: true }}
                className="link-button"
                onClick={handleLockedCardLearnMore}
              >
                Learn more
              </Link>
              <button type="button" className="btn btn-ghost" onClick={handleLockedCardDismiss}>
                Maybe later
              </button>
            </div>
          </div>
        )}

        {plainView ? (
          <div className="result-plain-view">{stripFormatting(displayText)}</div>
        ) : (
          <textarea
            ref={textareaRef}
            className="result-textarea"
            value={displayText}
            onChange={(e) => handleEdit(e.target.value)}
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
          <button type="button" className="link-button diff-toggle" onClick={toggleDiff}>
            {showDiff ? "Hide comparison" : "See what changed"}
          </button>
        </div>

        {showDiff && (
          <div className="diff-view">
            <div className="diff-pane diff-original">
              <h4>Your original prompt</h4>
              <pre>{originalPrompt}</pre>
            </div>
            <div className="diff-pane diff-assembled">
              <h4>Assembled prompt</h4>
              <pre>{displayText}</pre>
            </div>
          </div>
        )}
      </div>
      <FeedbackWidget originalPrompt={originalPrompt} />
    </>
  );
}
