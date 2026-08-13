import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../api.js";
import { loadSession } from "../storage.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const signup = useCallback(async (email, password) => {
    const { user: newUser } = await api.signup(email, password);
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

  const isPaidUser = Boolean(user) && ["trialing", "active"].includes(user.subscriptionStatus);

  return (
    <AuthContext.Provider value={{ user, authLoading, isPaidUser, signup, login, logout }}>
      {children}
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
