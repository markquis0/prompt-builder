import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import "./AuthModal.css";

// Deliberately minimal — Stage 3 (Stripe) will likely trigger this same
// modal from the /pro CTA and may extend it, but this needs to exist now
// so Stage 2's migration flow (signup -> localStorage session pulled into
// the new account) has a real UI path to test against.
export default function AuthModal({ onClose }) {
  const { signup, login } = useAuth();
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        await signup(email, password);
      } else {
        await login(email, password);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "signup" ? "login" : "signup"));
    setError(null);
  }

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="card auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-header">
          <h2>{mode === "signup" ? "Sign up" : "Log in"}</h2>
          <button
            type="button"
            className="btn btn-ghost auth-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="field-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && <p className="auth-modal-hint">At least 8 characters.</p>}

          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary auth-modal-submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "signup" ? "Sign up" : "Log in"}
          </button>
        </form>

        <button type="button" className="link-button auth-modal-toggle" onClick={toggleMode}>
          {mode === "signup" ? "Already have an account? Log in" : "Need an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
