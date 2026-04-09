import { useState, useEffect, useCallback, useRef } from 'react'
import type { PlayerPosition, HostedServerEntry } from '../../../../shared/types'
import { getBounds, worldToNorm } from './mapBounds'
import HeatMapScene from './HeatMapScene'
import HeatMapToolbar from './HeatMapToolbar'

const HEATMAP_RES = 256

interface HeatMapPanelProps {
  server: HostedServerEntry
}

export default function HeatMapPanel({ server }: HeatMapPanelProps): React.JSX.Element {
  const [players, setPlayers] = useState<PlayerPosition[]>([])
  const [trackerDeployed, setTrackerDeployed] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heatGridRef = useRef<Float32Array>(new Float32Array(HEATMAP_RES * HEATMAP_RES))
  const [heatGridVersion, setHeatGridVersion] = useState(0)

  const bounds = getBounds(server.config.map)
  const isRunning = server.status.state === 'running'

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
        playerCount={players.length}
        trackerDeployed={trackerDeployed}
        showHeatmap={showHeatmap}
        onToggleHeatmap={() => setShowHeatmap((v) => !v)}
        onClearHeatmap={handleClearHeatmap}
        onDeployTracker={handleDeployTracker}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 3D scene */}
        <div className="flex-1 min-h-0 relative">
          <HeatMapScene
            mapPath={server.config.map}
            players={players}
            routes={[]}
            mode="view"
            bounds={bounds}
            showHeatmap={showHeatmap}
            heatGrid={heatGridRef.current}
            heatGridVersion={heatGridVersion}
            heatGridRes={HEATMAP_RES}
          />
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
