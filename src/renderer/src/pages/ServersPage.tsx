import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useServerStore } from '../stores/useServerStore'
import { ServersToolbar } from '../components/servers/ServersToolbar'
import { ServersFilters } from '../components/servers/ServersFilters'
import { ServerList } from '../components/servers/ServerList'
import { ServerDetailPanel } from '../components/servers/ServerDetailPanel'
import { ModSyncOverlay } from '../components/servers/ModSyncOverlay'
import { Globe, Users, Shield, Package, Clock, X, Download, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BeamMPText } from '../components/BeamMPText'

export function ServersPage(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    filteredServers, loading, error, searchQuery, selectedServer, favorites,
    sortField, sortDir, filterTab, quickFilters,
    fetchServers, loadFavorites, toggleFavorite, setSearchQuery, selectServer, setSort, setFilterTab, toggleQuickFilter
  } = useServerStore()
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [highlightSignIn, setHighlightSignIn] = useState(false)
  const [beammpInstalled, setBeammpInstalled] = useState<boolean | null>(null)
  const [beammpInstalling, setBeammpInstalling] = useState(false)

  // Track whether mod sync is actively in progress
  const [modSyncActive, setModSyncActive] = useState(false)

  useEffect(() => {
    const unsub = window.api.onModSyncProgress((p) => {
      setModSyncActive(p.phase !== 'done' && p.phase !== 'cancelled')
      // If the user cancelled the join (closed the BeamNG window mid-sync),
      // also clear the "Connecting to server" overlay — otherwise it stays
      // stuck because the joinServer() promise never resolves.
      if (p.phase === 'cancelled') {
        setJoining(false)
      }
    })
    return unsub
  }, [])

  // Check if BeamMP.zip is installed
  useEffect(() => {
    window.api.checkBeamMPInstalled().then(setBeammpInstalled)
  }, [])

  const handleInstallBeamMP = async (): Promise<void> => {
    setBeammpInstalling(true)
    try {
      const result = await window.api.installBeamMP()
      if (result.success) setBeammpInstalled(true)
    } catch { /* ignore */ }
    setBeammpInstalling(false)
  }

  // Connection state (real-time)
  const [gameStatus, setGameStatus] = useState<{ running: boolean; pid: number | null; connectedServer: string | null }>({ running: false, pid: null, connectedServer: null })

  // Persistent probe cache — survives auto-refresh rebuilds
  type ProbeInfo = { online: boolean; sname?: string; map?: string; players?: string; maxplayers?: string; modstotal?: string; playerslist?: string }
  const probeCache = useRef<Map<string, ProbeInfo>>(new Map())

  // Load user labels from directConnectServers localStorage
  const getUserLabel = useCallback((ident: string): string | null => {
    try {
      const raw = localStorage.getItem('directConnectServers')
      if (!raw) return null
      const list = JSON.parse(raw) as { address: string; label: string }[]
      const entry = list.find((s) => s.address === ident)
      return entry?.label || null
    } catch { return null }
  }, [])

  // Persist probe metadata to localStorage so it survives app restarts
  const persistMeta = useCallback((ident: string, probe: ProbeInfo) => {
    if (!probe.online) return
    try {
      const raw = localStorage.getItem('directConnectServerMeta')
      const meta: Record<string, { sname?: string; map?: string; players?: string; maxplayers?: string; modstotal?: string }> = raw ? JSON.parse(raw) : {}
      meta[ident] = {
        sname: probe.sname,
        map: probe.map,
        players: probe.players,
        maxplayers: probe.maxplayers,
        modstotal: probe.modstotal
      }
      localStorage.setItem('directConnectServerMeta', JSON.stringify(meta))
    } catch { /* ignore */ }
  }, [])

  // Apply cached probe data to offline placeholder favorites
  const applyProbeCache = useCallback(() => {
    if (probeCache.current.size === 0) return
    useServerStore.setState((state) => ({
      filteredServers: state.filteredServers.map((s) => {
        const ident = `${s.ip}:${s.port}`
        if (s.tags !== 'offline' || !favorites.has(ident)) return s
        const probe = probeCache.current.get(ident)
        if (!probe) return s
        if (!probe.online) {
          // Server is offline — keep last-known metadata (already loaded from localStorage by store)
          return s
        }
        return {
          ...s,
          sname: probe.sname || s.sname,
          map: probe.map || s.map,
          players: probe.players || s.players,
          maxplayers: probe.maxplayers || s.maxplayers,
          modstotal: probe.modstotal || s.modstotal,
          playerslist: probe.playerslist || s.playerslist,
          sdesc: '',
          tags: ''
        }
      })
    }))
  }, [favorites])

  // Stable identity of which favorites are currently showing as offline
  const offlineFavIdent = useMemo(
    () =>
      filteredServers
        .filter((s) => favorites.has(`${s.ip}:${s.port}`) && s.tags === 'offline')
        .map((s) => `${s.ip}:${s.port}`)
        .sort()
        .join(','),
    [filteredServers, favorites]
  )

  // Probe offline favorite servers, cache results, persist, and apply
  useEffect(() => {
    if (!offlineFavIdent) return // No offline favorites

    const offlineFavs = filteredServers.filter(
      (s) => favorites.has(`${s.ip}:${s.port}`) && s.sdesc === 'Offline' && s.tags === 'offline'
    )

    // Apply any cached results immediately (covers auto-refresh scenarios)
    const hasCached = offlineFavs.some((s) => probeCache.current.has(`${s.ip}:${s.port}`))
    if (hasCached) applyProbeCache()

    // After cache application, check what still needs probing (read fresh state)
    const stillOffline = useServerStore.getState().filteredServers.filter(
      (s) => favorites.has(`${s.ip}:${s.port}`) && s.tags === 'offline'
    )
    if (stillOffline.length === 0) return

    let cancelled = false
    Promise.all(
      stillOffline.map(async (s) => {
        const result = await window.api.probeServer(s.ip, s.port)
        return { ident: `${s.ip}:${s.port}`, result }
      })
    ).then((probes) => {
      if (cancelled) return
      for (const { ident, result } of probes) {
        probeCache.current.set(ident, result)
        persistMeta(ident, result)
      }
      applyProbeCache()
    })

    return () => { cancelled = true }
  }, [offlineFavIdent, filterTab, applyProbeCache, persistMeta])

  // Queue state — lifted here so it's shared across all panels
  const [queueActive, setQueueActive] = useState(false)
  const [queueTarget, setQueueTarget] = useState<{ ip: string; port: string; sname: string } | null>(null)
  const [queueMessage, setQueueMessage] = useState('')
  const [queueElapsed, setQueueElapsed] = useState(0)

  useEffect(() => {
    loadFavorites()
    if (filteredServers.length === 0 && !loading) {
      fetchServers()
    }
    // Load initial game status
    window.api.getGameStatus().then(setGameStatus)
    // Listen for real-time game status changes
    const unsubStatus = window.api.onGameStatusChange((s) => {
      setGameStatus((prev) => {
        // If the game just stopped running, also clear the local "joining"
        // state so the "Connecting to server" overlay doesn't stay stuck
        // after the user closed the BeamNG window mid-launch.
        if (prev.running && !s.running) {
          setJoining(false)
          setModSyncActive(false)
        }
        return s
      })
    })
    // Auto-refresh server list every 30 seconds, but only when the window is visible
    let interval: ReturnType<typeof setInterval> | null = null
    const refreshAndReprobe = (): void => {
      // Don't clear probeCache — it will be re-applied immediately after
      // fetchServers replaces filteredServers with fresh offline placeholders
      fetchServers()
    }
    const startPolling = (): void => {
      if (!interval) interval = setInterval(() => refreshAndReprobe(), 30_000)
    }
    const stopPolling = (): void => {
      if (interval) { clearInterval(interval); interval = null }
    }
    const onVisibility = (): void => {
      if (document.hidden) stopPolling(); else startPolling()
    }
    if (!document.hidden) startPolling()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopPolling()
      unsubStatus()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Queue event listeners
  useEffect(() => {
    const unsubStatus = window.api.onQueueStatus((status) => {
      setQueueActive(status.active)
      setQueueTarget(status.active ? { ip: status.ip, port: status.port, sname: status.sname } : null)
      setQueueMessage(status.message)
      setQueueElapsed(status.elapsed)
    })

    const unsubJoined = window.api.onQueueJoined((result) => {
      setQueueActive(false)
      setQueueTarget(null)
      if (!result.success) {
        setQueueMessage(`Auto-join failed: ${result.error || 'Unknown error'}`)
      } else {
        setQueueMessage('')
      }
    })

    // Rehydrate on mount
    window.api.queueGetStatus().then((status) => {
      if (status.active && status.ip && status.port && status.sname) {
        setQueueActive(true)
        setQueueTarget({ ip: status.ip, port: status.port, sname: status.sname })
        setQueueElapsed(status.elapsed)
        setQueueMessage('Waiting for an open slot...')
      }
    })

    return () => {
      unsubStatus()
      unsubJoined()
    }
  }, [])

  const handleQueueStart = async (): Promise<void> => {
    if (!selectedServer) return
    // Check auth — require sign in before queuing
    try {
      const auth = await window.api.getAuthInfo()
      if (!auth.authenticated) {
        setJoinError(t('servers.signInRequired'))
        setHighlightSignIn(true)
        setTimeout(() => setHighlightSignIn(false), 3000)
        return
      }
    } catch { /* proceed anyway if check fails */ }
    setQueueActive(true)
    setQueueTarget({ ip: selectedServer.ip, port: selectedServer.port, sname: selectedServer.sname })
    setQueueMessage('Starting queue...')
    await window.api.queueStart(selectedServer.ip, selectedServer.port, selectedServer.sname)
  }

  const handleQueueStop = async (): Promise<void> => {
    await window.api.queueStop()
    setQueueActive(false)
    setQueueTarget(null)
    setQueueMessage('')
  }

  const formatElapsed = (ms: number): string => {
    const secs = Math.floor(ms / 1000)
    const mins = Math.floor(secs / 60)
    const s = secs % 60
    return mins > 0 ? `${mins}m ${s}s` : `${s}s`
  }

  const summary = useMemo(() => {
    const total = filteredServers.length
    const official = filteredServers.filter((s) => s.official).length
    const modded = filteredServers.filter((s) => parseInt(s.modstotal, 10) > 0).length
    const totalPlayers = filteredServers.reduce((sum, s) => sum + (parseInt(s.players, 10) || 0), 0)
    return { total, official, modded, totalPlayers }
  }, [filteredServers])

  // Join: check auth first, then connect
  const handleJoinServer = useCallback(async (ip: string, port: string): Promise<void> => {
    if (gameStatus.connectedServer) {
      setJoinError('Already connected to a server. Disconnect first.')
      return
    }
    // Check auth — require sign in before joining
    try {
      const auth = await window.api.getAuthInfo()
      if (!auth.authenticated) {
        setJoinError(t('servers.signInRequired'))
        setHighlightSignIn(true)
        setTimeout(() => setHighlightSignIn(false), 3000)
        return
      }
    } catch { /* proceed anyway if check fails */ }
    doJoin(ip, port)
  }, [gameStatus.connectedServer, t])

  const doJoin = async (ip: string, port: string): Promise<void> => {
    setJoining(true)
    setJoinError(null)
    try {
      const result = await window.api.joinServer(ip, parseInt(port, 10))
      if (!result.success) setJoinError(result.error || 'Failed to join server')
    } catch (err) {
      setJoinError(String(err))
    } finally {
      setJoining(false)
    }
  }

  const handleJoin = (): void => {
    if (!selectedServer) return
    handleJoinServer(selectedServer.ip, selectedServer.port)
  }

  const handleDirectConnect = (ip: string, port: string): void => {
    handleJoinServer(ip, port)
  }

  return (
    <div className="relative flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Top toolbar area — no card wrapper, sits on background */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 pt-4 pb-4 space-y-4">
        <ServersToolbar
          serverCount={filteredServers.length}
          searchQuery={searchQuery}
          loading={loading}
          joining={joining}
          highlightSignIn={highlightSignIn}
          onSearch={setSearchQuery}
          onRefresh={fetchServers}
          onDirectConnect={handleDirectConnect}
        />

        {/* Stats row — 4 equal columns */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <Globe size={11} /> {t('servers.visibleServers')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.total}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <Users size={11} /> {t('servers.playersOnline')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.totalPlayers}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <Shield size={11} /> {t('servers.official')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.official}</div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <Package size={11} /> {t('servers.modded')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.modded}</div>
          </div>
        </div>

        {/* Filters row */}
        <ServersFilters
          filterTab={filterTab}
          sortField={sortField}
          sortDir={sortDir}
          quickFilters={quickFilters}
          onFilterTab={setFilterTab}
          onSort={setSort}
          onToggleQuickFilter={toggleQuickFilter}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* BeamMP.zip missing banner */}
      {beammpInstalled === false && (
        <div className="mx-5 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-amber-500/10 border-amber-500/30">
          <Download size={16} className={beammpInstalling ? 'text-amber-400 animate-pulse' : 'text-amber-400'} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {beammpInstalling ? t('servers.beammpDownloading') : t('servers.beammpNotInstalled')}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('servers.beammpNotInstalledDesc')}
            </p>
          </div>
          {!beammpInstalling && (
            <button
              onClick={handleInstallBeamMP}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors shrink-0"
            >
              <Download size={12} /> {t('servers.beammpInstall')}
            </button>
          )}
          {beammpInstalling && (
            <Loader2 size={16} className="text-amber-400 animate-spin shrink-0" />
          )}
        </div>
      )}

      {/* Content: list + detail side-by-side */}
      <div className="flex-1 flex min-h-0">
        {loading && filteredServers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm">
            {t('servers.loadingServers')}
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 border-r border-[var(--color-border)] relative">
              <ServerList
                servers={filteredServers}
                selectedServer={selectedServer}
                favorites={favorites}
                onSelect={selectServer}
                onToggleFavorite={toggleFavorite}
              />

              {/* Queue overlay — covers the server list while waiting */}
              {queueActive && queueTarget && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[var(--color-scrim-80)] backdrop-blur-sm">
                  <Clock size={28} className="text-[var(--color-accent-text)] animate-pulse mb-3" />
                  <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{t('servers.waitingToJoin')}</div>
                  <div className="text-xs text-[var(--color-accent-text-muted)] mb-1 max-w-[280px] text-center truncate"><BeamMPText text={queueTarget.sname} /></div>
                  <div className="text-xs text-[var(--color-text-secondary)] mb-4">{queueMessage} — {formatElapsed(queueElapsed)}</div>
                  <button
                    onClick={handleQueueStop}
                    className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text-muted)] transition hover:bg-[var(--color-accent-20)]"
                  >
                    <X size={13} />
                    {t('servers.cancelQueue')}
                  </button>
                </div>
              )}

              {/* Mod sync progress overlay — always on top until complete */}
              <ModSyncOverlay />
            </div>
            {selectedServer && (
              <div
                className="shrink-0 border-l border-[var(--color-border)] overflow-hidden"
                style={{ width: 400 }}
              >
                <ServerDetailPanel
                  server={selectedServer}
                  favorite={favorites.has(`${selectedServer.ip}:${selectedServer.port}`)}
                  userLabel={getUserLabel(`${selectedServer.ip}:${selectedServer.port}`)}
                  joining={joining}
                  joinError={joinError}
                  connectedServer={gameStatus.connectedServer}
                  onJoin={handleJoin}
                  onClose={() => selectServer(null)}
                  onToggleFavorite={() => toggleFavorite(`${selectedServer.ip}:${selectedServer.port}`)}
                  queueActive={queueActive}
                  queueTarget={queueTarget}
                  queueMessage={queueMessage}
                  queueElapsed={queueElapsed}
                  onQueueStart={handleQueueStart}
                  onQueueStop={handleQueueStop}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Connecting overlay — only after mod sync is done */}
      {joining && !modSyncActive && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[var(--color-scrim-80)] backdrop-blur-sm">
          <div className="relative mb-4">
            <div className="h-10 w-10 rounded-full border-2 border-[var(--color-accent-20)]" />
            <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-transparent border-t-[var(--color-accent)] animate-spin" />
          </div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{t('servers.connectingToServer')}</div>
          <div className="text-xs text-[var(--color-text-secondary)]">{t('servers.syncingMods')}</div>
        </div>
      )}
    </div>
  )
}
