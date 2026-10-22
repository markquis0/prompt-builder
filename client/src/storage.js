const STORAGE_KEY = "prompt-builder-session";
const STAGES = ["intake", "qa", "result"];

// JSON.parse succeeding says nothing about whether the stored value is a
// session this version of the app can actually render — an older schema,
// a half-written save, or hand-edited storage all parse fine. Previously
// that got handed straight to PromptBuilder, e.g. stage "result" with no
// rawAssembled crashed ResultPreview's tag highlighting on load (blank
// page until storage was manually cleared). Anything that doesn't pass
// is discarded, same as having no saved session.
const isOptional = (value, type) => value == null || typeof value === type;

function isValidSession(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (!STAGES.includes(s.stage)) return false;
  if (typeof s.prompt !== "string") return false;
  if (!Array.isArray(s.questions)) return false;
  if (!s.answers || typeof s.answers !== "object" || Array.isArray(s.answers)) return false;
  if (!Number.isInteger(s.currentIndex) || s.currentIndex < 0) return false;
  if (typeof s.supportingContext !== "string" || typeof s.rawAssembled !== "string") return false;
  // Fields added with prompt versioning. All optional (older saved sessions
  // don't have them), but if present they must be the right type — a title
  // that's an object would crash the result screen the moment it renders.
  if (!isOptional(s.promptId, "string") || !isOptional(s.promptTitle, "string")) return false;
  if (!isOptional(s.versionCreatedAt, "string")) return false;
  if (!(s.versionNumber == null || Number.isInteger(s.versionNumber))) return false;
  if (s.stage === "qa" && (s.questions.length === 0 || s.currentIndex >= s.questions.length)) return false;
  if (s.stage === "result" && s.rawAssembled.trim() === "") return false;
  return true;
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isValidSession(parsed)) return parsed;
    clearSession();
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage unavailable (private browsing, quota) — fail silently, session still works in-memory
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
