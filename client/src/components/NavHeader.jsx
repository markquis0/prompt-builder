import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import posthog from "posthog-js";
import { useAuth } from "../context/AuthContext.jsx";
import { getBillingPortalUrl } from "../api.js";
import { useStripeRedirect } from "../useStripeRedirect.js";
import { useOutsideClick } from "../useOutsideClick.js";
import "./NavHeader.css";

const SUBSCRIPTION_LABELS = {
  active: "Pro · Active",
  trialing: "Pro · Trial",
  past_due: "Pro · Past due",
  canceled: "Pro · Canceled",
};

function initials(user) {
  const first = user.firstName?.[0] || "";
  const last = user.lastName?.[0] || "";
  return (first + last).toUpperCase() || "?";
}

function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 8.5h16" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function NavHeader() {
  const { pathname } = useLocation();
  const { user, authLoading, logout, openAuthModal, isPaidUser } = useAuth();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const moreMenuRef = useRef(null);
  const profileMenuRef = useRef(null);
  const mobileNavRef = useRef(null);

  useOutsideClick(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));
  useOutsideClick(profileMenuRef, profileMenuOpen, () => setProfileMenuOpen(false));
  useOutsideClick(mobileNavRef, mobileNavOpen, () => setMobileNavOpen(false));

  // No loading/error UI here by design — failure stays a silent console.error,
  // same as before this hook existed.
  const { go: handleManageSubscriptionRedirect } = useStripeRedirect(getBillingPortalUrl, "portalUrl", (err) =>
    console.error("[prompt-builder] Failed to open billing portal:", err)
  );

  // Wraps the redirect above with tracking — kept as a separate named
  // function (not just calling posthog.capture inline at the one call
  // site) so the intent reads clearly at the button's onClick.
  function handleManageSubscription() {
    posthog.capture("manage_subscription_clicked", { source: "header" });
    return handleManageSubscriptionRedirect();
  }

  function handleLogoutClick() {
    posthog.capture("logout_clicked");
    logout();
  }

  // Anyone who's ever started a subscription (including a canceled one) can
  // still get to the Stripe portal — it shows invoice history and lets them
  // resubscribe, not just manage an active plan.
  const hasBillingHistory = user?.subscriptionStatus && user.subscriptionStatus !== "none";

  // Fires once per time the badge actually becomes visible (isPaidUser
  // true), not once per render — so this measures how often it's actually
  // seen, not how often this component re-renders while it's showing.
  useEffect(() => {
    if (isPaidUser) {
      posthog.capture("entitlement_badge_viewed");
    }
  }, [isPaidUser]);

  function navLinkClass(isActive) {
    return isActive ? "nav-link nav-link-active" : "nav-link";
  }

  const logo = (
    <Link to="/" className="nav-logo">
      <img src="/promptme-logo.png" alt="PromptMe" className="nav-logo-full" />
      <img src="/promptme-icon-512.png" alt="PromptMe" className="nav-logo-icon" />
    </Link>
  );

  // Logged out — marketing header.
  if (!authLoading && !user) {
    return (
      <header className="nav-header">
        {logo}
        <nav className="nav-links">
          <Link to="/#builder" className={navLinkClass(pathname === "/")}>
            Build a Prompt
          </Link>
          <Link to="/prompts" className={navLinkClass(pathname === "/prompts")}>
            Prompts
          </Link>
          <Link to="/learn" className={navLinkClass(pathname.startsWith("/learn"))}>
            Learn
          </Link>
          <Link to="/resources" className={navLinkClass(pathname === "/resources")}>
            Resources
          </Link>
        </nav>

        <div className="nav-mobile-toggle" ref={mobileNavRef}>
          <button
            type="button"
            className="nav-hamburger-btn"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={mobileNavOpen}
            aria-label="Menu"
          >
            <HamburgerIcon />
          </button>
          {mobileNavOpen && (
            <div className="nav-mobile-panel" role="menu">
              <Link to="/#builder" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                Build a Prompt
              </Link>
              <Link to="/prompts" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                Prompts
              </Link>
              <Link to="/learn" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                Learn
              </Link>
              <Link to="/resources" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                Resources
              </Link>
            </div>
          )}
        </div>

        <div className="nav-auth-buttons">
          <Link to="/pro" className="nav-pricing-link">
            Pricing
          </Link>
          <button type="button" className="nav-login-btn" onClick={() => openAuthModal(undefined, "login")}>
            Log in
          </button>
          <button type="button" className="nav-signup-btn" onClick={() => openAuthModal(undefined, "signup")}>
            Sign up
          </button>
        </div>
      </header>
    );
  }

  // Logged in — product header (working loop + account management,
  // separated per the redesign: History/Prompts/Build a Prompt stay
  // primary; Learn/Resources move under More; settings/billing/logout
  // live in the profile menu, not alongside the working-loop nav).
  return (
    <header className="nav-header">
      {logo}

      {!authLoading && user && (
        <>
          <nav className="nav-links">
            <Link to="/#builder" className={navLinkClass(pathname === "/")}>
              Build a Prompt
            </Link>
            <Link to="/prompts" className={navLinkClass(pathname === "/prompts")}>
              Prompts
            </Link>
            <Link to="/history" className={navLinkClass(pathname === "/history")}>
              History
            </Link>
            <div className="nav-more" ref={moreMenuRef}>
              <button
                type="button"
                className="nav-more-trigger"
                onClick={() => setMoreMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={moreMenuOpen}
              >
                More ▾
              </button>
              {moreMenuOpen && (
                <div className="nav-more-menu" role="menu">
                  <Link
                    to="/learn"
                    className={`nav-more-menu-item ${pathname.startsWith("/learn") ? "nav-more-menu-item-active" : ""}`}
                    onClick={() => setMoreMenuOpen(false)}
                  >
                    Learn
                  </Link>
                  <Link
                    to="/resources"
                    className={`nav-more-menu-item ${pathname === "/resources" ? "nav-more-menu-item-active" : ""}`}
                    onClick={() => setMoreMenuOpen(false)}
                  >
                    Resources
                  </Link>
                </div>
              )}
            </div>
          </nav>

          <div className="nav-mobile-toggle" ref={mobileNavRef}>
            <button
              type="button"
              className="nav-hamburger-btn"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={mobileNavOpen}
              aria-label="Menu"
            >
              <HamburgerIcon />
            </button>
            {mobileNavOpen && (
              <div className="nav-mobile-panel" role="menu">
                <Link to="/#builder" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                  Build a Prompt
                </Link>
                <Link to="/prompts" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                  Prompts
                </Link>
                <Link to="/history" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                  History
                </Link>
                <Link to="/learn" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                  Learn
                </Link>
                <Link to="/resources" className="nav-mobile-panel-item" onClick={() => setMobileNavOpen(false)}>
                  Resources
                </Link>
              </div>
            )}
          </div>

          <div className="nav-account">
            {isPaidUser && (
              <Link to="/pro" className="nav-pro-badge" title="Your subscription is active">
                Pro
              </Link>
            )}

            <div className="nav-profile" ref={profileMenuRef}>
              <button
                type="button"
                className="nav-profile-trigger"
                onClick={() => setProfileMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={profileMenuOpen}
                aria-label="Account menu"
              >
                <span className="nav-avatar">{initials(user)}</span>
                <span className="nav-profile-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {profileMenuOpen && (
                <div className="nav-profile-menu" role="menu">
                  <p className="nav-profile-name">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="nav-profile-email" title={user.email}>
                    {user.email}
                  </p>
                  <p className="nav-profile-status">
                    {SUBSCRIPTION_LABELS[user.subscriptionStatus] || "Free"}
                  </p>
                  <div className="nav-profile-divider" />
                  <Link
                    to="/settings"
                    className="nav-profile-item"
                    onClick={() => setProfileMenuOpen(false)}
                  >
                    Account settings
                  </Link>
                  {hasBillingHistory && (
                    <button
                      type="button"
                      className="nav-profile-item nav-profile-item-row"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        handleManageSubscription();
                      }}
                    >
                      <span>Manage subscription</span>
                      <span className="nav-profile-stripe-indicator">
                        <CardIcon /> Stripe
                      </span>
                    </button>
                  )}
                  <div className="nav-profile-divider" />
                  <button
                    type="button"
                    className="nav-profile-item nav-profile-item-logout"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      handleLogoutClick();
                    }}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
