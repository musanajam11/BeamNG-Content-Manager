// Always-on-top overlay window that displays mod-sync download progress over
// the BeamNG.drive game window. Spawned on demand when the first non-`done`
// `game:modSyncProgress` event fires; auto-destroyed shortly after `done` or
// when the game process exits.
//
// The overlay reuses the existing renderer bundle. The renderer entry
// (`main.tsx`) detects `?overlay=modsync` in the URL and renders only the
// `ModSyncOverlay` component on a transparent background, instead of the full
// app UI.
//
// Window tracking: a small PowerShell helper (resources/track-window.ps1) is
// spawned with the BeamNG PID and streams JSON window-bounds events to
// stdout. The overlay's BrowserWindow follows those bounds so it sits over
// BeamNG's main menu — even on a secondary monitor or in windowed mode — and
// hides while the game is minimised.

import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { is } from '@electron-toolkit/utils'

let overlayWindow: BrowserWindow | null = null
let destroyTimer: NodeJS.Timeout | null = null
let lastProgress: ModSyncProgress | null = null
let trackerProc: ChildProcess | null = null
let trackedPid: number | null = null
let lastBounds: { x: number; y: number; w: number; h: number; min: boolean } | null = null

// Overlay covers the central menu area of the BeamNG window: roughly the
// width of the four menu cards + the row of buttons below them, centred
// horizontally and vertically. Sized as a fraction of the game window so it
// scales with windowed/fullscreen mode but never spills off-screen.
const CARD_WIDTH_FRAC = 0.62
const CARD_HEIGHT_FRAC = 0.55
const CARD_MIN_W = 520
const CARD_MIN_H = 360
const CARD_MAX_W = 1100
const CARD_MAX_H = 720

export type ModSyncProgress = {
  phase: 'downloading' | 'loading' | 'done' | 'cancelled'
  modIndex: number
  modCount: number
  fileName: string
  received: number
  total: number
}

function getOverlayUrl(): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}?overlay=modsync`
  }
  return `file://${join(__dirname, '../renderer/index.html').replace(/\\/g, '/')}?overlay=modsync`
}

function getTrackerScriptPath(): string {
  // resources/** is asarUnpack'd (see electron-builder.yml) so the .ps1 is a
  // real file on disk in production builds. In dev, app.getAppPath() returns
  // the project directory.
  let p = join(app.getAppPath(), 'resources', 'track-window.ps1')
  if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = p.replace('app.asar', 'app.asar.unpacked')
  }
  return p
}

function computeCardBounds(b: { x: number; y: number; w: number; h: number }):
  { x: number; y: number; width: number; height: number } {
  const targetW = Math.round(b.w * CARD_WIDTH_FRAC)
  const targetH = Math.round(b.h * CARD_HEIGHT_FRAC)
  const width = Math.max(CARD_MIN_W, Math.min(CARD_MAX_W, Math.min(targetW, b.w - 32)))
  const height = Math.max(CARD_MIN_H, Math.min(CARD_MAX_H, Math.min(targetH, b.h - 32)))
  const x = Math.round(b.x + (b.w - width) / 2)
  const y = Math.round(b.y + (b.h - height) / 2)
  return { x, y, width, height }
}

function applyBounds(b: { x: number; y: number; w: number; h: number }): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  // Guard against zero / negative sizes that can briefly appear during window
  // creation or restore animations.
  if (b.w < 100 || b.h < 100) return
  try {
    overlayWindow.setBounds(computeCardBounds(b))
  } catch { /* setBounds can throw if the display config changed mid-call */ }
}

function startTracker(pid: number): void {
  stopTracker()
  trackedPid = pid

  if (process.platform !== 'win32') {
    // Non-Windows: skip per-window tracking; createOverlayWindow's fallback
    // will centre on the primary display instead.
    return
  }

  const script = getTrackerScriptPath()
  console.log('[ModSyncOverlay] starting tracker for pid', pid, 'script:', script)
  trackerProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-TargetPid', String(pid)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )

  let buf = ''
  let firstRect = true
  trackerProc.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
      if (!line) continue
      try {
        const evt = JSON.parse(line) as
          | { event: 'rect'; x: number; y: number; w: number; h: number; min: boolean }
          | { event: 'gone' }
        if (evt.event === 'gone') {
          console.log('[ModSyncOverlay] tracker reported game window gone')
          closeModSyncOverlay()
          return
        }
        if (evt.event === 'rect') {
          if (firstRect) {
            console.log('[ModSyncOverlay] first window rect:', evt)
            firstRect = false
          }
          lastBounds = { x: evt.x, y: evt.y, w: evt.w, h: evt.h, min: evt.min }
          if (!overlayWindow || overlayWindow.isDestroyed()) return
          if (evt.min) {
            if (overlayWindow.isVisible()) overlayWindow.hide()
          } else {
            applyBounds(evt)
            if (!overlayWindow.isVisible()) overlayWindow.showInactive()
          }
        }
      } catch { /* ignore malformed line */ }
    }
  })

  trackerProc.stderr?.on('data', (chunk: Buffer) => {
    // Surface tracker errors to the dev console — these used to silently
    // suppress all overlay positioning when the script crashed.
    console.error('[ModSyncOverlay tracker]', chunk.toString('utf8').trim())
  })

  trackerProc.on('exit', (code) => {
    trackerProc = null
    if (code !== 0) {
      console.error('[ModSyncOverlay tracker] exited with code', code)
    }
    // Tracker died. We do NOT close the overlay here — tracker failures
    // (PowerShell missing, exec policy, BeamNG window not found, Steam shim
    // PID, etc.) must not hide the progress UI. The overlay's fallback path
    // (cover primary display) keeps it usable. The overlay is closed only
    // by GameLauncherService.shutdown() when BeamNG actually exits.
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isVisible()) {
      const d = screen.getPrimaryDisplay().workArea
      try {
        overlayWindow.setBounds(computeCardBounds({ x: d.x, y: d.y, w: d.width, h: d.height }))
        overlayWindow.showInactive()
      } catch { /* ignore */ }
    }
  })
}

function stopTracker(): void {
  if (trackerProc) {
    try { trackerProc.kill() } catch { /* ignore */ }
    trackerProc = null
  }
  trackedPid = null
  lastBounds = null
}

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    // Initial size is a placeholder; applyBounds() recomputes from the
    // tracker's first window rect and re-centres on the BeamNG window. We
    // start hidden to avoid a flash at the wrong location.
    width: CARD_MIN_W,
    height: CARD_MIN_H,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // never steal focus from BeamNG
    show: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // 'screen-saver' level keeps the overlay above fullscreen-windowed games.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // The card itself blocks clicks; clicks outside the small card hit BeamNG
  // normally so the user can drag/resize the game window.

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(getOverlayUrl())
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { overlay: 'modsync' }
    })
  }

  // Don't auto-show on ready-to-show — wait for the first window-bounds tick
  // from the tracker so the overlay appears directly on top of BeamNG instead
  // of flashing at (0, 0). If we never get a tick (tracker disabled, e.g.
  // non-Windows), fall back to covering the primary display after a short
  // grace period.
  win.webContents.on('did-finish-load', () => {
    if (lastProgress && !win.isDestroyed()) {
      win.webContents.send('game:modSyncProgress', lastProgress)
    }
    setTimeout(() => {
      if (win.isDestroyed() || win.isVisible()) return
      if (lastBounds && !lastBounds.min) {
        applyBounds(lastBounds)
        win.showInactive()
      } else if (!lastBounds) {
        // No tracker data — cover the central area of the primary display.
        const d = screen.getPrimaryDisplay().workArea
        win.setBounds(computeCardBounds({ x: d.x, y: d.y, w: d.width, h: d.height }))
        win.showInactive()
      }
    }, 800)
  })

  win.on('closed', () => {
    if (overlayWindow === win) overlayWindow = null
  })

  return win
}

/**
 * Called by GameLauncherService whenever a mod-sync progress event is emitted.
 * Spawns / tears down the overlay window as needed. `gamePid` is the BeamNG
 * process PID if known, used to track the game window's position so the
 * overlay sits on top of it.
 */
export function notifyModSyncProgress(progress: ModSyncProgress, gamePid?: number | null): void {
  // Gate: if we don't have a live game PID, don't spawn (or re-spawn) the
  // overlay. After the user closes BeamNG mid-sync the launcher keeps
  // emitting `placed` progress events for already-on-disk mods; without
  // this guard those events would resurrect the overlay window over a dead
  // game, leaving it stuck on screen forever.
  if (!gamePid) {
    // Still broadcast nothing here — the in-app overlay was already cleared
    // by the synthetic 'cancelled' event in closeModSyncOverlay().
    return
  }

  lastProgress = progress

  if (progress.phase === 'done') {
    // Brief "synced" flash, then tear the window down.
    if (destroyTimer) clearTimeout(destroyTimer)
    destroyTimer = setTimeout(() => {
      destroyTimer = null
      closeModSyncOverlay()
    }, 2500)
    return
  }

  // Cancel any pending teardown if a new sync starts before the timer fires.
  if (destroyTimer) {
    clearTimeout(destroyTimer)
    destroyTimer = null
  }

  if (!overlayWindow || overlayWindow.isDestroyed()) {
    console.log('[ModSyncOverlay] creating overlay window (gamePid=', gamePid, ')')
    overlayWindow = createOverlayWindow()
  }

  if (gamePid !== trackedPid) {
    startTracker(gamePid)
  }
}

/**
 * Force-close the overlay window and stop the window tracker. Called by
 * GameLauncherService.shutdown() so the overlay disappears immediately when
 * BeamNG exits — including a premature quit during the download.
 */
export function closeModSyncOverlay(): void {
  if (destroyTimer) {
    clearTimeout(destroyTimer)
    destroyTimer = null
  }
  stopTracker()

  // Notify all renderer windows that mod-sync is finished/cancelled, even if
  // the launcher never emitted a `done` phase (e.g. user quit BeamNG mid-
  // download). Without this the in-app ModSyncOverlay on the Servers page
  // stays stuck on the last progress value until the user navigates away.
  // BUT: if the last phase we saw was `done`, the sync completed successfully
  // — broadcasting `cancelled` here would mislabel a successful sync as
  // cancelled in the in-app overlay.
  if (lastProgress && lastProgress.phase !== 'done') {
    const cancelEvt = {
      phase: 'cancelled' as const,
      modIndex: lastProgress.modIndex,
      modCount: lastProgress.modCount,
      fileName: lastProgress.fileName,
      received: lastProgress.received,
      total: lastProgress.total
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        const wc = w.webContents
        if (wc.isDestroyed() || wc.isCrashed() || wc.isLoading()) continue
        try { wc.send('game:modSyncProgress', cancelEvt) } catch { /* ignore */ }
      }
    }
  }
  lastProgress = null

  // Destroy the tracked overlay window AND any orphan overlay windows that
  // may have leaked across HMR reloads / module re-evaluations in dev. We
  // identify overlay windows by their URL containing `overlay=modsync`.
  const tracked = overlayWindow
  overlayWindow = null
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    let isOverlay = w === tracked
    if (!isOverlay) {
      try {
        const url = w.webContents.getURL()
        if (url.includes('overlay=modsync')) isOverlay = true
      } catch { /* ignore */ }
    }
    if (isOverlay) {
      try { w.destroy() } catch { /* ignore */ }
    }
  }
}
