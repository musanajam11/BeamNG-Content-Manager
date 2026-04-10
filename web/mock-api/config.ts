// Mock implementations for config & appearance API methods

import { DEMO_CONFIG } from './demo-data'
import type { AppConfig } from '../../src/shared/types'

let currentConfig = { ...DEMO_CONFIG }

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
  loadBackgroundImage: async (): Promise<string | null> => null,
  getDefaultBackgrounds: async (): Promise<string[]> => [],
  deleteDefaultBackground: async (): Promise<boolean> => false,
  loadBackgroundThumb: async (): Promise<string | null> => null,

  // Versions
  getVersions: async () => ({
    appVersion: '0.3.0-demo',
    gameVersion: '0.32.5.0',
    launcherVersion: '3.5.1',
    serverVersion: '3.5.1'
  })
}
