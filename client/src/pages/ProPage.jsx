import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import ProDemo from "../components/ProDemo.jsx";
import ScoringDemo from "../components/ScoringDemo.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { createCheckoutSession, getBillingPortalUrl } from "../api.js";
import "./ProPage.css";

function formatDate(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// Ceil, not floor/round — someone 30 minutes from their trial ending still
// reads as "0 days left," not "-1" or a confusing rollover to a full day.
function daysUntil(isoString) {
  if (!isoString) return null;
  const ms = new Date(isoString).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

const RULES = [
  {
    accent: "gemini",
    title: "Gemini wants your context first.",
    body: 'Google’s documentation says to put instructions after long context and open with "Based on the preceding information…" — the opposite of what most people do.',
    sourceUrl: "https://ai.google.dev/gemini-api/docs/prompting-strategies",
    sourceLabel: "Google's prompt design strategies",
  },
  {
    accent: "openai",
    title: "ChatGPT reads Markdown better than XML.",
    body: "GPT-5.x is trained on more Markdown than XML. Structured headers give it cleaner signal than angle brackets.",
    sourceUrl: "https://developers.openai.com/api/docs/guides/prompt-guidance",
    sourceLabel: "OpenAI's prompt guidance",
  },
  {
    accent: "claude",
    title: "Claude is the opposite.",
    body: "Claude’s own documentation recommends XML-style tags for section boundaries. Same information, different packaging.",
    sourceUrl: "https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview",
    sourceLabel: "Anthropic's prompt engineering overview",
  },
];

export default function ProPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromLockedTab = Boolean(location.state?.fromLockedTab);
  const { user, openAuthModal, refreshUser } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState(null);

  useEffect(() => {
    posthog.capture("pro_page_view", {
      referrer: document.referrer,
      from_locked_tab: fromLockedTab,
    });
    // Only fire once per mount — fromLockedTab is fixed for the life of this page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get("checkout");
    if (!checkout) return;

    // The webhook that actually flips subscription_status runs async on
    // Stripe's side — it's usually done by the time this redirect lands,
    // but not guaranteed, so re-fetch rather than trust whatever AuthContext
    // loaded on initial mount.
    if (checkout === "success") {
      refreshUser();
    }
    // Strip the query param either way so a refresh doesn't re-trigger this.
    navigate("/pro", { replace: true, state: location.state });
    // Only on the param actually changing, not on every navigate() we cause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  function trackCta(action) {
    posthog.capture("pro_cta_clicked", { action });
  }

  async function goToCheckout() {
    trackCta(user ? "subscribe" : "start_trial");
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const { checkoutUrl } = await createCheckoutSession();
      window.location.href = checkoutUrl;
    } catch (err) {
      setCheckoutLoading(false);
      setCheckoutError(err.message);
    }
  }

  function handleSubscribeClick() {
    openAuthModal(goToCheckout);
  }

  // Same GET /api/billing/portal the header's "Manage subscription" link
  // already uses (monetisation gate) — not a second portal-session flow.
  async function goToBillingPortal() {
    trackCta("manage_billing");
    setPortalError(null);
    setPortalLoading(true);
    try {
      const { portalUrl } = await getBillingPortalUrl();
      window.location.href = portalUrl;
    } catch (err) {
      setPortalLoading(false);
      setPortalError(err.message);
    }
  }

  return (
    <div className="app-shell pro-shell">
      <Helmet>
        <title>PromptMe Pro — Format Your Prompt for Every AI Model</title>
        <meta
          name="description"
          content="Each AI model reads your prompt differently. PromptMe Pro formats it for Claude, ChatGPT, and Gemini — based on what each model's own documentation says works best."
        />
        <meta property="og:title" content="PromptMe Pro" />
        <meta
          property="og:description"
          content="Same prompt, three models, three formats. See the difference."
        />
        <meta property="og:url" content="https://promptme.host/pro" />
        <link rel="canonical" href="https://promptme.host/pro" />
      </Helmet>

      <NavHeader />

      <main className="pro-main">
        <section className="pro-hook">
          <h1>Same prompt. Three models. Three formats.</h1>
          <p className="pro-subhead">
            Each AI model reads your prompt differently. We format it for the one you're actually
            using.
          </p>
        </section>

        <section className="pro-demo-section">
          <ProDemo />
        </section>

        <section className="pro-rules">
          <div className="pro-rules-grid">
            {RULES.map((rule) => (
              <div key={rule.title} className={`pro-rule-card pro-rule-${rule.accent}`}>
                <p className="pro-rule-title">{rule.title}</p>
                <p className="pro-rule-body">{rule.body}</p>
                {/* Additive to the summary disclaimer below, not a
                    replacement — links straight to the specific doc this
                    card's claim comes from. */}
                <a
                  href={rule.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pro-rule-source"
                  title={rule.sourceLabel}
                  onClick={() => trackCta("rule_source_" + rule.accent)}
                >
                  Source →
                </a>
              </div>
            ))}
          </div>
          <p className="pro-rules-footer">
            These aren't our opinions. They're from each company's own documentation.{" "}
            <Link to="/learn/by-model" onClick={() => trackCta("learn_more")}>
              See the research →
            </Link>
          </p>
        </section>

        <section className="pro-scoring-section">
          <h2>Know what's missing before you send it</h2>
          <p className="pro-scoring-intro">
            Most advice about writing better prompts is either vague or unproven. We built a
            completeness check instead — it tells you specifically what's missing from your
            prompt, based on the one thing research actually shows matters: whether you've said
            enough.
          </p>
          <ScoringDemo />
          <p className="pro-scoring-disclosure">
            This isn't a quality score — research shows prompt effectiveness varies too much by
            task and model to promise that. It's a completeness check: does your prompt say
            enough for an AI to work with? That part is measurable, and it's exactly what our
            guided questions help you fix.
          </p>
        </section>

        <section className="pro-offer">
          <h2>PromptMe Pro — $5/month</h2>
          <p className="pro-offer-intro">Everything in the free builder, plus:</p>
          <ul className="pro-offer-list">
            <li>Copy your prompt formatted for Claude, ChatGPT, or Gemini</li>
            <li>Each format follows that model's own documentation</li>
            <li>New model formats added as guidance changes</li>
            <li>A completeness check with specific, actionable fixes — not just a score</li>
          </ul>
          <p className="pro-offer-note">
            The builder itself is always free. Build unlimited prompts, get a structured result
            you can paste anywhere.
          </p>
        </section>

        <section className="pro-cta-section">
          {user?.subscriptionStatus === "trialing" || user?.subscriptionStatus === "active" ? (
            <div className="pro-status-card">
              {user.subscriptionStatus === "trialing" ? (
                <>
                  <p className="pro-status-heading">
                    {user.trialEndsAt
                      ? `You're on your free trial — ${daysUntil(user.trialEndsAt)} day${daysUntil(user.trialEndsAt) === 1 ? "" : "s"} left`
                      : "You're on your free trial"}
                  </p>
                  <p className="pro-status-detail">
                    {user.currentPeriodEndsAt
                      ? `$5/month starting ${formatDate(user.currentPeriodEndsAt)}, unless you cancel first.`
                      : "Cancel anytime before it ends and you won't be charged."}
                  </p>
                </>
              ) : (
                <>
                  <p className="pro-status-heading">You're on PromptMe Pro — $5/month</p>
                  <p className="pro-status-detail">
                    {user.currentPeriodEndsAt
                      ? `Renews ${formatDate(user.currentPeriodEndsAt)}.`
                      : "Active subscription."}
                  </p>
                </>
              )}
              <div className="pro-status-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={goToBillingPortal}
                  disabled={portalLoading}
                >
                  {portalLoading ? "One sec…" : "Manage billing"}
                </button>
                <Link to="/#builder" className="btn btn-primary" onClick={() => trackCta("try_builder")}>
                  Go to your builder →
                </Link>
              </div>
              {portalError && (
                <div className="error-banner pro-cta-error">
                  <span>{portalError}</span>
                  <button type="button" className="btn btn-secondary" onClick={goToBillingPortal}>
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary pro-cta-btn"
                onClick={handleSubscribeClick}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? "One sec…" : "Start 7-day free trial →"}
              </button>
              {checkoutError && (
                <div className="error-banner pro-cta-error">
                  <span>{checkoutError}</span>
                  <button type="button" className="btn btn-secondary" onClick={goToCheckout}>
                    Retry
                  </button>
                </div>
              )}
              <p className="pro-cta-note">No credit card charge for 7 days. Cancel anytime.</p>
              <p className="pro-cta-disclosure">
                By starting your trial you agree to our{" "}
                <Link to="/terms" onClick={() => trackCta("terms_link")}>
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" onClick={() => trackCta("privacy_link")}>
                  Privacy Policy
                </Link>
                .
              </p>
              <p className="pro-cta-secondary">
                Just want the free builder?{" "}
                <Link to="/#builder" onClick={() => trackCta("try_builder")}>
                  Build a prompt — it's free →
                </Link>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
