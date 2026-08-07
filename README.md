# Prompt Builder

Turn a rough, underspecified prompt into a detailed, XML-tagged prompt you
can paste into Claude, ChatGPT, or any AI chat tool — via a short guided
Q&A instead of making you learn prompt engineering yourself.

This is a v1 MVP: no auth, no database. Session state lives in the
browser (React state + `localStorage`), and the backend is a thin
stateless proxy to two Claude API calls. It's deployable to free hosting
tiers (see [Deploy](#deploy)) so it can be shared for feedback — that's
free-tier hosting for a feedback loop, not a production-load setup.

## Stack & why

- **Frontend:** React + Vite, plain CSS (no Tailwind — see note below).
- **Backend:** Node/Express, a separate small API service.
- **LLM:** Anthropic API (`@anthropic-ai/sdk`), model set via
  `CLAUDE_MODEL` (defaults to Haiku — both calls in this app are
  structuring/formatting tasks, not deep-reasoning tasks, so a fast/cheap
  model is the right default).

**Express vs. Next.js API routes:** the spec allowed either. Went with a
separate Express backend + Vite frontend because it keeps the "two LLM
calls behind an API" mental model dead simple and framework-free — no
routing conventions to learn, nothing Next-specific to strip out later if
this evolves into a different frontend. The tradeoff is two dev servers
instead of one and CORS/proxy config (handled here via Vite's dev
proxy). If you'd rather have one codebase/one deploy target, Next.js API
routes are a reasonable alternative and the route handlers in
`server/src/routes/` would port over almost directly.

**Tailwind vs. plain CSS:** started to add Tailwind but the local npm
cache had root-owned files from a prior install (would've needed `sudo
chown`), so plain CSS it is. Functionally equivalent for a v1 this size;
revisit if the component count grows.

**Vercel vs. Netlify (frontend):** Vercel — zero-config for a Vite SPA,
generous free tier, and `vercel.json` here is minimal (build command +
SPA rewrite). Netlify would work identically well; picked Vercel mainly
to keep this doc to one path instead of documenting both.

**Render vs. Fly.io (backend):** Render — a plain Node web service on
Render's free tier needs nothing beyond `render.yaml` (build command +
start command); no Dockerfile, no `fly.toml` volumes/regions config to
reason about. Fly.io's free tier also works but leans on its CLI/`fly
launch` flow rather than a single declarative file, which is more setup
than a v1 needs.

**Formspree integration — React SDK vs. plain AJAX vs. raw HTML form:**
`@formspree/react`'s `useForm` — this is already a React app, so it's
the natural fit, and it buys retry-relevant state (`submitting`,
`succeeded`, `errors`) for free instead of hand-rolling a fetch wrapper.
It's used in its programmatic form (`handleSubmit(dataObject)`, per the
SDK's types) rather than wired to a native `<form onSubmit>`, since the
feedback widget's rating questions are one-tap buttons, not form
fields — there's nothing for a native form submission to collect. The
vanilla-JS AJAX package and a plain HTML `<form action="...">` were the
other two options; both assume a real `<form>` with named fields
driving the submission, which doesn't match this button-driven UI.

## Project structure

```
prompt-builder/
├── render.yaml               # Render blueprint for the backend
├── server/                   # Express API — stateless, two routes
│   ├── src/
│   │   ├── index.js          # app entry, CORS, health check, error handling
│   │   ├── lib/
│   │   │   ├── anthropic.js  # Claude client wrapper
│   │   │   └── prompts.js    # the two meta-prompts, verbatim from spec
│   │   └── routes/
│   │       ├── questions.js  # POST /api/questions
│   │       └── assemble.js   # POST /api/assemble
│   └── .env.example
└── client/                   # Vite + React SPA
    ├── vercel.json            # Vercel build/rewrite config
    ├── .env.example
    └── src/
        ├── App.jsx           # stage state machine (intake/qa/result)
        ├── api.js            # fetch wrappers (env-based API base URL)
        ├── storage.js        # localStorage auto-save
        └── components/
            ├── IntakeForm.jsx
            ├── QAFlow.jsx
            ├── QuestionCard.jsx
            ├── SupportingContext.jsx
            ├── ResultPreview.jsx
            └── FeedbackWidget.jsx  # @formspree/react useForm, no backend involved
```

## Setup

Requires Node 18+ (developed/tested on Node 20.18).

```bash
cd server && npm install
cd ../client && npm install
```

Add your Anthropic API key:

```bash
cp server/.env.example server/.env
# then edit server/.env and paste your ANTHROPIC_API_KEY
```

## Run

Two terminals:

```bash
cd server && npm run dev   # http://localhost:3001
```

```bash
cd client && npm run dev   # http://localhost:5173
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to
the Express backend (see `client/vite.config.js`), so no CORS setup is
needed in dev.

## How it works

1. **Intake** — rough prompt + optional prompt type (Writing, Coding,
   Analysis, Creative, Research, Other).
2. **Clarify** — `POST /api/questions` calls Claude with the exact
   system prompt from `prompt-builder-meta-prompts.md` §1, gets back
   3–6 questions as JSON (defensively strips markdown fences before
   parsing). Questions render one at a time with optional quick-select
   chips; every question is skippable; Back re-opens a previous answer
   for editing. A "supporting context" textarea is available at any
   point, separate from the Q&A.
3. **Assemble** — on finishing (or "Skip to result" at any time),
   `POST /api/assemble` sends the original prompt, all Q&A pairs
   (skipped ones marked `(skipped)`), and any supporting context to
   Claude using the exact system prompt from §2. The response is plain
   text (already XML-tagged) and is rendered directly — no further
   parsing.
4. **Result** — editable textarea, "Hide tags" display toggle (doesn't
   affect what gets copied), Copy button with a 2s "Copied!"
   confirmation and a manual-select fallback if the Clipboard API is
   unavailable. "Edit answers" jumps back into the Q&A without
   re-generating questions — only the assembler re-runs.
5. **Start Over** clears state, with a confirm if there's unsaved
   content.

Session state auto-saves to `localStorage` on every change, so a page
refresh mid-flow doesn't lose progress.

### Feedback widget

Below the result card, a small collapsed "Got a sec for quick feedback?"
prompt appears — it never blocks or precedes Copy, which stays the
primary action. Expanding it shows two one-tap questions (were the
clarifying questions useful; would you use this prompt as-is) and an
optional comment field. Submitting uses the official
[`@formspree/react`](https://github.com/formspree/formspree-js/tree/master/packages/formspree-react)
`useForm` hook, called directly with a data object (`questions_useful`,
`would_use_as_is`, `comments`, `original_prompt` — the rough input, not
the assembled result) rather than a native `<form>` submit, since the
one-tap questions are buttons, not form fields. Requires
`VITE_FEEDBACK_FORM_ID` — the ID from your Formspree form's URL
(`https://formspree.io/f/<this part>`), not the full URL. No backend
route, no database, per the SRS non-goals. A failed or unconfigured ID
shows the same inline error-banner-plus-Retry pattern used elsewhere,
never a silent failure. "Not now" dismisses it at any point without
affecting the rest of the page.

## Deploy

Free-tier deploy for sharing a working URL and gathering feedback — not
sized for production load. Backend goes to Render, frontend to Vercel;
deploy the backend first since the frontend build needs its URL.

### 1. Backend → Render

1. Push this repo to GitHub (Render deploys from a Git repo).
2. In the Render dashboard: **New → Blueprint**, point it at the repo.
   Render reads `render.yaml` at the root and creates a free web service
   rooted at `server/`.
3. Set the env vars Render will prompt for (marked `sync: false` in
   `render.yaml`, so they're not stored in the repo):
   - `ANTHROPIC_API_KEY` — your Claude API key.
   - `ALLOWED_ORIGIN` — leave blank for now; come back and set it to your
     Vercel URL (step 2.3 below) once you have it, then redeploy.
   - `CLAUDE_MODEL` is pre-filled from `render.yaml`; override if you
     want a different model.
4. Render assigns `PORT` automatically — the app already reads
   `process.env.PORT`, nothing to configure.
5. Once deployed, confirm `https://<your-service>.onrender.com/health`
   returns `{"ok":true}`.

Note: Render's free tier spins down after inactivity, so the first
request after a while will be slow (cold start) — fine for a feedback
tool, not for a snappy demo on demand.

### 2. Frontend → Vercel

1. In the Vercel dashboard: **New Project**, import the same repo, set
   **Root Directory** to `client/`. Vercel auto-detects Vite and uses
   the build command/output dir from `vercel.json`.
2. Set env vars:
   - `VITE_API_BASE_URL` = your Render backend's origin from step 1.5
     (e.g. `https://prompt-builder-api.onrender.com`, no trailing slash).
   - `VITE_FEEDBACK_FORM_ID` = your Formspree form's ID — just the ID
     from `https://formspree.io/f/<id>`, not the full URL (create a free
     form at [formspree.io](https://formspree.io) first). Optional — if
     you skip it, the feedback widget's submit just shows its retry
     banner instead of sending anywhere; nothing else breaks.

   Both are baked into the JS bundle at build time.
3. Deploy. Grab the resulting `https://<your-app>.vercel.app` URL.

### 3. Close the loop

Go back to the Render service's env vars and set `ALLOWED_ORIGIN` to
the Vercel URL from step 2.3 (comma-separate multiple origins if you
also want to allow a preview URL). Redeploy the backend so CORS accepts
requests from the deployed frontend. Reload the Vercel URL — the full
flow (intake → questions → assemble → copy) should now work end to end
against the deployed backend.

### Env var summary

| Var | Where | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Render | yes | never commit this |
| `CLAUDE_MODEL` | Render | no | defaults to Haiku, set in `render.yaml` |
| `ALLOWED_ORIGIN` | Render | yes (prod) | your Vercel origin, comma-separated if multiple |
| `VITE_API_BASE_URL` | Vercel | yes | your Render origin, no trailing slash |
| `VITE_FEEDBACK_FORM_ID` | Vercel | no | Formspree form ID (not the full URL); unset = widget shows retry banner on submit, nothing else affected |

## Error handling

Both LLM calls, and the feedback widget's submission, can fail (rate
limits, network, misconfigured endpoint). Each surfaces an inline error
banner with a **Retry** button that re-sends the same request — the app
never hangs silently or crashes.

## Known dev-only items

- `npm audit` flags a moderate/high advisory in `esbuild` (bundled with
  Vite 5) — it only affects the local dev server accepting arbitrary
  requests, not anything shipped to users, and not worth a breaking
  Vite major-version bump for a v1 MVP.

## Explicitly out of scope for v1 (next steps)

Per the SRS, these are flagged rather than built:

- **Auth** — no accounts, no login.
- **Database / session history** — nothing persists server-side or
  across browsers; `localStorage` is per-browser only.
- Everything under SRS §9 "Future Enhancements" (test-drive mode,
  template library, team workspaces, browser extension, versioning/diff,
  file upload support).
