import { useState, useEffect, useCallback, useRef } from 'react'
import type { GPSRoute, PlayerPosition, HostedServerEntry } from '../../../../shared/types'
import { getBounds, worldToNorm } from './mapBounds'
import HeatMapScene from './HeatMapScene'
import HeatMapToolbar from './HeatMapToolbar'

const HEATMAP_RES = 256

interface HeatMapPanelProps {
  server: HostedServerEntry
}

export default function HeatMapPanel({ server }: HeatMapPanelProps): React.JSX.Element {
  const [routes, setRoutes] = useState<GPSRoute[]>([])
  const [players, setPlayers] = useState<PlayerPosition[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'plot'>('view')
  const [trackerDeployed, setTrackerDeployed] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heatGridRef = useRef<Float32Array>(new Float32Array(HEATMAP_RES * HEATMAP_RES))
  const [heatGridVersion, setHeatGridVersion] = useState(0)

  const bounds = getBounds(server.config.map)
  const isRunning = server.status.state === 'running'

  /* ── Load routes on mount ────────────────────────────────────── */
  useEffect(() => {
    window.api.hostedServerGetRoutes(server.config.id).then(setRoutes).catch(() => {})
  }, [server.config.id])

  /* ── Poll player positions while server is running ───────────── */
  useEffect(() => {
    if (!isRunning) {
      setPlayers([])
      return
    }

    const poll = (): void => {
      window.api
        .hostedServerGetPlayerPositions(server.config.id)
        .then((ps) => {
          setPlayers(ps)
          // Accumulate positions into heatmap grid
          if (ps.length > 0) {
            const grid = heatGridRef.current
            let changed = false
            for (const p of ps) {
              const { nx, ny } = worldToNorm(p.x, p.y, bounds)
              const gx = Math.floor(nx * (HEATMAP_RES - 1))
              const gy = Math.floor(ny * (HEATMAP_RES - 1))
              if (gx >= 0 && gx < HEATMAP_RES && gy >= 0 && gy < HEATMAP_RES) {
                grid[gy * HEATMAP_RES + gx] += 1
                changed = true
              }
            }
            if (changed) setHeatGridVersion((v) => v + 1)
          }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isRunning, server.config.id])

  /* ── Route management callbacks ──────────────────────────────── */
  const handleCreateRoute = useCallback(() => {
    const route: GPSRoute = {
      id: crypto.randomUUID(),
      name: `Route ${routes.length + 1}`,
      waypoints: [],
      color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
      createdAt: Date.now()
    }
    window.api.hostedServerSaveRoute(server.config.id, route).then((updated) => {
      setRoutes(updated)
      setSelectedRouteId(route.id)
      setMode('plot')
    })
  }, [routes.length, server.config.id])

  const handleDeleteRoute = useCallback(
    (id: string) => {
      window.api.hostedServerDeleteRoute(server.config.id, id).then(setRoutes)
      if (selectedRouteId === id) {
        setSelectedRouteId(null)
        setMode('view')
      }
    },
    [server.config.id, selectedRouteId]
  )

  const handleMapClick = useCallback(
    (worldX: number, worldY: number) => {
      if (!selectedRouteId) return
      const route = routes.find((r) => r.id === selectedRouteId)
      if (!route) return

      const newWp = { id: crypto.randomUUID(), x: worldX, y: worldY }
      const prevWp = route.waypoints.length > 0 ? route.waypoints[route.waypoints.length - 1] : null

      const updated: GPSRoute = {
        ...route,
        waypoints: [...route.waypoints, newWp],
        pathSegments: route.pathSegments ? [...route.pathSegments] : []
      }

      if (prevWp) {
        // Compute road-following path for the new segment
        window.api
          .findMapRoute(server.config.map, prevWp.x, prevWp.y, worldX, worldY)
          .then((path) => {
            const seg = path.length > 0 ? path : [{ x: prevWp.x, y: prevWp.y }, { x: worldX, y: worldY }]
            const withPath: GPSRoute = {
              ...updated,
              pathSegments: [...(updated.pathSegments || []), seg]
            }
            window.api.hostedServerSaveRoute(server.config.id, withPath).then(setRoutes)
          })
          .catch(() => {
            // Fallback to straight line
            const seg = [{ x: prevWp.x, y: prevWp.y }, { x: worldX, y: worldY }]
            const withPath: GPSRoute = {
              ...updated,
              pathSegments: [...(updated.pathSegments || []), seg]
            }
            window.api.hostedServerSaveRoute(server.config.id, withPath).then(setRoutes)
          })
      } else {
        // First waypoint — no segment yet
        window.api.hostedServerSaveRoute(server.config.id, updated).then(setRoutes)
      }
    },
    [selectedRouteId, routes, server.config.id, server.config.map]
  )

  const handleColorChange = useCallback(
    (routeId: string, color: string) => {
      const route = routes.find((r) => r.id === routeId)
      if (!route) return
      window.api
        .hostedServerSaveRoute(server.config.id, { ...route, color })
        .then(setRoutes)
    },
    [routes, server.config.id]
  )

  const handleDeployTracker = useCallback(() => {
    window.api
      .hostedServerDeployTracker(server.config.id)
      .then(() => setTrackerDeployed(true))
      .catch(() => {})
  }, [server.config.id])

  const handleClearHeatmap = useCallback(() => {
    heatGridRef.current.fill(0)
    setHeatGridVersion((v) => v + 1)
  }, [])

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full">
      <HeatMapToolbar
        routes={routes}
        selectedRouteId={selectedRouteId}
        mode={mode}
        playerCount={players.length}
        trackerDeployed={trackerDeployed}
        showHeatmap={showHeatmap}
        onToggleHeatmap={() => setShowHeatmap((v) => !v)}
        onClearHeatmap={handleClearHeatmap}
        onSelectRoute={setSelectedRouteId}
        onCreateRoute={handleCreateRoute}
        onDeleteRoute={handleDeleteRoute}
        onModeChange={setMode}
        onDeployTracker={handleDeployTracker}
        onColorChange={handleColorChange}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 3D scene */}
        <div className="flex-1 min-h-0 relative">
          <HeatMapScene
            mapPath={server.config.map}
            players={players}
            routes={routes}
            mode={mode}
            bounds={bounds}
            showHeatmap={showHeatmap}
            heatGrid={heatGridRef.current}
            heatGridVersion={heatGridVersion}
            heatGridRes={HEATMAP_RES}
            onMapClick={handleMapClick}
          />

          {/* Floating mode hint */}
          {mode === 'plot' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-xs text-indigo-200 backdrop-blur-sm pointer-events-none">
              Click on the map to place waypoints
            </div>
          )}
        </div>

        {/* Player sidebar */}
        {players.length > 0 && (
          <div className="w-56 border-l border-white/10 bg-white/[0.015] overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-white/10">
              <h3 className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                Live Players
              </h3>
            </div>
            <div className="p-2 space-y-1">
              {players.map((p) => {
                const hue = (p.playerId * 0.15) % 1
                const dotColor = `hsl(${Math.round(hue * 360)}, 80%, 55%)`
                return (
                  <div
                    key={`${p.playerId}-${p.vehicleId}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="text-xs text-white/70 truncate">{p.playerName}</span>
                    </div>
                    <span className="text-[10px] text-white/40 tabular-nums ml-2 shrink-0">
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
