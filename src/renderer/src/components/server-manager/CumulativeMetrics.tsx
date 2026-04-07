import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, HardDrive, Users, Server, Activity, Clock } from 'lucide-react'
import type { HostedServerEntry } from '../../../../shared/types'

interface CumulativeMetricsProps {
  servers: HostedServerEntry[]
}

export function CumulativeMetrics({ servers }: CumulativeMetricsProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (servers.length === 0) return null

  const runningServers = servers.filter((s) => s.status.state === 'running')
  const runningCount = runningServers.length
  const totalCount = servers.length

  const totalPlayers = runningServers.reduce((sum, s) => sum + s.status.players, 0)
  const totalMaxPlayers = servers.reduce((sum, s) => sum + s.config.maxPlayers, 0)
  const playerPercent = totalMaxPlayers > 0 ? (totalPlayers / totalMaxPlayers) * 100 : 0

  // Live aggregate uptime from the longest-running server
  const oldestStartedAt = runningServers.reduce<number | null>((oldest, s) => {
    if (!s.status.startedAt) return oldest
    if (oldest === null) return s.status.startedAt
    return Math.min(oldest, s.status.startedAt)
  }, null)

  const [longestUptime, setLongestUptime] = useState(0)
  useEffect(() => {
    if (!oldestStartedAt) {
      setLongestUptime(0)
      return
    }
    setLongestUptime(Date.now() - oldestStartedAt)
    const id = setInterval(() => setLongestUptime(Date.now() - oldestStartedAt), 1000)
    return () => clearInterval(id)
  }, [oldestStartedAt])

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <MiniMetric
        icon={<Server size={14} />}
        label={t('serverManager.metricsInstances')}
        value={`${runningCount} / ${totalCount}`}
        sub={runningCount === 0 ? t('serverManager.metricsAllStopped') : t('serverManager.metricsRunningCount', { count: runningCount })}
        accent={runningCount > 0 ? 'green' : 'neutral'}
      />
      <MiniMetric
        icon={<Users size={14} />}
        label={t('serverManager.metricsTotalPlayers')}
        value={`${totalPlayers} / ${totalMaxPlayers}`}
        sub={t('serverManager.metricsCapacity', { percent: Math.round(playerPercent) })}
        accent={totalPlayers > 0 ? 'blue' : 'neutral'}
        barPercent={playerPercent}
      />
      <MiniMetric
        icon={<Cpu size={14} />}
        label={t('serverManager.metricsEstCpu')}
        value={runningCount > 0 ? `~${runningCount * 0}%` : '—'}
        sub={runningCount > 0 ? t('serverManager.metricsProcesses', { count: runningCount }) : t('serverManager.metricsNoLoad')}
        accent="neutral"
        barPercent={0}
      />
      <MiniMetric
        icon={<HardDrive size={14} />}
        label={t('serverManager.metricsEstMemory')}
        value={runningCount > 0 ? `~${(runningCount * 0.02).toFixed(2)} GB` : '—'}
        sub={runningCount > 0 ? t('serverManager.metricsInstanceCount', { count: runningCount }) : t('serverManager.metricsNoUsage')}
        accent="neutral"
        barPercent={0}
      />
      <MiniMetric
        icon={<Activity size={14} />}
        label={t('serverManager.metricsNetwork')}
        value={runningCount > 0 ? t('serverManager.metricsPortCount', { count: runningCount }) : '—'}
        sub={runningCount > 0 ? t('serverManager.metricsPorts', { ports: runningServers.map((s) => s.config.port).join(', ') }) : t('serverManager.metricsNoTraffic')}
        accent={runningCount > 0 ? 'blue' : 'neutral'}
      />
      <MiniMetric
        icon={<Clock size={14} />}
        label={t('serverManager.metricsLongestUptime')}
        value={longestUptime > 0 ? formatUptime(longestUptime) : '—'}
        sub={runningCount > 0 ? t('serverManager.metricsOldestInstance') : t('serverManager.metricsAllOffline')}
        accent={runningCount > 0 ? 'green' : 'neutral'}
      />
    </div>
  )
}

function MiniMetric({
  icon,
  label,
  value,
  sub,
  accent,
  barPercent
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  accent: 'green' | 'blue' | 'neutral'
  barPercent?: number
}): React.JSX.Element {
  const accentDot =
    accent === 'green'
      ? 'bg-green-400'
      : accent === 'blue'
        ? 'bg-blue-400'
        : 'bg-[var(--color-text-muted)]'

  const barColor =
    accent === 'green'
      ? 'bg-green-500'
      : accent === 'blue'
        ? 'bg-blue-500'
        : 'bg-[var(--color-text-muted)]'

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        <span className={`ml-auto w-1.5 h-1.5 rounded-full ${accentDot}`} />
      </div>
      <span className="text-lg font-bold text-[var(--color-text-primary)] leading-tight">{value}</span>
      {barPercent !== undefined && (
        <div className="h-1 bg-[var(--color-surface-hover)] rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-full transition-all duration-500`}
            style={{ width: `${Math.min(barPercent, 100)}%` }}
          />
        </div>
      )}
      <span className="text-[10px] text-[var(--color-text-muted)] leading-tight">{sub}</span>
    </div>
  )
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
