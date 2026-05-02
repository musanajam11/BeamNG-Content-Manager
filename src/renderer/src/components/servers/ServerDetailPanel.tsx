import { Play, Star, Package, Users, MapPin, Globe, Gauge, Wifi, Copy, Check, X, Clock, Square, ImageIcon, HardDrive, Link2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerInfo } from '../../../../shared/types'
import { countryFlag, cleanMapName } from '../../utils/countryFlags'
import { useFlagUrl } from '../../utils/flagCache'
import { BeamMPText } from '../BeamMPText'
import { parseServerTags } from '../../utils/serverTags'
import { ServerTagBadge } from './ServerTag'
import { buildInviteLink, createShortInviteLink } from '../../utils/inviteLink'
import { copyText } from '../../utils/clipboard'

interface Props {
  server: ServerInfo
  favorite: boolean
  userLabel?: string | null
  joining: boolean
  joinError: string | null
  connectedServer?: string | null
  onJoin: () => void
  onClose: () => void
  onToggleFavorite: () => void
  queueActive: boolean
  queueTarget: { ip: string; port: string; sname: string } | null
  queueMessage: string
  queueElapsed: number
  onQueueStart: () => void
  onQueueStop: () => void
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 4, paddingBottom: 4 }}
    >
      <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{value}</div>
    </div>
  )
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'gold' }): React.JSX.Element {
  const cls = tone === 'accent'
    ? 'border-[var(--color-accent-25)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]'
    : tone === 'gold'
      ? 'border-yellow-400/25 bg-yellow-400/12 text-yellow-200'
      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>{children}</span>
}

export function ServerDetailPanel({
  server, favorite, userLabel, joining, joinError, connectedServer, onJoin, onClose, onToggleFavorite,
  queueActive, queueTarget, queueMessage, queueElapsed, onQueueStart, onQueueStop
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const playerCount = parseInt(server.players, 10) || 0
  const maxPlayers = parseInt(server.maxplayers, 10) || 0
  const fillPct = maxPlayers > 0 ? Math.min(100, (playerCount / maxPlayers) * 100) : 0

  const modSizeBytes = parseInt(server.modstotalsize, 10) || 0
  const formatModSize = (bytes: number): string => {
    if (bytes <= 0) return '0 B'
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) return `${gb.toFixed(2)} GB`
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) return `${mb.toFixed(1)} MB`
    const kb = bytes / 1024
    return `${kb.toFixed(0)} KB`
  }

  const [copied, setCopied] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [mapPreview, setMapPreview] = useState<string | null>(null)

  // Load map preview when server changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on server change
    setMapPreview(null)
    if (server.map) {
      window.api.getMapPreview(server.map).then((url) => {
        if (url) setMapPreview(url)
      })
    }
  }, [server.map])

  const handleCopy = (): void => {
    copyText(`${server.ip}:${server.port}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const handleCopyInvite = (): void => {
    // Kick off short-link creation async; show spinner until done then flash
    // the "Copied!" state. Falls back to a plain beammp-cm:// link if the
    // BMR API is unreachable so the copy always works.
    setInviteCopied(false)
    createShortInviteLink({ ip: server.ip, port: Number(server.port) })
      .then((link) => {
        copyText(link)
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 1500)
      })
      .catch(() => {
        // Absolute last resort — local deep link
        copyText(buildInviteLink({ ip: server.ip, port: server.port }))
        setInviteCopied(true)
        setTimeout(() => setInviteCopied(false), 1500)
      })
  }

  const formatElapsed = (ms: number): string => {
    const secs = Math.floor(ms / 1000)
    const mins = Math.floor(secs / 60)
    const s = secs % 60
    return mins > 0 ? `${mins}m ${s}s` : `${s}s`
  }

  const isFull = playerCount >= maxPlayers && maxPlayers > 0
  const isThisQueued = queueActive && queueTarget?.ip === server.ip && queueTarget?.port === server.port
  const isOtherQueued = queueActive && !isThisQueued
  const isConnectedHere = connectedServer === `${server.ip}:${server.port}`
  const isConnectedElsewhere = !!connectedServer && !isConnectedHere
  const flagUrl = useFlagUrl(server.location)
  const contentTags = parseServerTags(server.tags)

  const popColor = fillPct >= 90 ? 'pop-fill-rose' : fillPct >= 65 ? 'pop-fill-amber' : 'pop-fill-green'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Map preview hero */}
      <div className="relative h-28 shrink-0 overflow-hidden bg-gradient-to-br from-white/5 to-white/[0.02]">
        {mapPreview ? (
          <img src={mapPreview} alt={cleanMapName(server.map)} className="absolute inset-0 w-full h-full object-cover opacity-60" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon size={32} className="text-[var(--color-text-dim)]" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#111113] via-[#111113]/60 to-transparent" />
        <div className="absolute bottom-2.5 left-4 right-4 flex items-end justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-[var(--color-accent-text)]" />
            <span className="text-xs font-semibold text-[var(--color-text-primary)] drop-shadow">{cleanMapName(server.map)}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleFavorite}
              className={`border p-1.5 transition backdrop-blur-sm ${
                favorite
                  ? 'border-yellow-400/25 bg-yellow-400/12 text-yellow-300'
                  : 'border-[var(--color-border-hover)] bg-[var(--color-scrim-30)] text-[var(--color-text-secondary)] hover:text-yellow-300'
              }`}
            >
              <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={onClose}
              className="border border-[var(--color-border-hover)] bg-[var(--color-scrim-30)] p-1.5 text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] backdrop-blur-sm"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Header */}
      <div
        className="border-b border-[var(--color-border)]"
        style={{ padding: 12 }}
      >
        <div className="mb-2 flex items-center gap-2.5">
          {flagUrl ? (
            <img
              src={flagUrl}
              alt={server.location}
              className="w-6 h-4 object-cover shadow-sm"
            />
          ) : (
            <span className="text-lg">{countryFlag(server.location)}</span>
          )}
          <BeamMPText text={server.sname} linkify className="text-sm font-bold tracking-tight text-[var(--color-text-primary)] line-clamp-2 leading-snug flex-1" />
        </div>
        {userLabel && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Label:</span>
            <span className="text-[var(--color-text-secondary)]">{userLabel}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {server.official && <Badge tone="accent">{t('servers.tagOfficial')}</Badge>}
          {contentTags.every(ct => ct.label !== 'Modded') && parseInt(server.modstotal, 10) > 0 && <Badge tone="gold">{t('servers.tagModded')}</Badge>}
          {server.password ? <Badge>{t('servers.private')}</Badge> : <Badge>{t('servers.open')}</Badge>}
          {contentTags.map(tag => (
            <ServerTagBadge key={tag.id} tag={tag} />
          ))}
        </div>

        {/* Description */}
        {server.sdesc && (
          <div className="mt-3 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            <BeamMPText text={server.sdesc} linkify />
          </div>
        )}

        {/* Stat pills */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill icon={<Users size={10} />} label={t('servers.players')} value={`${server.players}/${server.maxplayers}`} />
          <StatPill icon={<MapPin size={10} />} label={t('servers.map')} value={cleanMapName(server.map)} />
          <StatPill icon={<Globe size={10} />} label={t('servers.region')} value={server.location || 'Global'} />
          <StatPill icon={<Gauge size={10} />} label={t('servers.type')} value={parseInt(server.modstotal, 10) > 0 ? t('servers.tagModded') : t('servers.standard')} />
          {modSizeBytes > 0 && (
            <StatPill icon={<HardDrive size={10} />} label={t('servers.modSize', 'Mod Size')} value={formatModSize(modSizeBytes)} />
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          {isThisQueued ? (
            /* This server is being queued — show cancel button */
            <button
              onClick={onQueueStop}
              className="flex-1 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-text-muted)] transition hover:bg-[var(--color-accent-20)]"
            >
              <span className="inline-flex items-center gap-2">
                <Square size={14} />
                {t('servers.cancelQueueBtn')}
              </span>
            </button>
          ) : isConnectedHere ? (
            /* Currently connected to this server */
            <div className="flex-1 border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 text-center">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {t('servers.connected')}
              </span>
            </div>
          ) : isFull ? (
            /* Server is full, not queued — show "Wait to Join" */
            <button
              onClick={onQueueStart}
              disabled={isOtherQueued || isConnectedElsewhere || isConnectedHere}
              className="flex-1 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-text-muted)] transition hover:bg-[var(--color-accent-20)] disabled:opacity-40"
              title={isOtherQueued ? 'Already queued for another server' : (isConnectedElsewhere || isConnectedHere) ? 'Already connected to a server' : 'Wait for a slot to open, then auto-join'}
            >
              <span className="inline-flex items-center gap-2">
                <Clock size={14} />
                {t('servers.waitToJoin')}
              </span>
            </button>
          ) : (
            /* Server has space — show normal join */
            <button
              onClick={onJoin}
              disabled={joining || isOtherQueued || isConnectedElsewhere}
              className="flex-1 bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] accent-shadow-sm transition hover:opacity-95 disabled:opacity-40"
              title={isOtherQueued ? 'Already queued for another server' : isConnectedElsewhere ? 'Already connected to another server' : undefined}
            >
              <span className="inline-flex items-center gap-2">
                <Play size={14} fill="currentColor" />
                {joining ? t('servers.joining') : isOtherQueued ? t('servers.lockedInQueue') : isConnectedElsewhere ? t('servers.connectedElsewhere') : t('servers.joinServer')}
              </span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
            title={t('servers.copyAddress')}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>

          <button
            onClick={handleCopyInvite}
            className="border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
            title={t('servers.copyInviteLink', 'Copy invite link (beammp-cm://)')}
          >
            {inviteCopied ? <Check size={14} /> : <Link2 size={14} />}
          </button>
        </div>

        {/* Queue status banner — only for the server being queued */}
        {isThisQueued && (
          <div className="mt-2 border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] px-3 py-2 text-xs text-[var(--color-accent-text-muted)]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5">
                <Clock size={11} className="animate-pulse" />
                {queueMessage}
              </span>
              <span className="text-[10px] text-[var(--color-accent-text-muted)]">{formatElapsed(queueElapsed)}</span>
            </div>
          </div>
        )}
        {!queueActive && queueMessage && queueMessage.startsWith('Auto-join failed') && (
          <p className="mt-2 text-xs text-rose-400 text-center">{queueMessage}</p>
        )}
        {joinError && (
          <p className="mt-2 text-xs text-rose-400 text-center">{joinError}</p>
        )}
      </div>

      {/* Scrollable sections */}
      <div
        className="flex-1 space-y-3 overflow-y-auto"
        style={{ padding: 12 }}
      >
        {/* Connection */}
        <section className="p-3.5">
          <div className="mb-2.5 text-xs font-semibold text-[var(--color-text-primary)]">{t('servers.connection')}</div>
          <div className="space-y-1.5 text-xs">
            <div
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
              style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 4, paddingBottom: 4 }}
            >
              <span className="text-[var(--color-text-secondary)] shrink-0">{t('servers.address')}</span>
              <span className="font-mono text-[var(--color-text-primary)] text-[11px] truncate ml-2">{server.ip}:{server.port}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
                style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 4, paddingBottom: 4 }}
              >
                <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                  <Wifi size={10} /> {t('servers.access')}
                </div>
                <div className="text-xs font-medium text-[var(--color-text-primary)]">{server.password ? t('servers.restricted') : t('servers.openJoin')}</div>
              </div>
              <div
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
                style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 4, paddingBottom: 4 }}
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
                  {t('servers.version')}
                </div>
                <div className="text-xs font-medium text-[var(--color-text-primary)]">{server.version || '—'}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Population */}
        <section className="p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">{t('servers.population')}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">{t('servers.percentFull', { percent: Math.round(fillPct) })}</div>
          </div>
          <div className="pop-bar w-full">
            {/* Plain div — the .pop-bar-fill class already has a CSS width transition.
                Don't double-animate via framer; that fights the CSS transition and
                stutters when the player count changes. */}
            <div
              style={{ width: `${fillPct}%` }}
              className={`pop-bar-fill ${popColor}`}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-[var(--color-text-secondary)]">{t('servers.currentPlayers')}</span>
            <span className="font-semibold text-[var(--color-text-primary)]">{server.players}/{server.maxplayers}</span>
          </div>
        </section>

        {/* Online players */}
        {server.playerslist && (
          <section className="p-3.5">
            <div className="mb-2.5 text-xs font-semibold text-[var(--color-text-primary)]">{t('servers.onlinePlayers')}</div>
            <div className="flex flex-wrap gap-1.5">
              {server.playerslist.split(';').filter(Boolean).map((name) => (
                <span key={name} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)]">
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Mods */}
        {server.modlist && (
          <section className="p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-primary)]">
                <Package size={13} />
                {t('servers.requiredMods')}
              </div>
              {modSizeBytes > 0 && (
                <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {formatModSize(modSizeBytes)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {server.modlist.split(/[;,\n]+/).map((mod) => mod.trim()).filter(Boolean).map((mod) => (
                <span key={mod} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text-secondary)]">
                  {mod}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Extra info */}
        <section className="p-3.5">
          <div className="mb-2.5 text-xs font-semibold text-[var(--color-text-primary)]">{t('servers.details')}</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--color-text-secondary)] shrink-0">{t('servers.owner')}</span>
              <span className="text-[var(--color-text-primary)] truncate">{server.owner || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[var(--color-text-secondary)] shrink-0">{t('servers.guests')}</span>
              <span className={server.guests ? 'text-emerald-400' : 'text-rose-400'}>{server.guests ? t('servers.allowed') : t('common.no')}</span>
            </div>
            {server.tags && server.tags !== 'offline' && (
              <div className="mt-1.5">
                <span className="text-[var(--color-text-secondary)] text-xs shrink-0">{t('servers.tags')}</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {parseServerTags(server.tags).map(tag => (
                    <ServerTagBadge key={tag.id} tag={tag} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
