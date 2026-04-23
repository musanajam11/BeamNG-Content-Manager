import './assets/main.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ModSyncOverlay } from './components/servers/ModSyncOverlay'
import { startVoiceLoopback } from './voice/loopback'

// Dev-only: expose voice loopback test for the Phase 1 exit criteria.
// Use from devtools console: `await __voiceLoopback.start()`
if (import.meta.env.DEV) {
  ;(window as unknown as { __voiceLoopback: { start: typeof startVoiceLoopback } }).__voiceLoopback = {
    start: startVoiceLoopback,
  }
}

// The main process spawns a small always-on-top BrowserWindow during server
// mod sync that loads this same renderer bundle with `?overlay=modsync`. In
// that mode we render only the progress card on a transparent background so
// it can sit on top of BeamNG.drive while the user waits in the main menu.
const overlayMode = new URLSearchParams(window.location.search).get('overlay')

if (overlayMode === 'modsync') {
  // Force the host window's chrome transparent. The CSS in main.css applies
  // `background-color: var(--color-base)` to html/body/#root; inline styles
  // override that so only the centered card paints opaque pixels and the
  // surrounding area lets BeamNG.drive show through.
  const transparentEls = [document.documentElement, document.body]
  for (const el of transparentEls) {
    el.style.background = 'transparent'
    el.style.backgroundColor = 'transparent'
  }
  document.body.style.overflow = 'hidden'
  const rootEl = document.getElementById('root')!
  rootEl.style.background = 'transparent'
  rootEl.style.backgroundColor = 'transparent'

  createRoot(rootEl).render(
    <StrictMode>
      <div className="relative w-screen h-screen" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <ModSyncOverlay standalone />
      </div>
    </StrictMode>
  )
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
