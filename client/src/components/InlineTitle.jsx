import { useState } from "react";
import "./InlineTitle.css";

// A prompt's title with an in-place "Rename" — no separate settings screen.
// `onSave(newTitle)` must return a promise and throw to signal failure; the
// message is shown inline and the user's draft is kept so nothing is lost.
// `as` picks the heading element so each page keeps its own heading level.
export default function InlineTitle({ title, canEdit, onSave, as: Heading = "h1", className = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEditing() {
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  async function save(e) {
    e?.preventDefault();
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === "") {
      setError("A title can't be empty.");
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Couldn't rename this prompt. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className={`inline-title ${className}`}>
        <Heading className="inline-title-text">{title}</Heading>
        {canEdit && (
          <button type="button" className="link-button inline-title-rename" onClick={startEditing}>
            Rename
          </button>
        )}
      </div>
    );
  }

  return (
    <form className={`inline-title inline-title-editing ${className}`} onSubmit={save}>
      <input
        type="text"
        className="inline-title-input"
        value={draft}
        maxLength={120}
        autoFocus
        aria-label="Prompt title"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
      />
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
        Cancel
      </button>
      {error && <p className="inline-title-error">{error}</p>}
    </form>
  );
}
