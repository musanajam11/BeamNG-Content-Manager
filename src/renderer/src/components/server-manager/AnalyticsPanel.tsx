import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart3, Users, Clock, Trash2, Loader2, ChevronDown } from 'lucide-react'
import type { AnalyticsData, PlayerSummary, PlayerSession } from '../../../../shared/types'
import { useTranslation } from 'react-i18next'
import { useNow } from '../../hooks/useNow'

interface AnalyticsPanelProps {
  serverId: string
}

type Period = '1d' | '7d' | '30d' | '90d'
type SortKey = 'totalTimeMs' | 'totalSessions' | 'lastSeen' | 'playerName'

interface ChartPoint {
  label: string
  value: number
  sessions: number
  playerNames: string[]
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const mins = Math.floor(totalSec / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return `${hours}h ${remMins}m`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return `${days}d ${remHours}h`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatSessionEnd(session: PlayerSession): string {
  if (session.leftAt) return formatDate(session.leftAt)
  if (session.endReason === 'server-stopped') return 'Server stopped'
  return 'Active'
}

export function AnalyticsPanel({ serverId }: AnalyticsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('7d')
  const [sortKey, setSortKey] = useState<SortKey>('totalTimeMs')
  const [sortAsc, setSortAsc] = useState(false)

  const loadData = useCallback(async () => {
    const d = await window.api.hostedServerGetAnalytics(serverId)
    setData(d)
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load + polling
    loadData()
    const tick = (): void => {
      // Skip the IPC + analytics rebuild while the panel/window isn't visible.
      if (typeof document !== 'undefined' && document.hidden) return
      loadData()
    }
    const interval = setInterval(tick, 10000)
    const onVis = (): void => { if (!document.hidden) loadData() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadData])

  const handleClear = async (): Promise<void> => {
    await window.api.hostedServerClearAnalytics(serverId)
    loadData()
  }

  const displayData = data

  const cutoffTime = useMemo(() => {
    const now = Date.now()
    switch (period) {
      case '1d': return now - 1 * 86400000
      case '7d': return now - 7 * 86400000
      case '30d': return now - 30 * 86400000
      case '90d': return now - 90 * 86400000
      default: return now - 7 * 86400000
    }
  }, [period])

  const filteredDays = useMemo(() => {
    if (!displayData) return []
    const cutoffDate = new Date(cutoffTime).toISOString().slice(0, 10)
    return displayData.dailyStats.filter((d) => d.date >= cutoffDate)
  }, [displayData, cutoffTime])

  const filteredSessions = useMemo(() => {
    if (!displayData) return []
    return displayData.sessionHistory.filter((session) => {
      const lastActivity = session.leftAt ?? session.lastSeenAt ?? session.joinedAt
      return lastActivity >= cutoffTime
    })
  }, [displayData, cutoffTime])

  const chartPoints = useMemo((): ChartPoint[] => {
    const now = Date.now()
    if (period === '1d') {
      // Hourly buckets over the last 24 hours
      const hourMs = 3600000
      const start = Math.floor(cutoffTime / hourMs) * hourMs
      const points: ChartPoint[] = []
      for (let h = start; h < now; h += hourMs) {
        const hEnd = h + hourMs
        const active = filteredSessions.filter((s) => {
          const sStart = s.joinedAt
          const sEnd = s.leftAt ?? s.lastSeenAt ?? now
          return sStart < hEnd && sEnd >= h
        })
        const names = [...new Set(active.map((s) => s.playerName))]
        const d = new Date(h)
        const label = `${String(d.getHours()).padStart(2, '0')}:00`
        points.push({ label, value: names.length, sessions: active.length, playerNames: names })
      }
      return points
    }
    // For 7d/30d/90d: generate a full slot for every day in the range, filled with zeros
    // where there's no data, so the chart always spans the entire period.
    const dayCount = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const dayMap = new Map(filteredDays.map((d) => [d.date, d]))
    const daySessionCount = new Map<string, number>()
    for (const s of filteredSessions) {
      const dateStr = new Date(s.joinedAt).toISOString().slice(0, 10)
      daySessionCount.set(dateStr, (daySessionCount.get(dateStr) ?? 0) + 1)
    }
    const points: ChartPoint[] = []
    for (let i = dayCount - 1; i >= 0; i--) {
      const ts = now - i * 86400000
      const dateStr = new Date(ts).toISOString().slice(0, 10)
      const d = dayMap.get(dateStr)
      points.push({
        label: dayLabel(dateStr),
        value: d?.uniquePlayers ?? 0,
        sessions: daySessionCount.get(dateStr) ?? 0,
        playerNames: d?.playerNames ?? [],
      })
    }
    return points
  }, [period, filteredDays, filteredSessions, cutoffTime])

  const sortedPlayers = useMemo(() => {
    if (!displayData) return []
    const list = displayData.playerSummaries.filter((p) => p.lastSeen >= cutoffTime)
    list.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return list
  }, [displayData, sortKey, sortAsc, cutoffTime])

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const visibleSessions = useMemo(() => filteredSessions.slice(0, 100), [filteredSessions])

  const periodStats = useMemo(() => {
    const uniquePlayers = new Set(filteredSessions.map((s) => s.playerName)).size
    const totalSessions = filteredSessions.length
    const uniqueIps = new Set(filteredSessions.flatMap((s) => (s.ipAddress ? [s.ipAddress] : []))).size
    const totalPlaytime = filteredSessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
    return { uniquePlayers, totalSessions, uniqueIps, totalPlaytime }
  }, [filteredSessions])

  if (loading || !displayData) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('serverManager.loadingAnalytics')}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('serverManager.serverAnalytics')}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-1">
            {([['1d', '1 Day'], ['7d', '7 Days'], ['30d', '30 Days'], ['90d', '90 Days']] as [Period, string][]).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                  period === p
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={handleClear}
            title={t('serverManager.clearAllAnalytics')}
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <SummaryCard
            label={t('serverManager.totalPlayers')}
            value={String(periodStats.uniquePlayers)}
            icon={<Users size={14} />}
          />
          <SummaryCard
            label={t('serverManager.activeNow')}
            value={String(displayData.activeSessions.length)}
            icon={<span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
          />
          <SummaryCard
            label="Total Sessions"
            value={String(periodStats.totalSessions)}
            icon={<BarChart3 size={14} />}
          />
          <SummaryCard
            label="Unique IPs"
            value={String(periodStats.uniqueIps)}
            icon={<span className="text-xs font-semibold">IP</span>}
          />
          <SummaryCard
            label={t('serverManager.totalPlaytime')}
            value={formatDuration(periodStats.totalPlaytime)}
            icon={<Clock size={14} />}
          />
        </div>

        {/* Active Sessions */}
        {displayData.activeSessions.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                Active Sessions ({displayData.activeSessions.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayData.activeSessions.map((s: PlayerSession) => (
                <ActiveSessionBadge key={s.sessionId} session={s} formatDuration={formatDuration} />
              ))}
            </div>
          </div>
        )}

        {/* Session History */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Session History ({filteredSessions.length})
            </span>
          </div>

          {visibleSessions.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
              No sessions recorded for this period yet.
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="bg-[var(--color-surface)]">
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">Player</th>
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">IP</th>
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">Joined</th>
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">Duration</th>
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSessions.map((session: PlayerSession) => (
                    <tr key={session.sessionId} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] align-top">
                      <td className="px-4 py-2 text-[var(--color-text-primary)]">
                        <div className="font-medium">{session.playerName}</div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {session.beammpId ? `BeamMP ${session.beammpId}` : 'No BeamMP ID'}
                          {session.role ? ` • ${session.role}` : ''}
                          {session.isGuest ? ' • Guest' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{session.ipAddress ?? 'Unknown'}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatDate(session.joinedAt)}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatDuration(session.durationMs)}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatSessionEnd(session)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredSessions.length > visibleSessions.length && (
            <div className="text-xs text-[var(--color-text-muted)] mt-2">
              Showing the 100 most recent sessions for this period.
            </div>
          )}
        </div>

        {/* Players by Day — line chart */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              {period === '1d' ? 'Players by Hour' : 'Players by Day'}
            </span>
          </div>
          <LineChart points={chartPoints} />
        </div>

        {/* Player Table */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Player Summary ({sortedPlayers.length})
            </span>
          </div>

          {sortedPlayers.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
              No player data recorded yet.
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="bg-[var(--color-surface)]">
                    <SortHeader label="Player" sortKey="playerName" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Sessions" sortKey="totalSessions" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <th className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium">IPs</th>
                    <SortHeader label="Total Time" sortKey="totalTimeMs" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Last Seen" sortKey="lastSeen" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.map((p: PlayerSummary) => (
                    <tr key={p.playerName} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]">
                      <td className="px-4 py-2 text-[var(--color-text-primary)]">
                        <div className="font-medium">{p.playerName}</div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {p.beammpId ? `BeamMP ${p.beammpId}` : 'No BeamMP ID'}
                          {p.discordId ? ` • Discord ${p.discordId}` : ''}
                          {p.roles.length > 0 ? ` • ${p.roles.join(', ')}` : ''}
                          {p.isGuest ? ' • Guest' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{p.totalSessions}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">
                        <div>{p.uniqueIpCount}</div>
                        <div className="text-xs mt-0.5">{p.lastIpAddress ?? 'Unknown'}</div>
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatDuration(p.totalTimeMs)}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{formatDate(p.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LineChart({ points }: { points: ChartPoint[] }): React.JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)

  if (points.length === 0) {
    return (
      <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
        No data for this period yet.
      </div>
    )
  }

  const VW = 1000
  const VH = 130
  const padL = 28
  const padR = 16
  const padT = 12
  const padB = 24
  const plotW = VW - padL - padR
  const plotH = VH - padT - padB
  const maxVal = Math.max(...points.map((p) => p.value), 1)

  // Always distribute points evenly across the full plot width
  const pts = points.map((pt, i) => ({
    x: points.length === 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW,
    y: padT + plotH - (pt.value / maxVal) * plotH,
    pt,
  }))

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = [
    `M${pts[0].x.toFixed(1)},${padT + plotH}`,
    ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${pts[pts.length - 1].x.toFixed(1)},${padT + plotH}Z`,
  ].join(' ')

  // Show ~6 evenly-spaced x-axis labels
  const labelSet = new Set<number>([0, pts.length - 1])
  if (pts.length > 2) {
    const step = Math.max(1, Math.floor(pts.length / 5))
    for (let i = step; i < pts.length - 1; i += step) labelSet.add(i)
  }

  const hov = hovered !== null ? pts[hovered] : null
  const tooltipLeftPct = hov !== null ? Math.max(8, Math.min(92, (hov.x / VW) * 100)) : 0
  const hitW = plotW / Math.max(pts.length - 1, 1)

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="relative">
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ display: 'block', width: '100%' }}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id="beamcm-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Horizontal grid lines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <line
              key={frac}
              x1={padL} y1={padT + plotH * (1 - frac)}
              x2={padL + plotW} y2={padT + plotH * (1 - frac)}
              stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="4,4"
            />
          ))}
          {/* Baseline */}
          <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="var(--color-border)" strokeWidth="1" />
          {/* Area fill */}
          <path d={areaPath} fill="url(#beamcm-area-grad)" />
          {/* Line */}
          <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          {/* Transparent hit columns for easy hover */}
          {pts.map((p, i) => (
            <rect
              key={`hit-${i}`}
              x={p.x - hitW / 2} y={padT}
              width={hitW} height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
          ))}
          {/* Dots — only render when there are few points, to avoid clutter at 24/90 points */}
          {pts.length <= 31 && pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x} cy={p.y}
              r={hovered === i ? 4.5 : 2.5}
              fill={hovered === i ? 'var(--color-accent)' : 'var(--color-surface)'}
              stroke="var(--color-accent)" strokeWidth="1.5"
              onMouseEnter={() => setHovered(i)}
            />
          ))}
          {/* Highlighted dot when hovering (always visible regardless of point count) */}
          {pts.length > 31 && hovered !== null && pts[hovered] && (
            <circle
              cx={pts[hovered].x} cy={pts[hovered].y}
              r={4.5}
              fill="var(--color-accent)"
              stroke="var(--color-accent)" strokeWidth="1.5"
            />
          )}
          {/* Y-axis labels */}
          <text x={padL - 4} y={padT + 4} textAnchor="end" fontSize="8" fill="var(--color-text-muted)">{maxVal}</text>
          <text x={padL - 4} y={padT + plotH / 2 + 3} textAnchor="end" fontSize="8" fill="var(--color-text-muted)">{Math.round(maxVal / 2)}</text>
          <text x={padL - 4} y={padT + plotH + 1} textAnchor="end" fontSize="8" fill="var(--color-text-muted)">0</text>
          {/* X-axis labels */}
          {pts.map((p, i) => labelSet.has(i) && (
            <text key={i} x={p.x} y={VH - 4} textAnchor="middle" fontSize="8" fill="var(--color-text-muted)">
              {p.pt.label}
            </text>
          ))}
        </svg>
        {/* Hover tooltip */}
        {hov !== null && hovered !== null && (
          <div
            className="absolute bottom-8 pointer-events-none z-10"
            style={{ left: `${tooltipLeftPct.toFixed(1)}%`, transform: 'translateX(-50%)' }}
          >
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] text-[10px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
              <div className="font-medium mb-0.5">{hov.pt.label}</div>
              <div>{hov.pt.value} unique player{hov.pt.value !== 1 ? 's' : ''}</div>
              {hov.pt.playerNames.length > 0 && (
                <div className="mt-1 border-t border-[var(--color-border)] pt-1 text-[var(--color-text-muted)]">
                  {hov.pt.playerNames.slice(0, 5).join(', ')}
                  {hov.pt.playerNames.length > 5 ? ` +${hov.pt.playerNames.length - 5} more` : ''}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] text-[11px] mb-1">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold text-[var(--color-text-primary)]">{value}</div>
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  asc,
  onSort
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  asc: boolean
  onSort: (key: SortKey) => void
}): React.JSX.Element {
  const isActive = currentKey === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="px-4 py-2 text-left text-xs text-[var(--color-text-muted)] font-medium cursor-pointer hover:text-[var(--color-text-secondary)] select-none"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          <ChevronDown size={12} className={`transition-transform ${asc ? 'rotate-180' : ''}`} />
        )}
      </span>
    </th>
  )
}

function ActiveSessionBadge({ session, formatDuration }: { session: PlayerSession; formatDuration: (ms: number) => string }): React.JSX.Element {
  // Shared 1 Hz tick — one global timer for all badges instead of one per row.
  const now = useNow()
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      <span>{session.playerName}</span>
      {session.ipAddress && <span className="text-green-400/60">{session.ipAddress}</span>}
      <span className="text-green-400/60">
        {formatDuration(now - session.joinedAt)}
      </span>
    </span>
  )
}
