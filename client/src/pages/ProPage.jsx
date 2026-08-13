import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import ProDemo from "../components/ProDemo.jsx";
import "./ProPage.css";

const RULES = [
  {
    accent: "gemini",
    title: "Gemini wants your context first.",
    body: 'Google’s documentation says to put instructions after long context and open with "Based on the preceding information…" — the opposite of what most people do.',
  },
  {
    accent: "openai",
    title: "ChatGPT reads Markdown better than XML.",
    body: "GPT-5.x is trained on more Markdown than XML. Structured headers give it cleaner signal than angle brackets.",
  },
  {
    accent: "claude",
    title: "Claude is the opposite.",
    body: "Claude’s own documentation recommends XML-style tags for section boundaries. Same information, different packaging.",
  },
];

export default function ProPage() {
  const location = useLocation();
  const fromLockedTab = Boolean(location.state?.fromLockedTab);

  useEffect(() => {
    posthog.capture("pro_page_view", {
      referrer: document.referrer,
      from_locked_tab: fromLockedTab,
    });
    // Only fire once per mount — fromLockedTab is fixed for the life of this page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackCta(action) {
    posthog.capture("pro_cta_clicked", { action });
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

        <section className="pro-offer">
          <h2>PromptMe Pro — $8/month or $65/year</h2>
          <p className="pro-offer-intro">Everything in the free builder, plus:</p>
          <ul className="pro-offer-list">
            <li>Copy your prompt formatted for Claude, ChatGPT, or Gemini</li>
            <li>Each format follows that model's own documentation</li>
            <li>New model formats added as guidance changes</li>
          </ul>
          <p className="pro-offer-note">
            The builder itself is always free. Build unlimited prompts, get a structured result
            you can paste anywhere.
          </p>
        </section>

        <section className="pro-cta-section">
          <Link
            to="/"
            className="btn btn-primary pro-cta-btn"
            onClick={() => trackCta("try_builder")}
          >
            Try it free →
          </Link>
          <p className="pro-cta-note">Build a prompt, then see how it looks in each format.</p>
        </section>
      </main>
    </div>
  );
}
