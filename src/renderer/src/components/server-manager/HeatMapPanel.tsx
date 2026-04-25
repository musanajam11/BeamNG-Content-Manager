import { useState, useEffect, useCallback, useMemo } from 'react'
import type { PlayerPosition, HostedServerEntry } from '../../../../shared/types'
import { getBounds, type MapBounds } from './mapBounds'
import HeatMapScene from './HeatMapScene'
import HeatMapToolbar from './HeatMapToolbar'

const HEATMAP_RES = 256
const HEATMAP_MAPPING_VERSION = 3

interface HeatMapPanelProps {
  server: HostedServerEntry
}

interface HeatMapRuntime {
  serverId: string
  mapPath: string
  mappingVersion: number
  bounds: MapBounds
  heatmapWorldBounds: MapBounds
  // texBounds is set by the scene when the minimap image loads — same bounds
  // that worldToPlane() uses. Accumulation in runPoll uses these so bins
  // are guaranteed to land on the same pixel as the player marker.
  texBounds: MapBounds | null
  players: PlayerPosition[]
  showHeatmap: boolean
  heatGrid: Float32Array
  heatGridVersion: number
  emptyPolls: number
  running: boolean
  pollTimer: ReturnType<typeof setInterval> | null
  subscribers: Set<() => void>
}

const runtimeByServer = new Map<string, HeatMapRuntime>()

function normalizeMapPath(mapPath: string): string {
  // BeamMP network map messages may include a leading "M" prefix
  // (e.g. "M/levels/west_coast_usa/info.json"). Normalize so runtime keys,
  // map-bound lookups, and minimap loading remain stable across navigation.
  return mapPath.startsWith('M/') ? mapPath.slice(1) : mapPath
}

function createRuntime(serverId: string, mapPath: string): HeatMapRuntime {
  const normalizedMapPath = normalizeMapPath(mapPath)
  return {
    serverId,
    mapPath: normalizedMapPath,
    mappingVersion: HEATMAP_MAPPING_VERSION,
    bounds: getBounds(normalizedMapPath),
    heatmapWorldBounds: getBounds(normalizedMapPath),
    texBounds: null,
    players: [],
    showHeatmap: false,
    heatGrid: new Float32Array(HEATMAP_RES * HEATMAP_RES),
    heatGridVersion: 0,
    emptyPolls: 0,
    running: false,
    pollTimer: null,
    subscribers: new Set()
  }
}

function getRuntime(serverId: string, mapPath: string): HeatMapRuntime {
  const normalizedMapPath = normalizeMapPath(mapPath)
  const existing = runtimeByServer.get(serverId)
  if (existing) {
    const mapChanged = existing.mapPath !== normalizedMapPath
    const mappingChanged = existing.mappingVersion !== HEATMAP_MAPPING_VERSION
    if (mapChanged || mappingChanged) {
      existing.mapPath = normalizedMapPath
      existing.mappingVersion = HEATMAP_MAPPING_VERSION
      existing.bounds = getBounds(normalizedMapPath)
      existing.heatmapWorldBounds = getBounds(normalizedMapPath)
      // Projection or map changed: clear stale bins so old coordinates do not
      // pollute the new heatmap alignment.
      existing.heatGrid.fill(0)
      existing.heatGridVersion += 1
    }
    return existing
  }
  const created = createRuntime(serverId, mapPath)
  runtimeByServer.set(serverId, created)
  return created
}

function notifyRuntime(runtime: HeatMapRuntime): void {
  for (const cb of runtime.subscribers) cb()
}

function runPoll(runtime: HeatMapRuntime): void {
  window.api
    .hostedServerGetPlayerPositions(runtime.serverId)
    .then((ps) => {
      if (ps.length > 0) {
        runtime.players = ps
        runtime.emptyPolls = 0
      } else {
        runtime.emptyPolls += 1
        // Avoid flicker/disappearance from transient empty reads while the tracker
        // file is being written. Require a few consecutive empty polls before clear.
        if (runtime.emptyPolls >= 3) {
          runtime.players = []
        }
      }
      // Accumulate heat using the same coordinate system as the scene marker placement.
      // texBounds (set by scene when minimap loads) matches worldToPlane() in the scene.
      // DataTexture row 0 = UV v=0 = south edge, so gy must be flipped.
      let gridChanged = false
      if (runtime.showHeatmap && runtime.players.length > 0) {
        const wb = runtime.texBounds ?? runtime.heatmapWorldBounds
        const grid = runtime.heatGrid
        for (const p of runtime.players) {
          const u = (p.x - wb.minX) / (wb.maxX - wb.minX)
          const v = (wb.maxY - p.y) / (wb.maxY - wb.minY)
          const gx = Math.floor(u * (HEATMAP_RES - 1))
          const gy = (HEATMAP_RES - 1) - Math.floor(v * (HEATMAP_RES - 1))
          if (gx >= 0 && gx < HEATMAP_RES && gy >= 0 && gy < HEATMAP_RES) {
            grid[gy * HEATMAP_RES + gx] += 1
            gridChanged = true
          }
        }
      }
      if (gridChanged) runtime.heatGridVersion += 1
      notifyRuntime(runtime)
    })
    .catch(() => {})
}

function syncPolling(runtime: HeatMapRuntime): void {
  // Keep polling while mounted even if runtime.running briefly desyncs during
  // navigation. Also continue polling in background while running so heat data
  // and player markers persist across page switches.
  const shouldPoll = runtime.running || runtime.subscribers.size > 0
  if (shouldPoll && !runtime.pollTimer) {
    runPoll(runtime)
    runtime.pollTimer = setInterval(() => runPoll(runtime), 1000)
    return
  }
  if (!shouldPoll && runtime.pollTimer) {
    clearInterval(runtime.pollTimer)
    runtime.pollTimer = null
  }
}

export default function HeatMapPanel({ server }: HeatMapPanelProps): React.JSX.Element {
  const normalizedMapPath = useMemo(() => normalizeMapPath(server.config.map), [server.config.map])
  const runtime = useMemo(() => getRuntime(server.config.id, normalizedMapPath), [server.config.id, normalizedMapPath])
  const [players, setPlayers] = useState<PlayerPosition[]>(runtime.players)
  const [trackerDeployed, setTrackerDeployed] = useState(false)
  const [voicePluginDeployed, setVoicePluginDeployed] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(runtime.showHeatmap)
  const [heatGridVersion, setHeatGridVersion] = useState(runtime.heatGridVersion)

  const isRunning = server.status.state === 'running'
  const showLivePlayers = isRunning && trackerDeployed
  const visiblePlayers = showLivePlayers ? players : []

  // Snapshot the grid for render (keyed to version so it updates when grid changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heatGridSnapshot = useMemo(() => runtime.heatGrid, [runtime, heatGridVersion])

  useEffect(() => {
    const onRuntime = (): void => {
      setPlayers(runtime.players)
      setShowHeatmap(runtime.showHeatmap)
      setHeatGridVersion(runtime.heatGridVersion)
    }
    runtime.subscribers.add(onRuntime)
    onRuntime()
    syncPolling(runtime)
    return () => {
      runtime.subscribers.delete(onRuntime)
      syncPolling(runtime)
    }
  }, [runtime])

  useEffect(() => {
    let cancelled = false
    window.api.getMapMinimap(runtime.mapPath)
      .then((result) => {
        if (cancelled) return
        runtime.heatmapWorldBounds = result?.worldBounds
          ? result.worldBounds
          : getBounds(runtime.mapPath)
      })
      .catch(() => {
        if (cancelled) return
        runtime.heatmapWorldBounds = getBounds(runtime.mapPath)
      })
    return () => { cancelled = true }
  }, [runtime, runtime.mapPath])

  /* ── Check deploy state on mount ─────────────────────────────── */
  useEffect(() => {
    const id = server.config.id
    window.api.hostedServerIsTrackerDeployed(id).then(setTrackerDeployed).catch(() => {})
    window.api.hostedServerIsVoicePluginDeployed(id).then(setVoicePluginDeployed).catch(() => {})
  }, [server.config.id])

  useEffect(() => {
    runtime.running = isRunning
    // Do not clear players immediately on transient non-running states.
    // Polling + staleness filtering in getPlayerPositions will naturally
    // remove markers when the tracker actually stops writing.
    syncPolling(runtime)
  }, [isRunning, runtime])

  const handleDeployTracker = useCallback(() => {
    window.api
      .hostedServerDeployTracker(server.config.id)
      .then(() => setTrackerDeployed(true))
      .catch(() => {})
  }, [server.config.id])

  const handleUndeployTracker = useCallback(() => {
    window.api
      .hostedServerUndeployTracker(server.config.id)
      .then(() => setTrackerDeployed(false))
      .catch(() => {})
  }, [server.config.id])

  const handleDeployVoicePlugin = useCallback(() => {
    window.api
      .hostedServerDeployVoicePlugin(server.config.id)
      .then(() => setVoicePluginDeployed(true))
      .catch(() => {})
  }, [server.config.id])

  const handleUndeployVoicePlugin = useCallback(() => {
    window.api
      .hostedServerUndeployVoicePlugin(server.config.id)
      .then(() => setVoicePluginDeployed(false))
      .catch(() => {})
  }, [server.config.id])

  const handleClearHeatmap = useCallback(() => {
    runtime.heatGrid.fill(0)
    runtime.heatGridVersion += 1
    notifyRuntime(runtime)
  }, [runtime])

  const handleTexBoundsLoaded = useCallback(
    (bounds: { minX: number; maxX: number; minY: number; maxY: number } | null) => {
      runtime.texBounds = bounds
    },
    [runtime]
  )

  const handleToggleHeatmap = useCallback(() => {
    runtime.showHeatmap = !runtime.showHeatmap
    syncPolling(runtime)
    notifyRuntime(runtime)
  }, [runtime])

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full">
      <HeatMapToolbar
        playerCount={visiblePlayers.length}
        trackerDeployed={trackerDeployed}
        voicePluginDeployed={voicePluginDeployed}
        showHeatmap={showHeatmap}
        onToggleHeatmap={handleToggleHeatmap}
        onClearHeatmap={handleClearHeatmap}
        onDeployTracker={handleDeployTracker}
        onUndeployTracker={handleUndeployTracker}
        onDeployVoicePlugin={handleDeployVoicePlugin}
        onUndeployVoicePlugin={handleUndeployVoicePlugin}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 3D scene */}
        <div className="flex-1 min-h-0 relative">
          <HeatMapScene
            mapPath={normalizedMapPath}
            players={visiblePlayers}
            routes={[]}
            mode="view"
            bounds={runtime.bounds}
            showHeatmap={showHeatmap}
            heatGrid={heatGridSnapshot}
            heatGridVersion={heatGridVersion}
            heatGridRes={HEATMAP_RES}
            onTexBoundsLoaded={handleTexBoundsLoaded}
          />
        </div>

        {/* Player sidebar */}
        {visiblePlayers.length > 0 && (
          <div className="w-56 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
              <h3 className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wider">
                Live Players
              </h3>
            </div>
            <div className="p-2 space-y-1">
              {visiblePlayers.map((p) => {
                const hue = (p.playerId * 0.15) % 1
                const dotColor = `hsl(${Math.round(hue * 360)}, 80%, 55%)`
                return (
                  <div
                    key={`${p.playerId}-${p.vehicleId}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="text-xs text-[var(--color-text-secondary)] truncate">{p.playerName}</span>
                    </div>
                    <span className="text-[10px] text-[var(--color-text-dim)] tabular-nums ml-2 shrink-0">
                      {Math.round(p.speed)} km/h
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
