// Renders diffLines()/diffPrompts() output: added lines green with "+",
// removed red/struck with "−", unchanged muted. The marker glyph (not just
// color) carries the meaning. Styles live in PromptDetailPage.css.
export default function DiffView({ diff, label }) {
  return (
    <pre className="diff-output" aria-label={label}>
      {diff.map((d, i) => (
        <span key={i} className={`diff-line diff-${d.type}`}>
          <span className="diff-marker" aria-hidden="true">
            {d.type === "add" ? "+" : d.type === "remove" ? "−" : " "}
          </span>
          {d.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
