import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { Analytics } from '@vercel/analytics/react'
import posthog from 'posthog-js'
import './index.css'
import HomePage from './pages/HomePage.jsx'
import LearnPage from './pages/LearnPage.jsx'
import ProPage from './pages/ProPage.jsx'

// Guarded so local dev without PostHog configured never errors — funnel
// events become silent no-ops (posthog-js queues/no-ops calls made before
// or without init) rather than the app failing to boot.
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // no profiles for anonymous visitors — keeps this lightweight
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        {/* Was mounted only on the old App.jsx (the `/` route) — moved here
            so every route gets pageview tracking, not just the homepage. */}
        <Analytics />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/learn/*" element={<LearnPage />} />
          <Route path="/pro" element={<ProPage />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
