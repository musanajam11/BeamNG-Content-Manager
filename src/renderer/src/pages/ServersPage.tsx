import { useState, useEffect, useMemo } from 'react'
import { useServerStore } from '../stores/useServerStore'
import { ServersToolbar } from '../components/servers/ServersToolbar'
import { ServersFilters } from '../components/servers/ServersFilters'
import { ServerList } from '../components/servers/ServerList'
import { ServerDetailPanel } from '../components/servers/ServerDetailPanel'
import { ModSyncOverlay } from '../components/servers/ModSyncOverlay'
import { Globe, Users, Shield, Package, Clock, X } from 'lucide-react'
import { BeamMPText } from '../components/BeamMPText'

export function ServersPage(): React.JSX.Element {
  const {
    filteredServers, loading, error, searchQuery, selectedServer, favorites,
    sortField, sortDir, filterTab, quickFilters,
    fetchServers, loadFavorites, toggleFavorite, setSearchQuery, selectServer, setSort, setFilterTab, toggleQuickFilter
  } = useServerStore()
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

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
    // Auto-refresh server list every 30 seconds, but only when the window is visible
    let interval: ReturnType<typeof setInterval> | null = null
    const startPolling = (): void => {
      if (!interval) interval = setInterval(() => fetchServers(), 30_000)
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

  const handleJoin = async (): Promise<void> => {
    if (!selectedServer) return
    setJoining(true)
    setJoinError(null)
    try {
      const result = await window.api.joinServer(selectedServer.ip, parseInt(selectedServer.port, 10))
      if (!result.success) setJoinError(result.error || 'Failed to join server')
    } catch (err) {
      setJoinError(String(err))
    } finally {
      setJoining(false)
    }
  }

  const handleDirectConnect = async (ip: string, port: string): Promise<void> => {
    setJoining(true)
    setJoinError(null)
    try {
      const result = await window.api.joinServer(ip, parseInt(port, 10))
      if (!result.success) setJoinError(result.error || 'Failed to connect')
    } catch (err) {
      setJoinError(String(err))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="flex flex-col h-full rounded-lg border border-white/6 overflow-hidden">
      {/* Top toolbar area — no card wrapper, sits on background */}
      <div className="shrink-0 border-b border-white/6 px-5 pt-4 pb-4 space-y-4">
        <ServersToolbar
          serverCount={filteredServers.length}
          searchQuery={searchQuery}
          loading={loading}
          joining={joining}
          onSearch={setSearchQuery}
          onRefresh={fetchServers}
          onDirectConnect={handleDirectConnect}
        />

        {/* Stats row — 4 equal columns */}
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <Globe size={11} /> Visible servers
            </div>
            <div className="text-lg font-bold text-white">{summary.total}</div>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <Users size={11} /> Players online
            </div>
            <div className="text-lg font-bold text-white">{summary.totalPlayers}</div>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <Shield size={11} /> Official
            </div>
            <div className="text-lg font-bold text-white">{summary.official}</div>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <Package size={11} /> Modded
            </div>
            <div className="text-lg font-bold text-white">{summary.modded}</div>
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

      {/* Content: list + detail side-by-side */}
      <div className="flex-1 flex min-h-0">
        {loading && filteredServers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Loading servers...
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 border-r border-white/6 relative">
              <ServerList
                servers={filteredServers}
                selectedServer={selectedServer}
                favorites={favorites}
                onSelect={selectServer}
                onToggleFavorite={toggleFavorite}
              />

              {/* Queue overlay — covers the server list while waiting */}
              {queueActive && queueTarget && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#111113]/85 backdrop-blur-sm">
                  <Clock size={28} className="text-[var(--color-accent-text)] animate-pulse mb-3" />
                  <div className="text-sm font-semibold text-white mb-1">Waiting to join</div>
                  <div className="text-xs text-[var(--color-accent-text-muted)] mb-1 max-w-[280px] text-center truncate"><BeamMPText text={queueTarget.sname} /></div>
                  <div className="text-xs text-slate-400 mb-4">{queueMessage} — {formatElapsed(queueElapsed)}</div>
                  <button
                    onClick={handleQueueStop}
                    className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text-muted)] transition hover:bg-[var(--color-accent-20)]"
                  >
                    <X size={13} />
                    Cancel queue
                  </button>
                </div>
              )}

              {/* Mod sync progress overlay */}
              <ModSyncOverlay />
            </div>
            {selectedServer && (
              <div className="w-[400px] shrink-0">
                <ServerDetailPanel
                  server={selectedServer}
                  favorite={favorites.has(`${selectedServer.ip}:${selectedServer.port}`)}
                  joining={joining}
                  joinError={joinError}
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
    </div>
  )
}
