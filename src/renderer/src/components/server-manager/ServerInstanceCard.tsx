import { Play, Square, Trash2, Link2, Check, Loader2 } from 'lucide-react'
import { useState, useCallback } from 'react'
import type { HostedServerEntry } from '../../../../shared/types'
import { BeamMPText } from '../BeamMPText'
import { useLiveUptime } from '../../hooks/useLiveUptime'
import { useTranslation } from 'react-i18next'
import { buildInviteLink, createShortInviteLink } from '../../utils/inviteLink'
import { copyText } from '../../utils/clipboard'

interface ServerInstanceCardProps {
  server: HostedServerEntry
  isSelected: boolean
  onSelect: (id: string) => void
  onDelete: (id: string, name: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
}

export function ServerInstanceCard({
  server,
  isSelected,
  onSelect,
  onDelete,
  onStart,
  onStop
}: ServerInstanceCardProps): React.JSX.Element {
  const { config, status } = server
  const liveUptime = useLiveUptime(status.startedAt, status.state === 'running')
  const { t } = useTranslation()
  const [inviteCopied, setInviteCopied] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)

  const stateColor = (): string => {
    switch (status.state) {
      case 'running':
        return 'text-green-400'
      case 'starting':
        return 'text-yellow-400'
      case 'error':
        return 'text-red-400'
      default:
        return 'text-[var(--color-text-muted)]'
    }
  }

  const stateLabel = (): string => {
    switch (status.state) {
      case 'running':
        return t('serverManager.running')
      case 'starting':
        return t('serverManager.starting')
      case 'error':
        return t('serverManager.error')
      default:
        return t('serverManager.stopped')
    }
  }

  const stateDot = (): string => {
    switch (status.state) {
      case 'running':
        return 'bg-green-400'
      case 'starting':
        return 'bg-yellow-400'
      case 'error':
        return 'bg-red-400'
      default:
        return 'bg-[var(--color-text-muted)]'
    }
  }

  const handleCopyInvite = useCallback(async (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    if (status.state !== 'running' || creatingInvite) return

    setCreatingInvite(true)
    setInviteCopied(false)
    let didCopy = false
    try {
      const probe = await window.api.hostedServerTestPort(config.port).catch(() => null)
      let inviteIp = probe?.ip?.trim() || ''
      if (!inviteIp) {
        const ts = await window.api.getTailscaleStatus().catch(() => null)
        if (ts?.installed && ts.running && ts.ip) inviteIp = ts.ip
      }
      if (!inviteIp) return

      const link = await createShortInviteLink({ ip: inviteIp, port: config.port })
      copyText(link)
      didCopy = true
    } catch {
      const probe = await window.api.hostedServerTestPort(config.port).catch(() => null)
      const fallbackIp = probe?.ip?.trim()
      if (!fallbackIp) return
      copyText(buildInviteLink({ ip: fallbackIp, port: config.port, name: config.name }))
      didCopy = true
    } finally {
      setCreatingInvite(false)
      if (didCopy) {
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 1500)
      }
    }
  }, [status.state, creatingInvite, config.port, config.name])

  return (
    <button
      onClick={() => onSelect(config.id)}
      className={`group flex flex-col gap-1.5 p-3 text-left border-b border-[var(--color-border)] transition-colors ${
        isSelected
          ? 'bg-[var(--color-surface-active)]'
          : 'hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      {/* Name row */}
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-2 h-2 rounded-full shrink-0 ${stateDot()}`} />
        <BeamMPText text={config.name} className="text-sm font-medium text-[var(--color-text-primary)] truncate flex-1" />
      </div>

      {/* Status + port row */}
      <div className="flex items-center justify-between pl-4">
        <span className={`text-[11px] font-medium ${stateColor()}`}>{stateLabel()}</span>
        <span className="text-[11px] text-[var(--color-text-muted)]">:{config.port}</span>
      </div>

      {/* Players + uptime when running */}
      {status.state === 'running' && (
        <div className="flex items-center gap-3 pl-4 text-[11px] text-[var(--color-text-muted)]">
          <span>{status.players}/{config.maxPlayers} {t('serverManager.playerCount_other', { count: status.players })}</span>
          <span>{formatUptime(liveUptime)}</span>
        </div>
      )}

      {/* Quick actions (hover-reveal) */}
      <div className="flex items-center gap-0.5 pl-3 opacity-0 group-hover:opacity-100 transition-opacity">
        {status.state === 'stopped' || status.state === 'error' ? (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onStart(config.id)
            }}
            className="p-1 text-green-400 hover:bg-green-400/10 transition-colors rounded"
            title={t('serverManager.start')}
          >
            <Play size={13} />
          </span>
        ) : (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onStop(config.id)
            }}
            className="p-1 text-red-400 hover:bg-red-400/10 transition-colors rounded"
            title={t('serverManager.stop')}
          >
            <Square size={13} />
          </span>
        )}
        {status.state === 'running' && (
          <span
            role="button"
            onClick={handleCopyInvite}
            className="p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)] transition-colors rounded"
            title={t('servers.copyInviteLink', 'Copy invite link (beammp-cm://)')}
          >
            {creatingInvite ? <Loader2 size={13} className="animate-spin" /> : inviteCopied ? <Check size={13} /> : <Link2 size={13} />}
          </span>
        )}
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(config.id, config.name)
          }}
          className="p-1 text-red-400 hover:bg-red-400/10 transition-colors rounded"
          title={t('serverManager.delete')}
        >
          <Trash2 size={13} />
        </span>
      </div>
    </button>
  )
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
