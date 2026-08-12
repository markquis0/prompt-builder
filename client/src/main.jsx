import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import posthog from 'posthog-js'
import './index.css'
import App from './App.jsx'
import LearnPage from './pages/LearnPage.jsx'

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
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/learn/*" element={<LearnPage />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
)
