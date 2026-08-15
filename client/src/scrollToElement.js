// Shared by HomePage.jsx, PromptLibraryPage.jsx, WelcomeBackHero.jsx, and
// PromptBuilder.jsx's smooth-scroll-to-builder/category call sites. Not used
// by HomePage's returning-visitor autoscroll, which intentionally jumps
// instantly (no `behavior: "smooth"`) rather than animating.
export function scrollToElement(el, options) {
  if (!el) return;
  try {
    el.scrollIntoView({ behavior: "smooth", ...options });
  } catch {
    // iOS Safari has historically had issues with smooth-scroll options.
    el.scrollIntoView();
  }
}
