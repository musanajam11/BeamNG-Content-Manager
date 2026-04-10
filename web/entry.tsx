// Web demo entry point.
// Installs the mock API onto window, then boots the renderer app.

import './mock-api'
import './styles.css'
import '../src/renderer/src/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/src/App'
import { DemoBanner } from './DemoBanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DemoBanner />
    <App />
  </StrictMode>
)
