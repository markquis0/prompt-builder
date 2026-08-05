export default function QuestionCard({ question, value, onChange }) {
  return (
    <div className="question-card">
      <p className="question-text">{question.text}</p>

      {question.options?.length > 0 && (
        <div className="chip-row">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`chip ${value === option ? "chip-selected" : ""}`}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <textarea
        className="answer-textarea"
        placeholder="Type your answer, or leave blank to skip…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        autoFocus
      />
    </div>
  );
}
