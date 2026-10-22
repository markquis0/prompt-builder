import rateLimit from "express-rate-limit";

// Sharing takes an email and answers "is there an account for this?" — to a
// signed-in user, by design (the owner needs to know the share can't
// happen). That makes it an account-enumeration oracle if left unbounded, so
// it's capped per *user* (not per IP: this runs after requireAuth, and many
// teammates can share one office IP). Generous for real use — sharing one
// prompt with a whole team is a handful of requests — tight for a loop
// guessing addresses.
export const shareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You've shared a lot of prompts recently. Please try again later." },
});

// Adding a team member is the same "is there an account for this email?"
// lookup as sharing, so it gets the same per-user cap — but its own counter,
// so a manager populating a team isn't throttled by (or throttling) their
// prompt sharing.
export const teamMemberLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.userId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You've added a lot of people recently. Please try again later." },
});
