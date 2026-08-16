import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../api.js";
import { loadSession } from "../storage.js";
import AuthModal from "../components/AuthModal.jsx";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // null = closed. Otherwise { onSuccess: fn | null } — set by whichever
  // component called openAuthModal, so signup/login can resume whatever
  // the user was trying to do (e.g. start checkout) once they're in.
  const [modalState, setModalState] = useState(null);

  const refreshUser = useCallback(() => {
    return api
      .getMe()
      .then(({ user }) => {
        setUser(user);
      })
      .catch(() => {
        setUser(null);
      });
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setAuthLoading(false));
    // Only on mount — refreshUser is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signup = useCallback(async (email, password, firstName, lastName) => {
    const { user: newUser } = await api.signup(email, password, firstName, lastName);
    setUser(newUser);

    // Automatic, silent migration — per the monetisation-gate spec, no
    // confirmation prompt, and a failure here must never surface as an
    // error on the signup flow the user actually asked for. insertSession
    // server-side already no-ops on an empty/never-used session, so this
    // fires unconditionally rather than trying to duplicate that check here.
    const localSession = loadSession();
    if (localSession) {
      api.migrateSession(localSession).catch((err) => {
        console.error("[prompt-builder] Session migration failed:", err);
      });
    }

    return newUser;
  }, []);

  const login = useCallback(async (email, password) => {
    const { user: loggedInUser } = await api.login(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  // Any component can call this to gate an action behind auth — e.g. "start
  // checkout" from the /pro CTA or a locked result-screen tab. If already
  // logged in, onSuccess fires immediately with no modal shown at all.
  // initialMode lets the header's separate "Log in"/"Sign up" triggers open
  // straight into the right form instead of always defaulting to signup.
  const openAuthModal = useCallback(
    (onSuccess, initialMode = "signup") => {
      if (user) {
        onSuccess?.(user);
        return;
      }
      setModalState({ onSuccess: onSuccess || null, initialMode });
    },
    [user]
  );

  const closeAuthModal = useCallback(() => setModalState(null), []);

  function handleModalSuccess(loggedInUser) {
    const onSuccess = modalState?.onSuccess;
    setModalState(null);
    onSuccess?.(loggedInUser);
  }

  const isPaidUser = Boolean(user) && ["trialing", "active"].includes(user.subscriptionStatus);

  return (
    <AuthContext.Provider
      value={{ user, authLoading, isPaidUser, signup, login, logout, openAuthModal, refreshUser }}
    >
      {children}
      {modalState && (
        <AuthModal onClose={closeAuthModal} onSuccess={handleModalSuccess} initialMode={modalState.initialMode} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
