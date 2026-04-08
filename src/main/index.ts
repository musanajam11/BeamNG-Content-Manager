import { app, shell, BrowserWindow, protocol, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { initializeServices, registerIpcHandlers } from './ipc/handlers'
import { extractVehicleAsset, resolveGameAsset, initVehicleAssetService } from './services/VehicleAssetService'

// Must be called before app.whenReady() so fetch() works with the custom protocol
protocol.registerSchemesAsPrivileged([
  { scheme: 'vehicle-asset', privileges: { bypassCSP: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Single instance lock — if a second copy launches, focus the existing window
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
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
    backgroundColor: '#111113',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Close-to-tray: hide window instead of quitting (like Discord)
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
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

  // Initialize services and load config
  const { config, backend, serverManager } = initializeServices()
  const appConfig = await config.load()
  backend.setBaseUrl(appConfig.useOfficialBackend ? 'https://backend.beammp.com' : appConfig.backendUrl)
  initVehicleAssetService(config)
  await serverManager.init()

  // Register all IPC handlers
  registerIpcHandlers()

  // Kill all hosted servers on quit
  app.on('will-quit', () => {
    serverManager.shutdownAll()
  })

  // Set isQuitting so close-to-tray doesn't block actual quit
  app.on('before-quit', () => {
    isQuitting = true
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

  // System tray
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Don't quit — app lives in the system tray.
  // On macOS this is standard behavior already.
  if (process.platform !== 'darwin') {
    // no-op: tray keeps the app alive
  }
})
