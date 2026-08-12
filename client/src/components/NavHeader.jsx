import { Link, useLocation } from "react-router-dom";
import "./NavHeader.css";

export default function NavHeader({ right }) {
  const { pathname } = useLocation();

  return (
    <header className="nav-header">
      <Link to="/" className="nav-logo">
        Prompt Builder
      </Link>
      <nav className="nav-links">
        <Link to="/" className={pathname === "/" ? "nav-link nav-link-active" : "nav-link"}>
          Build a Prompt
        </Link>
        <Link
          to="/learn"
          className={pathname.startsWith("/learn") ? "nav-link nav-link-active" : "nav-link"}
        >
          Learn
        </Link>
      </nav>
      {right && <div className="nav-right">{right}</div>}
    </header>
  );
}
