import { RENDERERS } from "../renderers/index.js";
import { SAMPLE_PROMPT, SAMPLE_ROUGH_PROMPT } from "../samplePrompt.js";
import "./BeforeAfter.css";

// Muted-color the XML tag names so the structure reads at a glance without
// looking intimidating — not a real syntax highlighter, just tag spans.
function highlightTags(text) {
  const parts = text.split(/(<\/?[a-z_]+>)/g);
  return parts.map((part, i) =>
    /^<\/?[a-z_]+>$/.test(part) ? (
      <span key={i} className="xml-tag">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function BeforeAfter() {
  const after = RENDERERS.generic.render(SAMPLE_PROMPT);

  return (
    <div className="before-after">
      <div className="before-after-pane before-pane">
        <p className="before-after-heading">What you type:</p>
        <div className="before-content">"{SAMPLE_ROUGH_PROMPT}"</div>
      </div>
      <div className="before-after-pane after-pane">
        <p className="before-after-heading">What you get:</p>
        <pre className="after-content">{highlightTags(after)}</pre>
      </div>
    </div>
  );
}
