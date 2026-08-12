import { useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import { CHECKLIST_ITEMS } from "../pages/learnContent.js";
import "./Checklist.css";

export default function Checklist() {
  const [checked, setChecked] = useState({});

  function toggleItem(field) {
    // Read from render-scope state rather than a setState updater — the
    // updater form is invoked twice under StrictMode (by design, to catch
    // impure updaters), which would double-fire the analytics call below.
    const nextChecked = !checked[field];
    posthog.capture("checklist_item_checked", { item: field, checked: nextChecked });
    setChecked((prev) => ({ ...prev, [field]: nextChecked }));
  }

  function handleCtaClick() {
    posthog.capture("learn_to_builder_click", { from_section: "checklist" });
  }

  return (
    <div className="checklist">
      <ul className="checklist-list">
        {CHECKLIST_ITEMS.map((item) => (
          <li key={item.field}>
            <label className="checklist-item">
              <input
                type="checkbox"
                checked={Boolean(checked[item.field])}
                onChange={() => toggleItem(item.field)}
              />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
      <Link to="/" className="btn btn-primary checklist-cta" onClick={handleCtaClick}>
        Build a prompt now →
      </Link>
    </div>
  );
}
