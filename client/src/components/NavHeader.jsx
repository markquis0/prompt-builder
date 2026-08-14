import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getBillingPortalUrl } from "../api.js";
import "./NavHeader.css";

export default function NavHeader() {
  const { pathname } = useLocation();
  const { user, authLoading, logout, openAuthModal } = useAuth();

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
              <span className="nav-account-email">{user.email}</span>
              {hasBillingHistory && (
                <button type="button" className="link-button" onClick={handleManageSubscription}>
                  Manage subscription
                </button>
              )}
              <button type="button" className="link-button" onClick={logout}>
                Log out
              </button>
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
