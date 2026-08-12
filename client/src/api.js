// In dev this is empty, so requests hit the Vite proxy (see vite.config.js).
// In production, set VITE_API_BASE_URL to the deployed backend's origin
// (e.g. https://prompt-builder-api.onrender.com) — no trailing slash.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function postJSON(path, body) {
  const url = `${API_BASE}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

export function fetchQuestions({ prompt, promptType }) {
  return postJSON("/api/questions", { prompt, promptType });
}

export function assemblePrompt({ originalPrompt, supportingContext, qaPairs, targetModel = "generic" }) {
  return postJSON("/api/assemble", { originalPrompt, supportingContext, qaPairs, targetModel });
}
