import { useState } from "react";
import posthog from "posthog-js";

const DESKTOP_BREAKPOINT = 768;

export default function BuilderNote({ section, children }) {
  // Computed once at mount, not kept in sync with live resizes — this only
  // needs to set the *initial* open/closed state per the design spec.
  const [isDesktop] = useState(
    () => typeof window !== "undefined" && window.innerWidth > DESKTOP_BREAKPOINT
  );

  function handleToggle(e) {
    posthog.capture("builder_note_toggled", {
      section,
      action: e.target.open ? "open" : "close",
    });
  }

  return (
    <details className="builder-note" open={isDesktop} onToggle={handleToggle}>
      <summary>For builders</summary>
      <div className="builder-note-body">{children}</div>
    </details>
  );
}
