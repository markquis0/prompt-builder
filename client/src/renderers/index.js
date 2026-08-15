import { render as renderGeneric } from "./generic.js";
import { render as renderClaude } from "./claude.js";
import { render as renderOpenai } from "./openai.js";
import { render as renderGemini } from "./gemini.js";

// Order here is display order for the result-screen tabs.
export const RENDERERS = {
  generic: { render: renderGeneric, label: "Generic", icon: "📋" },
  claude: { render: renderClaude, label: "Claude", icon: "🟠" },
  openai: { render: renderOpenai, label: "ChatGPT", icon: "🟢" },
  gemini: { render: renderGemini, label: "Gemini", icon: "🔵" },
};
