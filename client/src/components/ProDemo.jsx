import { useState } from "react";
import posthog from "posthog-js";
import { RENDERERS } from "../renderers/index.js";
import "./ResultPreview.css";
import "./ProDemo.css";

// Realistic, long enough (~2,500 chars) to trigger the Gemini context-first
// reorder — the whole point of this demo is to make that difference visible.
const BRAND_VOICE_CONTEXT = `FocusFlow brand voice guide (excerpt for marketing copy):

We talk to freelancers like a smart friend who happens to know a lot about productivity tools, not like a SaaS company trying to close a deal. That means contractions, short sentences, and zero jargon like "leverage," "synergy," or "seamless."

Tone: warm, a little wry, never salesy. We're allowed to be funny about the chaos of freelance life (the seventeen open tabs, the client who emails at 11pm) because our users live it too. We are not allowed to be funny about money, deadlines they've missed, or anything that could read as mocking someone's actual stress.

What we never say: "revolutionary," "game-changing," "10x," "unlock your potential," or anything that sounds like a keynote slide. If a sentence could appear in a startup's Series A deck, cut it.

What we always do: lead with the specific problem before the feature. Freelancers don't care that FocusFlow has "AI-powered context switching detection" — they care that it stops them from losing 20 minutes every time a client Slack message interrupts deep work. Name the pain first, in their words, then the fix.

Formatting preferences: short paragraphs (2-3 sentences max), one idea per paragraph, and when giving instructions or steps, prefer a simple numbered or bulleted list over a dense paragraph. Subject lines should feel like they're from a person, not a newsletter — no emoji, no "🚀," no ALL CAPS urgency.

Call-to-action language: "Try it free for 14 days" beats "Start your free trial" beats "Sign up now." We want it to sound like an invitation, not a funnel step. Never use countdown-timer urgency ("Offer ends soon!") — our users can smell fake scarcity and it actively hurts trust with this audience.

A note on humor: self-deprecating is good, punching down is not. We can joke about our own onboarding flow being clunky in v1. We do not joke about other productivity apps by name — freelancers talk to each other, and dunking on a competitor reads as insecure, not confident.`;

const SAMPLE_PROMPT = {
  task:
    "Write a marketing email promoting FocusFlow, a new productivity app for freelancers. The email should drive sign-ups for a 14-day free trial.",
  audience:
    "Freelancers and independent contractors who juggle multiple client projects and struggle with context-switching.",
  tone:
    "Casual and encouraging — like a friend who found something useful, not a corporation selling something.",
  format: "Under 200 words. One clear call-to-action near the end. Subject line included.",
  constraints:
    'Do not mention competitor products by name. Do not use the word "revolutionary." No ALL CAPS.',
  context: BRAND_VOICE_CONTEXT,
  examples: null,
  successCriteria: "The reader clicks the free trial link. Secondary: they forward it to a freelancer friend.",
  background: null,
};

const ANNOTATIONS = {
  claude: "Claude works best with XML-style tags and task-first ordering.",
  openai:
    "ChatGPT parses Markdown headers better than XML tags. We added a reasoning-effort tip for GPT-5.x users.",
  gemini:
    "Gemini wants context before instructions when it's long. We added a grounding phrase and a verbosity steer — Gemini 3.x is terse by default.",
};

const TABS = ["claude", "openai", "gemini"];

export default function ProDemo() {
  const [activeModel, setActiveModel] = useState("claude");

  function handleTabClick(key) {
    setActiveModel(key);
    posthog.capture("pro_demo_tab_selected", { model: key });
  }

  const rendered = RENDERERS[activeModel].render(SAMPLE_PROMPT);

  return (
    <div className="card pro-demo">
      <p className="pro-demo-label">Your prompt, formatted for:</p>
      <div className="model-tabs" role="tablist">
        {TABS.map((key) => {
          const { label, icon } = RENDERERS[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeModel === key}
              className={`model-tab ${activeModel === key ? "active" : ""}`}
              onClick={() => handleTabClick(key)}
            >
              <span className="model-icon" aria-hidden="true">
                {icon}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      <pre className="pro-demo-output">{rendered}</pre>
      <div className="pro-demo-annotation">
        <span aria-hidden="true">ℹ️</span> {ANNOTATIONS[activeModel]}
      </div>
    </div>
  );
}
