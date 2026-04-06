import { useState, useCallback, useEffect } from 'react'
import { Play, Square, RotateCcw, Clock, Cpu, HardDrive, Users, Wifi, Copy, AlertTriangle, Search, CheckCircle, XCircle, Loader2, Globe, Download, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { HostedServerEntry, ServerExeStatus } from '../../../../shared/types'

type TailscaleStatus = {
  installed: boolean
  running: boolean
  ip: string | null
  hostname: string | null
  tailnet: string | null
  peers: Array<{ hostname: string; ip: string; os: string; online: boolean }>
}

interface StatusDashboardProps {
  server: HostedServerEntry
  exeStatus: ServerExeStatus
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
}

type PortTestState = 'idle' | 'testing' | 'open' | 'closed' | 'error'

export function StatusDashboard({
  server,
  exeStatus,
  onStart,
  onStop,
  onRestart
}: StatusDashboardProps): React.JSX.Element {
  const { config, status } = server
  const isRunning = status.state === 'running'
  const isStopped = status.state === 'stopped' || status.state === 'error'

  const [portTestState, setPortTestState] = useState<PortTestState>('idle')
  const [publicIp, setPublicIp] = useState<string | null>(null)
  const [portTestError, setPortTestError] = useState<string | null>(null)
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null)
  const [showTailscale, setShowTailscale] = useState(false)

  // Live uptime — computed from startedAt so it survives navigation
  const [liveUptime, setLiveUptime] = useState(() =>
    status.startedAt ? Date.now() - status.startedAt : status.uptimeMs
  )
  useEffect(() => {
    if (!isRunning || !status.startedAt) {
      setLiveUptime(status.uptimeMs)
      return
    }
    setLiveUptime(Date.now() - status.startedAt)
    const id = setInterval(() => setLiveUptime(Date.now() - status.startedAt!), 1000)
    return () => clearInterval(id)
  }, [isRunning, status.startedAt])

  // Auto-fetch public IP when server starts running
  useEffect(() => {
    if (isRunning && !publicIp) {
      window.api.hostedServerTestPort(config.port)
        .then((result) => { if (result.ip) setPublicIp(result.ip) })
        .catch(() => {})
    }
  }, [isRunning, config.port, publicIp])

  // Fetch Tailscale status when guide is opened
  useEffect(() => {
    if (showTailscale) {
      window.api.getTailscaleStatus().then(setTailscale).catch(() => {})
    }
  }, [showTailscale])

  const testPort = useCallback(async () => {
    setPortTestState('testing')
    setPortTestError(null)
    try {
      const result = await window.api.hostedServerTestPort(config.port)
      if (result.ip) setPublicIp(result.ip)
      if (result.error) {
        setPortTestState('error')
        setPortTestError(result.error)
      } else {
        setPortTestState(result.open ? 'open' : 'closed')
      }
    } catch {
      setPortTestState('error')
      setPortTestError('Failed to test port')
    }
  }, [config.port])

  const connectionString = publicIp ? `${publicIp}:${config.port}` : `:${config.port}`

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Uptime badge */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          Metrics and Status
        </h2>
        {isRunning ? (
          <span className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded-full">
            <Clock size={12} />
            RUNNING UPTIME: {formatUptime(liveUptime)}
          </span>
        ) : (
          <span className="text-xs font-medium px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] rounded-full">
            {status.state === 'error' ? 'ERROR' : 'STOPPED'}
          </span>
        )}
      </div>

      {/* Metrics cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <MetricCard
          icon={<Cpu size={16} />}
          label="CPU USAGE"
          value={isRunning ? '0%' : '—'}
          barPercent={0}
          barColor="bg-blue-500"
        />
        <MetricCard
          icon={<HardDrive size={16} />}
          label="MEMORY USAGE"
          value={isRunning ? '0.02 / 60.50 GB' : '— / —'}
          barPercent={isRunning ? 0.03 : 0}
          barColor="bg-blue-500"
        />
        <MetricCard
          icon={<Users size={16} />}
          label="ACTIVE USERS"
          value={`${isRunning ? status.players : 0} / ${config.maxPlayers}`}
          barPercent={
            isRunning && config.maxPlayers > 0
              ? (status.players / config.maxPlayers) * 100
              : 0
          }
          barColor="bg-blue-500"
        />
      </div>

      {/* Bottom row: Actions + Connection + Ports */}
      <div className="grid grid-cols-3 gap-4">
        {/* Actions */}
        <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Actions
          </h3>
          <div className="flex flex-wrap gap-2">
            {exeStatus !== 'ready' ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <AlertTriangle size={16} />
                <span>Server exe required — download it from the banner above</span>
              </div>
            ) : isStopped ? (
              <button
                onClick={() => onStart(config.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
              >
                <Play size={14} /> Start
              </button>
            ) : (
              <>
                <button
                  onClick={() => onRestart(config.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  <RotateCcw size={14} /> Restart
                </button>
                <button
                  onClick={() => onStop(config.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Square size={14} /> Stop
                </button>
              </>
            )}
          </div>
        </div>

        {/* Connection Info */}
        <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Connection Info
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">Connect Address</span>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-mono text-[var(--color-text-primary)]">
                  {connectionString}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(connectionString)}
                  className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                  title="Copy connection address"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
            {publicIp && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">Public IP</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono text-[var(--color-text-secondary)]">
                    {publicIp}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(publicIp)}
                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                    title="Copy IP"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">Port</span>
              <span className="text-sm font-mono text-[var(--color-text-secondary)]">
                {config.port}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">Map</span>
              <span className="text-sm text-[var(--color-text-secondary)]">
                {config.map?.split('/')[2] ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-muted)]">Visibility</span>
              <span className="text-sm text-[var(--color-text-secondary)]">
                {config.private ? 'Private' : 'Public'}
              </span>
            </div>
          </div>
        </div>

        {/* Network Port Status */}
        <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Network Port Status
          </h3>
          <div className="space-y-3">
            <PortRow
              active={isRunning}
              label="Main Game Port"
              port={config.port}
              protocol="TCP+UDP"
            />

            {/* Port test result */}
            {portTestState !== 'idle' && portTestState !== 'testing' && (
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded ${
                portTestState === 'open'
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : portTestState === 'closed'
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                    : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
              }`}>
                {portTestState === 'open' ? (
                  <><CheckCircle size={12} /> Port {config.port} is open and reachable</>
                ) : portTestState === 'closed' ? (
                  <><XCircle size={12} /> Port {config.port} is not reachable from outside</>
                ) : (
                  <><AlertTriangle size={12} /> {portTestError}</>
                )}
              </div>
            )}

            {/* Test My Port button */}
            <button
              onClick={testPort}
              disabled={portTestState === 'testing'}
              className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium border border-[var(--color-border)] bg-[var(--color-surface-hover)] hover:border-[var(--color-border-accent)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors rounded disabled:opacity-50"
            >
              {portTestState === 'testing' ? (
                <><Loader2 size={12} className="animate-spin" /> Testing port {config.port}...</>
              ) : (
                <><Search size={12} /> Test My Port</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* "I can't port forward" toggle */}
      <div className="mt-5">
        <button
          onClick={() => setShowTailscale(!showTailscale)}
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Globe size={14} />
          I can't port forward
          {showTailscale ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showTailscale && (
          <div className="mt-3 border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-5">
            {/* Tailscale live status */}
            {tailscale && tailscale.installed && tailscale.running && tailscale.ip && (
              <div className="border border-green-500/30 bg-green-500/5 p-4 rounded">
                <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircle size={12} /> Tailscale is running
                </h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">Your Tailscale Address</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-mono text-[var(--color-accent)]">{tailscale.ip}:{config.port}</span>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${tailscale.ip}:${config.port}`)}
                        className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                        title="Copy Tailscale address"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">Device</span>
                    <span className="text-sm text-[var(--color-text-secondary)]">{tailscale.hostname}</span>
                  </div>
                  {tailscale.peers.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-green-500/20">
                      <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Peers on your Tailnet</span>
                      <div className="mt-1.5 space-y-1">
                        {tailscale.peers.map((peer) => (
                          <div key={peer.hostname} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${peer.online ? 'bg-green-400' : 'bg-neutral-600'}`} />
                              <span className="text-[var(--color-text-secondary)]">{peer.hostname}</span>
                              <span className="text-[var(--color-text-muted)]">{peer.os}</span>
                            </span>
                            <span className="font-mono text-[var(--color-text-muted)]">{peer.ip}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Not installed prompt */}
            {tailscale && !tailscale.installed && (
              <div className="border border-yellow-500/30 bg-yellow-500/5 p-4 rounded">
                <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Tailscale not installed
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                  You'll need to install Tailscale first. It's free for personal use and takes about a minute.
                </p>
                <button
                  onClick={() => window.open('https://tailscale.com/download', '_blank')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] hover:opacity-90 text-white transition-opacity"
                >
                  <Download size={12} /> Download Tailscale
                </button>
              </div>
            )}

            {/* Installed but not running */}
            {tailscale && tailscale.installed && !tailscale.running && (
              <div className="border border-yellow-500/30 bg-yellow-500/5 p-4 rounded">
                <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Tailscale not connected
                </h4>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Tailscale is installed but not running. Open the Tailscale app and sign in to connect.
                </p>
              </div>
            )}

            {/* Guide */}
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Globe size={16} />
                Host a server without port forwarding using Tailscale
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-relaxed">
                Tailscale creates a private mesh network (called a "tailnet") between your devices and your friends' devices.
                Once everyone is on the same tailnet, your friends can connect directly to your BeamMP server using your
                Tailscale IP address — no router configuration, no port forwarding, no hassle.
              </p>
            </div>

            {/* Steps for you */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wider mb-2">What you need to do (host)</h4>
              <ol className="space-y-2 text-xs text-[var(--color-text-secondary)] list-decimal list-inside">
                <li>
                  <strong className="text-[var(--color-text-primary)]">Install Tailscale</strong> — download it from{' '}
                  <button onClick={() => window.open('https://tailscale.com/download', '_blank')} className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5">
                    tailscale.com <ExternalLink size={10} />
                  </button>{' '}
                  and sign in with Google, Microsoft, or GitHub.
                </li>
                <li>
                  <strong className="text-[var(--color-text-primary)]">Share your tailnet</strong> — go to the{' '}
                  <button onClick={() => window.open('https://login.tailscale.com/admin/users', '_blank')} className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5">
                    Tailscale admin panel <ExternalLink size={10} />
                  </button>{' '}
                  and invite your friends by email. They'll get a link to join your network.
                </li>
                <li>
                  <strong className="text-[var(--color-text-primary)]">Start your BeamMP server</strong> — launch the server from this page like normal.
                </li>
                <li>
                  <strong className="text-[var(--color-text-primary)]">Share your Tailscale address</strong> — give your friends your Tailscale IP and port
                  {tailscale?.ip && (
                    <span className="font-mono text-[var(--color-accent)] ml-1">({tailscale.ip}:{config.port})</span>
                  )}{'. '}
                  They'll use this to direct-connect in BeamMP.
                </li>
              </ol>
            </div>

            {/* Steps for friends */}
            <div>
              <h4 className="text-xs font-semibold text-[var(--color-accent)] uppercase tracking-wider mb-2">What your friends need to do</h4>
              <ol className="space-y-2 text-xs text-[var(--color-text-secondary)] list-decimal list-inside">
                <li>
                  <strong className="text-[var(--color-text-primary)]">Install Tailscale</strong> — same as above,{' '}
                  <button onClick={() => window.open('https://tailscale.com/download', '_blank')} className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5">
                    download here <ExternalLink size={10} />
                  </button>.
                </li>
                <li>
                  <strong className="text-[var(--color-text-primary)]">Accept your invite</strong> — they'll receive an email invite to join your tailnet. Click the link and sign in.
                </li>
                <li>
                  <strong className="text-[var(--color-text-primary)]">Direct Connect in BeamMP</strong> — open BeamMP, click "Direct Connect", and enter your Tailscale IP and port
                  {tailscale?.ip && (
                    <span className="font-mono text-[var(--color-accent)] ml-1">({tailscale.ip}:{config.port})</span>
                  )}.
                </li>
              </ol>
            </div>

            {/* FAQ */}
            <div className="border-t border-[var(--color-border)] pt-4">
              <h4 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Good to know</h4>
              <ul className="space-y-1.5 text-xs text-[var(--color-text-muted)]">
                <li>• Tailscale is <strong className="text-[var(--color-text-secondary)]">free for personal use</strong> (up to 100 devices, 3 users).</li>
                <li>• Your server will appear as <strong className="text-[var(--color-text-secondary)]">Private</strong> in the server list — only friends on your tailnet can see or join it.</li>
                <li>• Traffic is <strong className="text-[var(--color-text-secondary)]">encrypted end-to-end</strong> and goes directly between devices (no relay servers).</li>
                <li>• Connection quality is the same as a regular direct connection — no extra latency.</li>
                <li>• Tailscale runs in the background and auto-connects on boot.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Sub-components ── */

function MetricCard({
  icon,
  label,
  value,
  barPercent,
  barColor
}: {
  icon: React.ReactNode
  label: string
  value: string
  barPercent: number
  barColor: string
}): React.JSX.Element {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-2xl font-bold text-[var(--color-text-primary)]">{value}</span>
      <div className="h-1.5 bg-[var(--color-surface-hover)] rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(barPercent, 100)}%` }}
        />
      </div>
    </div>
  )
}

function PortRow({
  active,
  label,
  port,
  protocol
}: {
  active: boolean
  label: string
  port: number
  protocol: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <Wifi
        size={14}
        className={active ? 'text-green-400' : 'text-[var(--color-text-muted)]'}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--color-text-primary)]">{label}</div>
      </div>
      <span className="text-sm font-mono text-[var(--color-text-secondary)]">{port}</span>
      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded">
        {protocol}
      </span>
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
