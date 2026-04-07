import { Play, Star, Package, Users, MapPin, Globe, Gauge, Wifi, Copy, Check, X, Clock, Square, ImageIcon } from 'lucide-react'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { ServerInfo } from '../../../../shared/types'
import { countryFlag, cleanMapName } from '../../utils/countryFlags'
import { useFlagUrl } from '../../utils/flagCache'
import { BeamMPText } from '../BeamMPText'

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
    <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
      <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-semibold text-white truncate">{value}</div>
    </div>
  )
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'gold' }): React.JSX.Element {
  const cls = tone === 'accent'
    ? 'border-[var(--color-accent-25)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]'
    : tone === 'gold'
      ? 'border-yellow-400/25 bg-yellow-400/12 text-yellow-200'
      : 'border-white/8 bg-white/5 text-slate-300'
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>{children}</span>
}

export function ServerDetailPanel({
  server, favorite, userLabel, joining, joinError, connectedServer, onJoin, onClose, onToggleFavorite,
  queueActive, queueTarget, queueMessage, queueElapsed, onQueueStart, onQueueStop
}: Props): React.JSX.Element {
  const playerCount = parseInt(server.players, 10) || 0
  const maxPlayers = parseInt(server.maxplayers, 10) || 0
  const fillPct = maxPlayers > 0 ? Math.min(100, (playerCount / maxPlayers) * 100) : 0

  const [copied, setCopied] = useState(false)
  const [mapPreview, setMapPreview] = useState<string | null>(null)

  // Load map preview when server changes
  useEffect(() => {
    setMapPreview(null)
    if (server.map) {
      window.api.getMapPreview(server.map).then((url) => {
        if (url) setMapPreview(url)
      })
    }
  }, [server.map])

  const handleCopy = (): void => {
    navigator.clipboard.writeText(`${server.ip}:${server.port}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
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

  const popColor = fillPct >= 90 ? 'pop-fill-rose' : fillPct >= 65 ? 'pop-fill-amber' : 'pop-fill-green'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Map preview hero */}
      <div className="relative h-28 shrink-0 overflow-hidden bg-gradient-to-br from-white/5 to-white/[0.02]">
        {mapPreview ? (
          <img src={mapPreview} alt={cleanMapName(server.map)} className="absolute inset-0 w-full h-full object-cover opacity-60" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon size={32} className="text-white/10" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#111113] via-[#111113]/60 to-transparent" />
        <div className="absolute bottom-2.5 left-4 right-4 flex items-end justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-[var(--color-accent-text)]" />
            <span className="text-xs font-semibold text-white drop-shadow">{cleanMapName(server.map)}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleFavorite}
              className={`border p-1.5 transition backdrop-blur-sm ${
                favorite
                  ? 'border-yellow-400/25 bg-yellow-400/12 text-yellow-300'
                  : 'border-white/20 bg-black/30 text-slate-400 hover:text-yellow-300'
              }`}
            >
              <Star size={13} fill={favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              onClick={onClose}
              className="border border-white/20 bg-black/30 p-1.5 text-slate-400 transition hover:text-white backdrop-blur-sm"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="border-b border-white/8 px-5 py-4">
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
          <BeamMPText text={server.sname} className="text-sm font-bold tracking-tight text-white line-clamp-2 leading-snug flex-1" />
        </div>
        {userLabel && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Label:</span>
            <span className="text-slate-300">{userLabel}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {server.official && <Badge tone="accent">Official</Badge>}
          {parseInt(server.modstotal, 10) > 0 && <Badge tone="gold">Modded</Badge>}
          {server.password ? <Badge>Private</Badge> : <Badge>Open</Badge>}
        </div>

        {/* Description */}
        {server.sdesc && (
          <div className="mt-3 rounded-lg border border-white/8 bg-black/20 p-3 text-xs leading-relaxed text-slate-300">
            <BeamMPText text={server.sdesc} />
          </div>
        )}

        {/* Stat pills */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill icon={<Users size={10} />} label="Players" value={`${server.players}/${server.maxplayers}`} />
          <StatPill icon={<MapPin size={10} />} label="Map" value={cleanMapName(server.map)} />
          <StatPill icon={<Globe size={10} />} label="Region" value={server.location || 'Global'} />
          <StatPill icon={<Gauge size={10} />} label="Type" value={parseInt(server.modstotal, 10) > 0 ? 'Modded' : 'Standard'} />
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
                Cancel queue
              </span>
            </button>
          ) : isConnectedHere ? (
            /* Currently connected to this server */
            <div className="flex-1 border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 text-center">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Connected
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
                Wait to join
              </span>
            </button>
          ) : (
            /* Server has space — show normal join */
            <button
              onClick={onJoin}
              disabled={joining || isOtherQueued || isConnectedElsewhere}
              className="flex-1 bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white accent-shadow-sm transition hover:opacity-95 disabled:opacity-40"
              title={isOtherQueued ? 'Already queued for another server' : isConnectedElsewhere ? 'Already connected to another server' : undefined}
            >
              <span className="inline-flex items-center gap-2">
                <Play size={14} fill="currentColor" />
                {joining ? 'Joining...' : isOtherQueued ? 'Locked — in queue' : isConnectedElsewhere ? 'Connected elsewhere' : 'Join server'}
              </span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="border border-white/8 bg-white/5 px-3 py-2.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="Copy address"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
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
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {/* Connection */}
        <section className="rounded-lg border border-white/8 bg-black/20 p-3.5">
          <div className="mb-2.5 text-xs font-semibold text-white">Connection</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/5 px-3 py-2">
              <span className="text-slate-400 shrink-0">Address</span>
              <span className="font-mono text-white text-[11px] truncate ml-2">{server.ip}:{server.port}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <Wifi size={10} /> Access
                </div>
                <div className="text-xs font-medium text-white">{server.password ? 'Restricted' : 'Open join'}</div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  Version
                </div>
                <div className="text-xs font-medium text-white">{server.version || '—'}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Population */}
        <section className="rounded-lg border border-white/8 bg-black/20 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-white">Population</div>
            <div className="text-xs text-slate-400">{Math.round(fillPct)}% full</div>
          </div>
          <div className="pop-bar w-full">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${fillPct}%` }}
              transition={{ duration: 0.4 }}
              className={`pop-bar-fill ${popColor}`}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Current players</span>
            <span className="font-semibold text-white">{server.players}/{server.maxplayers}</span>
          </div>
        </section>

        {/* Online players */}
        {server.playerslist && (
          <section className="rounded-lg border border-white/8 bg-black/20 p-3.5">
            <div className="mb-2.5 text-xs font-semibold text-white">Online players</div>
            <div className="flex flex-wrap gap-1.5">
              {server.playerslist.split(';').filter(Boolean).map((name) => (
                <span key={name} className="rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                  {name}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Mods */}
        {server.modlist && (
          <section className="rounded-lg border border-white/8 bg-black/20 p-3.5">
            <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-white">
              <Package size={13} />
              Required mods
            </div>
            <div className="flex flex-wrap gap-1.5">
              {server.modlist.split(/[;,\n]+/).map((mod) => mod.trim()).filter(Boolean).map((mod) => (
                <span key={mod} className="rounded-full border border-white/8 bg-white/5 px-3 py-1 text-xs text-slate-300">
                  {mod}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Extra info */}
        <section className="rounded-lg border border-white/8 bg-black/20 p-3.5">
          <div className="mb-2.5 text-xs font-semibold text-white">Details</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Owner</span>
              <span className="text-white truncate">{server.owner || '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400 shrink-0">Guests</span>
              <span className={server.guests ? 'text-emerald-400' : 'text-rose-400'}>{server.guests ? 'Allowed' : 'No'}</span>
            </div>
            {server.tags && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 shrink-0">Tags</span>
                <span className="text-slate-300 truncate">{server.tags}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
