import { useState, useEffect } from 'react'
import { Play, Square, Settings, FolderOpen, Cpu, HardDrive, Users, Copy } from 'lucide-react'
import type { HostedServerEntry } from '../../../../shared/types'
import { useLiveUptime } from '../../hooks/useLiveUptime'
import { BeamMPText } from '../BeamMPText'
import type { Tab } from '../../stores/useHostedServerStore'

interface InstancesGridProps {
  servers: HostedServerEntry[]
  onOpen: (id: string, tab?: Tab) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string, name: string) => void
  onDuplicate: (id: string) => void
}

export function InstancesGrid({
  servers,
  onOpen,
  onStart,
  onStop,
  onDelete,
  onDuplicate
}: InstancesGridProps): React.JSX.Element {
  if (servers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
        No server instances yet. Click <span className="text-[var(--color-accent)] mx-1">+ Create Instance</span> to get started.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-1">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {servers.map((s) => (
          <InstanceCard
            key={s.config.id}
            server={s}
            onOpen={onOpen}
            onStart={onStart}
            onStop={onStop}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        ))}
      </div>
    </div>
  )
}

function InstanceCard({
  server,
  onOpen,
  onStart,
  onStop,
  onDelete,
  onDuplicate
}: {
  server: HostedServerEntry
  onOpen: (id: string, tab?: Tab) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onDelete: (id: string, name: string) => void
  onDuplicate: (id: string) => void
}): React.JSX.Element {
  const { config, status } = server
  const isRunning = status.state === 'running'
  const isStopped = status.state === 'stopped' || status.state === 'error'
  const liveUptime = useLiveUptime(status.startedAt, isRunning)

  const mapName = config.map?.split('/')[2] ?? 'Unknown'

  const [bannerImage, setBannerImage] = useState<string | null>(null)

  useEffect(() => {
    setBannerImage(null)
    // Try custom image first, then map preview
    window.api.hostedServerGetCustomImage(config.id).then((img) => {
      if (img) {
        setBannerImage(img)
      } else if (config.map) {
        window.api.getMapPreview(config.map).then((preview) => {
          if (preview) setBannerImage(preview)
        })
      }
    })
  }, [config.id, config.map, config.customImage])

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header banner with map image */}
      <div
        className="relative aspect-[16/3.5] flex items-end p-3 cursor-pointer"
        onClick={() => onOpen(config.id)}
        style={bannerImage ? {
          backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.1) 100%), url(${bannerImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        } : {
          background: 'linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-hover) 100%)'
        }}
      >
        <div className="flex-1 min-w-0">
          <BeamMPText text={config.name} className="text-sm font-semibold text-[var(--color-text-primary)] truncate" />
          <p className="text-[11px] text-[var(--color-text-muted)] truncate">
            {mapName} &middot; :{config.port}
          </p>
        </div>
        <StatusBadge state={status.state} />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 px-4 py-2.5 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)]">
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-[var(--color-text-muted)]" />
          <span>{isRunning ? '0%' : '—'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HardDrive size={12} className="text-[var(--color-text-muted)]" />
          <span>{isRunning ? formatUptime(liveUptime) : '—'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users size={12} className="text-[var(--color-text-muted)]" />
          <span>
            {isRunning
              ? `${status.players}/${config.maxPlayers}`
              : `0/${config.maxPlayers}`}
          </span>
        </div>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-1 px-4 py-2 border-t border-[var(--color-border)]">
        {isStopped ? (
          <ActionBtn
            onClick={() => onStart(config.id)}
            className="text-green-400 hover:bg-green-400/10"
            title="Start"
          >
            <Play size={14} />
          </ActionBtn>
        ) : (
          <ActionBtn
            onClick={() => onStop(config.id)}
            className="text-red-400 hover:bg-red-400/10"
            title="Stop"
          >
            <Square size={14} />
          </ActionBtn>
        )}
        <ActionBtn
          onClick={() => onOpen(config.id, 'config')}
          className="text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          title="Manage"
        >
          <Settings size={14} />
        </ActionBtn>
        <ActionBtn
          onClick={() => onOpen(config.id, 'files')}
          className="text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          title="Files"
        >
          <FolderOpen size={14} />
        </ActionBtn>
        <ActionBtn
          onClick={() => onDuplicate(config.id)}
          className="text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          title="Clone"
        >
          <Copy size={14} />
        </ActionBtn>

        <div className="ml-auto">
          <ActionBtn
            onClick={() => onDelete(config.id, config.name)}
            className="text-red-400/60 hover:text-red-400 hover:bg-red-400/10"
            title="Delete"
          >
            <span className="text-xs">&#x2715;</span>
          </ActionBtn>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  className,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  className: string
  title: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${className}`}
      title={title}
    >
      {children}
    </button>
  )
}

function StatusBadge({ state }: { state: string }): React.JSX.Element {
  const styles: Record<string, string> = {
    running: 'bg-green-500/20 text-green-400 border-green-500/30',
    starting: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    stopped: 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]'
  }

  const labels: Record<string, string> = {
    running: 'Running',
    starting: 'Starting',
    error: 'Error',
    stopped: 'Idle'
  }

  const s = styles[state] ?? styles.stopped
  const label = labels[state] ?? 'Idle'
  const dotColor = state === 'running' ? 'bg-green-400' : state === 'starting' ? 'bg-yellow-400' : state === 'error' ? 'bg-red-400' : 'bg-[var(--color-text-muted)]'

  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 border rounded-full ${s}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  )
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
