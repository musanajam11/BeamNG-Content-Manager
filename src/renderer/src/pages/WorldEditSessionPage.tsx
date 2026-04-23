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
  MapPin,
  Undo2,
  Redo2,
  Save,
  Package,
  Download,
  Circle,
} from 'lucide-react'
import type { SessionStatus, SessionOp, PeerPoseEntry, PeerActivity } from '../../../shared/types'
import { useNow } from '../hooks/useNow'
import { useWorldEditSessionStore } from '../stores/useWorldEditSessionStore'

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

export interface WorldEditSessionPageProps {
  /**
   * Bridge readiness signals from the parent's worldEditGetStatus poll. Used
   * to drive the project browser modal (gates Load/Capture buttons) and to
   * label the active-project chip with the current BeamNG level.
   */
  bridgeEditorPresent?: boolean
  bridgeCurrentLevel?: string | null
  /** Whether the Lua extension is hooked (ready to capture). */
  bridgeHooked?: boolean
  /** Whether the Lua extension is currently capturing ops to disk. */
  bridgeCapturing?: boolean
}

export function WorldEditSessionPage(
  props: WorldEditSessionPageProps = {}
): React.JSX.Element {
  const {
    bridgeEditorPresent = false,
    bridgeHooked = false,
    bridgeCapturing = false,
  } = props
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // UX mode: pick host OR join first (clearer than tabs)
  const [mode, setMode] = useState<'choose' | 'host' | 'join'>('choose')

  // Host-toggleable auth mode (open / token / approval / friends)
  const [authMode, setAuthMode] = useState<'open' | 'token' | 'approval' | 'friends'>('token')
  const [friendsWhitelistText, setFriendsWhitelistText] = useState('')

  // Host-advertise address (picked from getHostAddresses — tailscale/public/lan/loopback)
  const [hostAddresses, setHostAddresses] = useState<Array<{
    kind: 'tailscale' | 'lan' | 'public' | 'loopback'
    address: string
    label: string
    recommended: boolean
  }>>([])
  const [advertiseHost, setAdvertiseHost] = useState<string>('')

  // Pending approvals (host) and level-required prompt (joiner)
  const [pendingApprovals, setPendingApprovals] = useState<Array<{
    authorId: string; displayName: string; beamUsername: string | null; remote: string
  }>>([])
  const [levelRequired, setLevelRequired] = useState<{
    levelName: string | null
    levelSource: { builtIn: boolean; modPath?: string; hash?: string } | null
  } | null>(null)

  // Host form
  const [hostPort, setHostPort] = useState('45678')
  const [hostToken, setHostToken] = useState('')
  const [hostLevel, setHostLevel] = useState('')
  const [availableMaps, setAvailableMaps] = useState<
    Array<{ name: string; source: 'stock' | 'mod'; levelDir?: string }>
  >([])
  const [displayName, setDisplayName] = useState('Player')
  const [lanIps, setLanIps] = useState<string[]>([])
  const [publicIp, setPublicIp] = useState<string | null>(null)
  const [publicIpBusy, setPublicIpBusy] = useState(false)
  const [publicIpErr, setPublicIpErr] = useState<string | null>(null)

  // Windows Firewall hole for the listen port — Electron's auto-prompt only
  // covers our app binary on the active LAN profile and silently misses the
  // Tailscale wintun interface, so we offer a one-click port-based allow rule.
  const [firewallSupported, setFirewallSupported] = useState(false)
  const [firewallExists, setFirewallExists] = useState<boolean | null>(null)
  const [firewallBusy, setFirewallBusy] = useState(false)
  const [firewallMsg, setFirewallMsg] = useState<string | null>(null)

  // Reachability self-test — tries a TCP connect to the advertised host:port
  // so the host can verify packets actually reach the listener before sharing
  // the invite. Especially useful for Tailscale (hairpin TCP to own 100.x IP
  // exercises the wintun adapter + firewall exactly like a remote peer).
  const [reachBusy, setReachBusy] = useState(false)
  const [reachResult, setReachResult] = useState<
    | { kind: 'ok'; latencyMs: number }
    | { kind: 'err'; message: string }
    | null
  >(null)

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

  // Live op log + server log + peer presence + per-author activity all live
  // in a Zustand store so they survive navigating away from this page mid
  // session. The IPC subscriptions that feed the store are wired once at the
  // App-shell level (see App.tsx) for the same reason.
  const ops = useWorldEditSessionStore((s) => s.ops)
  const logEntries = useWorldEditSessionStore((s) => s.logEntries)
  const poses = useWorldEditSessionStore((s) => s.poses)
  const activity = useWorldEditSessionStore((s) => s.activity)
  const activityPulse = useWorldEditSessionStore((s) => s.activityPulse)
  const opEndRef = useRef<HTMLDivElement | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  // Tick once a second so "42s ago" labels stay fresh — shared global timer.
  const now = useNow()

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
    // NOTE: op / log / peer-pose / peer-activity subscriptions live at the
    // App level so the store keeps growing while the user is on another
    // page. We only need the status subscription here for local UI state.
    // Fetch LAN IPs for the Host panel (defensive: preload binding may be
    // missing if the main process was not restarted after adding it).
    window.api.worldEditSessionGetLanIps?.().then(setLanIps).catch(() => setLanIps([]))
    // Populate the host-side level dropdown so users can pick the map up
    // front (same UX as making a BeamMP server). Sorted by name in main.
    window.api
      .listMaps?.()
      .then((maps) => setAvailableMaps(maps ?? []))
      .catch(() => setAvailableMaps([]))
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
    // Fetch the host-address picker list so the user can advertise the right IP.
    window.api.worldEditSessionGetHostAddresses?.()
      .then((addrs) => {
        setHostAddresses(addrs ?? [])
        // Default to the first recommended entry (tailscale > public > LAN > loopback).
        const rec = addrs?.find((a) => a.recommended) ?? addrs?.[0]
        if (rec) setAdvertiseHost(rec.address)
      })
      .catch(() => setHostAddresses([]))
    // Keep pendingApprovals in sync with status pushes.
    const offStatus = window.api.onWorldEditSessionStatus?.((st) => {
      if (st.pendingApprovals) setPendingApprovals(st.pendingApprovals)
    })
    // Push events for newly parked joiners + level-mismatch prompts.
    const offPend = window.api.onWorldEditSessionPeerPendingApproval?.((p) => {
      setPendingApprovals((prev) => prev.some((x) => x.authorId === p.authorId) ? prev : [...prev, p])
    })
    const offLvl = window.api.onWorldEditSessionLevelRequired?.((info) => {
      setLevelRequired(info)
    })
    return () => {
      off1?.()
      offStatus?.()
      offPend?.()
      offLvl?.()
    }
  }, [refresh])

  useEffect(() => {
    opEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [ops.length])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' })
  }, [logEntries.length])
  /* ── Auto-start capture: when we start hosting with a bridge + known
   *    level, kick off the capture log so the snapshot pipeline has a
   *    feed of ops to relay to joiners. We deliberately do NOT auto-
   *    create a project zip / advertise it: the project zip was a dead
   *    feature — joiners get caught up entirely via the snapshot
   *    pipeline (scene graph, fields, objects, env, terrain, forest),
   *    not by downloading a stale zip of the host's level folder. */
  const autoProvisionedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!status || status.state !== 'hosting') {
      autoProvisionedRef.current = null
      return
    }
    if (!status.bridgeReady || !status.levelName) return
    const sessionKey = `${status.sessionId ?? ''}|${status.host ?? ''}|${status.port ?? ''}`
    if (autoProvisionedRef.current === sessionKey) return
    autoProvisionedRef.current = sessionKey
    void window.api.worldEditSignal?.('start').catch(() => undefined)
  }, [status?.state, status?.bridgeReady, status?.levelName, status?.sessionId, status?.host, status?.port])

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

  // Re-check the firewall-rule presence whenever the port changes (no admin
  // needed for the read). The button is only useful on Windows hosts.
  useEffect(() => {
    let cancelled = false
    const portNum = Number.parseInt(hostPort, 10)
    if (!Number.isFinite(portNum) || portNum <= 0) {
      setFirewallSupported(false)
      setFirewallExists(null)
      return
    }
    void window.api
      .worldEditSessionCheckFirewallHole?.(portNum)
      .then((res) => {
        if (cancelled || !res) return
        setFirewallSupported(res.supported)
        setFirewallExists(res.supported ? !!res.exists : null)
      })
      .catch(() => {
        if (!cancelled) setFirewallSupported(false)
      })
    return () => {
      cancelled = true
    }
  }, [hostPort])

  const onOpenFirewallHole = async (): Promise<void> => {
    const portNum = Number.parseInt(hostPort, 10)
    if (!Number.isFinite(portNum) || portNum <= 0) {
      setFirewallMsg('Invalid port')
      return
    }
    setFirewallBusy(true)
    setFirewallMsg(null)
    try {
      const res = await window.api.worldEditSessionOpenFirewallHole?.(portNum)
      if (!res) {
        setFirewallMsg('Firewall helper unavailable — restart CM.')
      } else if (res.success) {
        setFirewallExists(true)
        setFirewallMsg('Firewall rule added — peers can now reach this port.')
      } else if (res.cancelled) {
        setFirewallMsg('UAC prompt was cancelled.')
      } else {
        setFirewallMsg(res.error || 'Failed to add rule.')
      }
    } catch (e) {
      setFirewallMsg(String(e))
    } finally {
      setFirewallBusy(false)
    }
  }

  /**
   * Hairpin-TCP self-test to the advertised host:port. If this fails while
   * hosting, the listener is bound but packets can't reach it (firewall,
   * Tailscale not routing, wrong interface, etc.) — a remote joiner won't
   * get through either. If it succeeds, the invite code is known-good.
   */
  const onTestReachability = async (): Promise<void> => {
    const portNum = Number.parseInt(hostPort, 10)
    if (!Number.isFinite(portNum) || portNum <= 0) {
      setReachResult({ kind: 'err', message: 'Invalid port' })
      return
    }
    // Prefer the user-selected advertise address; fall back to session status
    // host (which may be "0.0.0.0:<port>" when idle), then 127.0.0.1.
    let targetHost = advertiseHost.trim()
    if (!targetHost && s?.host) {
      const parsed = s.host.split(':')[0]
      if (parsed && parsed !== '0.0.0.0') targetHost = parsed
    }
    if (!targetHost) targetHost = '127.0.0.1'
    setReachBusy(true)
    setReachResult(null)
    try {
      const res = await window.api.worldEditSessionTestReachability?.(targetHost, portNum)
      if (!res) {
        setReachResult({ kind: 'err', message: 'Reachability test unavailable — restart CM.' })
      } else if (res.success) {
        setReachResult({ kind: 'ok', latencyMs: res.latencyMs ?? 0 })
      } else {
        setReachResult({ kind: 'err', message: res.error ?? 'Unknown error' })
      }
    } catch (e) {
      setReachResult({ kind: 'err', message: String(e) })
    } finally {
      setReachBusy(false)
    }
  }

  const hostOpts = (): {
    port?: number
    token: string | null
    levelName: string | null
    displayName?: string
    authMode: 'open' | 'token' | 'approval' | 'friends'
    friendsWhitelist?: string[]
    advertiseHost?: string | null
  } => {
    const port = Number.parseInt(hostPort, 10)
    const whitelist = friendsWhitelistText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const levelName = hostLevel.trim() || null
    return {
      port: Number.isFinite(port) && port > 0 ? port : undefined,
      token: hostToken.trim() || null,
      levelName,
      displayName: displayName.trim() || undefined,
      authMode,
      friendsWhitelist: authMode === 'friends' ? whitelist : undefined,
      advertiseHost: advertiseHost || null,
    }
  }

  const onHost = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const res = await window.api.worldEditSessionHost(hostOpts())
      if (!res.success) setErr(res.error || 'host failed')
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onApprovePeer = async (authorId: string): Promise<void> => {
    await window.api.worldEditSessionApprovePeer?.(authorId)
    setPendingApprovals((prev) => prev.filter((p) => p.authorId !== authorId))
  }
  const onRejectPeer = async (authorId: string): Promise<void> => {
    await window.api.worldEditSessionRejectPeer?.({ authorId })
    setPendingApprovals((prev) => prev.filter((p) => p.authorId !== authorId))
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

  const onJoinAndLaunch = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const code = inviteCode.trim()
      if (!code) {
        setErr('Paste a session code first')
        return
      }
      const res = await window.api.worldEditSessionJoinCodeAndLaunch({
        code,
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
    // Primary path: async Clipboard API. Falls back to execCommand('copy')
    // via a hidden textarea if the async API throws (permission / focus
    // issues are surprisingly common in Electron when the click originates
    // inside a readonly <input>, which is exactly our invite-code layout).
    const markCopied = (): void => {
      setCopied(label)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => {
        setCopied((p) => (p === label ? null : p))
        copiedTimerRef.current = null
      }, 1500)
    }
    const fallback = (): boolean => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-1000px'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }
    const asyncApi = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (asyncApi) {
      asyncApi(text).then(markCopied).catch(() => {
        if (fallback()) markCopied()
      })
    } else if (fallback()) {
      markCopied()
    }
  }, [])

  const onLeave = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      await window.api.worldEditSessionLeave()
      // Wipe everything tied to the prior session so the page starts fresh
      // when the user hosts/joins again. Without this the Peers panel would
      // keep showing 'idle' rows and the Session log would carry over.
      useWorldEditSessionStore.getState().reset()
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
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-3 flex-wrap">
        <Radio size={18} className="text-[var(--color-accent)]" />
        <h2 className="text-base font-semibold">Multiplayer session</h2>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] max-w-4xl">
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
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
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

      {/* Reachability self-test — host-only. Lets the user confirm packets
          actually reach the listener on the advertised address before
          sharing the invite code. Critical for Tailscale: if a hairpin
          TCP to your own 100.x IP fails, a remote peer won't get through. */}
      {isHosting && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">
            Reachability test ({advertiseHost || s?.host?.split(':')[0] || '127.0.0.1'}:{hostPort}):
          </span>
          <button
            onClick={() => void onTestReachability()}
            disabled={reachBusy}
            className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] inline-flex items-center gap-1 disabled:opacity-50"
            title="Opens a TCP connection to the advertised host:port. If it fails, the invite code won't work for remote peers either."
          >
            {reachBusy ? <Loader2 size={11} className="animate-spin" /> : <Shield size={11} />}
            Test now
          </button>
          {reachResult?.kind === 'ok' && (
            <span className="text-green-300 inline-flex items-center gap-1">
              <CheckCircle2 size={11} /> reachable ({reachResult.latencyMs}ms) — invite is good
            </span>
          )}
          {reachResult?.kind === 'err' && (
            <span className="text-red-300 basis-full">
              <AlertCircle size={11} className="inline mr-1" />
              {reachResult.message}
            </span>
          )}
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

      {/* Pending approvals (host-only) */}
      {isHosting && pendingApprovals.length > 0 && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-2">
          <div className="text-sm font-semibold text-yellow-200 flex items-center gap-2">
            <Shield size={14} /> Waiting for your approval ({pendingApprovals.length})
          </div>
          {pendingApprovals.map((p) => (
            <div key={p.authorId} className="flex items-center gap-2 bg-[var(--color-bg)]/60 rounded px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.displayName}</div>
                <div className="text-[11px] text-[var(--color-text-muted)] truncate">
                  {p.beamUsername ? `BeamMP: ${p.beamUsername} • ` : ''}{p.remote}
                </div>
              </div>
              <button
                onClick={() => onApprovePeer(p.authorId)}
                className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-semibold"
              >
                Accept
              </button>
              <button
                onClick={() => onRejectPeer(p.authorId)}
                className="px-3 py-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-xs font-semibold"
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Level-required prompt (joiner only, after welcome) */}
      {levelRequired && levelRequired.levelName && (
        <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 text-xs text-blue-200 flex items-start gap-2">
          <MapPin size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold mb-0.5">Host is editing: {levelRequired.levelName}</div>
            <div className="opacity-80">
              {levelRequired.levelSource?.builtIn
                ? 'This is a stock BeamNG level — just make sure you own the game and the level is not removed.'
                : 'This appears to be a mod-delivered level. Install the matching level mod before launching so the editor loads on both sides.'}
            </div>
          </div>
          <button
            onClick={() => setLevelRequired(null)}
            className="text-[11px] opacity-70 hover:opacity-100"
          >Dismiss</button>
        </div>
      )}

      {/* Project offered by host: intentionally not shown. The project zip
          mechanism was removed — joiners are caught up entirely via the
          live snapshot pipeline (scene graph + fields + objects + env +
          terrain + forest), not by downloading a static folder snapshot. */}

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
            {firewallSupported && (
              <div className="pt-2 mt-1 border-t border-yellow-500/20 flex flex-wrap items-center gap-2">
                <span className="text-yellow-200/80">
                  Windows Firewall:&nbsp;
                  {firewallExists === true ? (
                    <span className="text-green-300 font-medium">rule for TCP {hostPort} present</span>
                  ) : firewallExists === false ? (
                    <span className="text-yellow-300 font-medium">no rule for TCP {hostPort} yet</span>
                  ) : (
                    <span className="opacity-70">checking…</span>
                  )}
                </span>
                {firewallExists === false && (
                  <button
                    onClick={() => void onOpenFirewallHole()}
                    disabled={firewallBusy}
                    className="px-2 py-1 rounded border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-100 text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                    title="Adds an inbound TCP allow-rule (Profile=Any) so peers can reach this port over LAN, Tailscale or any active interface. Triggers a UAC prompt."
                  >
                    {firewallBusy ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Shield size={11} />
                    )}
                    Open firewall hole (UAC)
                  </button>
                )}
                {firewallMsg && (
                  <span className="text-[11px] text-[var(--color-text-muted)] basis-full">
                    {firewallMsg}
                  </span>
                )}
              </div>
            )}
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
                Level (optional — peers will be told which map to load; auto-detected from
                the host's game once you launch into the editor if left blank)
              </span>
              <select
                value={hostLevel}
                onChange={(e) => setHostLevel(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
              >
                <option value="">— auto-detect from game —</option>
                {availableMaps.length > 0 && (
                  <optgroup label="Stock maps">
                    {availableMaps
                      .filter((m) => m.source === 'stock')
                      .map((m) => (
                        <option key={`stock-${m.name}`} value={m.levelDir ?? m.name}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>
                )}
                {availableMaps.some((m) => m.source === 'mod') && (
                  <optgroup label="Mod maps">
                    {availableMaps
                      .filter((m) => m.source === 'mod')
                      .map((m) => (
                        <option key={`mod-${m.levelDir ?? m.name}`} value={m.levelDir ?? m.name}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
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
            <label className="text-xs space-y-1 md:col-span-2">
              <span className="text-[var(--color-text-muted)]">Who can join?</span>
              <select
                value={authMode}
                onChange={(e) => setAuthMode(e.target.value as typeof authMode)}
                className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)]"
              >
                <option value="open">Open — anyone with the code</option>
                <option value="token">Token — anyone with the code AND the token</option>
                <option value="approval">Approval — I accept each joiner manually</option>
                <option value="friends">Friends only — whitelisted BeamMP usernames</option>
              </select>
            </label>
            {authMode === 'friends' && (
              <label className="text-xs space-y-1 md:col-span-2">
                <span className="text-[var(--color-text-muted)]">
                  Friend BeamMP usernames (comma- or newline-separated)
                </span>
                <textarea
                  value={friendsWhitelistText}
                  onChange={(e) => setFriendsWhitelistText(e.target.value)}
                  rows={2}
                  placeholder="alice, bob, carol"
                  className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
                />
              </label>
            )}
            {hostAddresses.length > 0 && (
              <label className="text-xs space-y-1 md:col-span-2">
                <span className="text-[var(--color-text-muted)]">
                  Address to advertise in the session code
                </span>
                <select
                  value={advertiseHost}
                  onChange={(e) => setAdvertiseHost(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono"
                >
                  {hostAddresses.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.label} — {a.address}
                      {a.recommended ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
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

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              disabled={busy}
              onClick={onHost}
              className="flex-1 px-4 py-2.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
              Start hosting
            </button>
          </div>
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
            <div className="flex gap-2">
              {!advancedJoin && (
                <button
                  disabled={busy || isConnecting}
                  onClick={onJoinAndLaunch}
                  className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2"
                >
                  {busy || isConnecting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <LogIn size={14} />
                  )}
                  {isConnecting ? 'Connecting…' : 'Join session'}
                </button>
              )}
              <button
                disabled={busy || isConnecting}
                onClick={onJoin}
                className="px-4 py-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 text-sm font-medium inline-flex items-center gap-2"
                title="Connect without launching — use if BeamNG is already running."
              >
                {busy || isConnecting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogIn size={14} />
                )}
                {isConnecting ? 'Connecting…' : 'Join only'}
              </button>
            </div>
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
              onClick={() => useWorldEditSessionStore.getState().clearLog()}
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

      {/* Editor action bar — prominent Undo / Redo / Save controls visible
          throughout the session so the user never has to dig into Diagnostics
          for them. Wired straight to the same we_capture_signal.json channel
          the Diagnostics panel uses. */}
      {(isHosting || isJoined) && (
        <EditorActionBar
          editorPresent={bridgeEditorPresent}
          hooked={bridgeHooked}
          capturing={bridgeCapturing}
        />
      )}

      {/* Op stream */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
          <div className="text-sm font-semibold">Op stream ({ops.length})</div>
          <button
            onClick={() => useWorldEditSessionStore.getState().clearOps()}
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

      {/* Project browser + saved-project picker modals were removed in
          v0.3.54 along with the broken `_beamcm_projects/<folder>` stub
          pipeline. Late joiners are caught up via the live snapshot pipeline
          (sceneGraph + fields + objects + env + terrain + forest) instead. */}
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

// ─── Project-offered banner (joiner side) ──────────────────────────────────
// REMOVED: the project zip mechanism was decommissioned. Joiners are now
// caught up entirely via the live snapshot pipeline (scene graph, fields,
// objects, env, terrain, forest), not by downloading a folder snapshot.
// See WorldEditSessionPage's "Auto-start capture" comment for context.

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
 * Prominent in-session toolbar for Undo / Redo / Save.
 *
 * Lives above the op stream so users can drive the world editor without
 * expanding the Diagnostics panel. Every button writes the same
 * `we_capture_signal.json` that the raw diagnostics controls do, so peers
 * see the resulting op in their stream via the capture hooks.
 */
function EditorActionBar({
  editorPresent,
  hooked,
  capturing,
}: {
  editorPresent: boolean
  hooked: boolean
  capturing: boolean
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null)
  // §D first-time toast: surface the "concurrent edits may be discarded"
  // warning once per browser profile so users learn the semantics without
  // being nagged. Stored in localStorage; cleared by hand if testing.
  const [showFirstUndoToast, setShowFirstUndoToast] = useState(false)

  const send = useCallback(
    async (
      action: 'undo' | 'redo' | 'save' | 'start' | 'stop',
      label: string,
    ): Promise<void> => {
      setBusy(true)
      try {
        // §D undo/redo are CM-mediated cross-peer ops, not the BeamNG
        // editor's local stack — route them to the dedicated handlers
        // so the inverse op is broadcast and `myOps`/`myRedoStack` stay
        // in sync. Save/start/stop still use the legacy editor signal.
        if (action === 'undo') {
          const r = await window.api.worldEditSessionUndo?.()
          if (!r) {
            setFlash({ msg: 'IPC binding unavailable — restart CM', tone: 'err' })
          } else if (!r.ok) {
            const msg =
              r.reason === 'empty-stack'
                ? 'Nothing to undo'
                : r.reason === 'unsupported'
                  ? `"${r.name ?? 'action'}" can't be undone yet`
                  : r.reason === 'no-session'
                    ? 'Not in a session'
                    : `Undo failed (${r.reason ?? '?'})`
            setFlash({ msg, tone: 'err' })
          } else {
            setFlash({ msg: `Undo${r.name ? ` ${r.name}` : ''} ✓`, tone: 'ok' })
            // §D first-time toast (per spec: "Undo will revert your last
            // edit and may discard concurrent changes by others.").
            try {
              if (window.localStorage.getItem('cm.editorSync.undoToastSeen') !== '1') {
                setShowFirstUndoToast(true)
                window.localStorage.setItem('cm.editorSync.undoToastSeen', '1')
              }
            } catch { /* private mode / quota — non-fatal */ }
          }
        } else if (action === 'redo') {
          const r = await window.api.worldEditSessionRedo?.()
          if (!r) {
            setFlash({ msg: 'IPC binding unavailable — restart CM', tone: 'err' })
          } else if (!r.ok) {
            const msg = r.reason === 'empty-stack' ? 'Nothing to redo' : `Redo failed (${r.reason ?? '?'})`
            setFlash({ msg, tone: 'err' })
          } else {
            setFlash({ msg: `Redo${r.name ? ` ${r.name}` : ''} ✓`, tone: 'ok' })
          }
        } else {
          const res = await window.api.worldEditSignal?.(action)
          if (!res) {
            setFlash({ msg: 'IPC binding unavailable — restart CM', tone: 'err' })
          } else if (!res.success) {
            setFlash({ msg: res.error ?? `${label} failed`, tone: 'err' })
          } else {
            setFlash({ msg: `${label} ✓`, tone: 'ok' })
          }
        }
      } catch (e) {
        setFlash({ msg: String(e), tone: 'err' })
      } finally {
        setBusy(false)
        window.setTimeout(() => setFlash((f) => (f && f.msg.startsWith(label) ? null : f)), 1800)
      }
    },
    [],
  )

  const disabled = busy || !editorPresent || !hooked
  const disabledReason = !editorPresent
    ? 'Open BeamNG world editor (F11) first'
    : !hooked
      ? 'Editor hooks not installed yet — open the world editor'
      : busy
        ? 'Working…'
        : ''

  const btnBase =
    'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-3 flex items-center gap-2 flex-wrap">
      <button
        onClick={() => void send('undo', 'Undo')}
        disabled={disabled}
        title={disabledReason || 'Undo last edit (Ctrl+Z in-game)'}
        className={`${btnBase} border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]`}
      >
        <Undo2 size={15} /> Undo
      </button>
      <button
        onClick={() => void send('redo', 'Redo')}
        disabled={disabled}
        title={disabledReason || 'Redo last undone edit (Ctrl+Y in-game)'}
        className={`${btnBase} border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]`}
      >
        <Redo2 size={15} /> Redo
      </button>
      <div className="w-px h-6 bg-[var(--color-border)] mx-1" />
      <button
        onClick={() => void send('save', 'Save')}
        disabled={disabled}
        title={disabledReason || 'Save the current level (in place)'}
        className={`${btnBase} border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20`}
      >
        <Save size={15} /> Save level
      </button>

      {/* §E.3 — package the live runtime state into a portable
          `.beamcmworld` file. Available regardless of `editorPresent`
          so a host can re-save after the game has closed (data is
          held in the relay's snapshot cache). */}
      <button
        onClick={async () => {
          setBusy(true)
          try {
            const r = await window.api.worldSaveSave?.({ includeOpLog: false })
            if (!r) {
              setFlash({ msg: 'IPC binding unavailable — restart CM', tone: 'err' })
            } else if (!r.success) {
              if (!r.cancelled) setFlash({ msg: r.error ?? 'Save world failed', tone: 'err' })
            } else {
              const mb = (r.bytes / (1024 * 1024)).toFixed(1)
              setFlash({ msg: `Saved "${r.title}" (${mb} MB) ✓`, tone: 'ok' })
            }
          } finally {
            setBusy(false)
            window.setTimeout(() => setFlash(null), 2400)
          }
        }}
        disabled={busy}
        title="Save the entire world (snapshot + mods) to a .beamcmworld file you can share"
        className={`${btnBase} border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20`}
      >
        <Package size={15} /> Save world…
      </button>
      <button
        onClick={async () => {
          setBusy(true)
          try {
            const r = await window.api.worldSaveLoad?.()
            if (!r) {
              setFlash({ msg: 'IPC binding unavailable — restart CM', tone: 'err' })
            } else if (!r.success) {
              if (!r.cancelled) setFlash({ msg: r.error ?? 'Load world failed', tone: 'err' })
            } else {
              const detail: string[] = [`${r.modCount} mod${r.modCount === 1 ? '' : 's'}`]
              if (r.opLogCount > 0) detail.push(`${r.opLogCount} ops`)
              if (r.seededIntoRelay) detail.push('seeded')
              setFlash({
                msg: `Loaded ${r.levelName} (${detail.join(', ')}) ✓`,
                tone: 'ok',
              })
            }
          } finally {
            setBusy(false)
            window.setTimeout(() => setFlash(null), 2400)
          }
        }}
        disabled={busy}
        title="Load a .beamcmworld file and stage its mods into the multiplayer slot"
        className={`${btnBase} border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
      >
        <Download size={15} /> Load world…
      </button>

      <div className="ml-auto flex items-center gap-2 text-[11px]">
        {/* Capture indicator */}
        {capturing ? (
          <button
            onClick={() => void send('stop', 'Capture paused')}
            disabled={busy}
            title="Pause op capture to disk (peers still see live ops)"
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20"
          >
            <Circle size={8} className="fill-green-400 text-green-400 animate-pulse" />
            Capturing
          </button>
        ) : (
          <button
            onClick={() => void send('start', 'Capture started')}
            disabled={busy || !editorPresent}
            title={
              !editorPresent
                ? 'Open the BeamNG world editor first'
                : 'Record ops to we_capture.log so edits can be recovered'
            }
            className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          >
            <Circle size={8} />
            Start capture
          </button>
        )}

        {flash && (
          <span
            className={`px-2 py-1 rounded-md font-medium ${
              flash.tone === 'ok'
                ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                : 'bg-red-500/15 text-red-400 border border-red-500/30'
            }`}
          >
            {flash.msg}
          </span>
        )}
      </div>
      {/* §D first-time toast — explains the cross-peer undo trade-off. */}
      {showFirstUndoToast && (
        <div className="basis-full mt-2 flex items-start gap-2 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[12px]">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Heads-up: shared-world undo</div>
            <div className="opacity-80">
              Undo reverts your last edit and may discard concurrent changes by
              other peers on the same field. Use the in-editor history
              (Ctrl+Shift+Z) for a local-only undo.
            </div>
          </div>
          <button
            onClick={() => setShowFirstUndoToast(false)}
            className="text-amber-200/70 hover:text-amber-100 px-1"
            title="Got it"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Shows everyone currently in the session — their display name, position,
 * whether they're in a vehicle, what their last edit was, and (for peers) a
 * warning if they're on a different level than the local user.
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

  // Build list of invite codes. Order matters — peers tend to copy the
  // first one they see, so we put the most-likely-to-actually-work option
  // up top. Tailscale wins when available (zero-config, no port-forwarding,
  // works across networks). Otherwise public IP (requires forwarding) →
  // LAN → loopback.
  interface Entry {
    ip: string
    code: string
    label: string
    tone: 'primary' | 'tailscale' | 'lan' | 'loopback'
    recommended?: boolean
  }
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    if (tsIp) {
      out.push({
        ip: tsIp,
        code: encodeInviteCode({ host: tsIp, port, token }),
        label: tsHostname
          ? `Tailscale (${tsHostname}) — any peer on your tailnet, no port-forwarding`
          : 'Tailscale — any peer on your tailnet, no port-forwarding',
        tone: 'tailscale',
        recommended: true,
      })
    }
    if (publicIp) {
      out.push({
        ip: publicIp,
        code: encodeInviteCode({ host: publicIp, port, token }),
        label: 'For peers on the internet (requires port-forwarding)',
        tone: 'primary',
        recommended: !tsIp,
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
      {status.sessionCode && (
        <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 space-y-2">
          <div className="text-xs font-semibold text-green-300 uppercase tracking-wide">
            Session code — share this with peers
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-[var(--color-bg)] rounded px-2 py-2 border border-[var(--color-border)] break-all select-all">
              {status.sessionCode}
            </code>
            <button
              onClick={() => onCopy(status.sessionCode!, 'sessionCode')}
              className="px-3 py-2 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <Copy size={12} /> {copied === 'sessionCode' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)]">
            Peers paste this in the Join panel — it encodes the address, port, auth token, level, and
            session ID in one string.
          </div>
        </div>
      )}
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
        {entries.map(({ ip, code, label, tone, recommended }) => (
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
                {recommended && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 font-semibold uppercase tracking-wide text-[9px]">
                    Recommended
                  </span>
                )}
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
