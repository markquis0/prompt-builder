import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";

const SITE_URL = "https://promptme.host";

// Placeholder legal content only — see the PLACEHOLDER note rendered on
// each page. Real policy drafting is explicitly out of scope for the UI/UX
// remediation work that added these routes/links; this exists so the
// footer and /pro's trial disclosure have somewhere real to link to
// instead of a 404, not as finished legal copy.
const PAGES = {
  privacy: {
    title: "Privacy Policy",
    body: [
      "This is placeholder content. PromptMe does not yet have a finalized privacy policy — this page exists so the site's legal links resolve to something instead of a broken link, not as a substitute for real policy drafting.",
      "Before this page is treated as accurate or relied on by users, it needs to be replaced with real legal copy covering what data PromptMe collects (account email, prompt sessions for logged-in users, PostHog analytics events), how it's stored (Postgres on Render), third parties involved (Stripe for billing, PostHog for analytics), and user rights (account deletion, data export).",
    ],
  },
  terms: {
    title: "Terms of Service",
    body: [
      "This is placeholder content. PromptMe does not yet have finalized terms of service — this page exists so the site's legal links resolve to something instead of a broken link, not as a substitute for real legal drafting.",
      "Before this page is treated as accurate or relied on by users, it needs to be replaced with real terms covering the service description, the PromptMe Pro subscription (7-day trial, $5/month, cancellation), acceptable use, and liability.",
    ],
  },
  refund: {
    title: "Refund Policy",
    body: [
      "This is placeholder content. PromptMe does not yet have a finalized refund policy — this page exists so the site's legal links resolve to something instead of a broken link, not as a substitute for real policy drafting.",
      "Before this page is treated as accurate or relied on by users, it needs to state PromptMe's actual refund terms for the Pro subscription: whether mid-cycle cancellations are prorated, how the 7-day trial's card-upfront requirement is handled if a user forgets to cancel, and how to request a refund.",
      "In the meantime, cancel any time from Manage billing — the trial itself never charges if canceled before it ends.",
    ],
  },
};

export default function LegalPage({ page }) {
  const content = PAGES[page];
  const path = page === "refund" ? "/refund-policy" : `/${page}`;

  // Previously the only route with zero PostHog coverage at all (no custom
  // event, and — before the capture_pageview fix in main.jsx — no reliable
  // native $pageview either, since this is only ever reached via
  // client-side navigation, not a fresh load).
  useEffect(() => {
    posthog.capture("legal_page_view", { page });
  }, [page]);

  return (
    <div className="app-shell">
      <Helmet>
        <title>{content.title} — PromptMe</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}${path}`} />
      </Helmet>
      <NavHeader />
      <main style={{ paddingBottom: 60 }}>
        <h1>{content.title}</h1>
        <p
          style={{
            background: "var(--accent-bg)",
            color: "var(--accent)",
            fontWeight: 700,
            fontSize: 13,
            padding: "10px 14px",
            borderRadius: 8,
            margin: "12px 0 24px",
          }}
        >
          PLACEHOLDER — not final legal copy. See note below.
        </p>
        {content.body.map((para, i) => (
          <p key={i} style={{ color: "var(--text)", lineHeight: 1.6, marginBottom: 16 }}>
            {para}
          </p>
        ))}
      </main>
    </div>
  );
}
