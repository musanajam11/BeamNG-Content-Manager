import { useState, useEffect } from 'react'
import {
  Square,
  Loader2,
  Star,
  Users,
  MapPin,
  Lock,
  Package,
  ChevronRight,
  Monitor,
  ArrowUpCircle,
  Newspaper,
  ExternalLink,
  Clock
} from 'lucide-react'
import { useGameStore } from '../stores/useGameStore'
import { useAppStore } from '../stores/useAppStore'
import { useServerStore } from '../stores/useServerStore'
import type { ServerInfo, ModInfo } from '../../../shared/types'
import { BeamMPText } from '../components/BeamMPText'

function formatMapName(map: string): string {
  const name = map.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
  return name
    .replace(/_/g, ' ')
    .replace(/\bv(\d)/gi, 'V$1')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bUsa\b/g, 'USA')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export function HomePage(): React.JSX.Element {
  const { gameStatus, error, killGame } = useGameStore()
  const config = useAppStore((s) => s.config)
  const setPage = useAppStore((s) => s.setPage)
  const { servers, favorites, fetchServers, loadFavorites } = useServerStore()

  const [vanillaLaunching, setVanillaLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  const [recentMods, setRecentMods] = useState<ModInfo[]>([])
  const [modPreviews, setModPreviews] = useState<Record<string, string>>({})
  const [mapPreviews, setMapPreviews] = useState<Record<string, string>>({})
  const [registryUpdates, setRegistryUpdates] = useState(0)
  const [newsItems, setNewsItems] = useState<
    Array<{ id: string; source: 'steam' | 'beammp'; title: string; url: string; date: number; summary: string }>
  >([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [recentServerIdents, setRecentServerIdents] = useState<string[]>([])

  const isRunning = gameStatus.running
  const hasGame = !!config?.gamePaths?.installDir

  useEffect(() => {
    loadFavorites()
    if (servers.length === 0) fetchServers()

    window.api.registryGetUpdatesAvailable().then((updates) => {
      setRegistryUpdates(updates.length)
    }).catch(() => {})

    window.api.getMods().then((result) => {
      if (result.success && result.data) {
        const sorted = [...result.data]
          .filter((m) => m.location === 'repo')
          .sort((a, b) => new Date(b.modifiedDate).getTime() - new Date(a.modifiedDate).getTime())
          .slice(0, 6)
        setRecentMods(sorted)
      }
    })

    window.api.getNewsFeed().then((items) => {
      setNewsItems(items)
    }).catch(() => {}).finally(() => setNewsLoading(false))

    window.api.getRecentServers().then((recent) => {
      setRecentServerIdents(recent.map((r) => r.ident))
    }).catch(() => {})
  }, [])

  const favoriteServers = servers.filter((s) => favorites.has(`${s.ip}:${s.port}`)).slice(0, 6)
  const recentServers = recentServerIdents
    .map((ident) => servers.find((s) => `${s.ip}:${s.port}` === ident))
    .filter((s): s is ServerInfo => !!s)

  useEffect(() => {
    const allServers = [...favoriteServers, ...recentServers]
    const mapPaths = [...new Set(allServers.map((s) => s.map))].filter(
      (m) => m && !mapPreviews[m]
    )
    if (mapPaths.length === 0) return
    for (const mapPath of mapPaths) {
      window.api.getMapPreview(mapPath).then((preview) => {
        if (preview) setMapPreviews((prev) => ({ ...prev, [mapPath]: preview }))
      })
    }
  }, [favoriteServers.length, recentServers.length])

  useEffect(() => {
    for (const mod of recentMods) {
      if (mod.filePath && !modPreviews[mod.key]) {
        window.api.getModPreview(mod.filePath).then((result) => {
          if (result.success && result.data) {
            setModPreviews((prev) => ({ ...prev, [mod.key]: result.data as string }))
          }
        })
      }
    }
  }, [recentMods])

  const handleVanillaLaunch = async (): Promise<void> => {
    if (isRunning) { killGame(); return }
    setVanillaLaunching(true)
    setLaunchError(null)
    try {
      const result = await window.api.launchVanilla()
      if (!result.success) setLaunchError(result.error || 'Failed to launch')
    } catch (err) {
      setLaunchError((err as Error).message)
    } finally {
      setVanillaLaunching(false)
    }
  }

  const handleJoinServer = async (server: ServerInfo): Promise<void> => {
    try {
      await window.api.joinServer(server.ip, parseInt(server.port, 10))
    } catch { /* handled elsewhere */ }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 pt-4 pb-4 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Home</h1>
          <p className="text-sm text-slate-400 mt-0.5">Launch into BeamNG.drive</p>
        </div>

        {/* Game not found warning */}
        {!hasGame && (
          <div className="border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] px-4 py-3">
            <p className="text-sm text-[var(--color-accent-text-muted)]">
              BeamNG.drive installation not found.{' '}
              <button
                onClick={() => setPage('settings')}
                className="text-[var(--accent-primary)] hover:underline font-medium"
              >
                Configure in Settings
              </button>
            </p>
          </div>
        )}

        {/* Error messages */}
        {(error || launchError) && (
          <p className="text-red-400 text-xs bg-red-400/10 px-4 py-2">
            {error || launchError}
          </p>
        )}

        {/* Start Singleplayer */}
        {hasGame && (
          <button
            onClick={handleVanillaLaunch}
            disabled={vanillaLaunching}
            className={`w-full flex items-center justify-center gap-3 px-6 py-4 text-sm font-semibold transition-all ${
              isRunning
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : vanillaLaunching
                  ? 'bg-[var(--accent-primary)]/60 text-white/60 cursor-wait'
                  : 'border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white'
            }`}
          >
            {vanillaLaunching ? (
              <Loader2 size={18} className="animate-spin" />
            ) : isRunning ? (
              <Square size={18} />
            ) : (
              <Monitor size={18} className="text-[var(--accent-primary)]" />
            )}
            {vanillaLaunching ? 'Launching...' : isRunning ? 'Stop Game' : 'Start Singleplayer'}
          </button>
        )}

        {/* Registry Updates */}
        {registryUpdates > 0 && (
          <button
            onClick={() => setPage('mods')}
            className="w-full flex items-center gap-3 border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] px-4 py-3 text-left transition hover:bg-[var(--color-accent-10)]"
          >
            <ArrowUpCircle size={18} className="text-[var(--color-accent)] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--color-accent-text)]">
                {registryUpdates} mod update{registryUpdates !== 1 ? 's' : ''} available
              </p>
              <p className="text-[11px] text-slate-500">Go to Registry tab to update</p>
            </div>
            <ChevronRight size={14} className="text-slate-500" />
          </button>
        )}

        {/* Favorite Servers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Star size={14} className="text-[var(--color-accent)]" />
              <h2 className="text-sm font-semibold text-white">Favorite Servers</h2>
            </div>
            <button
              onClick={() => setPage('servers')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
            >
              View all <ChevronRight size={12} />
            </button>
          </div>

          {favoriteServers.length === 0 ? (
            <div className="border border-white/6 bg-white/[0.02] px-4 py-6 text-center">
              <Star size={20} className="mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-500">No favorite servers yet</p>
              <button
                onClick={() => setPage('servers')}
                className="text-xs text-[var(--accent-primary)] hover:underline mt-1"
              >
                Browse servers
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {favoriteServers.map((server) => {
                const players = parseInt(server.players, 10) || 0
                const maxPlayers = parseInt(server.maxplayers, 10) || 0
                const isFull = players >= maxPlayers
                const preview = mapPreviews[server.map]

                return (
                  <button
                    key={`${server.ip}:${server.port}`}
                    onClick={() => handleJoinServer(server)}
                    className="group relative border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 transition-all text-left overflow-hidden"
                  >
                    {/* Map preview background */}
                    {preview && (
                      <div className="absolute inset-0 opacity-15 group-hover:opacity-25 transition-opacity">
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="relative p-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <BeamMPText text={server.sname} className="text-xs font-semibold text-white truncate flex-1" />
                        {server.password && <Lock size={10} className="text-slate-500 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <MapPin size={9} />
                          {formatMapName(server.map)}
                        </span>
                        <span className={`flex items-center gap-1 ${isFull ? 'text-red-400' : ''}`}>
                          <Users size={9} />
                          {players}/{maxPlayers}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Servers */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[var(--color-accent)]" />
              <h2 className="text-sm font-semibold text-white">Recent Servers</h2>
            </div>
            <button
              onClick={() => setPage('servers')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
            >
              View all <ChevronRight size={12} />
            </button>
          </div>

          {recentServers.length === 0 ? (
            <div className="border border-white/6 bg-white/[0.02] px-4 py-6 text-center">
              <Clock size={20} className="mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-500">No recent servers yet</p>
              <button
                onClick={() => setPage('servers')}
                className="text-xs text-[var(--accent-primary)] hover:underline mt-1"
              >
                Browse servers
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {recentServers.map((server) => {
                const players = parseInt(server.players, 10) || 0
                const maxPlayers = parseInt(server.maxplayers, 10) || 0
                const isFull = players >= maxPlayers
                const preview = mapPreviews[server.map]

                return (
                  <button
                    key={`recent-${server.ip}:${server.port}`}
                    onClick={() => handleJoinServer(server)}
                    className="group relative border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 transition-all text-left overflow-hidden"
                  >
                    {preview && (
                      <div className="absolute inset-0 opacity-15 group-hover:opacity-25 transition-opacity">
                        <img src={preview} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="relative p-3 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <BeamMPText text={server.sname} className="text-xs font-semibold text-white truncate flex-1" />
                        {server.password && <Lock size={10} className="text-slate-500 shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <MapPin size={9} />
                          {formatMapName(server.map)}
                        </span>
                        <span className={`flex items-center gap-1 ${isFull ? 'text-red-400' : ''}`}>
                          <Users size={9} />
                          {players}/{maxPlayers}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Mods */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-[var(--color-accent)]" />
              <h2 className="text-sm font-semibold text-white">Recently Installed Mods</h2>
            </div>
            <button
              onClick={() => setPage('mods')}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition"
            >
              View all <ChevronRight size={12} />
            </button>
          </div>

          {recentMods.length === 0 ? (
            <div className="border border-white/6 bg-white/[0.02] px-4 py-6 text-center">
              <Package size={20} className="mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-500">No mods installed yet</p>
              <button
                onClick={() => setPage('mods')}
                className="text-xs text-[var(--accent-primary)] hover:underline mt-1"
              >
                Browse mods
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {recentMods.map((mod) => (
                <div
                  key={mod.key}
                  className="border border-white/8 bg-white/[0.03] p-3 flex gap-3 items-start"
                >
                  {/* Mod thumbnail */}
                  <div className="w-10 h-10 shrink-0 bg-white/5 border border-white/8 flex items-center justify-center overflow-hidden">
                    {modPreviews[mod.key] ? (
                      <img src={modPreviews[mod.key]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Package size={14} className="text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">
                      {mod.title || mod.fileName}
                    </p>
                    {mod.author && (
                      <p className="text-[10px] text-slate-500 truncate">by {mod.author}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                      <span>{formatBytes(mod.sizeBytes)}</span>
                      <span>{timeAgo(mod.modifiedDate)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent News */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Newspaper size={14} className="text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold text-white">Recent News</h2>
          </div>

          {newsLoading ? (
            <div className="border border-white/6 bg-white/[0.02] px-4 py-6 text-center">
              <Loader2 size={20} className="mx-auto text-slate-600 mb-2 animate-spin" />
              <p className="text-xs text-slate-500">Loading news...</p>
            </div>
          ) : newsItems.length === 0 ? (
            <div className="border border-white/6 bg-white/[0.02] px-4 py-6 text-center">
              <Newspaper size={20} className="mx-auto text-slate-600 mb-2" />
              <p className="text-xs text-slate-500">No news available</p>
            </div>
          ) : (
            <div className="space-y-2">
              {newsItems.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  onClick={() => window.open(item.url, '_blank')}
                  className="w-full flex items-start gap-3 border border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15 px-4 py-3 text-left transition-all group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 ${
                          item.source === 'beammp'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}
                      >
                        {item.source === 'beammp' ? 'BeamMP' : 'BeamNG'}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {timeAgo(new Date(item.date * 1000).toISOString())}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    {item.summary && (
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{item.summary}</p>
                    )}
                  </div>
                  <ExternalLink
                    size={12}
                    className="text-slate-600 group-hover:text-slate-400 shrink-0 mt-1 transition"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
