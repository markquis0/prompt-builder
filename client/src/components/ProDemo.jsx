import { useState } from "react";
import posthog from "posthog-js";
import { RENDERERS } from "../renderers/index.js";
import { SAMPLE_PROMPT } from "../samplePrompt.js";
import "./ResultPreview.css";
import "./ProDemo.css";

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
