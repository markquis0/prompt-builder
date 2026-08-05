import { useState } from "react";

export default function SupportingContext({ value, onChange }) {
  const [open, setOpen] = useState(Boolean(value));

  return (
    <div className="supporting-context">
      <button type="button" className="link-button" onClick={() => setOpen((o) => !o)}>
        {open ? "− Hide" : "+ Add"} supporting context {value ? "(added)" : ""}
      </button>
      {open && (
        <textarea
          className="context-textarea"
          placeholder="Paste any background info, notes, or an existing draft you want reflected in the final prompt…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      )}
    </div>
  );
}
