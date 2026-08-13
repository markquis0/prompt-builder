// Shared example used by the /pro page demo and the homepage's before/after
// section, so both stay visually consistent. Realistic, and long enough
// (~2,500 chars of context) to trigger the Gemini context-first reorder —
// that's the whole point of showing it on /pro.

export const SAMPLE_ROUGH_PROMPT = "Write me a marketing email";

const BRAND_VOICE_CONTEXT = `FocusFlow brand voice guide (excerpt for marketing copy):

We talk to freelancers like a smart friend who happens to know a lot about productivity tools, not like a SaaS company trying to close a deal. That means contractions, short sentences, and zero jargon like "leverage," "synergy," or "seamless."

Tone: warm, a little wry, never salesy. We're allowed to be funny about the chaos of freelance life (the seventeen open tabs, the client who emails at 11pm) because our users live it too. We are not allowed to be funny about money, deadlines they've missed, or anything that could read as mocking someone's actual stress.

What we never say: "revolutionary," "game-changing," "10x," "unlock your potential," or anything that sounds like a keynote slide. If a sentence could appear in a startup's Series A deck, cut it.

What we always do: lead with the specific problem before the feature. Freelancers don't care that FocusFlow has "AI-powered context switching detection" — they care that it stops them from losing 20 minutes every time a client Slack message interrupts deep work. Name the pain first, in their words, then the fix.

Formatting preferences: short paragraphs (2-3 sentences max), one idea per paragraph, and when giving instructions or steps, prefer a simple numbered or bulleted list over a dense paragraph. Subject lines should feel like they're from a person, not a newsletter — no emoji, no "🚀," no ALL CAPS urgency.

Call-to-action language: "Try it free for 14 days" beats "Start your free trial" beats "Sign up now." We want it to sound like an invitation, not a funnel step. Never use countdown-timer urgency ("Offer ends soon!") — our users can smell fake scarcity and it actively hurts trust with this audience.

A note on humor: self-deprecating is good, punching down is not. We can joke about our own onboarding flow being clunky in v1. We do not joke about other productivity apps by name — freelancers talk to each other, and dunking on a competitor reads as insecure, not confident.`;

export const SAMPLE_PROMPT = {
  task:
    "Write a marketing email promoting FocusFlow, a new productivity app for freelancers. The email should drive sign-ups for a 14-day free trial.",
  audience:
    "Freelancers and independent contractors who juggle multiple client projects and struggle with context-switching.",
  tone:
    "Casual and encouraging — like a friend who found something useful, not a corporation selling something.",
  format: "Under 200 words. One clear call-to-action near the end. Subject line included.",
  constraints:
    'Do not mention competitor products by name. Do not use the word "revolutionary." No ALL CAPS.',
  context: BRAND_VOICE_CONTEXT,
  examples: null,
  successCriteria: "The reader clicks the free trial link. Secondary: they forward it to a freelancer friend.",
  background: null,
};
