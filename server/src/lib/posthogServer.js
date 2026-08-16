import { PostHog } from "posthog-node";

// Same lazy-construction pattern as getStripe() in routes/billing.js — this
// module is imported unconditionally, and POSTHOG_KEY is optional (analytics
// isn't load-bearing for the app to function), so nothing here should throw
// or block server boot when it's unset.
//
// POSTHOG_KEY is the same *Project API Key* (phc_...) as the client's
// VITE_POSTHOG_KEY, not a separate secret — PostHog's own docs say this key
// is safe to use for capturing events from a server. It has to be
// configured separately here anyway because Vite's import.meta.env.VITE_*
// vars are baked into the browser bundle at build time and never reach this
// Node process, which only sees process.env.
let client = null;

function getClient() {
  if (!process.env.POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(process.env.POSTHOG_KEY, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    });
  }
  return client;
}

// Fire-and-forget by design, same as the client-side posthog.capture()
// calls throughout the app — never let an analytics hiccup threaten a
// caller in a payment-critical path (e.g. the Stripe webhook handler).
export function captureServerEvent({ distinctId, event, properties }) {
  try {
    const ph = getClient();
    if (!ph || !distinctId) return;
    ph.capture({ distinctId, event, properties });
  } catch (err) {
    console.error("[prompt-builder] PostHog server capture failed:", err);
  }
}
