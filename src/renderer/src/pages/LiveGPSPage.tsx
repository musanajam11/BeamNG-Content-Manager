import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigation2, Power, PowerOff, Loader2, ZoomIn, ZoomOut, Locate } from 'lucide-react'
import type { GPSTelemetry, GPSMapPOI } from '../../../shared/types'

type MapListItem = { name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string }

function formatSpeed(metersPerSec: number): string {
  const kmh = metersPerSec * 3.6
  return `${Math.round(kmh)} km/h`
}

function formatMapName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function LiveGPSPage(): React.JSX.Element {
  const { t } = useTranslation()

  // Tracker state
  const [deployed, setDeployed] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [telemetry, setTelemetry] = useState<GPSTelemetry | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Map selection
  const [maps, setMaps] = useState<MapListItem[]>([])
  const [selectedMap, setSelectedMap] = useState<string>('')
  const lastDetectedMapRef = useRef<string>('')
  const [minimapData, setMinimapData] = useState<{ dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>(null)
  const [loadingMinimap, setLoadingMinimap] = useState(false)

  // Canvas / viewport
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [followPlayer, setFollowPlayer] = useState(true)
  const minimapImgRef = useRef<HTMLImageElement | null>(null)
  const [mapPOIs, setMapPOIs] = useState<GPSMapPOI[]>([])
  const [hoveredPOI, setHoveredPOI] = useState<number | null>(null) // index into mapPOIs
  const poiScreenPositions = useRef<Array<{ x: number; y: number }>>([])

  // Load maps list
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await window.api.listMaps()
        if (!cancelled) setMaps(list)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Check initial deploy state
  useEffect(() => {
    ;(async () => {
      try {
        const isDeployed = await window.api.gpsIsTrackerDeployed()
        setDeployed(isDeployed)
      } catch { /* ignore */ }
    })()
  }, [])

  // Load minimap when map is selected
  useEffect(() => {
    if (!selectedMap) {
      setMinimapData(null)
      minimapImgRef.current = null
      return
    }
    let cancelled = false
    setLoadingMinimap(true)
    ;(async () => {
      try {
        const mapPath = `/levels/${selectedMap}/`
        const data = await window.api.getMapMinimap(mapPath)
        if (!cancelled) {
          setMinimapData(data)
          if (data?.dataUrl) {
            const img = new Image()
            img.src = data.dataUrl
            img.onload = () => { if (!cancelled) minimapImgRef.current = img }
          }
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoadingMinimap(false)
    })()
    return () => { cancelled = true }
  }, [selectedMap])

  // Load POIs when map is selected
  useEffect(() => {
    if (!selectedMap) { setMapPOIs([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const pois = await window.api.gpsGetMapPOIs(selectedMap)
        if (!cancelled) setMapPOIs(pois)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [selectedMap])

  // Auto-detect map from telemetry (re-detects on map change)
  useEffect(() => {
    if (telemetry?.map && maps.length > 0) {
      const raw = telemetry.map
        .replace(/^\/levels\//, '')
        .replace(/\/main\.level\.json$/, '')
        .replace(/\/info\.json$/, '')
        .replace(/\/$/, '')
      if (raw && raw !== lastDetectedMapRef.current) {
        const rawLower = raw.toLowerCase()
        const match = maps.find((m) =>
          m.name.toLowerCase() === rawLower ||
          (m.levelDir && m.levelDir.toLowerCase() === rawLower)
        )
        if (match) {
          setSelectedMap(match.name)
          lastDetectedMapRef.current = raw
        }
      }
    } else if (!telemetry) {
      // Player left the game / no vehicle — clear detection + map so next session re-detects
      lastDetectedMapRef.current = ''
      setSelectedMap('')
    }
  }, [telemetry?.map, maps])

  // Poll telemetry when deployed
  useEffect(() => {
    if (!deployed) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setTelemetry(null)
      return
    }
    const poll = async (): Promise<void> => {
      try {
        const data = await window.api.gpsGetTelemetry()
        if (data) setTelemetry(data)
      } catch { /* ignore */ }
    }
    poll()
    pollRef.current = setInterval(poll, 100) // 10 Hz polling
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [deployed])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    // Background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, w, h)

    const bounds = minimapData?.worldBounds ?? { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 }
    const worldW = bounds.maxX - bounds.minX
    const worldH = bounds.maxY - bounds.minY

    // Helper: world coords → canvas coords (within the zoomed/transformed space)
    const worldToCanvas = (wx: number, wy: number): [number, number] => [
      ((wx - bounds.minX) / worldW) * w,
      (1 - (wy - bounds.minY) / worldH) * h
    ]

    // Compute view transform
    let offsetX = 0
    let offsetY = 0
    if (followPlayer && telemetry) {
      const nx = (telemetry.x - bounds.minX) / worldW
      const ny = (telemetry.y - bounds.minY) / worldH
      offsetX = w / 2 - nx * w * zoom
      offsetY = h / 2 - (1 - ny) * h * zoom
    } else {
      offsetX = (w - w * zoom) / 2
      offsetY = (h - h * zoom) / 2
    }

    ctx.save()
    ctx.translate(offsetX, offsetY)
    ctx.scale(zoom, zoom)

    // Draw minimap image
    if (minimapImgRef.current) {
      ctx.drawImage(minimapImgRef.current, 0, 0, w, h)
    } else {
      // Grid fallback
      ctx.strokeStyle = '#2a2a4a'
      ctx.lineWidth = 1
      const gridStep = w / 16
      for (let x = 0; x <= w; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = 0; y <= h; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }
    }

    // ── Draw POIs ──
    const iconSize = Math.max(5, 8 / zoom)
    const fontSize = Math.max(8, 11 / zoom)
    ctx.textAlign = 'center'
    const screenPos: Array<{ x: number; y: number }> = []

    for (let i = 0; i < mapPOIs.length; i++) {
      const poi = mapPOIs[i]
      const [px, py] = worldToCanvas(poi.x, poi.y)
      // Store screen position (transformed) for hit-testing
      const mat = ctx.getTransform()
      screenPos.push({ x: mat.a * px + mat.c * py + mat.e, y: mat.b * px + mat.d * py + mat.f })

      const isHovered = hoveredPOI === i

      // POI icon colours — prefer symbolic icons with short single-word labels
      let color = '#888'
      let icon = '●'
      let shortLabel = ''
      switch (poi.type) {
        case 'spawn': color = '#22d3ee'; icon = '📍'; break
        case 'gas_station': color = '#facc15'; icon = '⛽'; shortLabel = 'Gas'; break
        case 'garage': color = '#a78bfa'; icon = '🔧'; shortLabel = 'Garage'; break
        case 'dealership': color = '#34d399'; icon = '🚗'; shortLabel = 'Dealer'; break
        case 'shop': color = '#fb923c'; icon = '🏪'; shortLabel = 'Shop'; break
        case 'restaurant': color = '#f87171'; icon = '🍔'; shortLabel = 'Food'; break
        case 'mechanic': color = '#60a5fa'; icon = '⚙'; shortLabel = 'Mechanic'; break
        case 'waypoint': color = '#94a3b8'; icon = '📍'; break
      }

      // Highlight ring when hovered
      if (isHovered) {
        ctx.beginPath()
        ctx.arc(px, py, iconSize * 2, 0, Math.PI * 2)
        ctx.strokeStyle = color
        ctx.lineWidth = 2 / zoom
        ctx.stroke()
      }

      ctx.font = `${(isHovered ? iconSize * 2 : iconSize * 1.6)}px sans-serif`
      ctx.fillStyle = color
      ctx.fillText(icon, px, py + iconSize * 0.5)

      // Label — show full name on hover, otherwise short label for service POIs
      const label = isHovered ? poi.name : shortLabel
      if (label) {
        ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.lineWidth = 2.5 / zoom
        ctx.strokeText(label, px, py - iconSize - 2 / zoom)
        ctx.fillText(label, px, py - iconSize - 2 / zoom)
      }
    }
    poiScreenPositions.current = screenPos

    // ── Draw other players ──
    if (telemetry?.otherPlayers) {
      for (const other of telemetry.otherPlayers) {
        const [opx, opy] = worldToCanvas(other.x, other.y)
        const dotRadius = Math.max(4, 7 / zoom)

        // Filled dot with white border
        ctx.beginPath()
        ctx.arc(opx, opy, dotRadius, 0, Math.PI * 2)
        ctx.fillStyle = '#3b82f6'
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5 / zoom
        ctx.fill()
        ctx.stroke()

        // Player name label (above dot)
        if (other.name) {
          const labelFontSize = Math.max(8, 10 / zoom)
          ctx.font = `bold ${labelFontSize}px sans-serif`
          ctx.textAlign = 'center'
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'
          ctx.lineWidth = 2.5 / zoom
          ctx.strokeText(other.name, opx, opy - dotRadius - 3 / zoom)
          ctx.fillStyle = '#93c5fd'
          ctx.fillText(other.name, opx, opy - dotRadius - 3 / zoom)
        }

        // Player speed label (below dot)
        const speedLabel = formatSpeed(other.speed)
        const speedFontSize = Math.max(7, 8 / zoom)
        ctx.font = `${speedFontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.lineWidth = 2 / zoom
        ctx.strokeText(speedLabel, opx, opy + dotRadius + speedFontSize + 2 / zoom)
        ctx.fillStyle = 'rgba(147,197,253,0.7)'
        ctx.fillText(speedLabel, opx, opy + dotRadius + speedFontSize + 2 / zoom)
      }
    }

    // ── Draw navigation route ──
    if (telemetry?.navRoute && telemetry.navRoute.length >= 2) {
      ctx.beginPath()
      const [sx, sy] = worldToCanvas(telemetry.navRoute[0].x, telemetry.navRoute[0].y)
      ctx.moveTo(sx, sy)
      for (let i = 1; i < telemetry.navRoute.length; i++) {
        const [rx, ry] = worldToCanvas(telemetry.navRoute[i].x, telemetry.navRoute[i].y)
        ctx.lineTo(rx, ry)
      }
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = Math.max(2, 3 / zoom)
      ctx.setLineDash([Math.max(4, 8 / zoom), Math.max(3, 6 / zoom)])
      ctx.stroke()
      ctx.setLineDash([])

      // Destination marker (last point)
      const last = telemetry.navRoute[telemetry.navRoute.length - 1]
      const [dx, dy] = worldToCanvas(last.x, last.y)
      const destSize = Math.max(6, 10 / zoom)
      ctx.beginPath()
      ctx.arc(dx, dy, destSize, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(34, 211, 238, 0.4)'
      ctx.fill()
      ctx.strokeStyle = '#22d3ee'
      ctx.lineWidth = 2 / zoom
      ctx.stroke()
    }

    // ── Draw player marker (on top of everything) ──
    if (telemetry) {
      const [px, py] = worldToCanvas(telemetry.x, telemetry.y)

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(telemetry.heading)

      const size = Math.max(8, 14 / zoom)
      ctx.fillStyle = '#f97316'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2 / zoom
      ctx.beginPath()
      ctx.moveTo(0, -size)
      ctx.lineTo(-size * 0.6, size * 0.5)
      ctx.lineTo(0, size * 0.2)
      ctx.lineTo(size * 0.6, size * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    ctx.restore()

    // HUD overlay — speed
    if (telemetry) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(w - 140, h - 50, 130, 40)
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px monospace'
      ctx.textAlign = 'right'
      ctx.fillText(formatSpeed(telemetry.speed), w - 20, h - 22)
    }

    // HUD overlay — player count
    if (telemetry?.otherPlayers && telemetry.otherPlayers.length > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(10, h - 50, 120, 40)
      ctx.fillStyle = '#93c5fd'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`👥 ${telemetry.otherPlayers.length} ${t('gps.nearby')}`, 20, h - 24)
    }

    // "No signal" indicator
    if (deployed && !telemetry) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(w / 2 - 80, h / 2 - 15, 160, 30)
      ctx.fillStyle = '#888'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(t('gps.waitingForSignal'), w / 2, h / 2 + 5)
    }
  }, [telemetry, minimapData, zoom, followPlayer, deployed, mapPOIs, hoveredPOI, t])

  // Deploy / undeploy toggle
  const handleToggle = useCallback(async () => {
    setDeploying(true)
    try {
      if (deployed) {
        const result = await window.api.gpsUndeployTracker()
        if (result.success) setDeployed(false)
      } else {
        const result = await window.api.gpsDeployTracker()
        if (result.success) setDeployed(true)
      }
    } catch { /* ignore */ }
    setDeploying(false)
  }, [deployed])

  // Resize canvas to fill container
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      const size = Math.floor(Math.min(rect.width, rect.height))
      if (size > 0 && (canvas.width !== size || canvas.height !== size)) {
        canvas.width = size
        canvas.height = size
      }
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Navigation2 size={24} className="text-orange-400" />
          <h1 className="text-xl font-semibold">{t('gps.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Map selector */}
          <select
            value={selectedMap}
            onChange={(e) => setSelectedMap(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400/50"
          >
            <option value="">{t('gps.selectMap')}</option>
            {maps.map((m) => (
              <option key={m.name} value={m.name}>
                {formatMapName(m.name)} ({m.source})
              </option>
            ))}
          </select>

          {/* Deploy toggle */}
          <button
            onClick={handleToggle}
            disabled={deploying}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              deployed
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30'
                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
            } disabled:opacity-50`}
          >
            {deploying ? (
              <Loader2 size={16} className="animate-spin" />
            ) : deployed ? (
              <PowerOff size={16} />
            ) : (
              <Power size={16} />
            )}
            {deployed ? t('gps.undeploy') : t('gps.deploy')}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas area */}
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4 relative">
          {loadingMinimap && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/30">
              <Loader2 size={32} className="animate-spin text-orange-400" />
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={300}
            height={300}
            className="rounded-xl border border-white/10 bg-[#1a1a2e] max-w-full max-h-full"
            onMouseMove={(e) => {
              const rect = canvasRef.current?.getBoundingClientRect()
              if (!rect) return
              const mx = e.clientX - rect.left
              const my = e.clientY - rect.top
              const hitRadius = 16
              let found: number | null = null
              for (let i = 0; i < poiScreenPositions.current.length; i++) {
                const p = poiScreenPositions.current[i]
                const dx = mx - p.x, dy = my - p.y
                if (dx * dx + dy * dy < hitRadius * hitRadius) { found = i; break }
              }
              setHoveredPOI(found)
            }}
            onMouseLeave={() => setHoveredPOI(null)}
          />
          {/* Zoom controls */}
          <div className="absolute bottom-6 right-6 flex flex-col gap-2">
            <button
              onClick={() => setZoom((z) => Math.min(z * 1.3, 10))}
              className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
              title={t('gps.zoomIn')}
            >
              <ZoomIn size={18} />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(z / 1.3, 0.5))}
              className="p-2 bg-white/10 rounded-lg hover:bg-white/20 transition-colors"
              title={t('gps.zoomOut')}
            >
              <ZoomOut size={18} />
            </button>
            <button
              onClick={() => setFollowPlayer((f) => !f)}
              className={`p-2 rounded-lg transition-colors ${
                followPlayer ? 'bg-orange-500/30 text-orange-400' : 'bg-white/10 hover:bg-white/20'
              }`}
              title={t('gps.followPlayer')}
            >
              <Locate size={18} />
            </button>
          </div>
        </div>

        {/* Info panel */}
        <div className="w-64 shrink-0 border-l border-white/10 p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="text-sm text-white/60 uppercase tracking-wider">{t('gps.telemetry')}</div>
          {telemetry ? (
            <div className="space-y-3 text-sm">
              <InfoRow label="X" value={telemetry.x.toFixed(1)} />
              <InfoRow label="Y" value={telemetry.y.toFixed(1)} />
              <InfoRow label="Z" value={telemetry.z.toFixed(1)} />
              <InfoRow label={t('gps.heading')} value={`${((telemetry.heading * 180) / Math.PI).toFixed(1)}°`} />
              <InfoRow label={t('gps.speed')} value={formatSpeed(telemetry.speed)} />
            </div>
          ) : (
            <div className="text-sm text-white/40">
              {deployed ? t('gps.waitingForSignal') : t('gps.trackerNotDeployed')}
            </div>
          )}

          {telemetry?.otherPlayers && telemetry.otherPlayers.length > 0 && (
            <>
              <div className="text-sm text-white/60 uppercase tracking-wider">
                {t('gps.players')} ({telemetry.otherPlayers.length})
              </div>
              <div className="space-y-2 text-sm max-h-48 overflow-y-auto">
                {telemetry.otherPlayers.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-white/70">
                    <span className="text-blue-400">●</span>
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-white/40 font-mono text-xs">{formatSpeed(p.speed)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {mapPOIs.length > 0 && (
            <>
              <div className="text-sm text-white/60 uppercase tracking-wider">
                {t('gps.pois')} ({mapPOIs.length})
              </div>
              <div className="space-y-1 text-xs max-h-32 overflow-y-auto">
                {mapPOIs.slice(0, 30).map((poi, i) => {
                  const poiIcons: Record<string, string> = {
                    spawn: '📍', gas_station: '⛽', garage: '🔧', dealership: '🚗',
                    shop: '🏪', restaurant: '🍔', mechanic: '⚙', waypoint: '📍'
                  }
                  return (
                    <div
                      key={i}
                      className={`truncate cursor-pointer rounded px-1 transition-colors ${hoveredPOI === i ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'}`}
                      onMouseEnter={() => setHoveredPOI(i)}
                      onMouseLeave={() => setHoveredPOI(null)}
                    >
                      {poiIcons[poi.type] || '●'} {poi.name}
                    </div>
                  )
                })}
                {mapPOIs.length > 30 && <div className="text-white/30 px-1">+{mapPOIs.length - 30} more</div>}
              </div>
            </>
          )}

          <div className="mt-auto text-xs text-white/30 space-y-1">
            <p>{t('gps.hint1')}</p>
            <p>{t('gps.hint2')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex justify-between">
      <span className="text-white/50">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
