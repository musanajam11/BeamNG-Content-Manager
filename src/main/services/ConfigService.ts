import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type {
  AppConfig,
} from '../../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  gamePaths: {
    installDir: null,
    userDir: null,
    executable: null,
    gameVersion: null,
    isProton: false
  },
  backendUrl: 'https://backend.beammp.com',
  authUrl: 'https://auth.beammp.com',
  useOfficialBackend: true,
  launcherPort: 4444,
  theme: 'dark',
  language: 'en',
  appearance: {
    colorMode: 'dark',
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
    bgImageBlur: 5,
    bgImageOpacity: 0.45,
    bgImageList: [],
    bgCycleOnLaunch: true,
    sidebarOrder: ['home', 'servers', 'friends', 'vehicles', 'maps', 'mods', 'career', 'server-admin', 'launcher', 'controls', 'live-gps', 'livery-editor', 'voice-chat', 'lua-console', 'world-edit-sync'],
    sidebarHidden: [],
    customCSS: '',
    customCSSEnabled: false,
    cornerRadius: 0,
    buttonSize: 'comfortable',
    fontFamily: 'system',
    scrollbarStyle: 'rounded',
    animationSpeed: 'slow',
    overlayEffect: 'noise',
    borderStyle: 'normal',
    effectPageFade: true,
    effectFrostedGlass: true,
    effectAccentSelection: true,
    effectHoverGlow: false,
    effectHoverLift: true,
    filterBrightness: 1.0,
    filterContrast: 1.0,
    filterSaturation: 1.1,
    serverListChunkSize: 250,
    showHints: true
  },
  setupComplete: false,
  loadOrderEnforcement: false,
  defaultPorts: '',
  careerSavePath: null,
  customServerExe: null,
  renderer: 'ask',
  voiceChat: {
    enabled: false,
    inputDeviceId: null,
    inputGain: 1.0,
    outputVolume: 0.8,
    outputDeviceId: null,
    mode: 'vad',
    pttKey: 'KeyV',
    vadThreshold: 0.02,
    proximityRange: 50,
    turnServerUrl: null,
    turnUsername: null,
    turnCredential: null
  },
  worldEditSync: {
    enabled: true,
    tier4: {
      reflectiveFields: true,
      fullSnapshot: true,
      modInventory: true,
      terrainForest: true
    },
    modSync: {
      confirmThresholdBytes: 500 * 1024 * 1024
    }
  }
}

export class ConfigService {
  private config: AppConfig = { ...DEFAULT_CONFIG }
  private configPath: string
  private favoritesPath: string
  private recentServersPath: string
  private friendsPath: string
  private sessionsPath: string
  private favorites: Set<string> = new Set()
  private recentServers: Array<{ ident: string; timestamp: number }> = []
  private friends: Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }> = []
  private sessions: Array<{ serverIdent: string; serverName: string; players: string[]; timestamp: number }> = []

  constructor() {
    const appDataDir = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.configPath = join(appDataDir, 'config.json')
    this.favoritesPath = join(appDataDir, 'favorites.json')
    this.recentServersPath = join(appDataDir, 'recent-servers.json')
    this.friendsPath = join(appDataDir, 'friends.json')
    this.sessionsPath = join(appDataDir, 'sessions.json')
  }

  async load(): Promise<AppConfig> {
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.config = { ...DEFAULT_CONFIG, ...parsed }
        // Phase 5 migration: shallow merge above replaces nested objects
        // wholesale, so configs written before `worldEditSync.enabled`
        // existed lose the field entirely. Force the default back in if
        // a stored worldEditSync object is missing the new key.
        if (parsed && typeof parsed === 'object' && parsed.worldEditSync && typeof parsed.worldEditSync === 'object') {
          this.config.worldEditSync = {
            ...DEFAULT_CONFIG.worldEditSync,
            ...parsed.worldEditSync,
            tier4: { ...DEFAULT_CONFIG.worldEditSync.tier4, ...(parsed.worldEditSync.tier4 ?? {}) },
            modSync: { ...DEFAULT_CONFIG.worldEditSync.modSync, ...(parsed.worldEditSync.modSync ?? {}) },
          }
        }
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
    // Load friends
    try {
      if (existsSync(this.friendsPath)) {
        const raw = await readFile(this.friendsPath, 'utf-8')
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) this.friends = arr
      }
    } catch { /* ignore */ }
    // Load sessions
    try {
      if (existsSync(this.sessionsPath)) {
        const raw = await readFile(this.sessionsPath, 'utf-8')
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) this.sessions = arr
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

  // ── Friends ──

  getFriends(): Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }> {
    return this.friends
  }

  async addFriend(id: string, displayName: string): Promise<typeof this.friends> {
    if (this.friends.some((f) => f.id === id)) return this.friends
    this.friends.push({ id, displayName, addedAt: Date.now() })
    await this.saveFriends()
    return this.friends
  }

  async removeFriend(id: string): Promise<typeof this.friends> {
    this.friends = this.friends.filter((f) => f.id !== id)
    await this.saveFriends()
    return this.friends
  }

  async updateFriend(id: string, updates: { displayName?: string; notes?: string; tags?: string[] }): Promise<typeof this.friends> {
    const friend = this.friends.find((f) => f.id === id)
    if (friend) {
      if (updates.displayName !== undefined) friend.displayName = updates.displayName
      if (updates.notes !== undefined) friend.notes = updates.notes
      if (updates.tags !== undefined) friend.tags = updates.tags
      await this.saveFriends()
    }
    return this.friends
  }

  private async saveFriends(): Promise<void> {
    const dir = join(this.friendsPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.friendsPath, JSON.stringify(this.friends, null, 2), 'utf-8')
  }

  // ── Sessions ──

  getSessions(): Array<{ serverIdent: string; serverName: string; players: string[]; timestamp: number }> {
    return this.sessions
  }

  async recordSession(serverIdent: string, serverName: string, players: string[]): Promise<void> {
    this.sessions.unshift({ serverIdent, serverName, players, timestamp: Date.now() })
    // Keep last 100 sessions
    this.sessions = this.sessions.slice(0, 100)
    await this.saveSessions()
  }

  private async saveSessions(): Promise<void> {
    const dir = join(this.sessionsPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.sessionsPath, JSON.stringify(this.sessions), 'utf-8')
  }
}
