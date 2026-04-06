import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppConfig } from '../../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  gamePaths: {
    installDir: null,
    userDir: null,
    executable: null,
    gameVersion: null,
    isProton: false
  },
  backendUrl: 'https://backend.beammp.com',
  launcherPort: 4444,
  theme: 'dark',
  appearance: {
    accentColor: '#f97316',
    uiScale: 1.1,
    fontSize: 16,
    backgroundStyle: 'default',
    surfaceOpacity: 1.0,
    borderOpacity: 1.0,
    enableBlur: true,
    bgGradient1: null,
    bgGradient2: null,
    sidebarWidth: 200,
    bgImagePath: null,
    bgImageBlur: 0,
    bgImageOpacity: 0.3,
    bgImageList: [],
    bgCycleOnLaunch: false
  },
  setupComplete: false
}

export class ConfigService {
  private config: AppConfig = { ...DEFAULT_CONFIG }
  private configPath: string
  private favoritesPath: string
  private recentServersPath: string
  private favorites: Set<string> = new Set()
  private recentServers: Array<{ ident: string; timestamp: number }> = []

  constructor() {
    const appDataDir = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.configPath = join(appDataDir, 'config.json')
    this.favoritesPath = join(appDataDir, 'favorites.json')
    this.recentServersPath = join(appDataDir, 'recent-servers.json')
  }

  async load(): Promise<AppConfig> {
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.config = { ...DEFAULT_CONFIG, ...parsed }
      }
    } catch (err) {
      console.error('Failed to load config, using defaults:', err)
      this.config = { ...DEFAULT_CONFIG }
    }
    // Load favorites
    try {
      if (existsSync(this.favoritesPath)) {
        const raw = await readFile(this.favoritesPath, 'utf-8')
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) this.favorites = new Set(arr)
      }
    } catch { /* ignore */ }
    // Load recent servers
    try {
      if (existsSync(this.recentServersPath)) {
        const raw = await readFile(this.recentServersPath, 'utf-8')
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) this.recentServers = arr
      }
    } catch { /* ignore */ }
    return this.config
  }

  async save(): Promise<void> {
    const dir = join(this.configPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
  }

  get(): AppConfig {
    return this.config
  }

  async update(partial: Partial<AppConfig>): Promise<AppConfig> {
    this.config = { ...this.config, ...partial }
    await this.save()
    return this.config
  }

  async setGamePaths(
    installDir: string | null,
    userDir: string | null,
    executable: string | null,
    gameVersion: string | null,
    isProton: boolean = false
  ): Promise<void> {
    this.config.gamePaths = { installDir, userDir, executable, gameVersion, isProton }
    await this.save()
  }

  async setBackendUrl(url: string): Promise<void> {
    this.config.backendUrl = url
    await this.save()
  }

  async markSetupComplete(): Promise<void> {
    this.config.setupComplete = true
    await this.save()
  }

  getFavorites(): string[] {
    return [...this.favorites]
  }

  async setFavorite(ident: string, favorite: boolean): Promise<string[]> {
    if (favorite) {
      this.favorites.add(ident)
    } else {
      this.favorites.delete(ident)
    }
    await this.saveFavorites()
    return this.getFavorites()
  }

  private async saveFavorites(): Promise<void> {
    const dir = join(this.favoritesPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.favoritesPath, JSON.stringify([...this.favorites]), 'utf-8')
  }

  getRecentServers(): Array<{ ident: string; timestamp: number }> {
    return this.recentServers
  }

  async addRecentServer(ident: string): Promise<void> {
    // Remove existing entry for this server
    this.recentServers = this.recentServers.filter((r) => r.ident !== ident)
    // Add to front
    this.recentServers.unshift({ ident, timestamp: Date.now() })
    // Keep only 4
    this.recentServers = this.recentServers.slice(0, 4)
    await this.saveRecentServers()
  }

  private async saveRecentServers(): Promise<void> {
    const dir = join(this.recentServersPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.recentServersPath, JSON.stringify(this.recentServers), 'utf-8')
  }
}
