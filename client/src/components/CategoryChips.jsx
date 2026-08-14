import "./CategoryChips.css";

export default function CategoryChips({ categories, activeCategoryId, onJump }) {
  return (
    <nav className="category-chips" aria-label="Jump to category">
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          className={`category-chip ${cat.id === activeCategoryId ? "active" : ""}`}
          onClick={() => onJump(cat.id)}
        >
          {cat.label}
        </button>
      ))}
    </nav>
  );
}
