import { getPrompt, getPromptVersion } from "./api.js";

// Shape PromptBuilder.jsx's getInitialSession() resumes from. `id` is the
// generation (sessions row) this version came from, if any — it's what the
// AI-critique feature persists scores against; versions created by editing
// or restoring have none, and critique works fine without it.
export function resumeSessionFromVersion(version) {
  return {
    id: version.sessionId,
    promptId: version.promptId,
    versionNumber: version.versionNumber,
    originalPrompt: version.originalPrompt || "",
    qaPairs: version.qaPairs || [],
    supportingContext: version.supportingContext || "",
    promptObject: version.promptObject,
    rawAssembled: version.content,
  };
}

// Fetches a prompt's current version (or a specific one) and opens it in
// the builder. Shared by the welcome-back list, /history and the prompt
// detail page so all three resume identically.
export async function openPromptInBuilder(navigate, promptId, versionNumber) {
  const version = versionNumber
    ? (await getPromptVersion(promptId, versionNumber)).version
    : (await getPrompt(promptId)).currentVersion;
  if (!version) throw new Error("This prompt has no saved version to open.");
  navigate("/", { state: { resumeSession: resumeSessionFromVersion(version) } });
}
