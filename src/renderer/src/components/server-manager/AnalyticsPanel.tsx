import { useState, useEffect, useCallback, useMemo } from 'react'
import { BarChart3, Users, Clock, Trash2, Loader2, ChevronDown } from 'lucide-react'
import type { AnalyticsData, DailyStats, PlayerSummary, PlayerSession } from '../../../../shared/types'
import { useTranslation } from 'react-i18next'
import { useNow } from '../../hooks/useNow'

interface AnalyticsPanelProps {
  serverId: string
}

type Period = '7d' | '30d' | '90d' | 'all'
type SortKey = 'totalTimeMs' | 'totalSessions' | 'lastSeen' | 'playerName'

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

  const filteredDays = useMemo(() => {
    if (!data) return []
    const now = new Date()
    let cutoff = 0
    switch (period) {
      case '7d': cutoff = now.getTime() - 7 * 86400000; break
      case '30d': cutoff = now.getTime() - 30 * 86400000; break
      case '90d': cutoff = now.getTime() - 90 * 86400000; break
      default: cutoff = 0
    }
    const cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
    return data.dailyStats.filter((d) => period === 'all' || d.date >= cutoffDate)
  }, [data, period])

  const sortedPlayers = useMemo(() => {
    if (!data) return []
    const list = [...data.playerSummaries]
    list.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return list
  }, [data, sortKey, sortAsc])

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const maxPlayers = useMemo(() => {
    return filteredDays.reduce((m, d) => Math.max(m, d.uniquePlayers), 1)
  }, [filteredDays])

  if (loading || !data) {
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
            {([['7d', t('serverManager.period7Days')], ['30d', t('serverManager.period30Days')], ['90d', t('serverManager.period90Days')], ['all', t('serverManager.periodAll')]] as [Period, string][]).map(([p, label]) => (
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
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label={t('serverManager.totalPlayers')}
            value={String(data.playerSummaries.length)}
            icon={<Users size={14} />}
          />
          <SummaryCard
            label={t('serverManager.activeNow')}
            value={String(data.activeSessions.length)}
            icon={<span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
          />
          <SummaryCard
            label={t('serverManager.totalPlaytime')}
            value={formatDuration(data.playerSummaries.reduce((sum, p) => sum + p.totalTimeMs, 0))}
            icon={<Clock size={14} />}
          />
        </div>

        {/* Active Sessions */}
        {data.activeSessions.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                Active Sessions ({data.activeSessions.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.activeSessions.map((s: PlayerSession) => (
                <ActiveSessionBadge key={s.playerName} session={s} formatDuration={formatDuration} />
              ))}
            </div>
          </div>
        )}

        {/* Daily Chart */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              Players by Day
            </span>
          </div>

          {filteredDays.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
              No data for this period yet.
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-end gap-1 h-32">
                {filteredDays.slice().reverse().map((d: DailyStats) => {
                  const height = Math.max(4, (d.uniquePlayers / maxPlayers) * 100)
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div
                        className="w-full bg-[var(--color-accent)]/60 hover:bg-[var(--color-accent)] rounded-t transition-colors min-w-[4px]"
                        style={{ height: `${height}%` }}
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                        <div className="bg-[var(--color-scrim-40)] text-[var(--color-text-primary)] text-[10px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
                          <div className="font-medium">{d.date}</div>
                          <div>{d.uniquePlayers} unique &middot; {d.peakPlayers} peak</div>
                          <div>{formatDuration(d.totalSessionsMs)} total time</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* X-axis labels */}
              <div className="flex gap-1 mt-1">
                {filteredDays.slice().reverse().map((d: DailyStats, i: number) => (
                  <div key={d.date} className="flex-1 text-center">
                    {(i % Math.max(1, Math.floor(filteredDays.length / 7)) === 0) && (
                      <span className="text-[9px] text-[var(--color-text-muted)]">{dayLabel(d.date)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
            <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--color-surface)]">
                    <SortHeader label="Player" sortKey="playerName" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Sessions" sortKey="totalSessions" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Total Time" sortKey="totalTimeMs" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Last Seen" sortKey="lastSeen" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPlayers.map((p: PlayerSummary) => (
                    <tr key={p.playerName} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]">
                      <td className="px-4 py-2 text-[var(--color-text-primary)]">{p.playerName}</td>
                      <td className="px-4 py-2 text-[var(--color-text-muted)]">{p.totalSessions}</td>
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
      {session.playerName}
      <span className="text-green-400/60">
        {formatDuration(now - session.joinedAt)}
      </span>
    </span>
  )
}
