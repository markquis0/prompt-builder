import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AuthModal from "./AuthModal.jsx";
import "./NavHeader.css";

export default function NavHeader() {
  const { pathname } = useLocation();
  const { user, authLoading, logout } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

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

      {!authLoading && (
        <div className="nav-account">
          {user ? (
            <>
              <span className="nav-account-email">{user.email}</span>
              <button type="button" className="link-button" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <button type="button" className="link-button" onClick={() => setShowAuthModal(true)}>
              Log in / Sign up
            </button>
          )}
        </div>
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </header>
  );
}
