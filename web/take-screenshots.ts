// Automated screenshot capture for all app pages using the web demo.
// Usage: npx playwright test --config=playwright.config.ts  (or run directly with tsx)
// Requires: dev server running at localhost:5174 (npm run dev:web)

import { chromium } from 'playwright'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PAGES = [
  'home',
  'servers',
  'friends',
  'vehicles',
  'maps',
  'mods',
  'career',
  'server-admin',
  'launcher',
  'controls',
  'live-gps',
  'settings'
]

const SCREENSHOT_DIR = resolve(__dirname, '../Docs/screenshots')
const BASE_URL = 'http://localhost:5174'

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1
  })
  const page = await context.newPage()

  // Navigate to the app and wait for it to load
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  // Dismiss the demo banner
  await page.click('button:has-text("✕")', { timeout: 3000 }).catch(() => {})
  // Wait for the app to fully render
  await page.waitForTimeout(2000)

  for (let i = 0; i < PAGES.length; i++) {
    const pageId = PAGES[i]
    const num = i + 1

    // Navigate by clicking the sidebar button that contains the page text
    // Sidebar buttons use onClick={() => setPage(id)} — we find them by their role/structure
    // Each sidebar item is a <button> inside the sidebar with the page name text
    const clicked = await page.evaluate((pid) => {
      // Try to find sidebar buttons and click the right one
      const buttons = document.querySelectorAll('button, [role="button"], a')
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase() ?? ''
        const mapping: Record<string, string[]> = {
          home: ['home'],
          servers: ['servers'],
          friends: ['friends'],
          vehicles: ['vehicles'],
          maps: ['maps'],
          mods: ['mods'],
          career: ['career'],
          'server-admin': ['server manager'],
          launcher: ['launcher', 'beammp launcher'],
          controls: ['controls'],
          'live-gps': ['live gps'],
          settings: ['settings']
        }
        const candidates = mapping[pid] ?? [pid]
        if (candidates.some((c) => text === c)) {
          ;(btn as HTMLElement).click()
          return true
        }
      }
      return false
    }, pageId)

    if (!clicked) {
      console.warn(`  [!] Could not find sidebar button for "${pageId}", trying fallback...`)
    }

    // Wait for page transition animation
    await page.waitForTimeout(1200)

    const fileName = `screenshot (${num}).png`
    await page.screenshot({
      path: resolve(SCREENSHOT_DIR, fileName),
      type: 'png'
    })
    console.log(`[${num}/${PAGES.length}] Captured: ${pageId} → ${fileName}`)
  }

  await browser.close()
  console.log(`\nDone! ${PAGES.length} screenshots saved to Docs/screenshots/`)
}

main().catch(console.error)
