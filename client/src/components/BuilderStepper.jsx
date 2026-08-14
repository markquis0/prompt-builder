import "./BuilderStepper.css";

const STEPS = [
  { id: "intake", number: 1, label: "Type idea" },
  { id: "qa", number: 2, label: "Answer questions" },
  { id: "result", number: 3, label: "Copy prompt" },
];

// Reuses the homepage's "How it works" 1-2-3 iconography (Phase 2c) so the
// same visual language carries into the actual flow, not just the pitch
// for it.
export default function BuilderStepper({ stage }) {
  const activeIndex = STEPS.findIndex((s) => s.id === stage);

  return (
    <div className="builder-stepper">
      {STEPS.map((step, i) => (
        <div
          key={step.id}
          className={`builder-stepper-item ${i === activeIndex ? "current" : ""} ${i < activeIndex ? "done" : ""}`}
        >
          <span className="builder-stepper-number">{i < activeIndex ? "✓" : step.number}</span>
          <span className="builder-stepper-label">{step.label}</span>
        </div>
      ))}
    </div>
  );
}
