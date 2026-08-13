import { Link, useLocation } from "react-router-dom";
import "./NavHeader.css";

export default function NavHeader() {
  const { pathname } = useLocation();

  return (
    <header className="nav-header">
      <Link to="/" className="nav-logo">
        PromptMe
      </Link>
      <nav className="nav-links">
        <Link to="/#builder" className={pathname === "/" ? "nav-link nav-link-active" : "nav-link"}>
          Build a Prompt
        </Link>
        <Link
          to="/learn"
          className={pathname.startsWith("/learn") ? "nav-link nav-link-active" : "nav-link"}
        >
          Learn
        </Link>
        <Link
          to="/pro"
          className={pathname === "/pro" ? "nav-link nav-link-pro nav-link-active" : "nav-link nav-link-pro"}
        >
          Pro
        </Link>
      </nav>
    </header>
  );
}
