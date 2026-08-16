import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { updateAccountEmail, updateAccountPassword, updateAccountProfile } from "../api.js";
import "./SettingsPage.css";

const SITE_URL = "https://promptme.host";

// Same edit/save pattern as EmailSection below — current-password-gated,
// same Edit/Save/Cancel flow — per the header-redesign handoff's explicit
// instruction to reuse whatever pattern the email flow already uses.
function NameSection({ currentFirstName, currentLastName, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function startEditing() {
    setEditing(true);
    setFirstName(currentFirstName);
    setLastName(currentLastName);
    setCurrentPassword("");
    setError(null);
    setSuccess(null);
  }

  function cancelEditing() {
    setEditing(false);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await updateAccountProfile({ currentPassword, firstName, lastName });
      await onUpdated();
      setEditing(false);
      setSuccess("Name updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Name</h2>
      {!editing ? (
        <>
          <p className="settings-current-value">
            {currentFirstName} {currentLastName}
          </p>
          <button type="button" className="link-button" onClick={startEditing}>
            Edit
          </button>
          {success && <p className="settings-success">{success}</p>}
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="settings-name-row">
            <div>
              <label className="field-label" htmlFor="settings-first-name">
                First name
              </label>
              <input
                id="settings-first-name"
                type="text"
                required
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="settings-last-name">
                Last name
              </label>
              <input
                id="settings-last-name"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>

          <label className="field-label" htmlFor="settings-name-current-password">
            Current password
          </label>
          <input
            id="settings-name-current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          <div className="settings-form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save name"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function EmailSection({ currentEmail, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function startEditing() {
    setEditing(true);
    setNewEmail("");
    setCurrentPassword("");
    setError(null);
    setSuccess(null);
  }

  function cancelEditing() {
    setEditing(false);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await updateAccountEmail({ currentPassword, newEmail });
      posthog.capture("account_email_changed");
      await onUpdated();
      setEditing(false);
      setSuccess("Email updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Email</h2>
      {!editing ? (
        <>
          <p className="settings-current-value">{currentEmail}</p>
          <button type="button" className="link-button" onClick={startEditing}>
            Edit
          </button>
          {success && <p className="settings-success">{success}</p>}
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="settings-new-email">
            New email
          </label>
          <input
            id="settings-new-email"
            type="email"
            required
            autoFocus
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />

          <label className="field-label" htmlFor="settings-email-current-password">
            Current password
          </label>
          <input
            id="settings-email-current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          <div className="settings-form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save email"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancelEditing} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setLoading(true);
    try {
      await updateAccountPassword({ currentPassword, newPassword });
      posthog.capture("account_password_changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated. Any other signed-in devices or browsers were signed out.");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Password</h2>
      <form onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="settings-current-password">
          Current password
        </label>
        <input
          id="settings-current-password"
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />

        <label className="field-label" htmlFor="settings-new-password">
          New password
        </label>
        <input
          id="settings-new-password"
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <p className="settings-hint">At least 8 characters.</p>

        <label className="field-label" htmlFor="settings-confirm-password">
          Confirm new password
        </label>
        <input
          id="settings-confirm-password"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}
        {success && <p className="settings-success">{success}</p>}

        <div className="settings-form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  const { user, authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();

  // No dedicated login page in this app (auth is the modal in AuthModal.jsx)
  // — redirecting to "/" is the closest equivalent to "redirect to login".
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/", { replace: true });
    }
  }, [authLoading, user, navigate]);

  if (authLoading || !user) {
    return (
      <div className="app-shell">
        <NavHeader />
        <main>
          <p className="loading-text">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Helmet>
        <title>Account Settings — PromptMe</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/settings`} />
      </Helmet>
      <NavHeader />
      <main className="settings-page">
        <h1>Account settings</h1>
        <NameSection currentFirstName={user.firstName} currentLastName={user.lastName} onUpdated={refreshUser} />
        <EmailSection currentEmail={user.email} onUpdated={refreshUser} />
        <PasswordSection />
      </main>
    </div>
  );
}
