import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PlayerPosition, GPSRoute } from '../../../../shared/types'
import { worldToNorm, normToWorld, type MapBounds } from './mapBounds'

const PLANE_SIZE = 20
const TERRAIN_SEGMENTS = 512
const HEIGHT_SCALE = 0.6 // gentle terrain relief — keeps map readable
const PLAYER_EMOJIS = ['😀', '😎', '🤖', '👾', '💀', '👻', '🐱', '🐸', '🔥', '⭐', '🛸', '🚗'] as const

interface HeatMapSceneProps {
  mapPath: string
  players: PlayerPosition[]
  routes: GPSRoute[]
  mode: 'view' | 'plot'
  bounds: MapBounds
  showHeatmap?: boolean
  heatGrid?: Float32Array
  heatGridVersion?: number
  heatGridRes?: number
  onMapClick?: (worldX: number, worldY: number) => void
  onTexBoundsLoaded?: (bounds: { minX: number; maxX: number; minY: number; maxY: number } | null) => void
}

export default function HeatMapScene({
  mapPath,
  players,
  routes,
  mode,
  bounds,
  showHeatmap,
  heatGrid,
  heatGridVersion,
  heatGridRes,
  onMapClick,
  onTexBoundsLoaded
}: HeatMapSceneProps): React.JSX.Element {
  const [surfaceReadyTick, setSurfaceReadyTick] = useState(0)
  const [tooltip, setTooltip] = useState<{ name: string; x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const frameIdRef = useRef<number>(0)
  const groundRef = useRef<THREE.Mesh | null>(null)
  const playerSpritesRef = useRef<Map<string, THREE.Sprite>>(new Map())
  const playerConesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const lastEmojiByKeyRef = useRef<Map<string, string>>(new Map())
  const emojiTextureCacheRef = useRef<Map<string, THREE.Texture>>(new Map())
  const routeLinesRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const waypointMeshesRef = useRef<Map<string, THREE.Mesh[]>>(new Map())
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const heightDataRef = useRef<ImageData | null>(null)
  const heightRangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 255 })
  const heatOverlayRef = useRef<THREE.Mesh | null>(null)
  const heatTexRef = useRef<THREE.DataTexture | null>(null)
  // Maps sprite key → player name for hover tooltip
  const playerNameByKeyRef = useRef<Map<string, string>>(new Map())
  // Track which surfaceReadyTick value the overlay geometry was built for.
  // When the tick advances (ground deformed), geometry is rebuilt from the updated mesh.
  const lastOverlaySurfaceTickRef = useRef(-1)
  // World bounds covered by the texture image (from tile compositing, or matching terrain bounds)
  const texBoundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)

  /**
   * Map world coords → UV on the texture plane.
   * If texBounds is wider than the mapBounds (terrain grid), the terrain grid sits
   * inside the texture and we need an offset.
   */
  const worldToPlane = (worldX: number, worldY: number): { u: number; v: number } => {
    const tb = texBoundsRef.current
    if (tb) {
      // Texture covers custom world extent — v=0 at top (maxY), v=1 at bottom (minY)
      const u = (worldX - tb.minX) / (tb.maxX - tb.minX)
      const v = (tb.maxY - worldY) / (tb.maxY - tb.minY)
      return { u, v }
    }
    // Fallback: texture covers the terrain bounds
    const { nx, ny } = worldToNorm(worldX, worldY, bounds)
    return { u: nx, v: ny }
  }

  /** Sample terrain height at a normalised 0-1 position (within the terrain grid) */
  const getHeightAt = (nx: number, ny: number): number => {
    const hd = heightDataRef.current
    if (!hd) return 0
    const px = Math.floor(Math.max(0, Math.min(1, nx)) * (hd.width - 1))
    const py = Math.floor(Math.max(0, Math.min(1, 1 - ny)) * (hd.height - 1))
    const idx = (py * hd.width + px) * 4
    const r = hd.data[idx]
    const { min, max } = heightRangeRef.current
    const range = max - min || 1
    // Edge fade — reduce displacement near terrain boundaries
    const edgeFade = Math.min(nx, 1 - nx, ny, 1 - ny) / 0.10 // fades over 10% of the terrain
    const fade = Math.min(1, Math.max(0, edgeFade))
    return ((r - min) / range) * HEIGHT_SCALE * fade
  }

  const randomEmojiForJoin = (key: string): string => {
    const prev = lastEmojiByKeyRef.current.get(key)
    if (PLAYER_EMOJIS.length <= 1) {
      const single = PLAYER_EMOJIS[0]
      lastEmojiByKeyRef.current.set(key, single)
      return single
    }

    let next = PLAYER_EMOJIS[Math.floor(Math.random() * PLAYER_EMOJIS.length)]
    if (prev && next === prev) {
      const candidates = PLAYER_EMOJIS.filter((e) => e !== prev)
      next = candidates[Math.floor(Math.random() * candidates.length)]
    }
    lastEmojiByKeyRef.current.set(key, next)
    return next
  }

  const getEmojiTexture = (emoji: string): THREE.Texture => {
    const cached = emojiTextureCacheRef.current.get(emoji)
    if (cached) return cached

    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, size, size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.floor(size * 0.72)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`
    ctx.fillText(emoji, size / 2, size / 2 + 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    emojiTextureCacheRef.current.set(emoji, tex)
    return tex
  }

  /* ── Initialise scene ────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()

    // Scene
    const scene = new THREE.Scene()
    const baseBg = getComputedStyle(document.documentElement).getPropertyValue('--color-base').trim() || '#0e0e14'
    scene.background = new THREE.Color(baseBg)
    sceneRef.current = scene

    // Camera — nearly top-down to match the in-game map view
    const camera = new THREE.PerspectiveCamera(45, width / height || 1, 0.1, 200)
    camera.position.set(0, 22, 4)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer — no tone mapping so the minimap texture is displayed faithfully
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Single ambient light — terrain is unlit, but this helps route/overlay materials.
    const ambient = new THREE.AmbientLight(0xffffff, 1.2)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 0.6)
    sun.position.set(4, 16, 4)
    scene.add(sun)

    // Ground plane – high-res subdivision for smooth heightmap displacement
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.FrontSide
    })
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    groundRef.current = ground
    // Signal downstream effects (heat overlay) that ground is now available.
    setSurfaceReadyTick((v) => v + 1)

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 3
    controls.maxDistance = 50
    controls.target.set(0, 0, 0)
    controls.maxPolarAngle = Math.PI * 0.48
    controlsRef.current = controls

    // Render loop
    const animate = (): void => {
      frameIdRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize observer
    const obs = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      if (w > 0 && h > 0) {
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
    })
    obs.observe(container)

    return () => {
      cancelAnimationFrame(frameIdRef.current)
      obs.disconnect()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          obj.geometry?.dispose()
          const m = obj.material as THREE.Material | THREE.Material[]
          const dm = (mat: THREE.Material): void => {
            const rec = mat as THREE.Material & Record<string, unknown>
            for (const k of Object.keys(rec)) {
              const v = rec[k]
              if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) {
                try { (v as THREE.Texture).dispose() } catch { /* ignore */ }
              }
            }
            mat.dispose()
          }
          if (Array.isArray(m)) m.forEach(dm)
          else if (m) dm(m)
        }
      })
      scene.clear()
      for (const tex of emojiTextureCacheRef.current.values()) tex.dispose()
      emojiTextureCacheRef.current.clear()
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  /* ── Load heightmap + minimap texture ─────────────────────────── */
  useEffect(() => {
    if (!groundRef.current || !mapPath) return
    let cancelled = false

    const applyTexture = (dataUrl: string): void => {
      if (cancelled || !groundRef.current) return
      const loader = new THREE.TextureLoader()
      loader.load(dataUrl, (tex) => {
        if (cancelled || !groundRef.current) return
        tex.colorSpace = THREE.SRGBColorSpace
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.anisotropy = 8
        const mat = groundRef.current!.material as THREE.MeshBasicMaterial
        mat.map = tex
        mat.needsUpdate = true
      })
    }

    const applyHeightmap = (dataUrl: string): void => {
      if (cancelled || !groundRef.current) return
      const img = new Image()
      img.onload = (): void => {
        if (cancelled || !groundRef.current) return
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, img.width, img.height)
        heightDataRef.current = imageData

        // Find actual min/max range to normalize displacement
        let minH = 255, maxH = 0
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i]
          if (r < minH) minH = r
          if (r > maxH) maxH = r
        }
        const range = maxH - minH || 1
        heightRangeRef.current = { min: minH, max: maxH }

        // Displace vertices of the ground plane.
        // The heightmap covers the terrain grid (bounds), but the texture may cover
        // a larger world extent (texBounds). We need to map UV → terrain grid coords.
        const geo = groundRef.current!.geometry as THREE.PlaneGeometry
        const pos = geo.attributes.position
        const uv = geo.attributes.uv

        const tb = texBoundsRef.current
        const texW = tb ? (tb.maxX - tb.minX) : (bounds.maxX - bounds.minX)
        const texH = tb ? (tb.maxY - tb.minY) : (bounds.maxY - bounds.minY)
        const texMinX = tb ? tb.minX : bounds.minX
        const texMaxY = tb ? tb.maxY : bounds.maxY
        const terrW = bounds.maxX - bounds.minX
        const terrH = bounds.maxY - bounds.minY

        for (let i = 0; i < pos.count; i++) {
          const u = uv.getX(i)
          const v = uv.getY(i)

          // UV → world coords
          const worldX = texMinX + u * texW
          const worldY = texMaxY - v * texH

          // World → terrain grid normalised coords (0..1)
          const cu = (worldX - bounds.minX) / terrW
          const cv = (worldY - bounds.minY) / terrH

          // Outside terrain grid → flat
          if (cu < -0.01 || cu > 1.01 || cv < -0.01 || cv > 1.01) {
            pos.setZ(i, 0)
            continue
          }

          const cuc = Math.max(0, Math.min(1, cu))
          const cvc = Math.max(0, Math.min(1, cv))

          const px = Math.floor(cuc * (imageData.width - 1))
          const py = Math.floor((1 - cvc) * (imageData.height - 1))
          const idx = (py * imageData.width + px) * 4
          const r = imageData.data[idx]

          // Edge fade — smooth transition at terrain boundaries (over 10% of terrain extent)
          const edgeDist = Math.min(cuc, 1 - cuc, cvc, 1 - cvc)
          const fade = Math.min(1, edgeDist / 0.10)

          pos.setZ(i, ((r - minH) / range) * HEIGHT_SCALE * fade)
        }

        pos.needsUpdate = true
        geo.computeVertexNormals()
        // Heightmap deformation finished; force heat overlay effect to resync
        // overlay vertices to the updated ground geometry.
        setSurfaceReadyTick((v) => v + 1)
      }
      img.src = dataUrl
    }

    // Load heightmap + minimap in parallel
    const loadHeightmap = window.api.getMapHeightmap(mapPath).then((hm) => {
      if (hm) applyHeightmap(hm)
    })

    const loadMinimap = window.api.getMapMinimap(mapPath).then((result) => {
      if (result) {
        if (result.worldBounds) texBoundsRef.current = result.worldBounds
        onTexBoundsLoaded?.(result.worldBounds ?? null)
        applyTexture(result.dataUrl)
        return
      }
      // Fallback to preview
      return window.api.getMapPreview(mapPath).then((prev) => {
        if (prev) applyTexture(prev)
      })
    })

    Promise.all([loadHeightmap, loadMinimap])

    return () => {
      cancelled = true
    }
  }, [mapPath])

  /* ── Player markers (emoji sprites) ──────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const existing = playerSpritesRef.current
    const existingCones = playerConesRef.current
    const seen = new Set<string>()

    for (const p of players) {
      const key = `${p.playerId}-${p.vehicleId}`
      seen.add(key)

      const { nx, ny } = worldToNorm(p.x, p.y, bounds)
      const { u: pu, v: pv } = worldToPlane(p.x, p.y)
      const px = (pu - 0.5) * PLANE_SIZE
      const pz = (pv - 0.5) * PLANE_SIZE
      const groundY = getHeightAt(nx, ny)
      const coneHeight = 0.35
      const coneTipLift = 0.01
      const coneCenterY = groundY + coneHeight * 0.5 + coneTipLift
      const emojiY = coneCenterY + coneHeight * 0.5 + 0.09

      // Keep name map in sync for tooltip
      playerNameByKeyRef.current.set(key, p.playerName)

      let sprite = existing.get(key)
      if (!sprite) {
        const emoji = randomEmojiForJoin(key)
        const mat = new THREE.SpriteMaterial({
          map: getEmojiTexture(emoji),
          transparent: true,
          depthWrite: false,
        })
        sprite = new THREE.Sprite(mat)
        sprite.scale.set(0.75, 0.75, 1)
        scene.add(sprite)
        existing.set(key, sprite)

        const coneGeo = new THREE.ConeGeometry(0.06, 0.35, 10)
        const coneMat = new THREE.MeshStandardMaterial({
          color: '#ff8a3d',
          emissive: '#ff8a3d',
          emissiveIntensity: 0.15,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          roughness: 0.55,
          metalness: 0.0,
        })
        const cone = new THREE.Mesh(coneGeo, coneMat)
        cone.rotation.x = Math.PI
        scene.add(cone)
        existingCones.set(key, cone)
      }

      sprite.position.set(px, emojiY, pz)

      const cone = existingCones.get(key)
      if (cone) {
        cone.position.set(px, coneCenterY, pz)
        cone.rotation.y = -p.heading * (Math.PI / 180)
      }
    }

    // Remove stale markers
    for (const [key, sprite] of existing) {
      if (!seen.has(key)) {
        playerNameByKeyRef.current.delete(key)
        scene.remove(sprite)
        ;(sprite.material as THREE.Material).dispose()
        existing.delete(key)

        const cone = existingCones.get(key)
        if (cone) {
          scene.remove(cone)
          cone.geometry.dispose()
          ;(cone.material as THREE.Material).dispose()
          existingCones.delete(key)
        }
      }
    }
  }, [players, bounds])

  /* ── Route lines + waypoint dots ─────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Clear old route objects
    for (const [, obj] of routeLinesRef.current) {
      scene.remove(obj)
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry.dispose()
          const m = child.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else (m as THREE.Material).dispose()
        }
      })
    }
    routeLinesRef.current.clear()

    // Clear old waypoint spheres
    for (const [, meshes] of waypointMeshesRef.current) {
      for (const m of meshes) {
        scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    }
    waypointMeshesRef.current.clear()

    for (const route of routes) {
      const color = new THREE.Color(route.color || '#00ff88')

      // Waypoint spheres
      const wpMeshes: THREE.Mesh[] = []
      for (const wp of route.waypoints) {
        const { nx, ny } = worldToNorm(wp.x, wp.y, bounds)
        const { u: wu, v: wv } = worldToPlane(wp.x, wp.y)
        const wy = getHeightAt(nx, ny) + 0.15
        const sGeo = new THREE.SphereGeometry(0.1, 8, 8)
        const sMat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.5
        })
        const sphere = new THREE.Mesh(sGeo, sMat)
        sphere.position.set((wu - 0.5) * PLANE_SIZE, wy, (wv - 0.5) * PLANE_SIZE)
        scene.add(sphere)
        wpMeshes.push(sphere)
      }
      waypointMeshesRef.current.set(route.id, wpMeshes)

      // Line connecting waypoints — use road-following pathSegments if available
      const hasSegments = route.pathSegments && route.pathSegments.length > 0

      // Collect raw world points
      let worldPts: { x: number; y: number }[] = []
      if (hasSegments) {
        for (const seg of route.pathSegments!) {
          for (let i = 0; i < seg.length; i++) {
            if (worldPts.length > 0 && i === 0) continue
            worldPts.push(seg[i])
          }
        }
      } else if (route.waypoints.length >= 2) {
        worldPts = route.waypoints.map((wp) => ({ x: wp.x, y: wp.y }))
      }

      if (worldPts.length >= 2) {
        // Sample terrain height directly from the displaced mesh geometry
        // so the ribbon is guaranteed to sit above the actual rendered surface.
        const sampleMaxHeight = (px: number, pz: number): number => {
          const ground = groundRef.current
          if (!ground) return 0
          const pos = ground.geometry.attributes.position as THREE.BufferAttribute
          const N = TERRAIN_SEGMENTS
          const stride = N + 1
          // Map world position to terrain grid indices
          const gx = ((px + PLANE_SIZE / 2) / PLANE_SIZE) * N
          const gz = ((pz + PLANE_SIZE / 2) / PLANE_SIZE) * N
          const ix0 = Math.max(0, Math.min(N - 1, Math.floor(gx)))
          const iz0 = Math.max(0, Math.min(N - 1, Math.floor(gz)))
          const ix1 = Math.min(ix0 + 1, N)
          const iz1 = Math.min(iz0 + 1, N)
          // Read displaced Z of the 4 surrounding vertices
          // (local Z becomes world Y after the -π/2 X rotation)
          const h00 = pos.getZ(iz0 * stride + ix0)
          const h10 = pos.getZ(iz0 * stride + ix1)
          const h01 = pos.getZ(iz1 * stride + ix0)
          const h11 = pos.getZ(iz1 * stride + ix1)
          return Math.max(h00, h10, h01, h11)
        }

        // Convert to 3D positions hugging terrain surface
        const ROUTE_LIFT = 0.10
        const RIBBON_HALF_W = 0.06 // half-width of flat ribbon
        const pts3d: THREE.Vector3[] = []

        for (const p of worldPts) {
          const { u, v } = worldToPlane(p.x, p.y)
          const px = (u - 0.5) * PLANE_SIZE
          const pz = (v - 0.5) * PLANE_SIZE
          pts3d.push(new THREE.Vector3(px, sampleMaxHeight(px, pz) + ROUTE_LIFT, pz))
        }

        // Densify at terrain-grid resolution so ribbon follows every contour
        const dense: THREE.Vector3[] = [pts3d[0]]
        const STEP = PLANE_SIZE / TERRAIN_SEGMENTS // one sample per terrain vertex
        for (let i = 1; i < pts3d.length; i++) {
          const prev = pts3d[i - 1]
          const cur = pts3d[i]
          const dx = cur.x - prev.x
          const dz = cur.z - prev.z
          const segLen = Math.sqrt(dx * dx + dz * dz)
          const steps = Math.max(1, Math.ceil(segLen / STEP))
          for (let s = 1; s <= steps; s++) {
            const t = s / steps
            const ix = prev.x + dx * t
            const iz = prev.z + dz * t
            const h = sampleMaxHeight(ix, iz) + ROUTE_LIFT
            dense.push(new THREE.Vector3(ix, h, iz))
          }
        }

        if (dense.length >= 2) {
          // Build a flat ribbon mesh: two triangles per segment, lying on the terrain
          const verts: number[] = []
          const indices: number[] = []

          for (let i = 0; i < dense.length; i++) {
            const p = dense[i]
            // Compute perpendicular direction in XZ plane
            let dx: number, dz: number
            if (i < dense.length - 1) {
              dx = dense[i + 1].x - p.x
              dz = dense[i + 1].z - p.z
            } else {
              dx = p.x - dense[i - 1].x
              dz = p.z - dense[i - 1].z
            }
            const len = Math.sqrt(dx * dx + dz * dz) || 1
            // Perpendicular (rotate 90°)
            const px = -dz / len * RIBBON_HALF_W
            const pz = dx / len * RIBBON_HALF_W

            // Left and right vertices — sample height at each edge for terrain-hugging
            const lx = p.x + px, lz = p.z + pz
            const rx = p.x - px, rz = p.z - pz
            const lh = sampleMaxHeight(lx, lz) + ROUTE_LIFT
            const rh = sampleMaxHeight(rx, rz) + ROUTE_LIFT
            verts.push(lx, lh, lz) // left
            verts.push(rx, rh, rz) // right

            if (i > 0) {
              const bl = (i - 1) * 2
              const br = (i - 1) * 2 + 1
              const tl = i * 2
              const tr = i * 2 + 1
              indices.push(bl, tl, br)
              indices.push(br, tl, tr)
            }
          }

          const ribbonGeo = new THREE.BufferGeometry()
          ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
          ribbonGeo.setIndex(indices)
          ribbonGeo.computeVertexNormals()

          const ribbonMat = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          })
          const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat)
          scene.add(ribbonMesh)
          routeLinesRef.current.set(route.id, ribbonMesh)
        }
      }
    }
  }, [routes, bounds])

  /* ── Heatmap density overlay ─────────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    const ground = groundRef.current
    if (!scene || !ground) return

    // Remove existing overlay if heatmap is off or no data
    if (!showHeatmap || !heatGrid || !heatGridRes) {
      if (heatOverlayRef.current) {
        scene.remove(heatOverlayRef.current)
        heatOverlayRef.current.geometry.dispose()
        ;(heatOverlayRef.current.material as THREE.Material).dispose()
        heatOverlayRef.current = null
      }
      if (heatTexRef.current) {
        heatTexRef.current.dispose()
        heatTexRef.current = null
      }
      return
    }

    const RES = heatGridRes

    // Find max density for normalization
    let maxDensity = 0
    for (let i = 0; i < heatGrid.length; i++) {
      if (heatGrid[i] > maxDensity) maxDensity = heatGrid[i]
    }
    if (maxDensity === 0) {
      // No data yet — hide overlay
      if (heatOverlayRef.current) heatOverlayRef.current.visible = false
      return
    }

    // Build RGBA texture from density grid with gaussian blur for smooth heatmap
    const blurred = new Float32Array(RES * RES)
    const KERNEL = 3
    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        let sum = 0
        let wt = 0
        for (let dy = -KERNEL; dy <= KERNEL; dy++) {
          for (let dx = -KERNEL; dx <= KERNEL; dx++) {
            const sx = x + dx
            const sy = y + dy
            if (sx >= 0 && sx < RES && sy >= 0 && sy < RES) {
              const d2 = dx * dx + dy * dy
              const w = Math.exp(-d2 / (2 * KERNEL))
              sum += heatGrid[sy * RES + sx] * w
              wt += w
            }
          }
        }
        blurred[y * RES + x] = sum / wt
      }
    }

    // Re-find max after blur
    let blurMax = 0
    for (let i = 0; i < blurred.length; i++) {
      if (blurred[i] > blurMax) blurMax = blurred[i]
    }

    const data = new Uint8Array(RES * RES * 4)
    for (let i = 0; i < RES * RES; i++) {
      const t = blurMax > 0 ? blurred[i] / blurMax : 0
      // Color ramp: transparent → blue → cyan → green → yellow → red
      let r = 0, g = 0, b = 0, a = 0
      if (t > 0.01) {
        a = Math.min(255, Math.floor(t * 180 + 40))
        if (t < 0.25) {
          const s = t / 0.25
          r = 0; g = 0; b = Math.floor(128 + 127 * s)
        } else if (t < 0.5) {
          const s = (t - 0.25) / 0.25
          r = 0; g = Math.floor(255 * s); b = Math.floor(255 * (1 - s))
        } else if (t < 0.75) {
          const s = (t - 0.5) / 0.25
          r = Math.floor(255 * s); g = 255; b = 0
        } else {
          const s = (t - 0.75) / 0.25
          r = 255; g = Math.floor(255 * (1 - s)); b = 0
        }
      }
      data[i * 4] = r
      data[i * 4 + 1] = g
      data[i * 4 + 2] = b
      data[i * 4 + 3] = a
    }

    // Create or update DataTexture
    if (!heatTexRef.current) {
      const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat)
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.needsUpdate = true
      heatTexRef.current = tex
    } else {
      const img = heatTexRef.current.image as { data: Uint8Array }
      img.data.set(data)
      heatTexRef.current.needsUpdate = true
    }

    // Rebuild the overlay geometry whenever the ground changes (surfaceReadyTick advanced)
    // or when creating for the first time. This guarantees the overlay always sits
    // +0.04 above the *current* (possibly deformed) terrain rather than a stale flat clone.
    const geometryNeedsRebuild =
      !heatOverlayRef.current || lastOverlaySurfaceTickRef.current !== surfaceReadyTick

    if (geometryNeedsRebuild) {
      if (heatOverlayRef.current) {
        scene.remove(heatOverlayRef.current)
        heatOverlayRef.current.geometry.dispose()
        ;(heatOverlayRef.current.material as THREE.Material).dispose()
        heatOverlayRef.current = null
      }

      const overlayGeo = ground.geometry.clone()
      const pos = overlayGeo.attributes.position as THREE.BufferAttribute
      const groundPos = ground.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        pos.setZ(i, groundPos.getZ(i) + 0.04)
      }
      pos.needsUpdate = true

      const overlayMat = new THREE.MeshBasicMaterial({
        map: heatTexRef.current,
        transparent: true,
        // depthTest disabled: heatmap is a 2D overlay — depth-testing against the terrain
        // would occlude the flat overlay behind hills before geometry is synced to the
        // displaced mesh. With renderOrder=1 this renders correctly atop the terrain.
        depthTest: false,
        side: THREE.FrontSide,
        blending: THREE.NormalBlending
      })
      const overlay = new THREE.Mesh(overlayGeo, overlayMat)
      overlay.rotation.x = -Math.PI / 2
      overlay.renderOrder = 1
      scene.add(overlay)
      heatOverlayRef.current = overlay
      lastOverlaySurfaceTickRef.current = surfaceReadyTick
    } else if (heatOverlayRef.current) {
      // Geometry is current — just refresh the texture reference and ensure visible
      ;(heatOverlayRef.current.material as THREE.MeshBasicMaterial).map = heatTexRef.current
      ;(heatOverlayRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true
      heatOverlayRef.current.visible = true
    }
  }, [showHeatmap, heatGridVersion, heatGrid, heatGridRes, surfaceReadyTick])

  /* ── Click-to-place waypoints in plot mode ───────────────────── */
  useEffect(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const ground = groundRef.current
    if (!renderer || !camera || !ground || mode !== 'plot' || !onMapClick) return

    const handleClick = (e: MouseEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouseRef.current, camera)
      const hits = raycasterRef.current.intersectObject(ground)
      if (hits.length > 0) {
        const { x, z } = hits[0].point
        // Plane position → UV 0..1
        const pu = x / PLANE_SIZE + 0.5
        const pv = z / PLANE_SIZE + 0.5
        // UV → world coords, using texBounds if available
        const tb = texBoundsRef.current
        let worldX: number, worldY: number
        if (tb) {
          worldX = tb.minX + pu * (tb.maxX - tb.minX)
          worldY = tb.maxY - pv * (tb.maxY - tb.minY)
        } else {
          const w = normToWorld(pu, pv, bounds)
          worldX = w.x; worldY = w.y
        }
        onMapClick(worldX, worldY)
      }
    }

    renderer.domElement.addEventListener('click', handleClick)
    renderer.domElement.style.cursor = 'crosshair'
    return () => {
      renderer.domElement.removeEventListener('click', handleClick)
      renderer.domElement.style.cursor = ''
    }
  }, [mode, bounds, onMapClick])

  /* ── Sprite hover tooltip ────────────────────────────────────── */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const container = containerRef.current
    if (!renderer || !camera || !container) return

    const rect = container.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const rc = new THREE.Raycaster()
    rc.params.Sprite = { threshold: 0.4 }
    rc.setFromCamera(new THREE.Vector2(mx, my), camera)

    const sprites = Array.from(playerSpritesRef.current.values())
    const hits = rc.intersectObjects(sprites)
    if (hits.length > 0) {
      const hit = hits[0].object as THREE.Sprite
      // Reverse-lookup key from sprite
      for (const [key, s] of playerSpritesRef.current) {
        if (s === hit) {
          const name = playerNameByKeyRef.current.get(key)
          if (name) {
            setTooltip({ name, x: e.clientX - rect.left, y: e.clientY - rect.top })
            return
          }
          break
        }
      }
    }
    setTooltip(null)
  }, [])

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-0 relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTooltip(null)}
    >
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 px-2 py-1 rounded text-xs font-medium whitespace-nowrap"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 28,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.15)'
          }}
        >
          {tooltip.name}
        </div>
      )}
    </div>
  )
}
