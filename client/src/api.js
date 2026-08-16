import { scoreCompleteness } from "./completeness.js";

// In dev this is empty, so requests hit the Vite proxy (see vite.config.js).
// In production, set VITE_API_BASE_URL to the deployed backend's origin
// (e.g. https://prompt-builder-api.onrender.com) — no trailing slash.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

// credentials: "include" is required on every call, not just auth ones —
// it's what makes the browser send/accept the httpOnly session cookie
// across the Vercel/Render origin split. Harmless on routes that don't
// need auth (questions/assemble): no cookie to send, nothing changes.
async function request(path, { method = "GET", body } = {}) {
  const url = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }

  if (!res.ok) {
    throw new Error(data?.error || "Something went wrong. Please try again.");
  }

  return data;
}

function postJSON(path, body) {
  return request(path, { method: "POST", body });
}

function patchJSON(path, body) {
  return request(path, { method: "PATCH", body });
}

export function fetchQuestions({ prompt, promptType }) {
  return postJSON("/api/questions", { prompt, promptType });
}

export async function assemblePrompt({ originalPrompt, supportingContext, qaPairs, targetModel = "generic" }) {
  const data = await postJSON("/api/assemble", { originalPrompt, supportingContext, qaPairs, targetModel });

  if (data && typeof data.rawAssembled === "string") {
    return data;
  }
  // Backward-compat for a deploy-timing mismatch: an old backend build
  // still returns { prompt: string } with no promptObject. Wrap it so
  // the result screen degrades to its pre-tabs single-view behavior
  // instead of crashing on a missing field.
  if (data && typeof data.prompt === "string") {
    return { promptObject: null, rawAssembled: data.prompt };
  }
  return { promptObject: null, rawAssembled: "" };
}

// --- Auth ---

export function signup(email, password) {
  return postJSON("/api/auth/signup", { email, password });
}

export function login(email, password) {
  return postJSON("/api/auth/login", { email, password });
}

export function logout() {
  return postJSON("/api/auth/logout", {});
}

export function getMe() {
  return request("/api/auth/me");
}

// --- Account settings ---

export function updateAccountEmail({ currentPassword, newEmail }) {
  return patchJSON("/api/account/email", { currentPassword, newEmail });
}

export function updateAccountPassword({ currentPassword, newPassword }) {
  return patchJSON("/api/account/password", { currentPassword, newPassword });
}

// --- Sessions (logged-in save/history + anonymous->account migration) ---

function toSessionPayload(session) {
  const { score, checks } = scoreCompleteness(session.promptObject);
  return {
    originalPrompt: session.prompt,
    qaPairs: (session.questions || []).map((q) => ({
      question: q.text,
      answer: session.answers?.[q.id] || "",
    })),
    supportingContext: session.supportingContext,
    promptObject: session.promptObject,
    rawAssembled: session.rawAssembled,
    // Layer 1 (completeness.js) is computed here rather than server-side —
    // it's the same free/instant deterministic check either way, just
    // saved alongside the session for the user's own history.
    deterministicScore: score,
    deterministicChecks: checks,
  };
}

export function saveServerSession(session) {
  return postJSON("/api/sessions", toSessionPayload(session));
}

export function migrateSession(session) {
  return postJSON("/api/sessions/migrate", toSessionPayload(session));
}

export function listServerSessions() {
  return request("/api/sessions");
}

// --- Billing ---

export function createCheckoutSession() {
  return postJSON("/api/billing/create-checkout-session", {});
}

export function getBillingPortalUrl() {
  return request("/api/billing/portal");
}

// --- Resources ---

export function listResources() {
  return request("/api/resources");
}

// --- Completeness score, Layer 2 (paid, on-demand) ---

export function getPromptCritique({ originalPrompt, assembledPrompt, sessionId }) {
  return postJSON("/api/score/critique", { originalPrompt, assembledPrompt, sessionId });
}
