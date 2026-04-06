import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { PlayerSession, DailyStats, PlayerSummary, AnalyticsData } from '../../shared/types'

interface AnalyticsStore {
  sessions: PlayerSession[]
  activeSessions: Map<string, PlayerSession>
}

export class AnalyticsService {
  private serversDir: string
  private stores = new Map<string, AnalyticsStore>()

  constructor() {
    this.serversDir = join(app.getPath('appData'), 'BeamMP-ContentManager', 'servers')
  }

  private filePath(serverId: string): string {
    return join(this.serversDir, serverId, 'analytics.json')
  }

  private async loadStore(serverId: string): Promise<AnalyticsStore> {
    const existing = this.stores.get(serverId)
    if (existing) return existing

    let sessions: PlayerSession[] = []
    try {
      const raw = await readFile(this.filePath(serverId), 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.sessions)) sessions = data.sessions
    } catch { /* no file yet */ }

    const store: AnalyticsStore = { sessions, activeSessions: new Map() }
    this.stores.set(serverId, store)
    return store
  }

  private async persist(serverId: string, store: AnalyticsStore): Promise<void> {
    const dir = join(this.serversDir, serverId)
    await mkdir(dir, { recursive: true })
    const data = { sessions: store.sessions }
    await writeFile(this.filePath(serverId), JSON.stringify(data, null, 2))
  }

  /** Called when updated player names arrive from the poll. Detects joins/leaves. */
  async updatePlayers(serverId: string, currentNames: string[]): Promise<void> {
    const store = await this.loadStore(serverId)
    const now = Date.now()
    const currentSet = new Set(currentNames)

    // Detect leaves
    for (const [name, session] of store.activeSessions) {
      if (!currentSet.has(name)) {
        session.leftAt = now
        session.durationMs = now - session.joinedAt
        store.sessions.push({ ...session })
        store.activeSessions.delete(name)
      }
    }

    // Detect joins
    for (const name of currentNames) {
      if (!store.activeSessions.has(name)) {
        store.activeSessions.set(name, {
          playerName: name,
          joinedAt: now,
          leftAt: null,
          durationMs: 0
        })
      }
    }

    await this.persist(serverId, store)
  }

  /** End all active sessions (e.g. when server stops). */
  async endAllSessions(serverId: string): Promise<void> {
    const store = await this.loadStore(serverId)
    const now = Date.now()
    for (const [, session] of store.activeSessions) {
      session.leftAt = now
      session.durationMs = now - session.joinedAt
      store.sessions.push({ ...session })
    }
    store.activeSessions.clear()
    await this.persist(serverId, store)
  }

  async getAnalytics(serverId: string): Promise<AnalyticsData> {
    const store = await this.loadStore(serverId)

    const dailyMap = new Map<string, {
      names: Set<string>
      peak: number
      totalMs: number
    }>()

    // Build daily stats from completed sessions
    for (const s of store.sessions) {
      const date = new Date(s.joinedAt).toISOString().slice(0, 10)
      let day = dailyMap.get(date)
      if (!day) {
        day = { names: new Set(), peak: 0, totalMs: 0 }
        dailyMap.set(date, day)
      }
      day.names.add(s.playerName)
      day.totalMs += s.durationMs
    }

    // Compute peak by finding max concurrent players per day
    // Simple approach: count sessions overlapping at each join/leave point
    const sessionsByDate = new Map<string, PlayerSession[]>()
    for (const s of store.sessions) {
      const date = new Date(s.joinedAt).toISOString().slice(0, 10)
      if (!sessionsByDate.has(date)) sessionsByDate.set(date, [])
      sessionsByDate.get(date)!.push(s)
    }
    for (const [date, daySessions] of sessionsByDate) {
      const events: { time: number; delta: number }[] = []
      for (const s of daySessions) {
        events.push({ time: s.joinedAt, delta: 1 })
        if (s.leftAt) events.push({ time: s.leftAt, delta: -1 })
      }
      events.sort((a, b) => a.time - b.time)
      let cur = 0
      let peak = 0
      for (const e of events) {
        cur += e.delta
        if (cur > peak) peak = cur
      }
      const day = dailyMap.get(date)
      if (day) day.peak = peak
    }

    // Also count active sessions toward today
    if (store.activeSessions.size > 0) {
      const today = new Date().toISOString().slice(0, 10)
      let day = dailyMap.get(today)
      if (!day) {
        day = { names: new Set(), peak: 0, totalMs: 0 }
        dailyMap.set(today, day)
      }
      for (const [name] of store.activeSessions) {
        day.names.add(name)
      }
      day.peak = Math.max(day.peak, store.activeSessions.size)
    }

    const dailyStats: DailyStats[] = Array.from(dailyMap.entries())
      .map(([date, d]) => ({
        date,
        uniquePlayers: d.names.size,
        peakPlayers: d.peak,
        totalSessionsMs: d.totalMs,
        playerNames: Array.from(d.names)
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    // Player summaries
    const playerMap = new Map<string, PlayerSummary>()
    for (const s of store.sessions) {
      let p = playerMap.get(s.playerName)
      if (!p) {
        p = {
          playerName: s.playerName,
          totalSessions: 0,
          totalTimeMs: 0,
          lastSeen: 0,
          firstSeen: s.joinedAt
        }
        playerMap.set(s.playerName, p)
      }
      p.totalSessions++
      p.totalTimeMs += s.durationMs
      if (s.joinedAt < p.firstSeen) p.firstSeen = s.joinedAt
      const seen = s.leftAt ?? s.joinedAt
      if (seen > p.lastSeen) p.lastSeen = seen
    }
    const playerSummaries = Array.from(playerMap.values())
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs)

    // Active sessions
    const activeSessions: PlayerSession[] = Array.from(store.activeSessions.values())

    return { dailyStats, playerSummaries, activeSessions }
  }

  async clearAnalytics(serverId: string): Promise<void> {
    const store = await this.loadStore(serverId)
    store.sessions = []
    // Keep active sessions running
    await this.persist(serverId, store)
  }
}
