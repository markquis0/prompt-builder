import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import FeedbackWidget from "./FeedbackWidget.jsx";
import CompletenessScore from "./CompletenessScore.jsx";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import { RENDERERS } from "../renderers/index.js";
import { useAuth } from "../context/AuthContext.jsx";
import { createCheckoutSession } from "../api.js";
import { useStripeRedirect } from "../useStripeRedirect.js";
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

// Same technique as BeforeAfter.jsx's highlightTags — muted-color the XML
// tag names so structure reads at a glance. Only used for the read-only
// preview (see isEditingOutput below); the actual edit surface stays a
// plain textarea, since syntax-coloring live-edited text without a much
// heavier contenteditable/overlay rig is out of scope here and risks
// regressing editing itself, which Stage 5 explicitly must not touch.
function highlightTags(text) {
  const parts = text.split(/(<\/?[a-z_]+>)/g);
  return parts.map((part, i) =>
    /^<\/?[a-z_]+>$/.test(part) ? (
      <span key={i} className="xml-tag">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function ResultPreview({
  promptObject,
  rawAssembled,
  onEditAnswers,
  loading,
  error,
  onRetry,
  originalPrompt,
  sessionId,
}) {
  const [activeModel, setActiveModel] = useState("generic");
  const [editedVariants, setEditedVariants] = useState({});
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [plainView, setPlainView] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  // Read-only highlighted view by default; clicking in reveals the real
  // textarea (autofocused) for editing. Reset on tab switch so the newly
  // active tab's content isn't silently left in edit mode.
  // Controls only which layer is visible (see result-output-wrapper below)
  // — the textarea itself is always mounted with the same ref/value/
  // onChange, so toggling this never touches its focus/cursor/selection
  // state, only a CSS-visibility class.
  const [outputFocused, setOutputFocused] = useState(false);
  const [lockedCardModel, setLockedCardModel] = useState(null);
  const { go: goToCheckout, loading: checkoutLoading, error: checkoutError } = useStripeRedirect(
    createCheckoutSession,
    "checkoutUrl"
  );
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
    setOutputFocused(false);
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
    if (await copyToClipboard(displayText)) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
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
                  {/* Suppressed entirely for trialing/active — isLocked is
                      already exactly `key !== "generic" && !isPaidUser`,
                      so this never shows for a paid user on any tab. */}
                  {isLocked && <span className="model-tab-pro-chip">Pro</span>}
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
          <div className="result-output-wrapper">
            {!outputFocused && (
              <pre
                className="result-output-highlighted"
                role="button"
                tabIndex={0}
                aria-label="Click to edit"
                onClick={() => textareaRef.current?.focus()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    textareaRef.current?.focus();
                  }
                }}
              >
                {highlightTags(displayText)}
              </pre>
            )}
            <textarea
              ref={textareaRef}
              className={`result-textarea ${!outputFocused ? "result-textarea-layered" : ""}`}
              value={displayText}
              onChange={(e) => handleEdit(e.target.value)}
              onFocus={() => setOutputFocused(true)}
              onBlur={() => setOutputFocused(false)}
              rows={16}
            />
            <div className="result-output-fade" aria-hidden="true" />
          </div>
        )}

        <div className="copy-row">
          <button type="button" className="btn btn-primary copy-btn" onClick={handleCopy}>
            {copied ? "Copied!" : hasPromptObject ? `Copy ${RENDERERS[activeModel].label} version` : "Copy"}
          </button>
          {copyFailed && (
            <span className="copy-fallback-hint">
              Couldn't access your clipboard — text is selected, press Ctrl/Cmd+C to copy.
            </span>
          )}
          <button type="button" className="link-button diff-toggle" onClick={toggleDiff}>
            <span aria-hidden="true">⇄</span> {showDiff ? "Hide comparison" : "See what changed"}
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

        {hasPromptObject && (
          <CompletenessScore
            promptObject={promptObject}
            originalPrompt={originalPrompt}
            rawAssembled={rawAssembled}
            sessionId={sessionId}
            onEditAnswers={onEditAnswers}
          />
        )}
      </div>
      <FeedbackWidget originalPrompt={originalPrompt} />
    </>
  );
}
