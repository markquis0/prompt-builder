import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { Analytics } from '@vercel/analytics/react'
import posthog from 'posthog-js'
import './index.css'
import HomePage from './pages/HomePage.jsx'
import ProPage from './pages/ProPage.jsx'
import ResourcesPage from './pages/ResourcesPage.jsx'
import LegalPage from './pages/LegalPage.jsx'
import { AuthProvider } from './context/AuthContext.jsx'

// Split out of the main bundle — per the dependency/codebase audit, these
// two carry the largest first-party payloads (learnContent.js ~21KB,
// promptLibraryContent.js ~52KB of the 260 prompt-library entries), and
// most visitors landing on / or /pro never touch either. Prerendering is
// unaffected: prerender.mjs navigates to the real route and waits for
// networkidle0, which already accounts for the extra chunk request.
const LearnPage = lazy(() => import('./pages/LearnPage.jsx'))
const PromptLibraryPage = lazy(() => import('./pages/PromptLibraryPage.jsx'))
// Same reasoning as the two above — only reached by a logged-in user
// deliberately visiting /settings, never on the / or /pro landing paths.
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))
const HistoryPage = lazy(() => import('./pages/HistoryPage.jsx'))

// Guarded so local dev without PostHog configured never errors — funnel
// events become silent no-ops (posthog-js queues/no-ops calls made before
// or without init) rather than the app failing to boot.
//
// Also guarded against prerendering: client/scripts/prerender.mjs runs
// Puppeteer against this exact built bundle (same one that ships to
// production, same embedded VITE_POSTHOG_KEY), so without this check,
// every deploy's prerender pass would have posthog.init() run for real in
// the build machine's headless browser and send a live pageview per
// prerendered route — phantom "visits" from the build machine, not a
// hydration double-fire. prerender.mjs sets window.__PRERENDERING__ via
// page.evaluateOnNewDocument() before navigating; a real visitor's browser
// never has this set.
if (import.meta.env.VITE_POSTHOG_KEY && !window.__PRERENDERING__) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // no profiles for anonymous visitors — keeps this lightweight
    // Explicit, not left to the SDK's version-gated default — this is a
    // client-side-routed SPA (react-router, no full page reload between
    // routes), so pageviews have to be captured on History API changes or
    // every route reached via in-app navigation (which is most of them)
    // gets zero pageview coverage.
    capture_pageview: 'history_change',
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <AuthProvider>
        <BrowserRouter>
          {/* Was mounted only on the old App.jsx (the `/` route) — moved here
              so every route gets pageview tracking, not just the homepage. */}
          <Analytics />
          <Suspense fallback={<p className="loading-text">Loading…</p>}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/learn/*" element={<LearnPage />} />
              <Route path="/pro" element={<ProPage />} />
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/prompts" element={<PromptLibraryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/privacy" element={<LegalPage page="privacy" />} />
              <Route path="/terms" element={<LegalPage page="terms" />} />
              <Route path="/refund-policy" element={<LegalPage page="refund" />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </HelmetProvider>
  </StrictMode>,
)
