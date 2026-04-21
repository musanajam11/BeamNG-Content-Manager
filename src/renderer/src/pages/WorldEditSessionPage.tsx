import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import {
  Radio,
  PlayCircle,
  StopCircle,
  LogIn,
  LogOut,
  Users,
  Copy,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Globe,
  Shield,
  ArrowLeft,
} from 'lucide-react'
import type { SessionStatus, SessionOp, SessionLogEntry, PeerPoseEntry, PeerActivity } from '../../../shared/types'

/**
 * World-Editor Multiplayer Session page.
 *
 * Phase 2/3 UI: host a local relay OR join an existing host, then watch
 * ops flow in both directions. Assumes the `beamcmEditorSync` Lua bridge
 * has been deployed from the Sync page — that's where the local TCP
 * loopback comes from.
 */

function pill(
  label: string,
  value: string,
  tone: 'good' | 'warn' | 'bad' | 'neutral' = 'neutral'
): React.JSX.Element {
  const cls =
    tone === 'good'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : tone === 'warn'
        ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
        : tone === 'bad'
          ? 'bg-red-500/15 text-red-400 border-red-500/30'
          : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]'
  return (
    <div key={label} className={`flex items-center justify-between px-3 py-2 rounded-lg border ${cls}`}>
      <span className="text-xs uppercase tracking-wide opacity-80">{label}</span>
      <span className="text-sm font-semibold tabular-nums break-all text-right ml-2">{value}</span>
    </div>
  )
}

function kindBadge(kind: SessionOp['kind']): React.JSX.Element {
  const cls =
    kind === 'do'
      ? 'text-green-400 border-green-500/30'
      : kind === 'undo'
        ? 'text-yellow-400 border-yellow-500/30'
        : 'text-blue-400 border-blue-500/30'
  return <span className={`px-1.5 py-0.5 text-[10px] rounded border ${cls}`}>{kind}</span>
}

// Invite code = base64(JSON({h, p, t?})) with a BEAMCM: prefix for copy/paste.
interface InvitePayload {
  host: string
  port: number
  token: string | null
}
function encodeInviteCode(p: InvitePayload): string {
  const json = JSON.stringify({ h: p.host, p: p.port, t: p.token || undefined })
  // btoa for ASCII; the fields are ASCII-only IPs/ports/tokens
  return `BEAMCM:${btoa(json)}`
}
function parseInviteCode(code: string): InvitePayload | null {
  try {
    let raw = code.trim()
    if (raw.toUpperCase().startsWith('BEAMCM:')) raw = raw.slice(7)
    const json = atob(raw)
    const obj = JSON.parse(json) as { h?: string; p?: number; t?: string | null }
    if (!obj.h || !obj.p) return null
    return { host: String(obj.h), port: Number(obj.p), token: obj.t ?? null }
  } catch {
    return null
  }
}

/**
 * Deterministic per-author color (CSS hsl). Used to color-code op stream rows,
 * peers-panel cards, and activity pulses so a glance tells you who did what.
 */
function authorColor(authorId: string): string {
  let h = 0
  for (let i = 0; i < authorId.length; i++) {
    h = (h * 31 + authorId.charCodeAt(i)) & 0xffff
  }
  return `hsl(${h % 360} 70% 60%)`
}

/** Human-friendly "8s ago" / "3m ago" time delta. */
function timeAgo(ts: number, now: number): string {
  const d = Math.max(0, Math.floor((now - ts) / 1000))
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  return `${Math.floor(d / 3600)}h ago`
}

export function WorldEditSessionPage(): React.JSX.Element {
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // UX mode: pick host OR join first (clearer than tabs)
  const [mode, setMode] = useState<'choose' | 'host' | 'join'>('choose')

  // Host form
  const [hostPort, setHostPort] = useState('45678')
  const [hostToken, setHostToken] = useState('')
  const [displayName, setDisplayName] = useState('Player')
  const [lanIps, setLanIps] = useState<string[]>([])
  const [publicIp, setPublicIp] = useState<string | null>(null)
  const [publicIpBusy, setPublicIpBusy] = useState(false)
  const [publicIpErr, setPublicIpErr] = useState<string | null>(null)

  // Tailscale (optional — only shown if installed and running)
  const [tsIp, setTsIp] = useState<string | null>(null)
  const [tsHostname, setTsHostname] = useState<string | null>(null)
  const [tsInstalled, setTsInstalled] = useState(false)
  const [tsRunning, setTsRunning] = useState(false)

  // Join form
  const [inviteCode, setInviteCode] = useState('')
  const [advancedJoin, setAdvancedJoin] = useState(false)
  const [joinHost, setJoinHost] = useState('')
  const [joinPort, setJoinPort] = useState('45678')
  const [joinToken, setJoinToken] = useState('')

  // Copy feedback
  const [copied, setCopied] = useState<string | null>(null)

  // Live op log
  const [ops, setOps] = useState<SessionOp[]>([])
  const opEndRef = useRef<HTMLDivElement | null>(null)

  // Server log (peer join/leave, relay start/stop, errors)
  const [logEntries, setLogEntries] = useState<SessionLogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // Peer presence (poses) + last-edit activity, keyed by authorId.
  const [poses, setPoses] = useState<Record<string, PeerPoseEntry>>({})
  const [activity, setActivity] = useState<Record<string, PeerActivity>>({})
  /** "Pulse" timestamp per authorId — drives the yellow flash animation. */
  const [activityPulse, setActivityPulse] = useState<Record<string, number>>({})
  // Tick once a second so "42s ago" labels stay fresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(h)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.worldEditSessionGetStatus()
      setStatus(s)
    } catch (e) {
      console.warn('getStatus failed', e)
    }
  }, [])

  useEffect(() => {
    refresh()
    const off1 = window.api.onWorldEditSessionStatus((s) => setStatus(s))
    const off2 = window.api.onWorldEditSessionOp((op) => {
      setOps((prev) => {
        const next = [...prev, op]
        return next.length > 500 ? next.slice(next.length - 500) : next
      })
    })
    const off3 = window.api.onWorldEditSessionLog?.((entry) => {
      setLogEntries((prev) => {
        const next = [...prev, entry]
        return next.length > 300 ? next.slice(next.length - 300) : next
      })
    })
    // Peer presence: live camera/vehicle pose from each participant (~5 Hz).
    const off4 = window.api.onWorldEditSessionPeerPose?.((pose) => {
      setPoses((prev) => ({ ...prev, [pose.authorId]: pose }))
    })
    // Peer edit activity: most-recent op per author + a timestamp we use to
    // trigger a brief yellow pulse on their row/card.
    const off5 = window.api.onWorldEditSessionPeerActivity?.((act) => {
      setActivity((prev) => ({ ...prev, [act.authorId]: act }))
      setActivityPulse((prev) => ({ ...prev, [act.authorId]: Date.now() }))
    })
    // Fetch LAN IPs for the Host panel (defensive: preload binding may be
    // missing if the main process was not restarted after adding it).
    window.api.worldEditSessionGetLanIps?.().then(setLanIps).catch(() => setLanIps([]))
    // Fetch Tailscale status — if the user has Tailscale running we can offer
    // a zero-config cross-network invite code using their tailnet IP.
    window.api
      .getTailscaleStatus?.()
      .then((ts) => {
        if (!ts) return
        setTsInstalled(ts.installed)
        setTsRunning(ts.running)
        if (ts.running && ts.ip) setTsIp(ts.ip)
        if (ts.hostname) setTsHostname(ts.hostname)
      })
      .catch(() => {
        /* no tailscale, that's fine */
      })
    return () => {
      off1?.()
      off2?.()
      off3?.()
      off4?.()
      off5?.()
    }
  }, [refresh])

  useEffect(() => {
    opEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [ops.length])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logEntries.length])

  const onDetectPublicIp = async (): Promise<void> => {
    setPublicIpBusy(true)
    setPublicIpErr(null)
    try {
      const res = await window.api.worldEditSessionGetPublicIp?.()
      if (!res) {
        setPublicIpErr('Public-IP lookup unavailable — restart CM to pick up the new binding.')
        return
      }
      if (res.ip) setPublicIp(res.ip)
      else setPublicIpErr(res.error || 'lookup failed')
    } catch (e) {
      setPublicIpErr(String(e))
    } finally {
      setPublicIpBusy(false)
    }
  }

  const onHost = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const port = Number.parseInt(hostPort, 10)
      const res = await window.api.worldEditSessionHost({
        port: Number.isFinite(port) && port > 0 ? port : undefined,
        token: hostToken.trim() || null,
        displayName: displayName.trim() || undefined,
      })
      if (!res.success) setErr(res.error || 'host failed')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onJoin = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      // Parse either advanced fields or invite code
      let host = joinHost.trim()
      let port = Number.parseInt(joinPort, 10)
      let token: string | null = joinToken.trim() || null
      if (!advancedJoin) {
        const parsed = parseInviteCode(inviteCode.trim())
        if (!parsed) {
          setErr('Invalid invite code — paste the full BEAMCM:… string from the host')
          return
        }
        host = parsed.host
        port = parsed.port
        token = parsed.token
      }
      if (!host) {
        setErr('Missing host address')
        return
      }
      if (!Number.isFinite(port) || port <= 0) {
        setErr('Invalid port')
        return
      }
      const res = await window.api.worldEditSessionJoin({
        host,
        port,
        token,
        displayName: displayName.trim() || undefined,
      })
      if (!res.success) setErr(res.error || 'join failed')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Pending "copied!" timer so we can clear it on unmount and avoid a
  // setState-on-unmounted warning when the user navigates away within 1.5 s.
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])
  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopied((p) => (p === label ? null : p))
      copiedTimerRef.current = null
    }, 1500)
  }, [])

  const onLeave = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      await window.api.worldEditSessionLeave()
      // Wipe everything tied to the prior session so the page starts fresh
      // when the user hosts/joins again. Without this the Peers panel would
      // keep showing 'idle' rows and the Session log would carry over.
      setOps([])
      setLogEntries([])
      setPoses({})
      setActivity({})
      setActivityPulse({})
    } finally {
      setBusy(false)
    }
  }

  /**
   * Launch BeamNG.drive directly into the World Editor for this session.
   * Uses the session's level (host's own when hosting; host-supplied via
   * welcome frame when joined). Editor opens automatically once the level
   * finishes loading via the editor_autostart signal.
   */
  const onLaunchIntoEditor = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const fn = window.api.worldEditSessionLaunchIntoEditor
      if (!fn) {
        setErr('Launch-into-editor binding unavailable — restart CM to pick it up.')
        return
      }
      const res = await fn()
      if (!res.success) setErr(res.error ?? 'Launch failed')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const s = status
  const isIdle = !s || s.state === 'idle'
  const isHosting = s?.state === 'hosting'
  const isJoined = s?.state === 'joined'
  const isConnecting = s?.state === 'connecting'

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center gap-3">
        <Radio size={18} className="text-[var(--color-accent)]" />
        <h2 className="text-base font-semibold">Multiplayer session</h2>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">
        Collaborative world-editor sessions run <strong>peer-to-peer between two CM installs</strong>
        over a direct TCP socket — no BeamMP server, no accounts. One person hosts, others
        join with an invite code.
      </p>

      {err && (
        <div className="flex gap-2 items-start p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span className="font-mono break-all">{err}</span>
        </div>
      )}

      {/* Status pills — only when a session is active */}
      {(isHosting || isJoined || isConnecting) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {pill(
            'State',
            s?.state.toUpperCase() ?? 'IDLE',
            isHosting || isJoined ? 'good' : isConnecting ? 'warn' : 'neutral'
          )}
          {pill('Bridge', s?.bridgeReady ? 'Lua connected' : 'Lua offline', s?.bridgeReady ? 'good' : 'warn')}
          {pill('Peers', String(s?.peers.length ?? 0), 'neutral')}
          {pill('Level', s?.levelName || '—', s?.levelName ? 'good' : 'warn')}
          {pill('Ops sent', String(s?.opsIn ?? 0), 'neutral')}
          {pill('Ops received', String(s?.opsOut ?? 0), 'neutral')}
          {pill('Seq', String(s?.lastSeq ?? 0), 'neutral')}
          {s?.host ? pill('Address', s.host, 'neutral') : pill('Address', '—', 'neutral')}
        </div>
      )}

      {/* Peers list */}
      {s && s.peers.length > 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <Users size={14} /> Connected peers
          </div>
          <div className="space-y-1">
            {s.peers.map((p) => (
              <div key={p.authorId} className="flex items-center justify-between text-xs font-mono">
                <span>{p.displayName}</span>
                <span className="text-[var(--color-text-muted)]">{p.remote ?? p.authorId.substring(0, 8)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bridge readiness warning */}
      {(isIdle || isConnecting) && s && !s.bridgeReady && (
        <div className="flex gap-2 items-start p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">BeamNG bridge is offline</div>
            <div className="text-xs opacity-80">
              You can still start a session, but nothing will sync until BeamNG is launched via the
              BeamCM launcher <em>and</em> the World Editor is open (<kbd>F11</kbd>). Deploy the
              Sync extension from the tab above first.
            </div>
          </div>
        </div>
      )}

      {/* Mode chooser */}
      {isIdle && mode === 'choose' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => setMode('host')}
            className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-green-500/50 hover:bg-green-500/5 text-left transition-colors group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded bg-green-500/15 text-green-400 group-hover:bg-green-500/25">
                <PlayCircle size={20} />
              </div>
              <span className="text-base font-semibold">Host a session</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Open your CM to peers over a direct TCP port. You'll get an <strong>invite code</strong> to
              share. Whatever map you have loaded in BeamNG is what gets edited together.
            </p>
          </button>
          <button
            onClick={() => setMode('join')}
            className="p-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-blue-500/50 hover:bg-blue-500/5 text-left transition-colors group"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded bg-blue-500/15 text-blue-400 group-hover:bg-blue-500/25">
                <LogIn size={20} />
              </div>
              <span className="text-base font-semibold">Join a session</span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Paste an invite code a host shared with you. Your BeamNG should be on the
              same map (the host's current level will be shown after you connect).
            </p>
          </button>
        </div>
      )}

      {/* Host form */}
      {isIdle && mode === 'host' && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
          <button
            onClick={() => setMode('choose')}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> Back
          </button>

          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
              <PlayCircle size={16} className="text-green-400" /> Host an editing session
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Peer-to-peer over a raw TCP port — no BeamMP server, no accounts. You'll share an
              invite code.
            </p>
          </div>

          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-200/90 space-y-1">
            <div className="font-semibold flex items-center gap-1">
              <Shield size={12} /> Same requirements as running a BeamMP server
            </div>
            <div>
              Your router must forward <span className="font-mono">TCP {hostPort}</span> to this
              machine so peers outside your LAN can reach you. Alternatively put both machines on
              Tailscale / Hamachi and share the VPN IP.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs space-y-1">
              <span className="text-[var(--color-text-muted)]">Your display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"
              />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-[var(--color-text-muted)]">Listen port</span>
              <input
                value={hostPort}
                onChange={(e) => setHostPort(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
              />
            </label>
            <label className="text-xs space-y-1 md:col-span-2">
              <span className="text-[var(--color-text-muted)]">
                Access token (optional — peers without it will be refused)
              </span>
              <input
                value={hostToken}
                onChange={(e) => setHostToken(e.target.value)}
                placeholder="leave blank for open session"
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
              />
            </label>
          </div>

          {lanIps.length > 0 && (
            <div className="text-xs text-[var(--color-text-muted)] space-y-0.5">
              <div className="inline-flex items-center gap-1">
                <Globe size={12} /> Your LAN addresses:
              </div>
              <div className="font-mono pl-4">{lanIps.join(', ')}</div>
            </div>
          )}

          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs">
                <div className="font-semibold inline-flex items-center gap-1">
                  <Globe size={12} /> Public (internet-facing) IP
                </div>
                <div className="text-[var(--color-text-muted)]">
                  {publicIp ? (
                    <>Detected: <span className="font-mono text-[var(--color-text)]">{publicIp}</span></>
                  ) : publicIpErr ? (
                    <span className="text-red-400">{publicIpErr}</span>
                  ) : (
                    'Peers on the internet will need this, plus port-forwarding.'
                  )}
                </div>
              </div>
              <button
                onClick={() => void onDetectPublicIp()}
                disabled={publicIpBusy}
                className="px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-xs inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
              >
                {publicIpBusy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                {publicIp ? 'Re-detect' : 'Detect public IP'}
              </button>
            </div>
          </div>

          {tsRunning && tsIp ? (
            <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 text-xs space-y-1">
              <div className="font-semibold text-purple-300 inline-flex items-center gap-1">
                <Shield size={12} /> Tailscale detected — zero-config invites ready
              </div>
              <div className="text-[var(--color-text-muted)]">
                Your tailnet IP <span className="font-mono text-[var(--color-text)]">{tsIp}</span>
                {tsHostname && <> (<span className="font-mono">{tsHostname}</span>)</>}
                {' '}will be included as an invite code. Any peer logged into the same tailnet
                can join <strong>without port-forwarding</strong>.
              </div>
            </div>
          ) : tsInstalled ? (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs text-[var(--color-text-muted)]">
              <Shield size={12} className="inline mb-0.5" /> Tailscale is installed but not
              running — start it to get a zero-config cross-network invite code.
            </div>
          ) : null}

          <button
            disabled={busy}
            onClick={onHost}
            className="w-full px-4 py-2.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            Start hosting
          </button>
        </div>
      )}

      {/* Join form */}
      {(isIdle || isConnecting) && mode === 'join' && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
          <button
            onClick={() => setMode('choose')}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] inline-flex items-center gap-1"
          >
            <ArrowLeft size={12} /> Back
          </button>

          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
              <LogIn size={16} className="text-blue-400" /> Join a session
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Paste the <code>BEAMCM:…</code> invite code the host shared with you.
              Use Advanced if you only have raw IP/port details.
            </p>
          </div>

          <label className="text-xs space-y-1 block">
            <span className="text-[var(--color-text-muted)]">Your display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"
            />
          </label>

          {!advancedJoin ? (
            <label className="text-xs space-y-1 block">
              <span className="text-[var(--color-text-muted)]">Invite code</span>
              <textarea
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="BEAMCM:eyJoIjoiMTkyLjE2OC4xLjEwIiwicCI6NDU2Nzh9"
                rows={3}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px]"
              />
            </label>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-[var(--color-text-muted)]">Host address</span>
                <input
                  value={joinHost}
                  onChange={(e) => setJoinHost(e.target.value)}
                  placeholder="192.168.1.10"
                  className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--color-text-muted)]">Port</span>
                <input
                  value={joinPort}
                  onChange={(e) => setJoinPort(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-[var(--color-text-muted)]">Token (optional)</span>
                <input
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
                />
              </label>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setAdvancedJoin((v) => !v)}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
            >
              {advancedJoin ? 'Use invite code instead' : 'Advanced: enter IP / port manually'}
            </button>
            <button
              disabled={busy || isConnecting}
              onClick={onJoin}
              className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2"
            >
              {busy || isConnecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <LogIn size={14} />
              )}
              {isConnecting ? 'Connecting…' : 'Join session'}
            </button>
          </div>
        </div>
      )}

      {/* Active session: hosting */}
      {isHosting && (
        <InvitePanel
          status={s!}
          hostToken={s?.token ?? hostToken}
          lanIps={lanIps}
          publicIp={publicIp}
          tsIp={tsIp}
          tsHostname={tsHostname}
          onDetectPublicIp={onDetectPublicIp}
          publicIpBusy={publicIpBusy}
          publicIpErr={publicIpErr}
          onCopy={copyToClipboard}
          copied={copied}
          onLeave={onLeave}
          onLaunchIntoEditor={onLaunchIntoEditor}
          busy={busy}
        />
      )}

      {/* Active session: joined */}
      {isJoined && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-400">
              <CheckCircle2 size={16} /> Connected
            </div>
            <div className="text-xs text-[var(--color-text-muted)] font-mono">{s?.host}</div>
            {s?.levelName && (
              <div className="text-xs text-[var(--color-text-muted)]">
                Level: <span className="font-mono text-[var(--color-text)]">{s.levelName}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              disabled={busy || !s?.levelName}
              onClick={onLaunchIntoEditor}
              title={
                s?.levelName
                  ? `Launch BeamNG and open the World Editor on "${s.levelName}"`
                  : 'Waiting for host to report a level…'
              }
              className="px-3 py-1.5 rounded bg-[var(--color-accent)] hover:opacity-90 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50"
            >
              <PlayCircle size={14} /> Launch into editor
            </button>
            <button
              disabled={busy}
              onClick={onLeave}
              className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm inline-flex items-center gap-1"
            >
              <LogOut size={14} /> Leave
            </button>
          </div>
        </div>
      )}

      {/* Server log — peer connect/disconnect, relay lifecycle, errors */}
      {(isHosting || isJoined || logEntries.length > 0) && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <div className="text-sm font-semibold">
              Session log{' '}
              <span className="text-[var(--color-text-muted)] font-normal">
                ({logEntries.length})
              </span>
            </div>
            <button
              onClick={() => setLogEntries([])}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto font-mono text-xs">
            {logEntries.length === 0 ? (
              <div className="p-3 text-[var(--color-text-muted)]">
                No events yet. Peer joins, leaves, and errors will show up here.
              </div>
            ) : (
              <div>
                {logEntries.map((e, i) => (
                  <div
                    key={`${e.ts}-${i}`}
                    className="grid grid-cols-[90px_60px_60px_1fr] gap-2 px-3 py-1 border-b border-[var(--color-border)]/40 items-center"
                  >
                    <span className="text-[var(--color-text-muted)] tabular-nums">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        e.level === 'error'
                          ? 'text-red-400 uppercase text-[10px]'
                          : e.level === 'warn'
                            ? 'text-yellow-400 uppercase text-[10px]'
                            : 'text-[var(--color-text-muted)] uppercase text-[10px]'
                      }
                    >
                      {e.level}
                    </span>
                    <span className="text-[var(--color-accent)] text-[10px]">{e.source}</span>
                    <span className="break-all">{e.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Peers panel — live presence (camera/vehicle pose) + last-edit */}
      <PeersPanel
        poses={poses}
        activity={activity}
        activityPulse={activityPulse}
        selfLevel={Object.values(poses).find((p) => p.self)?.levelName ?? null}
        now={now}
      />

      {/* Op stream */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold">Op stream ({ops.length})</div>
          <button
            onClick={() => setOps([])}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Clear
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto font-mono text-xs">
          {ops.length === 0 ? (
            <div className="p-3 text-[var(--color-text-muted)]">
              No ops yet. Start editing in BeamNG while a session is live.
            </div>
          ) : (
            <div>
              {ops.map((op, i) => {
                const color = authorColor(op.authorId)
                const peerName =
                  poses[op.authorId]?.displayName ??
                  activity[op.authorId]?.displayName ??
                  op.authorId.substring(0, 8)
                return (
                  <div
                    key={`${op.seq}-${i}`}
                    className="grid grid-cols-[60px_40px_90px_1fr] gap-2 px-3 py-1 border-b border-[var(--color-border)]/40 items-center"
                    style={{ borderLeft: `3px solid ${color}` }}
                  >
                    <span className="text-[var(--color-text-muted)] tabular-nums">#{op.seq}</span>
                    <span>{kindBadge(op.kind)}</span>
                    <span className="truncate" title={op.authorId} style={{ color }}>
                      {peerName}
                    </span>
                    <span className="truncate">
                      <span className="text-[var(--color-accent)]">{op.name ?? op.kind}</span>
                      {op.detail && <span className="text-[var(--color-text-muted)]"> — {op.detail}</span>}
                    </span>
                  </div>
                )
              })}
              <div ref={opEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Invite panel (shown while hosting) ────────────────────────────────────

interface InvitePanelProps {
  status: SessionStatus
  hostToken: string
  lanIps: string[]
  publicIp: string | null
  tsIp: string | null
  tsHostname: string | null
  onDetectPublicIp: () => void | Promise<void>
  publicIpBusy: boolean
  publicIpErr: string | null
  onCopy: (text: string, label: string) => void
  copied: string | null
  onLeave: () => void | Promise<void>
  /** Launch BeamNG.drive directly into the World Editor on the session level. */
  onLaunchIntoEditor: () => void | Promise<void>
  busy: boolean
}

// ─── Peers panel ───────────────────────────────────────────────────────────

interface PeersPanelProps {
  poses: Record<string, PeerPoseEntry>
  activity: Record<string, PeerActivity>
  activityPulse: Record<string, number>
  /** The local user's current level, for mismatched-level warnings. */
  selfLevel: string | null
  now: number
}

/**
 * Shows everyone currently in the session — their display name, position,
 * whether they're in a vehicle, what their last edit was, and (for peers) a
 * warning if they're on a different level than the local user.
 *
 * Each participant gets a deterministic color (shared with the op stream) so
 * you can visually match activity to people.
 */
function PeersPanel({
  poses,
  activity,
  activityPulse,
  selfLevel,
  now
}: PeersPanelProps): React.JSX.Element | null {
  // Union of everyone we've seen — a peer who hasn't sent pose yet but has
  // produced ops still deserves a row.
  const ids = useMemo(() => {
    const s = new Set<string>()
    for (const id of Object.keys(poses)) s.add(id)
    for (const id of Object.keys(activity)) s.add(id)
    return Array.from(s)
  }, [poses, activity])

  if (ids.length === 0) return null

  // Self first, then by most-recent activity, then by name.
  const ordered = [...ids].sort((a, b) => {
    const selfA = poses[a]?.self ? 1 : 0
    const selfB = poses[b]?.self ? 1 : 0
    if (selfA !== selfB) return selfB - selfA
    const ta = Math.max(activity[a]?.ts ?? 0, poses[a]?.ts ?? 0)
    const tb = Math.max(activity[b]?.ts ?? 0, poses[b]?.ts ?? 0)
    return tb - ta
  })

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div className="text-sm font-semibold">Peers ({ids.length})</div>
        <div className="text-xs text-[var(--color-text-muted)]">Live pose · ~5 Hz</div>
      </div>
      <div className="divide-y divide-[var(--color-border)]/40">
        {ordered.map((id) => {
          const pose = poses[id]
          const act = activity[id]
          const color = authorColor(id)
          const name =
            pose?.displayName ?? act?.displayName ?? id.substring(0, 8)
          const pulseAge = now - (activityPulse[id] ?? 0)
          const pulsing = pulseAge < 1500
          const staleMs = pose ? now - pose.ts : Infinity
          const stale = !pose?.self && staleMs > 5000
          const wrongLevel =
            !pose?.self &&
            pose?.levelName &&
            selfLevel &&
            pose.levelName !== selfLevel
          return (
            <div
              key={id}
              className="px-3 py-2 flex items-center gap-3 transition-colors"
              style={{
                borderLeft: `4px solid ${color}`,
                backgroundColor: pulsing ? 'rgba(250, 204, 21, 0.10)' : undefined
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate" style={{ color }} title={id}>
                    {name}
                  </span>
                  {pose?.self && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                      you
                    </span>
                  )}
                  {pose?.inVehicle && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-bg)] text-[var(--color-text-muted)]" title={pose.vehicle || 'in vehicle'}>
                      🚗 {pose.vehicle ? pose.vehicle.replace(/^vehicles\//, '').replace(/\.jbeam$/, '') : 'vehicle'}
                    </span>
                  )}
                  {stale && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-bg)] text-[var(--color-text-muted)]">
                      idle
                    </span>
                  )}
                  {wrongLevel && (
                    <span
                      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400"
                      title={`They are on "${pose?.levelName}", you are on "${selfLevel}"`}
                    >
                      different level
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] font-mono mt-0.5">
                  {pose ? (
                    <>
                      pos {pose.x.toFixed(1)}, {pose.y.toFixed(1)}, {pose.z.toFixed(1)}
                      {pose.levelName && <> · {pose.levelName}</>}
                    </>
                  ) : (
                    'no pose yet'
                  )}
                </div>
                {act && (
                  <div className="text-xs mt-0.5 truncate">
                    <span className="text-[var(--color-text-muted)]">last edit: </span>
                    <span className="text-[var(--color-accent)]">{act.name ?? act.kind}</span>
                    {act.detail && <span className="text-[var(--color-text-muted)]"> — {act.detail}</span>}
                    <span className="text-[var(--color-text-muted)]"> · {timeAgo(act.ts, now)}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function InvitePanel({
  status,
  hostToken,
  lanIps,
  publicIp,
  tsIp,
  tsHostname,
  onDetectPublicIp,
  publicIpBusy,
  publicIpErr,
  onCopy,
  copied,
  onLeave,
  onLaunchIntoEditor,
  busy,
}: InvitePanelProps): React.JSX.Element {
  const port = status.port ?? 45678
  const token = hostToken.trim() || null

  // Build list of invite codes: public IP first (primary — works across the
  // internet), Tailscale (zero-config cross-network), then LAN IPs, then
  // loopback (for local 2-instance smoke tests on one PC).
  interface Entry {
    ip: string
    code: string
    label: string
    tone: 'primary' | 'tailscale' | 'lan' | 'loopback'
  }
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    if (publicIp) {
      out.push({
        ip: publicIp,
        code: encodeInviteCode({ host: publicIp, port, token }),
        label: 'For peers on the internet (requires port-forwarding)',
        tone: 'primary',
      })
    }
    if (tsIp) {
      out.push({
        ip: tsIp,
        code: encodeInviteCode({ host: tsIp, port, token }),
        label: tsHostname
          ? `Tailscale (${tsHostname}) — any peer on your tailnet, no port-forwarding`
          : 'Tailscale — any peer on your tailnet, no port-forwarding',
        tone: 'tailscale',
      })
    }
    for (const ip of lanIps) {
      // Skip if duplicated by Tailscale (tailscale IPs sometimes also appear
      // in os.networkInterfaces()).
      if (ip === tsIp) continue
      out.push({
        ip,
        code: encodeInviteCode({ host: ip, port, token }),
        label: 'For peers on your LAN / Hamachi',
        tone: 'lan',
      })
    }
    out.push({
      ip: '127.0.0.1',
      code: encodeInviteCode({ host: '127.0.0.1', port, token }),
      label: 'Local loopback (testing two CM instances on this PC)',
      tone: 'loopback',
    })
    return out
  }, [publicIp, tsIp, tsHostname, lanIps, port, token])

  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-green-400">
            <CheckCircle2 size={16} /> Hosting session
          </div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">
            Listening on <span className="font-mono">0.0.0.0:{port}</span>
            {token && <> · <Shield size={10} className="inline mb-0.5" /> token required</>}
            {status.levelName && (
              <> · level <span className="font-mono text-[var(--color-text)]">{status.levelName}</span></>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            disabled={busy}
            onClick={() => void onLaunchIntoEditor()}
            title="Launch BeamNG.drive and open the World Editor automatically"
            className="px-3 py-1.5 rounded bg-[var(--color-accent)] hover:opacity-90 text-white text-sm inline-flex items-center gap-1"
          >
            <PlayCircle size={14} /> Launch into editor
          </button>
          <button
            disabled={busy}
            onClick={() => void onLeave()}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-sm inline-flex items-center gap-1"
          >
            <StopCircle size={14} /> Stop hosting
          </button>
        </div>
      </div>

      {!publicIp && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold text-yellow-300 flex items-center gap-1">
              <AlertCircle size={12} /> No public invite code yet
            </div>
            <div className="text-[var(--color-text-muted)]">
              To invite peers outside your LAN, detect your public IP first. You'll still need
              to forward <span className="font-mono">TCP {port}</span> on your router.
              {publicIpErr && (
                <div className="text-red-400 font-mono mt-1">{publicIpErr}</div>
              )}
            </div>
          </div>
          <button
            onClick={() => void onDetectPublicIp()}
            disabled={publicIpBusy}
            className="px-3 py-1.5 rounded border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 text-xs inline-flex items-center gap-1 shrink-0 h-[30px] disabled:opacity-50"
          >
            {publicIpBusy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
            Detect public IP
          </button>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
          Share an invite code with your peers
        </div>
        {entries.map(({ ip, code, label, tone }) => (
          <div key={ip} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-[var(--color-text-muted)] mb-0.5 flex items-center gap-1">
                <span
                  className={
                    tone === 'primary'
                      ? 'px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-semibold'
                      : tone === 'tailscale'
                        ? 'px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-semibold'
                        : tone === 'lan'
                          ? 'px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300'
                          : 'px-1.5 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)]'
                  }
                >
                  {tone === 'primary'
                    ? 'INTERNET'
                    : tone === 'tailscale'
                      ? 'TAILSCALE'
                      : tone === 'lan'
                        ? 'LAN'
                        : 'LOCAL'}
                </span>
                <span>
                  <span className="font-mono">{ip}</span> — {label}
                </span>
              </div>
              <input
                readOnly
                value={code}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px]"
              />
            </div>
            <button
              onClick={() => onCopy(code, ip)}
              className="px-3 py-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-green-500/40 text-xs inline-flex items-center gap-1 shrink-0 h-[34px] mt-4"
            >
              {copied === ip ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied === ip ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
