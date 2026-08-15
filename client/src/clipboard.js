// Shared by ResultPreview.jsx and PromptCard.jsx. navigator.clipboard needs
// a secure context and can be denied by permissions policy; the
// execCommand fallback covers those cases (older Safari, insecure/embedded
// contexts) at the cost of a visible-but-instant textarea flash.
function legacyCopy(text) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

// How long the "Copied!" / "✓ Copied" confirmation stays up before
// reverting, in both ResultPreview.jsx and PromptCard.jsx.
export const COPY_CONFIRMATION_MS = 2000;

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
}
