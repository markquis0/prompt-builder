import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getBillingPortalUrl } from "../api.js";
import "./NavHeader.css";

export default function NavHeader() {
  const { pathname } = useLocation();
  const { user, authLoading, logout, openAuthModal } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleOutsideClick(e) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [mobileMenuOpen]);

  async function handleManageSubscription() {
    try {
      const { portalUrl } = await getBillingPortalUrl();
      window.location.href = portalUrl;
    } catch (err) {
      console.error("[prompt-builder] Failed to open billing portal:", err);
    }
  }

  // Anyone who's ever started a subscription (including a canceled one) can
  // still get to the Stripe portal — it shows invoice history and lets them
  // resubscribe, not just manage an active plan.
  const hasBillingHistory = user?.subscriptionStatus && user.subscriptionStatus !== "none";

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
          to="/prompts"
          className={pathname === "/prompts" ? "nav-link nav-link-active" : "nav-link"}
        >
          Prompts
        </Link>
        <Link
          to="/resources"
          className={pathname === "/resources" ? "nav-link nav-link-active" : "nav-link"}
        >
          Resources
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
              {/* Desktop: inline email (title attr = hover tooltip for the
                  ellipsis-truncated case) + separate action links. Hidden
                  below 600px in favor of the avatar dropdown, which needs
                  no truncation at all — full email is always visible in
                  the dropdown, tooltip or not. */}
              <div className="nav-account-desktop">
                <span className="nav-account-email" title={user.email}>
                  {user.email}
                </span>
                {hasBillingHistory && (
                  <button type="button" className="link-button" onClick={handleManageSubscription}>
                    Manage subscription
                  </button>
                )}
                <button type="button" className="link-button" onClick={logout}>
                  Log out
                </button>
              </div>

              <div className="nav-account-mobile" ref={mobileMenuRef}>
                <button
                  type="button"
                  className="nav-account-avatar"
                  onClick={() => setMobileMenuOpen((v) => !v)}
                  aria-haspopup="true"
                  aria-expanded={mobileMenuOpen}
                  aria-label="Account menu"
                >
                  {user.email.charAt(0).toUpperCase()}
                </button>
                {mobileMenuOpen && (
                  <div className="nav-account-dropdown" role="menu">
                    <span className="nav-account-dropdown-email">{user.email}</span>
                    {hasBillingHistory && (
                      <button
                        type="button"
                        className="nav-account-dropdown-item"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          handleManageSubscription();
                        }}
                      >
                        Manage subscription
                      </button>
                    )}
                    <button
                      type="button"
                      className="nav-account-dropdown-item"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        logout();
                      }}
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button type="button" className="link-button" onClick={() => openAuthModal()}>
              Log in / Sign up
            </button>
          )}
        </div>
      )}
    </header>
  );
}
