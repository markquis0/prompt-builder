// Shared by routes/auth.js (signup) and routes/account.js (email/password
// change) so the two never drift into enforcing different rules for the
// same thing.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

export function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

// No format constraint beyond non-empty — see the header-redesign handoff's
// Part 3 (required first/last name at signup).
export function isValidName(name) {
  return typeof name === "string" && name.trim().length > 0;
}
