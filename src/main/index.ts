import { app, shell, BrowserWindow, protocol, Tray, Menu, nativeImage, ipcMain, nativeTheme } from 'electron'
import { join, resolve as resolvePath } from 'path'
import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { initializeServices, registerIpcHandlers } from './ipc/handlers'
import { extractVehicleAsset, resolveGameAsset, initVehicleAssetService } from './services/VehicleAssetService'
import { initDiscordRPC, destroyDiscordRPC } from './services/DiscordRPCService'
// ── Read stored colorMode before window creation for correct initial background ──
function getInitialBackground(): string {
  try {
    const cfgPath = join(app.getPath('appData'), 'BeamMP-ContentManager', 'config.json')
    if (existsSync(cfgPath)) {
      const parsed = JSON.parse(readFileSync(cfgPath, 'utf-8'))
      const mode: string = parsed?.appearance?.colorMode ?? 'dark'
      if (mode === 'light' || (mode === 'system' && nativeTheme.shouldUseDarkColors === false)) {
        return '#f5f5f7'
      }
    }
  } catch { /* ignore – fall through to dark */ }
  return '#111113'
}

// ── Linux/Steam Deck: enable Wayland support via Ozone platform ──
if (process.platform === 'linux') {
  // Ozone auto-detection picks Wayland (Gamescope on Steam Deck) or X11
  app.commandLine.appendSwitch('ozone-platform-auto')
  // GPU acceleration can fail under Gamescope; allow software fallback
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,UseOzonePlatform')
}

// Must be called before app.whenReady() so fetch() works with the custom protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'vehicle-asset', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } }
])

// ── beammp-cm:// custom URL scheme (invite links) ──────────────────────────
//
// Lets users (or web pages) open `beammp-cm://join?ip=...&port=...&...` and
// have it routed straight into a running CM instance. The OS launches the
// installed app for the scheme; we receive the URL via:
//   • argv on cold start (Windows/Linux)
//   • app.on('second-instance', argv) when already running (Win/Linux)
//   • app.on('open-url', url)        on macOS (both cold and warm)
//
// Format (parsed in parseInviteUrl below — keep schema minimal/whitelisted):
//   beammp-cm://join?ip=<host>&port=<1-65535>
//                  [&name=<sname>][&map=<map>][&password=<pw>][&from=<sender>]
//
// Security: we never auto-join. The renderer always shows a confirmation card
// with the parsed server info first. Unknown query keys are ignored. Any
// malformed URL is dropped silently (logged for debugging).
const INVITE_SCHEME = 'beammp-cm'
const BMR_ORIGIN = 'https://bmr.musanet.xyz'
const BMR_INVITE_API = `${BMR_ORIGIN}/api/invite`

interface JoinInvitePayload {
  ip: string
  port: number
  name?: string
  map?: string
  password?: string
  from?: string
  raw: string
}

let pendingInvite: JoinInvitePayload | null = null

function parseInviteUrl(input: string): JoinInvitePayload | null {
  if (!input || typeof input !== 'string') return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== `${INVITE_SCHEME}:`) return null

  // We intentionally accept either `beammp-cm://join?...` (host = "join")
  // or `beammp-cm:join?...` (path-style). Either way, the action is "join".
  const action = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase()
  if (action && action !== 'join') {
    console.warn('[invite] unsupported action:', action)
    return null
  }

  const ip = (url.searchParams.get('ip') || '').trim()
  const portStr = (url.searchParams.get('port') || '').trim()
  const port = parseInt(portStr, 10)
  if (!ip || !port || port < 1 || port > 65535) return null

  // Reject obviously hostile hosts: only allow chars that can appear in a
  // hostname / IPv4 / bracketed IPv6 literal. This blocks command-injection
  // style payloads from any downstream code that might forward the value.
  if (!/^[a-zA-Z0-9.\-:[\]_]+$/.test(ip)) return null

  const name = url.searchParams.get('name')?.slice(0, 200) || undefined
  const map = url.searchParams.get('map')?.slice(0, 200) || undefined
  const password = url.searchParams.get('password')?.slice(0, 200) || undefined
  const from = url.searchParams.get('from')?.slice(0, 100) || undefined

  return { ip, port, name, map, password, from, raw: input }
}

function findInviteInArgv(argv: readonly string[]): JoinInvitePayload | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${INVITE_SCHEME}:`)) {
      const parsed = parseInviteUrl(arg)
      if (parsed) return parsed
    }
  }
  return null
}

function dispatchInvite(invite: JoinInvitePayload): void {
  console.log('[invite] received:', invite.ip + ':' + invite.port, invite.name ? `(${invite.name})` : '')
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    mainWindow.webContents.send('invite:received', invite)
  } else {
    // Window not ready yet — stash and let the renderer pull on first mount.
    pendingInvite = invite
  }
}

// Register CM as the OS-level handler for beammp-cm:// links.
// Dev mode special-case: when running via `electron .` the invocation is
// `electron.exe <argv[1]=path-to-app>`, so we must pass execPath + the
// script path so Windows reconstructs the correct command line on
// protocol launch. The script path MUST be absolute — when Windows
// invokes the registered command from the browser, the working directory
// is typically C:\WINDOWS\System32, and a relative argv[1] resolves there
// (yielding the "Unable to find Electron app at C:\WINDOWS\System32"
// error). We also unregister any stale prior dev registration so leftover
// entries pointing at deleted electron.exe paths don't poison the OS
// handler list.
if (process.defaultApp) {
  if (process.argv.length >= 2 && process.argv[1]) {
    const appEntry = resolvePath(process.argv[1])
    // Pass `--` so beammp-cm://… URLs are treated as positional args, not
    // as flags (Electron would otherwise try to interpret a leading `--`).
    app.removeAsDefaultProtocolClient(INVITE_SCHEME)
    app.setAsDefaultProtocolClient(INVITE_SCHEME, process.execPath, [appEntry])
  }
} else {
  app.setAsDefaultProtocolClient(INVITE_SCHEME)
}

// On Windows, decorate the protocol's HKCU class with a friendly name and
// DefaultIcon so the browser's "Open this link with…" picker shows
// "BeamMP Content Manager" + our app icon instead of the generic
// "Electron" text and a blank icon. `app.setAsDefaultProtocolClient` only
// writes shell\open\command; it leaves the (Default) friendly name and
// DefaultIcon empty, which is what the browser scrapes for the picker UI.
// In packaged installs, electron-builder's NSIS installer writes these
// for us, so we only need this in dev / unpackaged contexts.
if (process.platform === 'win32') {
  try {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(app.getAppPath(), 'build', 'icon.ico')
    const friendlyName = 'BeamMP Content Manager'
    const baseKey = `HKCU\\Software\\Classes\\${INVITE_SCHEME}`
    const regAdd = (key: string, valueName: string, type: string, data: string): void => {
      // Use spawn (no shell) so values containing spaces/quotes are passed
      // safely as a single argv element. /f forces overwrite without prompt.
      const args = ['ADD', key, '/v', valueName, '/t', type, '/d', data, '/f']
      // /ve writes the (Default) value
      if (valueName === '') {
        args.splice(2, 2, '/ve')
      }
      const child = spawn('reg.exe', args, { stdio: 'ignore', windowsHide: true })
      child.on('error', (err) => console.warn('[invite] reg.exe failed:', err.message))
    }
    regAdd(baseKey, '', 'REG_SZ', `URL:${friendlyName} Invite`)
    regAdd(baseKey, 'URL Protocol', 'REG_SZ', '')
    regAdd(baseKey, 'FriendlyTypeName', 'REG_SZ', friendlyName)
    regAdd(`${baseKey}\\DefaultIcon`, '', 'REG_SZ', `"${iconPath}",0`)
  } catch (err) {
    console.warn('[invite] Failed to decorate protocol registry entries:', err)
  }
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Single instance lock — if a second copy launches, focus the existing window
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    // The OS appended the beammp-cm:// URL to our argv when it relaunched
    // the existing instance. Parse it and dispatch.
    const invite = findInviteInArgv(argv)
    if (invite) dispatchInvite(invite)
  })

  // macOS: protocol URLs arrive via 'open-url', NOT argv.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const invite = parseInviteUrl(url)
    if (invite) dispatchInvite(invite)
  })

  // Cold start (Win/Linux): the URL is in our own process.argv.
  // macOS cold-start uses 'open-url' which is wired up above and will fire
  // shortly after app.whenReady(); dispatchInvite() stashes it as pending
  // until mainWindow is ready.
  pendingInvite = findInviteInArgv(process.argv)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: getInitialBackground(),
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      spellcheck: false,
      // Must remain false: voice chat (renderer) relies on setInterval / AudioContext
      // scheduling that Chromium throttles when the window is backgrounded. With
      // BeamNG.drive in the foreground the CM window is always backgrounded, which
      // would chop and eventually silence voice playback. See v0.3.28 regression.
      backgroundThrottling: false,
      v8CacheOptions: 'code'
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Close-to-tray: hide window instead of quitting (like Discord).
  // If no system tray is available (e.g. Steam Deck gaming mode), close
  // actually quits — otherwise the user would have no way to exit.
  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // When hidden to tray, release renderer HTTP cache so the app idles light.
  // NOTE: do NOT force gc() here — voice chat runs in the renderer and a
  // synchronous GC pause stalls the AudioContext scheduler, causing dropouts.
  mainWindow.on('hide', () => {
    try {
      mainWindow?.webContents.session.clearCache().catch(() => { /* ignore */ })
    } catch { /* ignore */ }
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Safety net: if any anchor without target="_blank" tries to navigate the
  // renderer away from the app (e.g. an external mod link), open it in the
  // user's default browser instead and keep the React UI mounted. Without
  // this, the renderer would replace itself with the external page and the
  // user would have no way back short of restarting CM.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const current = mainWindow?.webContents.getURL() ?? ''
      const target = new URL(url)
      const cur = current ? new URL(current) : null
      const isInternal =
        target.protocol === 'file:' ||
        (cur && target.protocol === cur.protocol && target.host === cur.host)
      if (!isInternal) {
        event.preventDefault()
        shell.openExternal(url)
      }
    } catch {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Always allow F12 / Ctrl+Shift+I to toggle DevTools, even in production
  // builds. `optimizer.watchWindowShortcuts` only enables this in dev mode,
  // which leaves end-users unable to capture renderer logs when something
  // breaks (voice chat audio init, IPC errors, etc.).
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const isF12 = input.key === 'F12'
    const isCtrlShiftI =
      (input.control || input.meta) && input.shift && (input.key === 'I' || input.key === 'i')
    if (isF12 || isCtrlShiftI) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.beammp.content-manager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register vehicle-asset:// protocol to serve 3D models and textures from vehicle zips
  protocol.handle('vehicle-asset', async (request) => {
    try {
      const url = new URL(request.url)
      const vehicleName = url.hostname
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))

      let buf: Buffer | null = null

      // If the path starts with 'vehicles/', treat as a game-absolute path
      // (supports common.zip routing and .png→.dds fallback)
      if (filePath.startsWith('vehicles/')) {
        buf = await resolveGameAsset(filePath)
      } else {
        // Legacy behavior: relative to vehicles/<vehicleName>/
        buf = await extractVehicleAsset(vehicleName, filePath)
      }

      if (!buf) {
        console.warn('[protocol] 404:', filePath)
        return new Response('Not found', { status: 404 })
      }
      console.log('[protocol] served:', filePath, buf.length, 'bytes')
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      const mimeMap: Record<string, string> = {
        dae: 'application/xml', png: 'image/png', jpg: 'image/jpeg',
        jpeg: 'image/jpeg', dds: 'application/octet-stream'
      }
      return new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': mimeMap[ext] || 'application/octet-stream' }
      })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })

  // Allow the renderer to use the microphone for voice chat without prompting.
  // Without this handler Electron's default request pipeline can drop the
  // promise silently on Windows when the OS-level mic permission is missing,
  // causing useVoiceChatStore.enable() to throw before vc_enable ever
  // reaches the BeamMP server.
  const ses = (await import('electron')).session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') {
      callback(true)
      return
    }
    callback(false)
  })
  ses.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'mediaKeySystem'
  })

  // Initialize services and load config
  const { config, backend, serverManager, modManagerService } = initializeServices()
  const appConfig = await config.load()
  backend.setBaseUrl(appConfig.useOfficialBackend ? 'https://backend.beammp.com' : appConfig.backendUrl)
  initVehicleAssetService(config)
  await serverManager.init()

  // One-time migration: if a previously saved userDir points at the BeamNG root
  // (e.g. E:\BeamData) instead of the active version subfolder (E:\BeamData\current),
  // normalize it so all features (mods, careers, settings, etc.) resolve correctly.
  const gp = appConfig.gamePaths
  if (gp?.userDir) {
    const { GameDiscoveryService } = await import('./services/GameDiscoveryService')
    const normalized = new GameDiscoveryService().normalizeUserDir(gp.userDir)
    if (normalized && normalized !== gp.userDir) {
      console.log(`[config] Normalizing userDir: ${gp.userDir} -> ${normalized}`)
      await config.setGamePaths(gp.installDir, normalized, gp.executable, gp.gameVersion, gp.isProton)
    }
  }

  // Repair db.json entries missing modname (prevents BeamMP MPModManager Lua crash)
  const userDir = config.get().gamePaths?.userDir
  if (userDir) {
    modManagerService.repairModNames(userDir).catch((err) =>
      console.error('[ModManager] repairModNames failed:', err)
    )
    modManagerService.repairDuplicateEntries(userDir).catch((err) =>
      console.error('[ModManager] repairDuplicateEntries failed:', err)
    )
  }

  // Register all IPC handlers
  registerIpcHandlers()

  // Invite link bridge: renderer pulls any pending invite that was captured
  // before the window finished loading (cold-start case). Returns null and
  // clears in one call so we never re-deliver the same invite.
  ipcMain.handle('invite:getPending', () => {
    const inv = pendingInvite
    pendingInvite = null
    return inv
  })

  // Create a short invite URL via bmr.musanet.xyz from the main process so
  // renderer CORS restrictions cannot force a fallback to beammp-cm://.
  ipcMain.handle('invite:createShort', async (_evt, payload: { ip?: string; port?: number }) => {
    const ip = String(payload?.ip ?? '').trim()
    const port = Number(payload?.port)
    if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null
    }
    if (!/^[a-zA-Z0-9.\-:[\]_]+$/.test(ip)) {
      return null
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)

      // BMR protects non-GET endpoints with CSRF. As a non-browser client we
      // must perform the same handshake explicitly and forward the token.
      const csrfRes = await fetch(`${BMR_ORIGIN}/api/auth/csrf`, {
        method: 'GET',
        signal: controller.signal,
      })

      const setCookie = csrfRes.headers.get('set-cookie') || ''
      const csrfMatch = setCookie.match(/(?:^|,\s*)rw_csrf=([^;]+)/)
      const csrfToken = csrfMatch?.[1] ?? ''

      const res = await fetch(BMR_INVITE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken, Cookie: `rw_csrf=${csrfToken}` } : {}),
        },
        body: JSON.stringify({ ip, port }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!res.ok) {
        console.warn(`[invite] short-link upstream non-OK: ${res.status}`)
        return null
      }

      const data = await res.json() as { url?: string }
      const url = typeof data?.url === 'string' ? data.url : null
      if (!url) return null
      return url
    } catch (err) {
      console.warn('[invite] short-link request failed:', err)
      return null
    }
  })

  // Discord Rich Presence
  initDiscordRPC()

  // Kill all hosted servers on quit
  app.on('will-quit', () => {
    serverManager.shutdownAll()
    destroyDiscordRPC()
  })

  // Set isQuitting so close-to-tray doesn't block actual quit
  app.on('before-quit', () => {
    isQuitting = true
    destroyDiscordRPC()
  })

  createWindow()

  // Auto-updater
  if (!is.dev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater:update-available', {
        version: info.version,
        releaseDate: info.releaseDate
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('updater:download-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('updater:update-downloaded', {
        version: info.version
      })
    })

    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err.message)
    })

    autoUpdater.checkForUpdates().catch(() => {})
  }

  ipcMain.handle('updater:install', () => {
    isQuitting = true
    autoUpdater.quitAndInstall()
  })

  // Allow the renderer to re-trigger an update check (e.g. when the user
  // returns to the home tab). The auto-updater is debounced internally so
  // back-to-back calls won't hammer GitHub.
  ipcMain.handle('updater:check', async () => {
    if (is.dev) return { ok: false, reason: 'dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        ok: true,
        version: result?.updateInfo?.version ?? null
      }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  })

  // System tray — wrapped in try-catch because Linux desktops (especially
  // Steam Deck gaming mode) may lack a system tray / StatusNotifier service,
  // which would otherwise crash the app on startup.
  try {
    const trayIcon = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
    tray = new Tray(trayIcon)
    tray.setToolTip('BeamNG Content Manager')
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show',
        click: (): void => {
          mainWindow?.show()
          mainWindow?.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: (): void => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
  } catch (err) {
    console.warn('[Tray] Failed to create system tray (no tray service available):', err)
    tray = null
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // When a tray is available the app lives in the system tray.
  // Without a tray (e.g. Steam Deck gaming mode), quit on window close.
  if (process.platform !== 'darwin' && !tray) {
    app.quit()
  }
})
