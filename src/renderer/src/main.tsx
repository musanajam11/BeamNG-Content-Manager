import './assets/main.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startVoiceLoopback } from './voice/loopback'

// Dev-only: expose voice loopback test for the Phase 1 exit criteria.
// Use from devtools console: `await __voiceLoopback.start()`
if (import.meta.env.DEV) {
  ;(window as unknown as { __voiceLoopback: { start: typeof startVoiceLoopback } }).__voiceLoopback = {
    start: startVoiceLoopback,
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
