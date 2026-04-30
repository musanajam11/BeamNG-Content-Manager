import { useEffect, useState, useCallback, useRef } from 'react'
import { Play, X, MapPin, Users, Globe, Package, ShieldAlert, Lock, ImageIcon, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { JoinInvitePayload } from '../../../../shared/types'
import { useAppStore } from '../../stores/useAppStore'
import { cleanMapName } from '../../utils/countryFlags'
import { BeamMPText } from '../BeamMPText'

/**
 * Global handler for incoming `beammp-cm://join?...` invite links.
 *
 * Mounted once at the App root so it can intercept invites regardless of
 * which page the user is currently on. Always shows a confirmation card
 * with rich server info before any join — invites NEVER auto-connect, since
 * a webpage can trigger custom-protocol launches and we don't want a hostile
 * page to silently route users to malicious servers.
 *
 * Flow:
 *  1. On mount, pull any pending cold-start invite from main.
 *  2. Subscribe to live `invite:received` events for warm starts.
 *  3. When an invite arrives, probe the server (sname/map/players/...).
 *  4. User clicks Join → call `window.api.joinServer(ip, port)`.
 *
 * The `password` query param (if present) is shown to the user but NOT
 * automatically applied — joining a private server still requires the
 * existing in-app password flow. (We don't have a wire to pre-fill it yet,
 * but the user can copy it from the dialog.)
 */
interface ProbeInfo {
  online: boolean
  sname?: string
  map?: string
  players?: string
  maxplayers?: string
  modstotal?: string
  playerslist?: string
}

function isPrivateOrLoopback(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true
  if (host.startsWith('172.')) {
    const second = parseInt(host.split('.')[1] ?? '', 10)
    if (second >= 16 && second <= 31) return true
  }
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true
  if (/^fe80:/i.test(host)) return true
  return false
}

export function InviteJoinDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const setPage = useAppStore((s) => s.setPage)

  const [invite, setInvite] = useState<JoinInvitePayload | null>(null)
  const [probe, setProbe] = useState<ProbeInfo | null>(null)
  const [probing, setProbing] = useState(false)
  const [mapPreview, setMapPreview] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const probeReqId = useRef(0)

  // Reset transient state whenever a new invite is shown.
  useEffect(() => {
    if (!invite) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on new invite
    setProbe(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on new invite
    setMapPreview(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on new invite
    setJoinError(null)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on new invite
    setJoining(false)

    const reqId = ++probeReqId.current
    setProbing(true)
    window.api
      .probeServer(invite.ip, String(invite.port))
      .then((result) => {
        if (reqId !== probeReqId.current) return
        setProbe(result)
        if (result?.map) {
          window.api.getMapPreview(result.map).then((url) => {
            if (reqId !== probeReqId.current) return
            if (url) setMapPreview(url)
          }).catch(() => { /* preview is best-effort */ })
        }
      })
      .catch((err) => {
        if (reqId !== probeReqId.current) return
        console.warn('[invite] probe failed:', err)
        setProbe({ online: false })
      })
      .finally(() => {
        if (reqId !== probeReqId.current) return
        setProbing(false)
      })
  }, [invite])

  // Pull cold-start invite + subscribe to warm-start invites.
  useEffect(() => {
    let cancelled = false
    window.api.getPendingInvite().then((pending) => {
      if (!cancelled && pending) setInvite(pending)
    }).catch(() => { /* no pending */ })

    const off = window.api.onInviteReceived((next) => {
      setInvite(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const close = useCallback(() => {
    setInvite(null)
  }, [])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !joining) close()
  }, [close, joining])

  useEffect(() => {
    if (!invite) return undefined
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [invite, onKey])

  const handleJoin = useCallback(async () => {
    if (!invite) return
    setJoining(true)
    setJoinError(null)
    try {
      // Surface the join progress on the Servers page (where launcher errors
      // and "joining..." state already render) so the user has somewhere
      // useful to land if BeamMP needs interaction.
      setPage('servers')
      const result = await window.api.joinServer(invite.ip, invite.port)
      if (!result.success) {
        setJoinError(result.error || t('invite.joinFailed', 'Failed to join server'))
        setJoining(false)
        return
      }
      // Joined successfully — close the dialog.
      setInvite(null)
    } catch (err) {
      setJoinError(String(err))
      setJoining(false)
    }
  }, [invite, setPage, t])

  if (!invite) return null

  const displayName =
    probe?.sname?.trim() ||
    invite.name?.trim() ||
    `${invite.ip}:${invite.port}`
  const mapSlug = probe?.map || invite.map || ''
  const mapDisplay = mapSlug ? cleanMapName(mapSlug) : t('invite.unknownMap', 'Unknown map')
  const playersText =
    probe?.players != null && probe?.maxplayers != null
      ? `${probe.players}/${probe.maxplayers}`
      : '—'
  const modCount = parseInt(probe?.modstotal ?? '', 10) || 0
  const isModded = modCount > 0
  const isPrivateAddr = isPrivateOrLoopback(invite.ip)
  const playersList = (probe?.playerslist || '').split(';').filter(Boolean)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-[var(--color-scrim-60)] backdrop-blur-sm"
        onClick={joining ? undefined : close}
      />

      <div className="relative w-full max-w-md rounded-[28px] border border-[var(--color-border)] bg-[var(--color-base)] backdrop-blur-xl shadow-2xl overflow-hidden">
        {/* Hero / map preview */}
        <div className="relative h-32 overflow-hidden bg-gradient-to-br from-white/5 to-white/[0.02]">
          {mapPreview ? (
            <img
              src={mapPreview}
              alt={mapDisplay}
              className="absolute inset-0 w-full h-full object-cover opacity-60"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon size={32} className="text-[var(--color-text-dim)]" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-base)] via-[var(--color-base)]/60 to-transparent" />
          <div className="absolute top-3 left-4 right-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-hover)] bg-[var(--color-scrim-30)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-secondary)] backdrop-blur-sm">
              <Link2 size={11} />
              {t('invite.title', 'Join invite')}
            </div>
            <button
              onClick={close}
              disabled={joining}
              className="rounded-xl border border-[var(--color-border-hover)] bg-[var(--color-scrim-30)] p-1.5 text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] backdrop-blur-sm disabled:opacity-40"
              aria-label={t('common.close', 'Close')}
            >
              <X size={13} />
            </button>
          </div>
          <div className="absolute bottom-2.5 left-4 right-4 flex items-end gap-2">
            <MapPin size={12} className="text-[var(--color-accent-text)] shrink-0" />
            <span className="text-xs font-semibold text-[var(--color-text-primary)] drop-shadow truncate">
              {mapDisplay}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-3 px-6 py-5">
          <div>
            <BeamMPText
              text={displayName}
              className="text-base font-bold tracking-tight text-[var(--color-text-primary)] line-clamp-2"
            />
            {invite.from && (
              <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                {t('invite.from', 'Invited by')}{' '}
                <span className="font-medium text-[var(--color-text-primary)]">{invite.from}</span>
              </p>
            )}
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatPill icon={<Users size={10} />} label={t('servers.players')} value={playersText} />
            <StatPill icon={<Package size={10} />} label={t('invite.mods', 'Mods')} value={isModded ? String(modCount) : t('invite.none', 'None')} />
            <StatPill
              icon={<Globe size={10} />}
              label={t('invite.address', 'Address')}
              value={`${invite.ip}:${invite.port}`}
              mono
            />
            <StatPill
              icon={<MapPin size={10} />}
              label={t('servers.map')}
              value={mapDisplay}
            />
          </div>

          {/* Probe-status + warnings */}
          {probing && (
            <p className="text-[11px] text-[var(--color-text-secondary)] text-center">
              {t('invite.probing', 'Looking up server…')}
            </p>
          )}
          {!probing && probe && !probe.online && (
            <p className="text-[11px] text-amber-400 text-center">
              {t('invite.offline', 'Server is offline or unreachable. You can still try to join.')}
            </p>
          )}

          {invite.password && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
              <Lock size={12} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{t('invite.passwordProvided', 'Password provided')}</div>
                <div className="font-mono text-amber-100/90 break-all">{invite.password}</div>
                <div className="mt-1 text-amber-200/70">
                  {t('invite.passwordNote', 'Enter this when BeamMP prompts you.')}
                </div>
              </div>
            </div>
          )}

          {!isPrivateAddr && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              <span>
                {t(
                  'invite.publicWarn',
                  'This link points at a public address. Only join servers you trust — joining will download mods and run server-supplied scripts.'
                )}
              </span>
            </div>
          )}

          {playersList.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--color-text-secondary)]">
                {t('servers.onlinePlayers')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {playersList.slice(0, 12).map((name) => (
                  <span
                    key={name}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
                  >
                    {name}
                  </span>
                ))}
                {playersList.length > 12 && (
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                    +{playersList.length - 12}
                  </span>
                )}
              </div>
            </div>
          )}

          {joinError && (
            <p className="text-[11px] text-rose-400 text-center">{joinError}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={close}
              disabled={joining}
              className="flex items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-40"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleJoin}
              disabled={joining}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] accent-shadow transition hover:opacity-95 disabled:opacity-40"
            >
              <Play size={14} fill="currentColor" />
              {joining
                ? t('servers.joining')
                : t('invite.joinAction', 'Join server')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatPill({
  icon,
  label,
  value,
  mono
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6 }}
    >
      <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`text-xs font-semibold text-[var(--color-text-primary)] truncate ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
