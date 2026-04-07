import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Loader2, Settings, Sun, Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface PaintData {
  baseColor?: [number, number, number, number]
  metallic?: number
  roughness?: number
  clearcoat?: number
  clearcoatRoughness?: number
}

interface VehicleViewerProps {
  vehicleName: string
  parts?: Record<string, string>
  paints?: PaintData[]
  className?: string
}

// ── Material classification ──
type MatCategory = 'paint' | 'glass' | 'interior' | 'chrome' | 'light' | 'dark' | 'tire' | 'mirror'

function classifyMesh(matName: string, meshName: string): MatCategory {
  const mat = matName.toLowerCase()
  const mesh = meshName.toLowerCase()

  // Glass / windows
  if (mat.includes('glass') || mat.includes('windshield'))
    return mesh.includes('dmg') ? 'paint' : 'glass'

  // Interior
  if (
    mat.includes('interior') || mat.includes('carpet') ||
    mat.includes('racing_interior') || mat.includes('gauges') ||
    mat.includes('gauges_display')
  ) return 'interior'

  // Lights / signals
  if (
    mat.includes('light') || mat.includes('signal') || mat.includes('chmsl') ||
    mat.includes('halogen') || mat.includes('led') || mat.includes('hazard') ||
    mat.includes('reverselight')
  ) return 'light'

  // Mechanical / structural
  if (
    mat.includes('mechanical') || mat.includes('suspension') || mat.includes('engine') ||
    mat.includes('boxer') || mat.includes('exhaust') || mat.includes('rollcage') ||
    mat.includes('perf_parts') || mat.includes('rally') || mat.includes('load_attachment')
  ) return 'dark'

  // Chrome / grille
  if (mat.includes('grille') || mat.includes('chrome')) return 'chrome'

  // Mirror
  if (mat === 'mirror' || mat === 'mirror_f' || mat.startsWith('mirror')) return 'mirror'

  // Main body material → paint (but structural sub-parts should be dark)
  if (mat.includes('_main') || mat.includes('lettering') || mat.includes('decal') || mat.includes('sunstrip')) {
    if (
      mesh.includes('bumperbar') || mesh.includes('subframe') || mesh.includes('undertray') ||
      mesh.includes('skidplate') || mesh.includes('strut_bar') || mesh.includes('stiffening') ||
      mesh.includes('engbay') || mesh.includes('_belt') || mesh.includes('pulley')
    ) return 'dark'
    return 'paint'
  }

  // Fallback by mesh name
  if (mesh.includes('tire') || mesh.includes('tyre')) return 'tire'
  if (mesh.includes('glass') || mesh.includes('windshield') || mesh.includes('quarterglass')) return 'glass'
  if (
    mesh.includes('interior') || mesh.includes('seat') || mesh.includes('dash') ||
    mesh.includes('steering') || mesh.includes('pedal') || mesh.includes('shifter') ||
    mesh.includes('doorpanel') || mesh.includes('carpet') || mesh.includes('gauge') ||
    mesh.includes('radio') || mesh.includes('nav_empty') || mesh.includes('nav ')
  ) return 'interior'
  if (
    mesh.includes('engine') || mesh.includes('brake') || mesh.includes('suspension') ||
    mesh.includes('differential') || mesh.includes('halfshaft') || mesh.includes('radiator') ||
    mesh.includes('oilpan') || mesh.includes('transaxle') || mesh.includes('driveshaft') ||
    mesh.includes('swaybar') || mesh.includes('flywheel') || mesh.includes('coilover') ||
    mesh.includes('exhaust') || mesh.includes('engbay') || mesh.includes('pulley') ||
    mesh.includes('belt') || mesh.includes('fueltank') || mesh.includes('bumperbar') ||
    mesh.includes('strut_bar') || mesh.includes('undertray') || mesh.includes('skidplate') ||
    mesh.includes('subframe') || mesh.includes('stiffening') || mesh.includes('transfer_case') ||
    mesh.includes('steeringboot') || mesh.includes('steering_column') || mesh.includes('rollcage')
  ) return 'dark'
  if (
    mesh.includes('headlight') || mesh.includes('taillight') || mesh.includes('foglight') ||
    mesh.includes('signal') || mesh.includes('chmsl') || mesh.includes('trunklight') ||
    mesh.includes('reverselight') || mesh.includes('lightglass')
  ) return 'light'
  if (mesh.includes('chrome') || mesh.includes('grille')) return 'chrome'
  if (mesh.includes('mirror_') && !mesh.includes('mirror_L') && !mesh.includes('mirror_R')) return 'mirror'

  return 'paint'
}

// ── Apply resolved mesh visibility ──
// Three.js ColladaLoader naming:
//   - Single-material geometry  → Mesh with name = <node name>
//   - Multi-material geometry   → Group with name = <node name>, child Meshes unnamed
// We walk the tree top-down: named nodes check the active set,
// unnamed children inherit visibility from their nearest named ancestor.
function applyMeshVisibility(model: THREE.Object3D, activeMeshes: Set<string>): void {
  function walk(node: THREE.Object3D, ancestorActive: boolean): void {
    // Skip wheel placement clones — they manage their own visibility
    if (node.userData.wheelClone) return
    // Skip wheel originals at origin — they must stay hidden
    if (node.userData.wheelOriginal) return
    let active: boolean
    if (node === model) {
      active = true
    } else if (node.name) {
      active = activeMeshes.has(node.name)
    } else {
      active = ancestorActive
    }
    node.visible = active
    for (const child of node.children) {
      walk(child, active)
    }
  }
  walk(model, true)
}

// ── Wheel placement: clone wheel/tire/hubcap meshes to their corner positions ──
// Removes any previous wheel clones, resets originals, then re-builds clones.
async function placeWheels(
  model: THREE.Object3D,
  vehicleName: string,
  parts: Record<string, string>
): Promise<void> {
  // Clean up previous wheel placement
  const toRemove: THREE.Object3D[] = []
  model.traverse((node) => {
    if (node.userData.wheelClone) toRemove.push(node)
    if (node.userData.wheelOriginal) {
      node.userData.wheelOriginal = false
      // Visibility will be managed by applyMeshVisibility after this
    }
  })
  for (const n of toRemove) n.parent?.remove(n)

  const wheelPlacements = await window.api.getWheelPlacements(vehicleName, parts)
  if (wheelPlacements.length === 0) return

  model.updateMatrixWorld(true)
  const cornerPositions: Partial<Record<string, THREE.Vector3>> = {}

  // Brakedrum meshes → accurate corner centres
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.geometry) return
    const bdMatch = /_brakedrum_(R|L)$/i.exec(node.name)
    if (!bdMatch) return
    node.geometry.computeBoundingBox()
    if (!node.geometry.boundingBox) return
    const center = node.geometry.boundingBox.getCenter(new THREE.Vector3())
    const side = bdMatch[1].toUpperCase()
    const isFront = center.y < 0
    if (side === 'R') {
      cornerPositions[isFront ? 'FR' : 'RR'] = center
    } else {
      cornerPositions[isFront ? 'FL' : 'RL'] = center
    }
  })

  // Fallback: handler-provided positions for corners without DAE references
  for (const p of wheelPlacements) {
    if (!cornerPositions[p.corner]) {
      cornerPositions[p.corner] = new THREE.Vector3(p.position[0], p.position[1], p.position[2])
    }
  }

  // Group placements by mesh name
  const byMesh = new Map<string, typeof wheelPlacements>()
  for (const p of wheelPlacements) {
    if (!byMesh.has(p.meshName)) byMesh.set(p.meshName, [])
    byMesh.get(p.meshName)!.push(p)
  }

  for (const [meshName, placements] of byMesh) {
    let foundNode: THREE.Object3D | null = null
    model.traverse((node) => {
      if (node.name === meshName && !foundNode) foundNode = node
    })
    if (!foundNode) continue
    const original = foundNode as THREE.Object3D

    // Compute mesh geometry centre in model-local space
    let meshCenter = new THREE.Vector3(0, 0, 0)
    original.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry && meshCenter.length() === 0) {
        child.geometry.computeBoundingBox()
        if (child.geometry.boundingBox) {
          const c = child.geometry.boundingBox.getCenter(new THREE.Vector3())
          c.applyMatrix4(child.matrixWorld)
          model.worldToLocal(c)
          meshCenter = c
        }
      }
    })

    const isNearOrigin = meshCenter.length() < 0.15
    original.visible = false
    original.userData.wheelOriginal = true

    for (const p of placements) {
      const cornerPos = cornerPositions[p.corner]
      if (!cornerPos) continue
      const clone = original.clone(true)
      clone.visible = true
      clone.name = `${meshName}_${p.group}`
      clone.position.set(
        cornerPos.x - meshCenter.x,
        cornerPos.y - meshCenter.y,
        cornerPos.z - meshCenter.z
      )
      const isRightSide = /R\d*$/i.test(p.corner) || /R$/i.test(p.corner)
      if (isNearOrigin && isRightSide) {
        clone.scale.x *= -1
      }
      clone.userData.wheelClone = true
      clone.traverse((child) => { child.visible = true })
      model.add(clone)
    }
  }
}

// ── DDS texture loader with BC7/BC5/DXT support ──
// Three.js DDSLoader only handles DXT1/3/5. BeamNG uses BC7 (DX10 fourCC, dxgiFormat=99)
// and BC5 for normals. We parse the DDS header ourselves and use WebGL compressed texture
// extensions (EXT_texture_compression_bptc for BC7, EXT_texture_compression_rgtc for BC5).

const FOURCC_DXT1 = 0x31545844 // 'DXT1'
const FOURCC_DXT3 = 0x33545844 // 'DXT3'
const FOURCC_DXT5 = 0x35545844 // 'DXT5'
const FOURCC_DX10 = 0x30315844 // 'DX10'
const FOURCC_BC4U = 0x55344342 // 'BC4U'
const FOURCC_BC5U = 0x55354342 // 'BC5U'
const FOURCC_ATI2 = 0x32495441 // 'ATI2' (= BC5)

// DXGI formats
const DXGI_FORMAT_BC1_UNORM = 71
const DXGI_FORMAT_BC2_UNORM = 74
const DXGI_FORMAT_BC3_UNORM = 77
const DXGI_FORMAT_BC4_UNORM = 80
const DXGI_FORMAT_BC5_UNORM = 83
const DXGI_FORMAT_BC7_UNORM = 98
const DXGI_FORMAT_BC7_UNORM_SRGB = 99

interface DDSInfo {
  width: number
  height: number
  mipmaps: { data: Uint8Array; width: number; height: number }[]
  format: number // THREE compressed format constant
}

// ── Detect-only: check if a DDS is BC4/BC5 (needs software decoding for normal/roughness) ──
function detectDDSFormat(buffer: ArrayBuffer): 'bc4' | 'bc5' | 'gpu' | null {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x20534444) return null
  const pfFlags = view.getUint32(80, true)
  const fourCC = view.getUint32(84, true)
  const hasFourCC = (pfFlags & 0x4) !== 0
  if (!hasFourCC) return null
  if (fourCC === FOURCC_DX10) {
    const dxgi = view.getUint32(128, true)
    if (dxgi === DXGI_FORMAT_BC4_UNORM) return 'bc4'
    if (dxgi === DXGI_FORMAT_BC5_UNORM) return 'bc5'
    return 'gpu'
  }
  if (fourCC === FOURCC_BC4U) return 'bc4'
  if (fourCC === FOURCC_BC5U || fourCC === FOURCC_ATI2) return 'bc5'
  return 'gpu'
}

// ── Software decode a single BC4 block (8 bytes → 16 values) ──
function decodeBC4Block(src: Uint8Array, offset: number): number[] {
  const a0 = src[offset]
  const a1 = src[offset + 1]
  const lut: number[] = [a0, a1]
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) lut.push(((6 - i) * a0 + i * a1 + 3) / 7 | 0)
  } else {
    for (let i = 1; i <= 4; i++) lut.push(((4 - i) * a0 + i * a1 + 2) / 5 | 0)
    lut.push(0, 255)
  }
  const values: number[] = []
  let bits = 0, bitCount = 0, byteIdx = offset + 2
  for (let i = 0; i < 16; i++) {
    while (bitCount < 3) { bits |= (src[byteIdx++] << bitCount); bitCount += 8 }
    values.push(lut[bits & 7])
    bits >>= 3; bitCount -= 3
  }
  return values
}

// ── Software decode BC5 normal map → RGBA pixels ──
function decodeBC5Normal(buffer: ArrayBuffer): { data: Uint8Array; width: number; height: number } | null {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x20534444) return null
  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)
  let dataOffset = 128
  const pfFlags = view.getUint32(80, true)
  const fourCC = view.getUint32(84, true)
  if ((pfFlags & 0x4) !== 0 && fourCC === FOURCC_DX10) dataOffset = 148

  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  const rgba = new Uint8Array(width * height * 4)
  const src = new Uint8Array(buffer)
  let off = dataOffset

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const rVals = decodeBC4Block(src, off)
      const gVals = decodeBC4Block(src, off + 8)
      off += 16
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px, y = by * 4 + py
          if (x >= width || y >= height) continue
          const idx = py * 4 + px
          const nx = (rVals[idx] / 255) * 2 - 1
          const ny = (gVals[idx] / 255) * 2 - 1
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
          const pixOff = (y * width + x) * 4
          rgba[pixOff] = rVals[idx]
          rgba[pixOff + 1] = gVals[idx]
          rgba[pixOff + 2] = (nz * 0.5 + 0.5) * 255 | 0
          rgba[pixOff + 3] = 255
        }
      }
    }
  }
  return { data: rgba, width, height }
}

function parseDDS(buffer: ArrayBuffer, renderer: THREE.WebGLRenderer): DDSInfo | null {
  const view = new DataView(buffer)

  // Validate magic
  if (view.getUint32(0, true) !== 0x20534444) return null // 'DDS '

  const height = view.getUint32(12, true)
  const width = view.getUint32(16, true)
  const mipmapCount = Math.max(1, view.getUint32(28, true))
  const pfFlags = view.getUint32(80, true)
  const fourCC = view.getUint32(84, true)

  let format: number
  let blockSize: number
  let dataOffset = 128

  const hasFourCC = (pfFlags & 0x4) !== 0

  if (hasFourCC && fourCC === FOURCC_DX10) {
    // DX10 extended header
    const dxgiFormat = view.getUint32(128, true)
    dataOffset = 148

    switch (dxgiFormat) {
      case DXGI_FORMAT_BC1_UNORM:
        format = THREE.RGBA_S3TC_DXT1_Format
        blockSize = 8
        break
      case DXGI_FORMAT_BC2_UNORM:
        format = THREE.RGBA_S3TC_DXT3_Format
        blockSize = 16
        break
      case DXGI_FORMAT_BC3_UNORM:
        format = THREE.RGBA_S3TC_DXT5_Format
        blockSize = 16
        break
      case DXGI_FORMAT_BC4_UNORM: {
        const ext = renderer.getContext().getExtension('EXT_texture_compression_rgtc')
        if (!ext) return null
        format = ext.COMPRESSED_RED_RGTC1_EXT
        blockSize = 8
        break
      }
      case DXGI_FORMAT_BC5_UNORM: {
        const ext = renderer.getContext().getExtension('EXT_texture_compression_rgtc')
        if (!ext) return null
        format = ext.COMPRESSED_RED_GREEN_RGTC2_EXT
        blockSize = 16
        break
      }
      case DXGI_FORMAT_BC7_UNORM:
      case DXGI_FORMAT_BC7_UNORM_SRGB: {
        const ext = renderer.getContext().getExtension('EXT_texture_compression_bptc')
        if (!ext) return null
        // Always use non-SRGB format — let Three.js handle colorSpace via texture.colorSpace
        // Using the SRGB variant here + Three.js SRGBColorSpace = double conversion → too dark
        format = ext.COMPRESSED_RGBA_BPTC_UNORM_EXT
        blockSize = 16
        break
      }
      default:
        return null // unsupported
    }
  } else if (hasFourCC) {
    switch (fourCC) {
      case FOURCC_DXT1: format = THREE.RGBA_S3TC_DXT1_Format; blockSize = 8; break
      case FOURCC_DXT3: format = THREE.RGBA_S3TC_DXT3_Format; blockSize = 16; break
      case FOURCC_DXT5: format = THREE.RGBA_S3TC_DXT5_Format; blockSize = 16; break
      case FOURCC_BC4U: {
        const ext = renderer.getContext().getExtension('EXT_texture_compression_rgtc')
        if (!ext) return null
        format = ext.COMPRESSED_RED_RGTC1_EXT
        blockSize = 8
        break
      }
      case FOURCC_BC5U:
      case FOURCC_ATI2: {
        const ext = renderer.getContext().getExtension('EXT_texture_compression_rgtc')
        if (!ext) return null
        format = ext.COMPRESSED_RED_GREEN_RGTC2_EXT
        blockSize = 16
        break
      }
      default:
        return null
    }
  } else {
    return null // uncompressed not handled
  }

  // Extract mipmaps
  const mipmaps: DDSInfo['mipmaps'] = []
  let mipWidth = width
  let mipHeight = height
  let offset = dataOffset

  for (let i = 0; i < mipmapCount; i++) {
    const blocksW = Math.max(1, Math.ceil(mipWidth / 4))
    const blocksH = Math.max(1, Math.ceil(mipHeight / 4))
    const dataLength = blocksW * blocksH * blockSize

    if (offset + dataLength > buffer.byteLength) break

    mipmaps.push({
      data: new Uint8Array(buffer, offset, dataLength),
      width: mipWidth,
      height: mipHeight
    })

    offset += dataLength
    mipWidth = Math.max(1, mipWidth >> 1)
    mipHeight = Math.max(1, mipHeight >> 1)
  }

  return { width, height, mipmaps, format }
}

async function loadGameTexture(
  renderer: THREE.WebGLRenderer,
  vehicleName: string,
  gamePath: string
): Promise<THREE.CompressedTexture | null> {
  const cleanPath = gamePath.replace(/^\/+/, '').replace(/\.png$/i, '.dds')
  const url = `vehicle-asset://${vehicleName}/${cleanPath}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn('[tex] fetch failed:', url, resp.status)
      return null
    }
    const buffer = await resp.arrayBuffer()
    console.log('[tex] loaded', cleanPath, buffer.byteLength, 'bytes')
    const info = parseDDS(buffer, renderer)
    if (!info || info.mipmaps.length === 0) {
      console.warn('[tex] parseDDS failed for', cleanPath, info ? 'no mipmaps' : 'null')
      return null
    }
    console.log('[tex] parsed', cleanPath, info.width, 'x', info.height, 'fmt=', info.format, 'mips=', info.mipmaps.length)

    const texture = new THREE.CompressedTexture(
      info.mipmaps as unknown as ImageData[],
      info.width,
      info.height,
      info.format as THREE.CompressedPixelFormat
    )
    texture.minFilter = info.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    // DDS is stored top-down but Collada UVs use OpenGL convention (V=0 at bottom).
    // CompressedTexture can't actually flip pixel data, so we apply a texture matrix
    // transform that flips V: v' = 1 - v. This corrects the vertical orientation.
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1, -1)
    texture.offset.set(0, 1)
    texture.needsUpdate = true
    return texture
  } catch (e) {
    console.error('[tex] error loading', cleanPath, e)
    return null
  }
}

// ── Load a normal map DDS, with software BC5 decoding and Z reconstruction ──
async function loadGameNormalMap(
  renderer: THREE.WebGLRenderer,
  vehicleName: string,
  gamePath: string
): Promise<THREE.Texture | null> {
  const cleanPath = gamePath.replace(/^\/+/, '').replace(/\.png$/i, '.dds')
  const url = `vehicle-asset://${vehicleName}/${cleanPath}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const buffer = await resp.arrayBuffer()
    const fmt = detectDDSFormat(buffer)

    if (fmt === 'bc5') {
      // Software decode BC5 → RGBA with reconstructed Z
      const decoded = decodeBC5Normal(buffer)
      if (!decoded) return null
      const tex = new THREE.DataTexture(decoded.data, decoded.width, decoded.height, THREE.RGBAFormat)
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(1, -1)
      tex.offset.set(0, 1)
      tex.needsUpdate = true
      console.log('[tex] decoded BC5 normal', cleanPath, decoded.width, 'x', decoded.height)
      return tex
    }

    // BC7 or other GPU-supported format — use compressed path
    const info = parseDDS(buffer, renderer)
    if (!info || info.mipmaps.length === 0) return null
    const tex = new THREE.CompressedTexture(
      info.mipmaps as unknown as ImageData[],
      info.width, info.height, info.format as THREE.CompressedPixelFormat
    )
    tex.minFilter = info.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1, -1)
    tex.offset.set(0, 1)
    tex.needsUpdate = true
    return tex
  } catch {
    return null
  }
}

// ── Material definition stage from materials.json ──
interface MatStage {
  baseColorMap?: string
  baseColorFactor?: number[] | null
  colorMap?: string
  colorPaletteMap?: string
  colorPaletteMapUseUV?: number
  normalMap?: string
  roughnessMap?: string
  roughnessFactor?: number
  metallicMap?: string
  metallicFactor?: number
  ambientOcclusionMap?: string
  clearCoatFactor?: number
  clearCoatRoughnessFactor?: number
  clearCoatMap?: string
  opacityMap?: string
  specularMap?: string
  emissive?: boolean
  glow?: boolean
  diffuseColor?: number[] | null
  instanceDiffuse?: boolean
}
interface MatDef {
  name?: string
  mapTo?: string
  Stages?: MatStage[]
  translucent?: boolean
  translucentBlendOp?: string
  activeLayers?: number
  alphaTest?: boolean
  alphaRef?: number
  doubleSided?: boolean
}

export function VehicleViewer({ vehicleName, parts, paints, className }: VehicleViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const frameIdRef = useRef<number>(0)
  const modelRef = useRef<THREE.Object3D | null>(null)
  const paintMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null)
  const partsRef = useRef(parts)
  partsRef.current = parts
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // Render options state
  const [showRenderOpts, setShowRenderOpts] = useState(false)
  const [sunAngle, setSunAngle] = useState(45) // degrees, 0=front, 90=overhead, 180=behind
  const [bgColor, setBgColor] = useState('#111113')
  const [floorColor, setFloorColor] = useState('#222228')
  const [lightIntensity, setLightIntensity] = useState(1.8)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null)
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null)
  const backLightRef = useRef<THREE.DirectionalLight | null>(null)
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null)
  const floorMatRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const fogRef = useRef<THREE.Fog | null>(null)

  // React to parts changes — resolve active meshes via slot tree walk
  useEffect(() => {
    if (!modelRef.current || !parts) return
    let cancelled = false
    ;(async () => {
      const model = modelRef.current!
      const meshList = await window.api.getActiveVehicleMeshes(vehicleName, parts)
      if (cancelled || !modelRef.current) return

      // Re-run wheel placement (also cleans up old clones/originals)
      try {
        await placeWheels(model, vehicleName, parts)
      } catch (e) {
        console.warn('[wheels] failed to re-place wheels on part change:', e)
      }
      if (cancelled || !modelRef.current) return

      applyMeshVisibility(model, new Set(meshList))

      // Re-run wheel placement with new parts
      try {
        await placeWheels(model, vehicleName, parts)
      } catch (e) {
        console.warn('[wheels] failed to re-place wheels on part change:', e)
      }
    })()
    return () => { cancelled = true }
  }, [parts, vehicleName, status])

  // React to paint changes
  useEffect(() => {
    if (!paintMatRef.current) return
    const p = paints?.[0]
    if (p?.baseColor) {
      // If a livery texture is applied, keep paint white so texture isn't tinted
      if (!paintMatRef.current.map) {
        const [r, g, b] = p.baseColor
        paintMatRef.current.color.setRGB(r, g, b)
      }
      // Only override roughness/metalness if no texture maps are present
      if (!paintMatRef.current.roughnessMap) {
        paintMatRef.current.roughness = p.roughness ?? 0.3
      }
      if (!paintMatRef.current.metalnessMap) {
        paintMatRef.current.metalness = p.metallic ?? 0.8
      }
      paintMatRef.current.clearcoat = p.clearcoat ?? 0.8
      paintMatRef.current.clearcoatRoughness = p.clearcoatRoughness ?? 0.05
    }
  }, [paints])

  // React to sun angle changes — rotate lights in an arc
  const updateSunAngle = useCallback((angleDeg: number) => {
    const rad = (angleDeg * Math.PI) / 180
    const radius = 10
    // Sun travels in an arc: 0° = front, 90° = directly overhead, 180° = behind
    const x = radius * Math.cos(rad) * 0.5
    const y = radius * Math.sin(rad)
    const z = radius * Math.cos(rad) * 0.6

    if (keyLightRef.current) {
      keyLightRef.current.position.set(x, Math.max(y, 1), z)
    }
    if (fillLightRef.current) {
      fillLightRef.current.position.set(-x * 0.8, Math.max(y * 0.7, 1), -z * 0.3)
    }
    if (backLightRef.current) {
      backLightRef.current.position.set(-x * 0.3, Math.max(y * 0.5, 1), -z)
    }
    if (rimLightRef.current) {
      rimLightRef.current.position.set(x * 0.4, Math.max(y * 0.1, 0.3), -z * 0.5)
    }
  }, [])

  useEffect(() => { updateSunAngle(sunAngle) }, [sunAngle, updateSunAngle])

  // React to light intensity changes
  useEffect(() => {
    if (keyLightRef.current) keyLightRef.current.intensity = lightIntensity
    if (fillLightRef.current) fillLightRef.current.intensity = lightIntensity * 0.28
    if (backLightRef.current) backLightRef.current.intensity = lightIntensity * 0.19
    if (rimLightRef.current) rimLightRef.current.intensity = lightIntensity * 0.11
  }, [lightIntensity])

  // React to background color changes
  useEffect(() => {
    const c = new THREE.Color(bgColor)
    if (sceneRef.current) {
      sceneRef.current.background = c
      sceneRef.current.backgroundIntensity = 1.0
      sceneRef.current.backgroundBlurriness = 0
    }
    if (fogRef.current) {
      fogRef.current.color.copy(c)
    }
  }, [bgColor])

  // React to floor color changes
  useEffect(() => {
    if (floorMatRef.current) {
      floorMatRef.current.color.set(floorColor)
      floorMatRef.current.needsUpdate = true
    }
  }, [floorColor])

  // Scene + model load
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    modelRef.current = null
    paintMatRef.current = null
    setStatus('loading')

    const scene = new THREE.Scene()
    const fog = new THREE.Fog(0x111113, 25, 50)
    scene.fog = fog
    sceneRef.current = scene
    fogRef.current = fog

    const width = container.clientWidth
    const height = container.clientHeight
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 500)
    camera.position.set(5, 2.5, 5)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.zIndex = '0'
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Showroom environment ──
    // Build a lit box scene for the PMREM environment map (reflections).
    // This gives paint and chrome surfaces something "real" to reflect —
    // overhead strip lights, walls, floor — instead of a flat gradient.
    const pmremGen = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.background = new THREE.Color(0x1a1a22)

    // Ambient fill
    envScene.add(new THREE.HemisphereLight(0x8899bb, 0x222233, 1.2))

    // Fake ceiling strip lights (emissive boxes visible in reflections)
    const stripGeo = new THREE.BoxGeometry(0.4, 0.02, 8)
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    for (let i = -2; i <= 2; i++) {
      const strip = new THREE.Mesh(stripGeo, stripMat)
      strip.position.set(i * 1.8, 4, 0)
      envScene.add(strip)
    }

    // Walls (visible grey so reflections show structure)
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x333340 })
    const wallGeo = new THREE.PlaneGeometry(24, 10)
    const wallBack = new THREE.Mesh(wallGeo, wallMat)
    wallBack.position.set(0, 4, -10)
    envScene.add(wallBack)
    const wallLeft = new THREE.Mesh(wallGeo, wallMat)
    wallLeft.rotation.y = Math.PI / 2
    wallLeft.position.set(-10, 4, 0)
    envScene.add(wallLeft)
    const wallRight = new THREE.Mesh(wallGeo, wallMat)
    wallRight.rotation.y = -Math.PI / 2
    wallRight.position.set(10, 4, 0)
    envScene.add(wallRight)

    // Floor for reflections
    const envFloorGeo = new THREE.PlaneGeometry(24, 24)
    const envFloorMat = new THREE.MeshBasicMaterial({ color: 0x222230 })
    const envFloor = new THREE.Mesh(envFloorGeo, envFloorMat)
    envFloor.rotation.x = -Math.PI / 2
    envScene.add(envFloor)

    const envMap = pmremGen.fromScene(envScene, 0.04).texture
    scene.environment = envMap
    // Show the garage environment as background
    scene.background = envMap
    scene.backgroundIntensity = 0.4
    scene.backgroundBlurriness = 0.5
    pmremGen.dispose()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 2
    controls.maxDistance = 12
    controls.target.set(0, 0.6, 0)
    controls.maxPolarAngle = Math.PI * 0.52

    // ── Showroom lighting ──
    const hemi = new THREE.HemisphereLight(0xdde0f0, 0x1a1a22, 0.4)
    scene.add(hemi)

    // Key light — overhead, slightly forward-right
    const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.8)
    keyLight.position.set(4, 9, 5)
    keyLightRef.current = keyLight
    keyLight.castShadow = true
    keyLight.shadow.mapSize.width = 2048
    keyLight.shadow.mapSize.height = 2048
    keyLight.shadow.camera.near = 0.5
    keyLight.shadow.camera.far = 25
    keyLight.shadow.camera.left = -8
    keyLight.shadow.camera.right = 8
    keyLight.shadow.camera.top = 8
    keyLight.shadow.camera.bottom = -8
    keyLight.shadow.bias = -0.0005
    keyLight.shadow.normalBias = 0.02
    scene.add(keyLight)

    // Fill light — softer, from left
    const fillLight = new THREE.DirectionalLight(0xc8d0e8, 0.5)
    fillLight.position.set(-6, 6, -1)
    scene.add(fillLight)
    fillLightRef.current = fillLight

    // Back light — rim highlight
    const backLight = new THREE.DirectionalLight(0xffffff, 0.35)
    backLight.position.set(-2, 4, -7)
    scene.add(backLight)
    backLightRef.current = backLight

    // Low rim for underside detail
    const rimLight = new THREE.DirectionalLight(0xeeeeff, 0.2)
    rimLight.position.set(3, 0.5, -4)
    scene.add(rimLight)
    rimLightRef.current = rimLight

    // Overhead strip lights (visible scene geometry matching env map)
    const sceneStripGeo = new THREE.BoxGeometry(0.15, 0.01, 10)
    const sceneStripMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    for (let i = -2; i <= 2; i++) {
      const s = new THREE.Mesh(sceneStripGeo, sceneStripMat)
      s.position.set(i * 1.8, 6, 0)
      scene.add(s)
    }

    // Animation
    const animate = (): void => {
      frameIdRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = (): void => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Load DAE models — first resolve active meshes, then load all relevant DAEs
    const loader = new ColladaLoader()
    let cancelled = false

    ;(async () => {
      // Step 1: Resolve active meshes via slot tree walk (needed to find relevant DAE files)
      let activeMeshList: string[] | undefined
      if (partsRef.current) {
        try {
          activeMeshList = await window.api.getActiveVehicleMeshes(vehicleName, partsRef.current)
        } catch { /* proceed without mesh filtering */ }
      }

      // Step 2: Load all relevant DAE files (vehicle zip + matching common.zip DAEs)
      const daeTexts = await window.api.getVehicle3DModel(vehicleName, activeMeshList)
      if (cancelled || !daeTexts || daeTexts.length === 0) {
        if (!cancelled) setStatus('error')
        return
      }

      try {
        // Step 3: Parse each DAE and merge into a single model group
        const model = new THREE.Group()
        model.rotation.x = -Math.PI / 2
        for (const daeText of daeTexts) {
          try {
            const collada = loader.parse(daeText, '')!
            const scene = collada.scene

            // ColladaLoader applies unit scale (e.g., 0.01 for centimeter DAEs) and
            // Z_UP rotation on the scene root. We apply our own -π/2 Z_UP rotation
            // on the model root, so we only need to preserve the unit scale.
            const hasUnitScale = Math.abs(scene.scale.x - 1) > 1e-6 ||
                                 Math.abs(scene.scale.y - 1) > 1e-6 ||
                                 Math.abs(scene.scale.z - 1) > 1e-6

            if (hasUnitScale) {
              // Wrap children in a group that preserves the unit scale
              const wrapper = new THREE.Group()
              wrapper.scale.copy(scene.scale)
              while (scene.children.length > 0) {
                wrapper.add(scene.children[0])
              }
              model.add(wrapper)
            } else {
              while (scene.children.length > 0) {
                model.add(scene.children[0])
              }
            }
          } catch { /* skip malformed DAE files */ }
        }

        // ── Fetch material definitions from game data ──
        let materialsDB: Record<string, MatDef> = {}
        try {
          materialsDB = (await window.api.getVehicleMaterials(vehicleName)) as Record<string, MatDef>
        } catch { /* proceed without textures */ }

        // ── Identify paint material(s) — those that use instanceDiffuse in any stage ──
        const paintMapToNames = new Set<string>()
        for (const [mapTo, def] of Object.entries(materialsDB)) {
          const hasPaint = (def.Stages as MatStage[] | undefined)?.some((s) => s?.instanceDiffuse)
          if (hasPaint || mapTo === vehicleName) {
            paintMapToNames.add(mapTo)
          }
        }

        // ── Resolve active skin name from config parts ──
        let globalSkinName: string | null = null
        let globalSkinSlotType: string | null = null
        if (partsRef.current) {
          try {
            const skinInfo = await window.api.getActiveGlobalSkin(vehicleName, partsRef.current)
            if (skinInfo) {
              globalSkinName = skinInfo.skin
              globalSkinSlotType = skinInfo.slotType
              console.log('[skin] active globalSkin:', globalSkinName, 'slotType:', globalSkinSlotType)
            }
          } catch { /* no skin */ }
        }

        // ── Paint colors ──
        const p0 = paints?.[0]
        // Default paint color for materials without palette compositing
        const paintColor = p0?.baseColor
          ? new THREE.Color(p0.baseColor[0], p0.baseColor[1], p0.baseColor[2])
          : new THREE.Color(0.65, 0.65, 0.67)

        // Three paint zone colors for palette compositing (sRGB floats, matching BeamNG instanceColors)
        // Zone 0 (R channel) = primary paint, Zone 1 (G) = secondary, Zone 2 (B) = tertiary
        const paintZoneColors: [number, number, number][] = [
          p0?.baseColor ? [p0.baseColor[0], p0.baseColor[1], p0.baseColor[2]] : [0.65, 0.65, 0.67],
          paints?.[1]?.baseColor ? [paints[1].baseColor[0], paints[1].baseColor[1], paints[1].baseColor[2]] : [0.1, 0.1, 0.12],
          paints?.[2]?.baseColor ? [paints[2].baseColor[0], paints[2].baseColor[1], paints[2].baseColor[2]] : [0.8, 0.8, 0.82],
        ]

        // ── Procedural fallback materials ──
        const fallbackPaintMat = new THREE.MeshPhysicalMaterial({
          color: paintColor,
          roughness: p0?.roughness ?? 0.3,
          metalness: p0?.metallic ?? 0.5,
          clearcoat: p0?.clearcoat ?? 0.8,
          clearcoatRoughness: p0?.clearcoatRoughness ?? 0.04,
          envMapIntensity: 1.2
        })

        const glassMat = new THREE.MeshPhysicalMaterial({
          color: 0x334455, roughness: 0.05, metalness: 0.0,
          transmission: 0.85, thickness: 0.3, transparent: true, opacity: 0.35,
          envMapIntensity: 1.5
        })
        const interiorMat = new THREE.MeshStandardMaterial({
          color: 0x1a1a1e, roughness: 0.82, metalness: 0.05
        })
        const darkMat = new THREE.MeshStandardMaterial({
          color: 0x151515, roughness: 0.88, metalness: 0.1
        })
        const chromeMat = new THREE.MeshStandardMaterial({
          color: 0xe0e0e0, roughness: 0.06, metalness: 1.0, envMapIntensity: 1.4
        })
        const lightMat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff, roughness: 0.05, metalness: 0.0,
          transmission: 0.85, transparent: true, opacity: 0.3,
          emissive: 0xffffee, emissiveIntensity: 0.3,
          envMapIntensity: 0.4, ior: 1.5, thickness: 0.5
        })
        const mirrorMat = new THREE.MeshStandardMaterial({
          color: 0xaabbcc, roughness: 0.02, metalness: 1.0
        })

        const fallbackMap: Record<MatCategory, THREE.Material> = {
          paint: fallbackPaintMat, glass: glassMat, interior: interiorMat,
          dark: darkMat, chrome: chromeMat, light: lightMat,
          mirror: mirrorMat, tire: darkMat
        }

        // ── Build textured materials from materials.json ──
        const matCache: Record<string, THREE.MeshPhysicalMaterial> = {}
        const texturePromises: Promise<void>[] = []

        function resolveMapTo(colladaName: string): string {
          return colladaName.replace(/-material$/, '')
        }

        function getOrCreateTexturedMat(colladaName: string, meshName: string): THREE.MeshPhysicalMaterial | null {
          const mapTo = resolveMapTo(colladaName)
          if (matCache[mapTo]) return matCache[mapTo]

          const def = materialsDB[mapTo] || materialsDB[colladaName]
          if (!def?.Stages) return null

          const isPaint = paintMapToNames.has(mapTo)
          const isTranslucent = !!def.translucent
          const cat = classifyMesh(colladaName, meshName)

          // For paint materials, determine the effective material definition
          // Skin material key patterns:
          //   slotType "paint_design" → <mapTo>.skin.<skinName> (e.g. van.skin.police)
          //   slotType "skin_*"       → <mapTo>.<slotType>.<skinName> (e.g. fullsize.skin_sedan.bcpd)
          let effectiveDef: MatDef = def
          if (isPaint && globalSkinName && globalSkinSlotType) {
            const skinKeyBySlot = `${mapTo}.${globalSkinSlotType}.${globalSkinName}`
            const skinKeyFallback = `${mapTo}.skin.${globalSkinName}`
            const skinDef = materialsDB[skinKeyBySlot] || materialsDB[skinKeyFallback]
            if ((skinDef as MatDef | undefined)?.Stages) {
              effectiveDef = skinDef as MatDef
              console.log('[skin] using skin material:', materialsDB[skinKeyBySlot] ? skinKeyBySlot : skinKeyFallback)
            }
          }

          // Extract staged texture info from effective material
          const stages = effectiveDef.Stages as MatStage[]
          const stage0 = stages?.find(s => s && !s.instanceDiffuse) || null
          const paintStage = stages?.find(s => s?.instanceDiffuse) || null

          // Base color path from Stage[0] (body detail texture)
          const colorPath = stage0?.baseColorMap || stage0?.colorMap || null
          const normalPath = stage0?.normalMap || null
          const stage0OpacityPath = stage0?.opacityMap || null

          // Paint rendering: palette map from the instanceDiffuse stage
          const palettePath = isPaint ? (paintStage?.colorPaletteMap || null) : null
          const opacityPath = isPaint ? (paintStage?.opacityMap || null) : null
          // Direct livery skins (e.g. police): unique baseColorMap in paint stage
          const paintStageBaseColor = isPaint ? (paintStage?.baseColorMap || null) : null
          const hasDirectLivery = isPaint && !palettePath && !!paintStageBaseColor && paintStageBaseColor !== colorPath

          // baseColorFactor is a flat RGBA color used by grille/chrome/decal materials
          // that have no texture map but define their color via a factor array
          const baseColorFactor = stage0?.baseColorFactor as number[] | null | undefined

          // Determine if this material has any useful texture/color data
          const hasTextureData = colorPath || normalPath || stage0OpacityPath || palettePath || hasDirectLivery
          const hasColorFactor = baseColorFactor && Array.isArray(baseColorFactor) && baseColorFactor.length >= 3
          if (!hasTextureData && !hasColorFactor) return null

          // Glass, mirror → procedural for materials that lack real texture data
          // Chrome/grille/light materials that have texture data should be rendered with textures
          if (!isPaint && (cat === 'glass' || cat === 'mirror') && !colorPath && !stage0OpacityPath) return null
          // Light materials with no texture data → use procedural (signal bulbs, foglights, etc.)
          if (!isPaint && cat === 'light' && !colorPath && !stage0OpacityPath) return null

          // Determine if this is an alpha-tested material (grille mesh patterns, decals)
          const isAlphaTested = !!def.alphaTest && !!stage0OpacityPath
          const isDoubleSided = !!def.doubleSided

          // Resolve the base color: from baseColorFactor, category defaults, or white
          let baseColor = new THREE.Color(0xffffff)
          if (!isPaint && hasColorFactor && baseColorFactor) {
            // baseColorFactor from materials.json (linear space values)
            baseColor = new THREE.Color(baseColorFactor[0], baseColorFactor[1], baseColorFactor[2])
          } else if (!isPaint && !colorPath && cat === 'chrome') {
            // Chrome without texture or color factor → bright metallic
            baseColor = new THREE.Color(0.86, 0.86, 0.86)
          }

          // Create material — paint materials get white base (colors applied via shader)
          const mat = new THREE.MeshPhysicalMaterial({
            color: isPaint ? new THREE.Color(1, 1, 1) : baseColor,
            roughness: isPaint ? (p0?.roughness ?? 0.3) : (stage0?.roughnessFactor ?? 0.5),
            metalness: isPaint ? (p0?.metallic ?? 0.5) : Math.min(stage0?.metallicFactor ?? 0.1, 0.6),
            clearcoat: isPaint ? (p0?.clearcoat ?? 0.8) : (paintStage?.clearCoatFactor ?? 0),
            clearcoatRoughness: isPaint ? (p0?.clearcoatRoughness ?? 0.04) : 0.1,
            envMapIntensity: isPaint ? 1.2 : 0.8,
            transparent: isTranslucent,
            opacity: isTranslucent ? 0.6 : 1.0,
            side: isDoubleSided ? THREE.DoubleSide : (isTranslucent ? THREE.DoubleSide : THREE.FrontSide),
            alphaTest: isAlphaTested ? ((def.alphaRef ?? 127) / 255) : 0
          })

          matCache[mapTo] = mat
          if (isPaint) paintMatRef.current = mat

          const tp = (async (): Promise<void> => {
            if (cancelled) return

            // 1. Load base color texture (Stage[0])
            if (colorPath && !cancelled) {
              const colorTex = await loadGameTexture(renderer, vehicleName, colorPath)
              if (colorTex && !cancelled) {
                colorTex.colorSpace = THREE.SRGBColorSpace
                mat.map = colorTex
                mat.needsUpdate = true
                console.log('[tex] applied baseColor', mapTo)
              }
            }

            // 2. Load normal map (Stage[0]) — BC5 software decoded, others GPU compressed
            if (normalPath && !cancelled) {
              const normalTex = await loadGameNormalMap(renderer, vehicleName, normalPath)
              if (normalTex && !cancelled) {
                mat.normalMap = normalTex
                mat.normalScale = new THREE.Vector2(1, 1)
                mat.needsUpdate = true
                console.log('[tex] normal applied', mapTo)
              }
            }

            // 3. Load opacity map for alpha-tested materials (grille mesh patterns)
            if (isAlphaTested && stage0OpacityPath && !cancelled) {
              const opacityTex = await loadGameTexture(renderer, vehicleName, stage0OpacityPath)
              if (opacityTex && !cancelled) {
                mat.alphaMap = opacityTex
                mat.needsUpdate = true
                console.log('[tex] opacity/alpha applied', mapTo)
              }
            }

            // 4. Paint compositing — palette or direct livery
            if (isPaint && !cancelled) {
              if (palettePath) {
                // ── Palette-based paint compositing (BeamNG getColorPalette) ──
                // Load palette map as DATA texture (no sRGB conversion — values are zone weights)
                const paletteTex = await loadGameTexture(renderer, vehicleName, palettePath)
                const opacityTex = opacityPath
                  ? await loadGameTexture(renderer, vehicleName, opacityPath)
                  : null

                if (paletteTex && !cancelled) {
                  // DO NOT set colorSpace to SRGBColorSpace — palette is zone mask data, not color
                  // opacityTex is also data (greyscale blend mask)
                  const [c0, c1, c2] = paintZoneColors
                  // The palette uses UV1 (colorPaletteMapUseUV: 1 in material def)
                  const paletteUsesUV1 = (paintStage as MatStage)?.colorPaletteMapUseUV === 1

                  // Force Three.js to include UV1 plumbing by setting lightMap with channel=1
                  // This triggers USE_UV1 define and vLightMapUv varying populated from uv1 attribute
                  if (paletteUsesUV1) {
                    const dummyTex = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1)
                    dummyTex.needsUpdate = true
                    mat.lightMap = dummyTex
                    mat.lightMap.channel = 1
                    mat.lightMapIntensity = 0 // neutralize its lighting effect
                  }

                  mat.onBeforeCompile = (shader) => {
                    shader.uniforms.paletteMap = { value: paletteTex }
                    shader.uniforms.uOpacityTex = { value: opacityTex }
                    shader.uniforms.paintColor0 = { value: new THREE.Vector3(c0[0], c0[1], c0[2]) }
                    shader.uniforms.paintColor1 = { value: new THREE.Vector3(c1[0], c1[1], c1[2]) }
                    shader.uniforms.paintColor2 = { value: new THREE.Vector3(c2[0], c2[1], c2[2]) }

                    shader.fragmentShader =
                      'uniform sampler2D paletteMap;\n' +
                      'uniform sampler2D uOpacityTex;\n' +
                      'uniform vec3 paintColor0;\n' +
                      'uniform vec3 paintColor1;\n' +
                      'uniform vec3 paintColor2;\n' +
                      shader.fragmentShader

                    // Use vLightMapUv (UV1) for palette sampling when paletteUsesUV1
                    // DDS textures are stored top-down; UV V-flip (1-v) corrects orientation
                    const paletteUvExpr = paletteUsesUV1
                      ? 'vec2(vLightMapUv.x, 1.0 - vLightMapUv.y)'
                      : 'vMapUv'

                    shader.fragmentShader = shader.fragmentShader.replace(
                      '#include <map_fragment>',
                      `#include <map_fragment>
                      {
                        // ── BeamNG getColorPalette() — exact shader replication ──
                        vec4 palSample = texture2D(paletteMap, ${paletteUvExpr});

                        // Step 1: Normalize RGB channels so they sum to 1
                        float palSum = palSample.r + palSample.g + palSample.b + 1e-10;
                        palSample.rgb /= palSum;

                        // Step 2: Alpha processing — paint coverage
                        float palAlpha = clamp(palSample.a, 0.0, 1.0);

                        // Step 3: Scale zone weights by alpha, compute unpainted fraction
                        palSample.rgb *= palAlpha;
                        float unpainted = 1.0 - palAlpha;

                        // Step 4: Convert paint colors from sRGB to linear
                        // BeamNG toLinearColor approximation:
                        // srgb * (srgb * (srgb * 0.305306011 + 0.682171111) + 0.012522878)
                        vec3 c0 = paintColor0;
                        vec3 c0L = c0 * (c0 * (c0 * 0.305306011 + 0.682171111) + 0.012522878);
                        vec3 c1 = paintColor1;
                        vec3 c1L = c1 * (c1 * (c1 * 0.305306011 + 0.682171111) + 0.012522878);
                        vec3 c2 = paintColor2;
                        vec3 c2L = c2 * (c2 * (c2 * 0.305306011 + 0.682171111) + 0.012522878);

                        // Step 5: Composite paint colors weighted by palette zone masks
                        // Unpainted areas (alpha=0) receive white (1.0)
                        vec3 composited = palSample.r * c0L
                                        + palSample.g * c1L
                                        + palSample.b * c2L
                                        + unpainted * vec3(1.0);

                        // Step 6: Layer blend — paint replaces base texture where opacity > 0
                        // BeamNG processLayers: outLayer = lerp(outLayer, inLayer, opacity)
                        // Stage[1] has no baseColorMap, so paint is the flat composited color
                        // Surface detail comes from shared normal/metallic/roughness/AO maps
                        float opSample = ${opacityPath ? 'texture2D(uOpacityTex, vMapUv).r' : '1.0'};
                        diffuseColor.rgb = mix(diffuseColor.rgb, composited, opSample);
                      }`
                    )
                  }
                  mat.needsUpdate = true
                  console.log('[paint] palette compositing applied to', mapTo, 'palette:', palettePath)
                }
              } else if (hasDirectLivery && paintStageBaseColor) {
                // ── Direct livery skin (e.g. police) ──
                // Livery texture replaces base color where opacity mask is active
                const liveryTex = await loadGameTexture(renderer, vehicleName, paintStageBaseColor)
                if (liveryTex && !cancelled) {
                  liveryTex.colorSpace = THREE.SRGBColorSpace
                  mat.map = liveryTex
                  mat.needsUpdate = true
                  console.log('[skin] direct livery applied to', mapTo)
                }
              } else {
                // No palette, no livery — simple paint tint on base texture
                mat.color.copy(paintColor)
                mat.needsUpdate = true
              }
            }
          })()
          texturePromises.push(tp)

          return mat
        }

        // ── Assign materials to meshes ──
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const meshName = child.name || ''

            const resolveMat = (origMat: THREE.Material): THREE.Material => {
              const matName = origMat?.name || ''
              const texturedMat = getOrCreateTexturedMat(matName, meshName)
              if (texturedMat) return texturedMat
              const cat = classifyMesh(matName, meshName)
              return fallbackMap[cat]
            }

            if (Array.isArray(child.material)) {
              child.material = child.material.map(resolveMat)
            } else {
              child.material = resolveMat(child.material)
            }

            // Enable shadow casting for all visible meshes
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        // If no paint material was created from textures, use the fallback
        if (!paintMatRef.current) paintMatRef.current = fallbackPaintMat

        // ── Apply part visibility (using mesh list already resolved above) ──
        if (activeMeshList && !cancelled) {
          applyMeshVisibility(model, new Set(activeMeshList))
        }

        // ── Position wheel/tire/hubcap meshes at their correct locations ──
        if (partsRef.current && !cancelled) {
          try {
            await placeWheels(model, vehicleName, partsRef.current)
          } catch (e) {
            console.warn('[wheels] failed to place wheels:', e)
          }
        }

        // ── Compute bounding box from VISIBLE meshes only ──
        model.updateMatrixWorld(true)
        const visBox = new THREE.Box3()
        model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible && child.geometry) {
            child.geometry.computeBoundingBox()
            if (child.geometry.boundingBox) {
              const b = child.geometry.boundingBox.clone()
              b.applyMatrix4(child.matrixWorld)
              visBox.union(b)
            }
          }
        })
        if (visBox.isEmpty()) visBox.setFromObject(model)

        const size = visBox.getSize(new THREE.Vector3())
        const center = visBox.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = 3.5 / maxDim

        // Scale and position: center on XZ, bottom at y=0
        model.scale.setScalar(scale)
        model.position.set(
          -center.x * scale,
          -visBox.min.y * scale,
          -center.z * scale
        )

        scene.add(model)
        modelRef.current = model

        // ── Showroom floor — polished concrete with reflections ──
        const floorGeo = new THREE.PlaneGeometry(30, 30)
        const floorMat = new THREE.MeshStandardMaterial({
          color: 0x222228,
          roughness: 0.28,
          metalness: 0.15,
          envMapIntensity: 0.8
        })
        const floor = new THREE.Mesh(floorGeo, floorMat)
        floor.rotation.x = -Math.PI / 2
        floor.position.y = -0.005
        floor.receiveShadow = true
        scene.add(floor)
        floorMatRef.current = floorMat

        // Subtle floor grid lines (showroom detail)
        const gridHelper = new THREE.GridHelper(28, 56, 0x333340, 0x2a2a32)
        gridHelper.position.y = -0.003
        scene.add(gridHelper)
        gridRef.current = gridHelper

        // ── Camera ──
        const scaledHeight = size.y * scale
        controls.target.set(0, scaledHeight * 0.4, 0)
        const camDist = 4.5
        camera.position.set(camDist * 0.85, camDist * 0.35, camDist * 0.85)
        controls.update()

        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })().catch(() => {
      if (!cancelled) setStatus('error')
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frameIdRef.current)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      modelRef.current = null
      paintMatRef.current = null
      sceneRef.current = null
      keyLightRef.current = null
      fillLightRef.current = null
      backLightRef.current = null
      rimLightRef.current = null
      floorMatRef.current = null
      gridRef.current = null
      fogRef.current = null
    }
  }, [vehicleName])

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
          <Loader2 size={24} className="text-[var(--color-accent)] animate-spin" />
          <span className="text-xs text-[var(--color-text-muted)] mt-2">{t('vehicles.loading3DModel')}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
          <span className="text-xs text-[var(--color-text-muted)]">{t('vehicles.modelUnavailable')}</span>
        </div>
      )}

      {/* Render options toggle */}
      {status === 'ready' && (
        <button
          onClick={() => setShowRenderOpts(v => !v)}
          className="absolute top-2 right-10 z-20 p-1.5 bg-[#222226]/90 hover:bg-[#333] border border-[#444] shadow-lg transition-colors"
          title={t('vehicles.renderOptions')}
        >
          <Settings size={14} className={showRenderOpts ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'} />
        </button>
      )}

      {/* Render options panel */}
      {status === 'ready' && showRenderOpts && (
        <div
          className="absolute top-10 right-10 z-20 w-52 bg-[#1a1a1e]/95 border border-[#333] p-3 space-y-3 text-xs select-none"
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Sun Angle */}
          <div>
            <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] mb-1.5">
              <Sun size={12} />
              <span>{t('vehicles.sunAngle')}</span>
              <span className="ml-auto text-[var(--color-text-muted)]/60">{sunAngle}°</span>
            </div>
            <input
              type="range"
              min={5}
              max={175}
              value={sunAngle}
              onChange={e => setSunAngle(Number(e.target.value))}
              className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-[var(--color-text-muted)]/40 mt-0.5">
              <span>{t('vehicles.sunLow')}</span>
              <span>{t('vehicles.sunOverhead')}</span>
              <span>{t('vehicles.sunBehind')}</span>
            </div>
          </div>

          {/* Light Intensity */}
          <div>
            <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] mb-1.5">
              <Sun size={12} />
              <span>{t('vehicles.intensity')}</span>
              <span className="ml-auto text-[var(--color-text-muted)]/60">{lightIntensity.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={4.0}
              step={0.1}
              value={lightIntensity}
              onChange={e => setLightIntensity(Number(e.target.value))}
              className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
            />
          </div>

          {/* Background Color */}
          <div>
            <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] mb-1.5">
              <Palette size={12} />
              <span>{t('vehicles.background')}</span>
            </div>
            <div className="flex gap-1.5 items-center">
              <input
                type="color"
                value={bgColor}
                onChange={e => setBgColor(e.target.value)}
                className="w-6 h-6 border border-[#444] cursor-pointer bg-transparent p-0"
              />
              <div className="flex gap-1">
                {['#111113', '#1a1a22', '#0a0a0c', '#1e1e2e', '#0d1117', '#2d1b00'].map(c => (
                  <button
                    key={c}
                    onClick={() => setBgColor(c)}
                    className={`w-4 h-4 border ${bgColor === c ? 'border-[var(--color-accent)]' : 'border-[#444]'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Floor Color */}
          <div>
            <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] mb-1.5">
              <Palette size={12} />
              <span>{t('vehicles.floor')}</span>
            </div>
            <div className="flex gap-1.5 items-center">
              <input
                type="color"
                value={floorColor}
                onChange={e => setFloorColor(e.target.value)}
                className="w-6 h-6 border border-[#444] cursor-pointer bg-transparent p-0"
              />
              <div className="flex gap-1">
                {['#222228', '#1a1a1e', '#333340', '#2a2520', '#181820', '#3a3a3a'].map(c => (
                  <button
                    key={c}
                    onClick={() => setFloorColor(c)}
                    className={`w-4 h-4 border ${floorColor === c ? 'border-[var(--color-accent)]' : 'border-[#444]'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Grid toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-text-muted)]">Floor Grid</span>
            <button
              onClick={() => { if (gridRef.current) gridRef.current.visible = !gridRef.current.visible }}
              className="px-2 py-0.5 bg-[#2a2a2e] hover:bg-[#333] border border-[#444] text-[var(--color-text-muted)] transition-colors"
            >
              Toggle
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
