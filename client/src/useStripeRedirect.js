import { useState } from "react";

// Shared by ResultPreview.jsx, ProPage.jsx (checkout + billing portal), and
// NavHeader.jsx (billing portal) — all three independently implemented the
// same "call an API that returns a URL, redirect the whole page there,
// track loading/error" shape. apiCall is whichever of createCheckoutSession
// or getBillingPortalUrl the caller needs; both already return
// { checkoutUrl } / { portalUrl } shaped objects, so the caller tells this
// hook which key to read off the response.
//
// Loading/error state is returned but callers aren't required to render
// it. onError is a separate, optional escape hatch for callers that need
// to react to a failure without rendering the error state — NavHeader.jsx
// uses it to preserve its pre-existing console.error-only behavior, since
// it doesn't show any error UI.
export function useStripeRedirect(apiCall, urlKey, onError) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function go() {
    setError(null);
    setLoading(true);
    try {
      const result = await apiCall();
      window.location.href = result[urlKey];
    } catch (err) {
      setLoading(false);
      setError(err.message);
      onError?.(err);
    }
  }

  return { go, loading, error };
}
