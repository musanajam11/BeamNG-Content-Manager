import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { PlayerSession, DailyStats, PlayerSummary, AnalyticsData } from '../../shared/types'

interface AnalyticsStore {
  sessions: PlayerSession[]
  ingestedSessionIds: Set<string>
  activeSessions: Map<string, PlayerSession>
  missedPolls: Map<string, number>
}

interface TrackerAnalyticsSnapshot {
  version?: number
  activeSessions?: unknown[]
  completedSessions?: unknown[]
}

const LEGACY_IP_KEYS = ['ipAddress', 'ip', 'remoteAddress'] as const
const MISSED_POLLS_BEFORE_LEAVE = 2

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function toEpochMs(value: unknown): number | null {
  const n = asNullableNumber(value)
  if (n === null) return null
  // Old tracker snapshots used epoch seconds. Convert to ms when value
  // is clearly not already in milliseconds.
  return n > 0 && n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n)
}

function cleanPlayerName(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return 'Unknown Player'
  // BeamMP names may contain trailing semicolons and in-band color codes.
  return raw
    .replace(/\^[0-9a-fA-F]/g, '')
    .replace(/;+$/g, '')
    .trim() || 'Unknown Player'
}

function playerKey(name: string | null | undefined): string {
  return cleanPlayerName(name).toLowerCase()
}

function normalizeSession(raw: unknown, fallbackId?: string): PlayerSession | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  let joinedAt = toEpochMs(entry.joinedAt)
  const rawJoinedAt = asNullableNumber(entry.joinedAt)
  // Compatibility for old tracker builds where os.time()*1000 overflowed in Lua
  // and wrote negative timestamps. Treat active overflowed sessions as "now"
  // so totals keep updating until servers restart onto the fixed tracker.
  if ((joinedAt === null || joinedAt <= 0) && rawJoinedAt !== null && rawJoinedAt < 0) {
    joinedAt = Date.now()
  }
  if (joinedAt === null) return null
  if (joinedAt <= 0) return null
  const leftAt = toEpochMs(entry.leftAt)
  const playerName = cleanPlayerName(asNullableString(entry.playerName))
  const sessionId = asNullableString(entry.sessionId)
    ?? fallbackId
    ?? `legacy:${playerName}:${joinedAt}:${leftAt ?? 'active'}`
  let ipAddress: string | null = null
  for (const key of LEGACY_IP_KEYS) {
    ipAddress = asNullableString(entry[key])
    if (ipAddress) break
  }
  const rawDurationMs = asNullableNumber(entry.durationMs)
  const durationMs = rawDurationMs !== null ? Math.trunc(Math.max(0, rawDurationMs)) : null
  // For completed sessions with known start+end, compute duration from timestamps.
  // This self-heals any previously inflated durationMs values.
  const computedDuration = leftAt !== null && leftAt > 0 ? Math.max(0, leftAt - joinedAt) : null
  const effectiveDuration = computedDuration !== null
    ? computedDuration  // timestamps are ground truth for completed sessions
    : durationMs ?? 0
  return {
    sessionId,
    playerId: asNullableNumber(entry.playerId),
    playerName,
    joinedAt,
    leftAt: leftAt !== null && leftAt > 0 ? leftAt : null,
    durationMs: effectiveDuration,
    ipAddress,
    beammpId: asNullableString(entry.beammpId),
    discordId: asNullableString(entry.discordId),
    role: asNullableString(entry.role),
    isGuest: asNullableBoolean(entry.isGuest),
    authAt: toEpochMs(entry.authAt),
    lastSeenAt: toEpochMs(entry.lastSeenAt),
    endReason: asNullableString(entry.endReason)
  }
}

function sessionKey(session: PlayerSession): string {
  return session.sessionId || `legacy:${session.playerName}:${session.joinedAt}:${session.leftAt ?? 'active'}`
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

  private trackerFilePath(serverId: string): string {
    return join(this.serversDir, serverId, 'player_analytics.json')
  }

  private async loadStore(serverId: string): Promise<AnalyticsStore> {
    const existing = this.stores.get(serverId)
    if (existing) return existing

    let sessions: PlayerSession[] = []
    const ingestedSessionIds = new Set<string>()
    try {
      const raw = await readFile(this.filePath(serverId), 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.sessions)) {
        sessions = data.sessions
          .map((session: unknown, index: number) => normalizeSession(session, `legacy:${serverId}:${index}`))
          .filter((session): session is PlayerSession => session !== null)
      }
      if (Array.isArray(data.ingestedSessionIds)) {
        for (const id of data.ingestedSessionIds) {
          const normalizedId = asNullableString(id)
          if (normalizedId) ingestedSessionIds.add(normalizedId)
        }
      }
    } catch { /* no file yet */ }

    for (const session of sessions) {
      ingestedSessionIds.add(sessionKey(session))
    }

    const store: AnalyticsStore = {
      sessions,
      ingestedSessionIds,
      activeSessions: new Map(),
      missedPolls: new Map()
    }
    this.stores.set(serverId, store)
    return store
  }

  private async persist(serverId: string, store: AnalyticsStore): Promise<void> {
    const dir = join(this.serversDir, serverId)
    await mkdir(dir, { recursive: true })
    const data = {
      sessions: store.sessions,
      ingestedSessionIds: Array.from(store.ingestedSessionIds)
    }
    await writeFile(this.filePath(serverId), JSON.stringify(data, null, 2))
  }

  private async readTrackerSnapshot(serverId: string): Promise<TrackerAnalyticsSnapshot | null> {
    try {
      const raw = await readFile(this.trackerFilePath(serverId), 'utf-8')
      return JSON.parse(raw) as TrackerAnalyticsSnapshot
    } catch {
      return null
    }
  }

  private async writeTrackerSnapshot(serverId: string, snapshot: { version: number; activeSessions: PlayerSession[]; completedSessions: PlayerSession[] }): Promise<void> {
    await mkdir(join(this.serversDir, serverId), { recursive: true })
    await writeFile(this.trackerFilePath(serverId), JSON.stringify(snapshot, null, 2))
  }

  private async syncFromTracker(serverId: string, store: AnalyticsStore): Promise<boolean> {
    const snapshot = await this.readTrackerSnapshot(serverId)
    if (!snapshot) return false

    let changed = false
    // Do not overwrite activeSessions from tracker snapshot.
    // The snapshot file can be stale when the server/app exits unexpectedly,
    // which would resurrect ghost "active now" users. Live active state is
    // maintained by updatePlayers() polling and explicit endAllSessions().

    if (Array.isArray(snapshot.completedSessions)) {
      for (let index = 0; index < snapshot.completedSessions.length; index++) {
        const session = normalizeSession(snapshot.completedSessions[index], `completed:${serverId}:${index}`)
        if (!session) continue
        const key = sessionKey(session)
        if (store.ingestedSessionIds.has(key)) {
          // Session already ingested by its tracker ID — but enrich any matching
          // legacy poller session with IP/BeamMP ID if it's still missing them.
          if (session.ipAddress || session.beammpId) {
            const legacyIdx = store.sessions.findIndex(
              (s) => playerKey(s.playerName) === playerKey(session.playerName) && !s.ipAddress && !s.beammpId &&
                Math.abs(s.joinedAt - session.joinedAt) < 60000
            )
            if (legacyIdx !== -1) {
              store.sessions[legacyIdx] = {
                ...store.sessions[legacyIdx],
                ipAddress: session.ipAddress,
                beammpId: session.beammpId,
                discordId: session.discordId,
                role: session.role,
                isGuest: session.isGuest,
              }
              changed = true
            }
          }
          continue
        }
        // Check if a legacy poller session for the same player/time already exists.
        // If so, upgrade it in-place instead of adding a duplicate.
        const legacyIdx = store.sessions.findIndex(
          (s) => playerKey(s.playerName) === playerKey(session.playerName) &&
            s.sessionId.startsWith('legacy:') &&
            Math.abs(s.joinedAt - session.joinedAt) < 60000
        )
        if (legacyIdx !== -1) {
          // Remove the legacy key from ingested set so we can re-key under the tracker ID
          store.ingestedSessionIds.delete(sessionKey(store.sessions[legacyIdx]))
          store.sessions[legacyIdx] = { ...store.sessions[legacyIdx], ...session }
        } else {
          store.sessions.push(session)
        }
        // Also remove any matching entry from activeSessions (player may still
        // be in the poller's active map if they disconnected recently and the
        // poller hasn't missed enough polls yet). Without this, endAllSessions
        // would finalize the active entry again, creating a duplicate.
        for (const [activeKey, active] of store.activeSessions) {
          if (
            playerKey(active.playerName) === playerKey(session.playerName) &&
            Math.abs(active.joinedAt - session.joinedAt) < 60000
          ) {
            store.activeSessions.delete(activeKey)
            store.missedPolls.delete(activeKey)
            break
          }
        }
        store.ingestedSessionIds.add(key)
        changed = true
      }
    }

    return changed
  }

  /** Called when updated player names arrive from the poll. Detects joins/leaves. */
  async updatePlayers(serverId: string, currentNames: string[]): Promise<void> {
    const store = await this.loadStore(serverId)
    const now = Date.now()
    const currentCanonical = new Map<string, string>()
    for (const rawName of currentNames) {
      const display = cleanPlayerName(rawName)
      currentCanonical.set(playerKey(display), display)
    }
    const currentSet = new Set(currentCanonical.keys())

    // Detect joins
    for (const [canonical, displayName] of currentCanonical) {
      if (!store.activeSessions.has(canonical)) {
        store.activeSessions.set(canonical, {
          sessionId: `legacy:${serverId}:${canonical}:${now}`,
          playerId: null,
          playerName: displayName,
          joinedAt: now,
          leftAt: null,
          durationMs: 0,
          ipAddress: null,
          beammpId: null,
          discordId: null,
          role: null,
          isGuest: null,
          authAt: null,
          lastSeenAt: now,
          endReason: null
        })
        store.missedPolls.set(canonical, 0)
      } else {
        const existing = store.activeSessions.get(canonical)
        if (existing) {
          existing.playerName = displayName
          existing.lastSeenAt = now
        }
        store.missedPolls.set(canonical, 0)
      }
    }

    // Detect leaves with debounce so one transient empty poll does not create
    // fake 9-10s sessions.
    for (const [canonical, session] of store.activeSessions) {
      if (currentSet.has(canonical)) continue
      const misses = (store.missedPolls.get(canonical) ?? 0) + 1
      store.missedPolls.set(canonical, misses)
      if (misses < MISSED_POLLS_BEFORE_LEAVE) continue
      session.leftAt = now
      session.durationMs = now - session.joinedAt
      store.sessions.push({ ...session })
      store.activeSessions.delete(canonical)
      store.missedPolls.delete(canonical)
    }

    await this.persist(serverId, store)
  }

  /** End all active sessions (e.g. when server stops). */
  async endAllSessions(serverId: string): Promise<void> {
    const store = await this.loadStore(serverId)
    const trackerChanged = await this.syncFromTracker(serverId, store)
    const now = Date.now()
    let changed = trackerChanged
    for (const [key, session] of store.activeSessions) {
      const finished: PlayerSession = {
        ...session,
        leftAt: now,
        durationMs: Math.max(session.durationMs, now - session.joinedAt),
        lastSeenAt: now,
        endReason: session.endReason ?? 'server-stopped'
      }
      const finishedKey = sessionKey(finished)
      if (!store.ingestedSessionIds.has(finishedKey)) {
        store.sessions.push(finished)
        store.ingestedSessionIds.add(finishedKey)
        changed = true
      }
      store.activeSessions.delete(key)
    }
    if (changed) await this.persist(serverId, store)
    try {
      await unlink(this.trackerFilePath(serverId))
    } catch { /* tracker file may not exist */ }
  }

  async getAnalytics(serverId: string): Promise<AnalyticsData> {
    const store = await this.loadStore(serverId)
    const trackerChanged = await this.syncFromTracker(serverId, store)
    if (trackerChanged) await this.persist(serverId, store)

    const now = Date.now()
    const activeSessions: PlayerSession[] = Array.from(store.activeSessions.values())
      .map((session) => ({
        ...session,
        durationMs: Math.max(session.durationMs, now - session.joinedAt),
        lastSeenAt: session.lastSeenAt ?? now
      }))
      .sort((a, b) => b.joinedAt - a.joinedAt)

    const allSessions = [...store.sessions, ...activeSessions]

    const dailyMap = new Map<string, {
      names: Set<string>
      peak: number
      totalMs: number
    }>()

    // Build daily stats from completed sessions
    for (const s of allSessions) {
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
    for (const s of allSessions) {
      const date = new Date(s.joinedAt).toISOString().slice(0, 10)
      if (!sessionsByDate.has(date)) sessionsByDate.set(date, [])
      sessionsByDate.get(date)!.push(s)
    }
    for (const [date, daySessions] of sessionsByDate) {
      const events: { time: number; delta: number }[] = []
      for (const s of daySessions) {
        events.push({ time: s.joinedAt, delta: 1 })
        events.push({ time: s.leftAt ?? now, delta: -1 })
      }
      events.sort((a, b) => a.time - b.time || b.delta - a.delta)
      let cur = 0
      let peak = 0
      for (const e of events) {
        cur += e.delta
        if (cur > peak) peak = cur
      }
      const day = dailyMap.get(date)
      if (day) day.peak = peak
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
    for (const s of allSessions) {
      let p = playerMap.get(s.playerName)
      if (!p) {
        p = {
          playerName: s.playerName,
          totalSessions: 0,
          totalTimeMs: 0,
          lastSeen: 0,
          firstSeen: s.joinedAt,
          lastIpAddress: null,
          uniqueIpCount: 0,
          knownIps: [],
          beammpId: null,
          discordId: null,
          roles: [],
          isGuest: false
        }
        playerMap.set(s.playerName, p)
      }
      p.totalSessions++
      p.totalTimeMs += s.durationMs
      if (s.joinedAt < p.firstSeen) p.firstSeen = s.joinedAt
      const seen = s.leftAt ?? s.lastSeenAt ?? s.joinedAt
      if (seen > p.lastSeen) p.lastSeen = seen
      if (s.ipAddress) {
        if (!p.knownIps.includes(s.ipAddress)) {
          p.knownIps.push(s.ipAddress)
          p.uniqueIpCount = p.knownIps.length
        }
        p.lastIpAddress = s.ipAddress
      }
      if (s.beammpId && !p.beammpId) p.beammpId = s.beammpId
      if (s.discordId && !p.discordId) p.discordId = s.discordId
      if (s.role && !p.roles.includes(s.role)) p.roles.push(s.role)
      if (s.isGuest) p.isGuest = true
    }
    const playerSummaries = Array.from(playerMap.values())
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs)

    const uniqueIpCount = new Set(
      allSessions
        .map((session) => session.ipAddress)
        .filter((value): value is string => Boolean(value))
    ).size

    const sessionHistory = [...allSessions].sort((a, b) => b.joinedAt - a.joinedAt)

    return {
      dailyStats,
      playerSummaries,
      activeSessions,
      sessionHistory,
      totalSessions: store.sessions.length,
      uniqueIpCount
    }
  }

  async clearAnalytics(serverId: string): Promise<void> {
    const store = await this.loadStore(serverId)
    await this.syncFromTracker(serverId, store)
    store.sessions = []
    store.ingestedSessionIds.clear()
    const activeSessions = Array.from(store.activeSessions.values())
    await this.writeTrackerSnapshot(serverId, {
      version: 2,
      activeSessions,
      completedSessions: []
    })
    await this.persist(serverId, store)
  }
}
