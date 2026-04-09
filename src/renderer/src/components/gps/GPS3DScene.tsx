import { useRef, useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { GPSTelemetry, GPSMapPOI } from '../../../../shared/types'

const PLANE_SIZE = 20
const TERRAIN_SEGMENTS = 512
const HEIGHT_SCALE = 0.6

interface GPS3DSceneProps {
  mapPath: string
  telemetry: GPSTelemetry | null
  mapPOIs: GPSMapPOI[]
  worldBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  followPlayer: boolean
}

export default function GPS3DScene({
  mapPath,
  telemetry,
  mapPOIs,
  worldBounds,
  followPlayer
}: GPS3DSceneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const frameIdRef = useRef<number>(0)
  const groundRef = useRef<THREE.Mesh | null>(null)
  const heightDataRef = useRef<ImageData | null>(null)
  const heightRangeRef = useRef<{ min: number; max: number }>({ min: 0, max: 255 })
  const texBoundsRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null)

  // Mutable refs for markers updated each frame
  const playerMarkerRef = useRef<THREE.Mesh | null>(null)
  const otherMarkersRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const routeLineRef = useRef<THREE.Line | null>(null)
  const destMarkerRef = useRef<THREE.Mesh | null>(null)
  const poiSpritesRef = useRef<THREE.Sprite[]>([])

  const bounds = worldBounds ?? { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 }

  const worldToPlane = (worldX: number, worldY: number): { px: number; pz: number } => {
    const tb = texBoundsRef.current
    const refBounds = tb ?? bounds
    const u = (worldX - refBounds.minX) / (refBounds.maxX - refBounds.minX)
    const v = (refBounds.maxY - worldY) / (refBounds.maxY - refBounds.minY)
    return { px: (u - 0.5) * PLANE_SIZE, pz: (v - 0.5) * PLANE_SIZE }
  }

  const getHeightAt = (worldX: number, worldY: number): number => {
    const hd = heightDataRef.current
    if (!hd) return 0
    const nx = (worldX - bounds.minX) / (bounds.maxX - bounds.minX)
    const ny = (worldY - bounds.minY) / (bounds.maxY - bounds.minY)
    const px = Math.floor(Math.max(0, Math.min(1, nx)) * (hd.width - 1))
    const py = Math.floor(Math.max(0, Math.min(1, 1 - ny)) * (hd.height - 1))
    const idx = (py * hd.width + px) * 4
    const r = hd.data[idx]
    const { min, max } = heightRangeRef.current
    const range = max - min || 1
    const edgeDist = Math.min(nx, 1 - nx, ny, 1 - ny) / 0.10
    const fade = Math.min(1, Math.max(0, edgeDist))
    return ((r - min) / range) * HEIGHT_SCALE * fade
  }

  /* ── Init scene ─────────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { width, height } = container.getBoundingClientRect()

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0e0e14)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, width / height || 1, 0.1, 200)
    camera.position.set(0, 22, 4)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambient = new THREE.AmbientLight(0xffffff, 1.2)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 0.6)
    sun.position.set(4, 16, 4)
    scene.add(sun)

    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide })
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    groundRef.current = ground

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 3
    controls.maxDistance = 50
    controls.target.set(0, 0, 0)
    controls.maxPolarAngle = Math.PI * 0.48
    controlsRef.current = controls

    const animate = (): void => {
      frameIdRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

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
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
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

        let minH = 255, maxH = 0
        for (let i = 0; i < imageData.data.length; i += 4) {
          const r = imageData.data[i]
          if (r < minH) minH = r
          if (r > maxH) maxH = r
        }
        heightRangeRef.current = { min: minH, max: maxH }
        const range = maxH - minH || 1

        const tb = texBoundsRef.current
        const texW = tb ? (tb.maxX - tb.minX) : (bounds.maxX - bounds.minX)
        const texH = tb ? (tb.maxY - tb.minY) : (bounds.maxY - bounds.minY)
        const texMinX = tb ? tb.minX : bounds.minX
        const texMaxY = tb ? tb.maxY : bounds.maxY
        const terrW = bounds.maxX - bounds.minX
        const terrH = bounds.maxY - bounds.minY

        const geo = groundRef.current!.geometry as THREE.PlaneGeometry
        const pos = geo.attributes.position
        const uv = geo.attributes.uv

        for (let i = 0; i < pos.count; i++) {
          const u = uv.getX(i)
          const v = uv.getY(i)
          const worldX = texMinX + u * texW
          const worldY = texMaxY - v * texH
          const cu = (worldX - bounds.minX) / terrW
          const cv = (worldY - bounds.minY) / terrH

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
          const edgeDist = Math.min(cuc, 1 - cuc, cvc, 1 - cvc)
          const fade = Math.min(1, edgeDist / 0.10)
          pos.setZ(i, ((r - minH) / range) * HEIGHT_SCALE * fade)
        }

        pos.needsUpdate = true
        geo.computeVertexNormals()
      }
      img.src = dataUrl
    }

    const fullPath = mapPath.startsWith('/levels/') ? mapPath : `/levels/${mapPath}/`
    window.api.getMapHeightmap(fullPath).then((hm) => { if (hm) applyHeightmap(hm) })
    window.api.getMapMinimap(fullPath).then((result) => {
      if (result) {
        if (result.worldBounds) texBoundsRef.current = result.worldBounds
        applyTexture(result.dataUrl)
        return
      }
      return window.api.getMapPreview(fullPath).then((prev) => { if (prev) applyTexture(prev) })
    })

    return () => { cancelled = true }
  }, [mapPath])

  /* ── Update player marker ────────────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (!telemetry) {
      if (playerMarkerRef.current) {
        playerMarkerRef.current.visible = false
      }
      return
    }

    if (!playerMarkerRef.current) {
      const cGeo = new THREE.ConeGeometry(0.18, 0.5, 8)
      const cMat = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: new THREE.Color(0xf97316),
        emissiveIntensity: 0.4
      })
      const mesh = new THREE.Mesh(cGeo, cMat)
      scene.add(mesh)
      playerMarkerRef.current = mesh
    }

    const marker = playerMarkerRef.current
    marker.visible = true
    const { px, pz } = worldToPlane(telemetry.x, telemetry.y)
    const py = getHeightAt(telemetry.x, telemetry.y) + 0.3
    marker.position.set(px, py, pz)
    marker.rotation.y = -telemetry.heading

    // Follow player: move camera target to player position
    if (followPlayer && controlsRef.current) {
      const controls = controlsRef.current
      const target = controls.target
      // Smoothly lerp the target toward the player
      target.x += (px - target.x) * 0.1
      target.z += (pz - target.z) * 0.1
    }
  }, [telemetry, followPlayer])

  /* ── Other player markers ────────────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const existing = otherMarkersRef.current
    const seen = new Set<string>()

    if (telemetry?.otherPlayers) {
      for (let i = 0; i < telemetry.otherPlayers.length; i++) {
        const other = telemetry.otherPlayers[i]
        const key = `other-${i}-${other.name}`
        seen.add(key)

        let mesh = existing.get(key)
        if (!mesh) {
          const cGeo = new THREE.ConeGeometry(0.12, 0.35, 8)
          const cMat = new THREE.MeshStandardMaterial({
            color: 0x3b82f6,
            emissive: new THREE.Color(0x3b82f6),
            emissiveIntensity: 0.3
          })
          mesh = new THREE.Mesh(cGeo, cMat)
          scene.add(mesh)
          existing.set(key, mesh)
        }

        const { px, pz } = worldToPlane(other.x, other.y)
        const py = getHeightAt(other.x, other.y) + 0.25
        mesh.position.set(px, py, pz)
        mesh.rotation.y = -other.heading
      }
    }

    // Remove stale
    for (const [key, mesh] of existing) {
      if (!seen.has(key)) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        existing.delete(key)
      }
    }
  }, [telemetry?.otherPlayers])

  /* ── Navigation route line ───────────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Clear old
    if (routeLineRef.current) {
      scene.remove(routeLineRef.current)
      routeLineRef.current.geometry.dispose()
      ;(routeLineRef.current.material as THREE.Material).dispose()
      routeLineRef.current = null
    }
    if (destMarkerRef.current) {
      scene.remove(destMarkerRef.current)
      destMarkerRef.current.geometry.dispose()
      ;(destMarkerRef.current.material as THREE.Material).dispose()
      destMarkerRef.current = null
    }

    if (!telemetry?.navRoute || telemetry.navRoute.length < 2) return

    const pts: THREE.Vector3[] = []
    for (const p of telemetry.navRoute) {
      const { px, pz } = worldToPlane(p.x, p.y)
      const py = getHeightAt(p.x, p.y) + 0.15
      pts.push(new THREE.Vector3(px, py, pz))
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 })
    const line = new THREE.Line(lineGeo, lineMat)
    scene.add(line)
    routeLineRef.current = line

    // Destination sphere
    const last = telemetry.navRoute[telemetry.navRoute.length - 1]
    const { px: dx, pz: dz } = worldToPlane(last.x, last.y)
    const dy = getHeightAt(last.x, last.y) + 0.25
    const destGeo = new THREE.SphereGeometry(0.12, 12, 12)
    const destMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: new THREE.Color(0x22d3ee),
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.7
    })
    const dest = new THREE.Mesh(destGeo, destMat)
    dest.position.set(dx, dy, dz)
    scene.add(dest)
    destMarkerRef.current = dest
  }, [telemetry?.navRoute])

  /* ── POI sprites ─────────────────────────────────────────────── */
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Clear old
    for (const sprite of poiSpritesRef.current) {
      scene.remove(sprite)
      sprite.material.dispose()
      if (sprite.material.map) sprite.material.map.dispose()
    }
    poiSpritesRef.current = []

    for (const poi of mapPOIs) {
      const { px, pz } = worldToPlane(poi.x, poi.y)
      const py = getHeightAt(poi.x, poi.y) + 0.3

      // Create a colored dot sprite
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const ctx = canvas.getContext('2d')!
      const colorMap: Record<string, string> = {
        spawn: '#22d3ee', gas_station: '#facc15', garage: '#a78bfa',
        dealership: '#34d399', shop: '#fb923c', restaurant: '#f87171',
        mechanic: '#60a5fa', waypoint: '#94a3b8'
      }
      ctx.beginPath()
      ctx.arc(16, 16, 12, 0, Math.PI * 2)
      ctx.fillStyle = colorMap[poi.type] || '#888'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()

      const tex = new THREE.CanvasTexture(canvas)
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.set(px, py, pz)
      sprite.scale.set(0.25, 0.25, 1)
      scene.add(sprite)
      poiSpritesRef.current.push(sprite)
    }
  }, [mapPOIs])

  return <div ref={containerRef} className="w-full h-full min-h-0" />
}
