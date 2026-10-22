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

export function signup(email, password, firstName, lastName) {
  return postJSON("/api/auth/signup", { email, password, firstName, lastName });
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

export function updateAccountProfile({ currentPassword, firstName, lastName }) {
  return patchJSON("/api/account/profile", { currentPassword, firstName, lastName });
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
    // Whatever the user picked (or left blank) on IntakeForm.jsx — already
    // collected for the question-generation call, just carried one hop
    // further into persistence instead of being dropped after that.
    category: session.promptType || null,
    // Layer 1 (completeness.js) is computed here rather than server-side —
    // it's the same free/instant deterministic check either way, just
    // saved alongside the session for the user's own history.
    deterministicScore: score,
    deterministicChecks: checks,
    // Set only when this generation is a rework of an already-saved prompt
    // (opened from history, then "Edit answers") — tells the server to add
    // the next version to that prompt instead of starting a new one.
    promptId: session.promptId || null,
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

// Full detail (qaPairs/promptObject/rawAssembled included) for resuming a
// past session back into the builder — the list endpoint above
// deliberately only returns id/originalPrompt/createdAt.
export function getServerSession(id) {
  return request(`/api/sessions/${id}`);
}

// --- Prompts + version history (signed-in only) ---

export function listPrompts() {
  return request("/api/prompts");
}

export function getPrompt(id) {
  return request(`/api/prompts/${id}`);
}

export function listPromptVersions(id) {
  return request(`/api/prompts/${id}/versions`);
}

export function getPromptVersion(id, versionNumber) {
  return request(`/api/prompts/${id}/versions/${versionNumber}`);
}

// `source: "improved"` + `baseVersionNumber` mark a version created from an
// accepted Improve suggestion; the server refuses it (409) if the prompt has
// moved past the version the suggestion was made from.
export function savePromptVersion(id, { content, changeNote, source, baseVersionNumber }) {
  return postJSON(`/api/prompts/${id}/versions`, { content, changeNote, source, baseVersionNumber });
}

// Grades the given version and proposes a rewrite — saves nothing. Pro, owner
// only. Accepting goes through savePromptVersion above.
export function improvePrompt(id, versionNumber) {
  return postJSON(`/api/prompts/${id}/improve`, versionNumber ? { versionNumber } : {});
}

export function restorePromptVersion(id, versionNumber) {
  return postJSON(`/api/prompts/${id}/versions/${versionNumber}/restore`, {});
}

export function renamePrompt(id, title) {
  return patchJSON(`/api/prompts/${id}`, { title });
}

// "Build on this" / "Save a copy": a new prompt owned by the caller, whose
// v1 is this prompt's current (or the given) version. Works on your own
// prompts and on ones shared with you.
export function copyPrompt(id, versionNumber) {
  return postJSON(`/api/prompts/${id}/copy`, versionNumber ? { versionNumber } : {});
}

export function listSharedPrompts() {
  return request("/api/prompts/shared");
}

export function listPromptShares(id) {
  return request(`/api/prompts/${id}/shares`);
}

export function sharePrompt(id, email) {
  return postJSON(`/api/prompts/${id}/shares`, { email });
}

export function removePromptShare(id, shareId) {
  return request(`/api/prompts/${id}/shares/${shareId}`, { method: "DELETE" });
}

// --- Teams ---

export function listTeams() {
  return request("/api/teams");
}

export function createTeam(name) {
  return postJSON("/api/teams", { name });
}

export function getTeam(id) {
  return request(`/api/teams/${id}`);
}

export function renameTeam(id, name) {
  return patchJSON(`/api/teams/${id}`, { name });
}

export function deleteTeam(id) {
  return request(`/api/teams/${id}`, { method: "DELETE" });
}

export function listTeamMembers(id) {
  return request(`/api/teams/${id}/members`);
}

export function addTeamMember(id, email) {
  return postJSON(`/api/teams/${id}/members`, { email });
}

export function removeTeamMember(id, memberId) {
  return request(`/api/teams/${id}/members/${memberId}`, { method: "DELETE" });
}

export function leaveTeam(id) {
  return postJSON(`/api/teams/${id}/leave`, {});
}

export function listTeamPrompts(id) {
  return request(`/api/teams/${id}/prompts`);
}

export function addPromptToTeam(teamId, promptId) {
  return postJSON(`/api/teams/${teamId}/prompts`, { promptId });
}

export function removePromptFromTeam(teamId, promptId) {
  return request(`/api/teams/${teamId}/prompts/${promptId}`, { method: "DELETE" });
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
