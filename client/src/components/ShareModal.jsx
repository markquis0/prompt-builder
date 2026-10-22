import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { listPromptShares, sharePrompt, removePromptShare } from "../api.js";
import "./AuthModal.css";
import "./ShareModal.css";

// Owner-only. Sharing is private and person-to-person: the recipient is an
// existing PromptMe account and sees whatever the prompt's *current* version
// is (no re-sharing per version), read-only. `onChanged(shareCount)` lets the
// caller keep a count in sync (e.g. History's "Shared with 2").
export default function ShareModal({ promptId, promptTitle, sourcePage, onClose, onChanged }) {
  const [shares, setShares] = useState(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    listPromptShares(promptId)
      .then(({ shares }) => setShares(shares))
      .catch((err) => setError(err.message));
  }, [promptId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleShare(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const { share } = await sharePrompt(promptId, email);
      const next = [...(shares || []), share];
      setShares(next);
      setEmail("");
      onChanged?.(next.length);
      posthog.capture("prompt_shared", {
        prompt_id: promptId,
        share_permission: share.permission,
        source_page: sourcePage,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(share) {
    setError(null);
    setRemovingId(share.id);
    try {
      await removePromptShare(promptId, share.id);
      const next = shares.filter((s) => s.id !== share.id);
      setShares(next);
      onChanged?.(next.length);
      posthog.capture("prompt_share_removed", {
        prompt_id: promptId,
        share_permission: share.permission,
        source_page: sourcePage,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div
        className="card auth-modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${promptTitle}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-modal-header">
          <h2>Share “{promptTitle}”</h2>
          <button type="button" className="btn btn-ghost auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="share-modal-intro">
          People you share with can view and copy this prompt and its version history. They always see the current
          version, and can save their own copy — they can’t change yours.
        </p>

        <form className="share-modal-form" onSubmit={handleShare}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            aria-label="Email of a PromptMe account"
            autoFocus
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
            {busy ? "Sharing…" : "Share"}
          </button>
        </form>
        {error && <p className="share-modal-error">{error}</p>}

        <h3 className="share-modal-subheading">People with access</h3>
        {shares === null && !error && <p className="loading-text">Loading…</p>}
        {shares && shares.length === 0 && <p className="share-modal-empty">Only you, for now.</p>}
        {shares && shares.length > 0 && (
          <ul className="share-modal-list">
            {shares.map((share) => (
              <li key={share.id}>
                <span className="share-modal-person">
                  <span className="share-modal-name">
                    {share.user.firstName} {share.user.lastName}
                  </span>
                  <span className="share-modal-email">{share.user.email}</span>
                </span>
                <span className="share-modal-role">Viewer</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleRemove(share)}
                  disabled={removingId === share.id}
                >
                  {removingId === share.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
