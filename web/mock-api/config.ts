// Mock implementations for config & appearance API methods

import { DEMO_CONFIG } from './demo-data'
import type { AppConfig } from '../../src/shared/types'

let currentConfig = { ...DEMO_CONFIG }

// Bundled background images served from /backgrounds/* via vite's publicDir
// (configured in web/vite.config.ts to point at ../resources). The renderer
// stores these paths in localStorage and feeds them back into <img src> and
// CSS url(...), so we just return the same string for thumb/full loaders.
const DEMO_BG_FILES = [
  'baja-bug.jpg',
  'camper-van.png',
  'city-cruise.png',
  'coastal-drive.jpg',
  'demolition-derby.png',
  'flying-car.jpg',
  'police-chase.jpg',
  'rally-drift.png',
  'rally-jump.jpg',
  'red-convertible.png',
  'rock-crawling.jpg',
  'tunnel-drive.png'
]
const DEMO_BG_PATHS = DEMO_BG_FILES.map((f) => `backgrounds/${f}`)

export const configMocks = {
  // Config
  getConfig: async (): Promise<AppConfig> => ({ ...currentConfig }),
  updateConfig: async (partial: Partial<AppConfig>): Promise<void> => {
    currentConfig = { ...currentConfig, ...partial }
  },
  markSetupComplete: async (): Promise<void> => {
    currentConfig.setupComplete = true
  },
  browseServerExe: async (): Promise<string | null> => null,

  // Appearance
  setZoomFactor: async (): Promise<void> => {},
  getZoomFactor: async (): Promise<number> => currentConfig.appearance.uiScale,
  pickBackgroundImage: async (): Promise<string | null> => null,
  loadBackgroundImage: async (filePath: string): Promise<string | null> => filePath,
  getDefaultBackgrounds: async (): Promise<string[]> => DEMO_BG_PATHS,
  deleteDefaultBackground: async (): Promise<boolean> => false,
  loadBackgroundThumb: async (filePath: string): Promise<string | null> => filePath,

  // Auto-updater (no-ops in web demo)
  onUpdateAvailable: (_cb: (info: { version: string }) => void): (() => void) => () => {},
  onUpdateDownloadProgress: (_cb: (progress: { percent: number }) => void): (() => void) => () => {},
  onUpdateDownloaded: (_cb: (info: { version: string }) => void): (() => void) => () => {},
  checkForUpdates: async (): Promise<void> => {},
  installUpdate: async (): Promise<void> => {},
  quitAndInstall: async (): Promise<void> => {},

  // Versions
  getVersions: async () => ({
    appVersion: '0.3.0-demo',
    gameVersion: '0.32.5.0',
    launcherVersion: '3.5.1',
    serverVersion: '3.5.1'
  })
}
