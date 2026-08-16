import { useEffect } from "react";
import posthog from "posthog-js";
import { loadSession } from "./storage.js";

// Shared by the anonymous marketing page and the authenticated builder page
// — a visitor with in-progress localStorage content (built before signing
// in, or simply unfinished) should autoscroll either page straight to the
// builder, same as an explicit "#builder" hash link.
export function useBuilderAutoscroll() {
  useEffect(() => {
    const session = loadSession();
    const hasContent = Boolean(
      session &&
        (session.prompt ||
          session.rawAssembled ||
          Object.values(session.answers || {}).some(Boolean))
    );
    const wantsBuilder = window.location.hash === "#builder";
    if (hasContent || wantsBuilder) {
      document.getElementById("builder")?.scrollIntoView();
      if (hasContent) {
        posthog.capture("home_returning_autoscroll");
      }
    }
    // Run once on mount only — this is a landing-behavior decision, not a
    // reactive one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
