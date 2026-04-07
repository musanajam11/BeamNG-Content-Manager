import { ipcMain, BrowserWindow, app, shell, dialog, session } from 'electron'
import { readFile, writeFile, mkdir, access, readdir, unlink, rename as fsRename, stat, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import net from 'node:net'
import { get as httpsGet, request as httpsRequest } from 'node:https'
import { open as yauzlOpen } from 'yauzl'
import { PNG } from 'pngjs'
import { GameDiscoveryService } from '../services/GameDiscoveryService'
import { GameLauncherService } from '../services/GameLauncherService'
import { ConfigService } from '../services/ConfigService'
import { BackendApiService } from '../services/BackendApiService'
import { ModManagerService } from '../services/ModManagerService'
import { BeamNGRepoService } from '../services/BeamNGRepoService'
import { registerModVehicle, clearModVehicles, getModVehicleZip } from '../services/VehicleAssetService'
import { ServerManagerService } from '../services/ServerManagerService'
import { BackupSchedulerService } from '../services/BackupSchedulerService'
import { TaskSchedulerService } from '../services/TaskSchedulerService'
import { AnalyticsService } from '../services/AnalyticsService'
import { RegistryService } from '../services/RegistryService'
import { DependencyResolver } from '../services/DependencyResolver'
import { RoadNetwork } from '../services/RoadNetwork'
import { TailscaleService } from '../services/TailscaleService'
import { CareerSaveService } from '../services/CareerSaveService'
import { parseBeamNGJson } from '../utils/parseBeamNGJson'
import type { AppConfig, GamePaths, ServerInfo, RepoSortOrder, VehicleDetail, VehicleConfigInfo, VehicleConfigData, VehicleEditorData, SlotInfo, VariableInfo, WheelPlacement, HostedServerConfig, GPSRoute, ScheduledTask, MapRichMetadata } from '../../shared/types'
import type { RegistrySearchOptions, RegistryRepository, BeamModMetadata, InstalledRegistryMod } from '../../shared/registry-types'

let discoveryService: GameDiscoveryService
let launcherService: GameLauncherService
let configService: ConfigService
let backendService: BackendApiService
let modManagerService: ModManagerService
let repoService: BeamNGRepoService
let serverManagerService: ServerManagerService
let backupSchedulerService: BackupSchedulerService
let taskSchedulerService: TaskSchedulerService
let analyticsService: AnalyticsService
let registryService: RegistryService
let tailscaleService: TailscaleService

export function initializeServices(): {
  config: ConfigService
  discovery: GameDiscoveryService
  launcher: GameLauncherService
  backend: BackendApiService
  modManager: ModManagerService
  serverManager: ServerManagerService
} {
  discoveryService = new GameDiscoveryService()
  launcherService = new GameLauncherService()
  configService = new ConfigService()
  backendService = new BackendApiService()
  modManagerService = new ModManagerService()
  repoService = new BeamNGRepoService()
  serverManagerService = new ServerManagerService()
  backupSchedulerService = new BackupSchedulerService()
  taskSchedulerService = new TaskSchedulerService()
  taskSchedulerService.setDependencies(serverManagerService, backupSchedulerService)
  analyticsService = new AnalyticsService()
  registryService = new RegistryService()
  tailscaleService = new TailscaleService()
  registryService.setModManager(modManagerService)

  // Initialize backup scheduler (resume saved schedules)
  backupSchedulerService.init().catch((err) =>
    console.error('[BackupScheduler] Init failed:', err)
  )

  // Initialize task scheduler (resume saved tasks)
  taskSchedulerService.init().catch((err) =>
    console.error('[TaskScheduler] Init failed:', err)
  )

  // Initialize mod registry (load local registry + cached index)
  registryService.load().catch((err) =>
    console.error('[Registry] Init failed:', err)
  )

  return {
    config: configService,
    discovery: discoveryService,
    launcher: launcherService,
    backend: backendService,
    modManager: modManagerService,
    serverManager: serverManagerService
  }
}

/** Read a preview image from a BeamNG level zip file */
function readPreviewFromZip(zipPath: string, levelName: string): Promise<string | null> {
  return new Promise((resolve) => {
    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }

      // Matches any *preview*.jpg/png directly inside the level folder (not in subfolders).
      // Covers: <name>_preview1.jpg, <name>_01_preview.jpg, <name>_preview1_v2.jpg,
      //         preview.jpg, <short>_preview.jpg, etc.
      const levelDirPattern = new RegExp(
        `^levels/${levelName}/[^/]*preview[^/]*\\.(?:jpe?g|png)$`, 'i'
      )

      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (found) return
        if (levelDirPattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => {
              zipFile.close()
              const buffer = Buffer.concat(chunks)
              const ext = entry.fileName.split('.').pop()?.toLowerCase() || 'jpg'
              const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
              resolve(`data:${mime};base64,${buffer.toString('base64')}`)
            })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

/** Read raw bytes of first file matching a regex from a zip */
function readRawFromZip(zipPath: string, pattern: RegExp): Promise<Buffer | null> {
  return new Promise((resolve) => {
    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }
      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (found) return
        if (pattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => { zipFile.close(); resolve(Buffer.concat(chunks)) })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

/**
 * Read multiple files from a zip in a single pass.
 * Returns a Map of filename → Buffer for each matched file.
 */
function readMultipleFromZip(zipPath: string, fileNames: string[]): Promise<Map<string, Buffer>> {
  const wanted = new Set(fileNames.map(f => f.replace(/\\/g, '/')))
  return new Promise((resolve) => {
    const results = new Map<string, Buffer>()
    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(results); return }
      let pending = 0
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (wanted.has(entry.fileName) && !results.has(entry.fileName)) {
          pending++
          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) { pending--; zipFile.readEntry(); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => {
              results.set(entry.fileName, Buffer.concat(chunks))
              pending--
              if (results.size === wanted.size) { zipFile.close(); resolve(results) }
              else zipFile.readEntry()
            })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (pending === 0) resolve(results) })
      zipFile.on('error', () => resolve(results))
    })
  })
}

interface MinimapTile {
  file: string
  size: [number, number]
  offset: [number, number]
}

interface DecalRoadNode {
  x: number
  y: number
  width: number
}

/** Materials that represent actual road surfaces (not markings, not invisible) */
const SKIP_MATERIAL_RE = /^(line_|road_invisible|road_marking|road_edge|road_slash)/i

/** Materials to include for A* routing (driveable surfaces including invisible road meshes) */
const ROUTE_MATERIAL_RE = /^(road|asphalt|concrete|dirt_road|dirt|gravel|decalroad|m_road|m_dirt_road|m_dirt_variation|m_quarry_dirt|m_asphalt|m_prepped_asphalt|m_snow_road|m_gm_droad|italy_asphalt|italy_road(?!_marking|_edge|_crack)|italy_concrete_sidewalk|sidewalk|DefaultDecalRoadMaterial|BNG_Road)/i
/** Materials to exclude from routing (decorative overlays, markings, non-driveable) */
const ROUTE_SKIP_RE = /^(line_|road_marking|road_edge|road_slash|track_rubber|road_rubber|road_crack|road_patch|repair|spraypaint|crossing_|bank_erosion|grass_|mud_|.*skidmark|.*tread_?mark|.*tiretrack)/i

/**
 * Read all DecalRoad definitions from a level zip.
 * Returns an array of roads, each with nodes [x, y, width] and material.
 */
function readDecalRoadsFromZip(
  zipPath: string, levelName: string
): Promise<{ nodes: DecalRoadNode[]; material: string }[]> {
  return new Promise((resolve) => {
    const roads: { nodes: DecalRoadNode[]; material: string }[] = []
    const levelPrefix = `levels/${levelName}/`
    const pending: Promise<void>[] = []

    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(roads); return }

      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        // Match items.level.json files under DecalRoad or decalroad directories
        if (entry.fileName.startsWith(levelPrefix) &&
            /decalroad/i.test(entry.fileName) &&
            entry.fileName.endsWith('items.level.json')) {
          const p = new Promise<void>((res) => {
            zipFile.openReadStream(entry, (streamErr, stream) => {
              if (streamErr || !stream) { res(); return }
              const chunks: Buffer[] = []
              stream.on('data', (chunk: Buffer) => chunks.push(chunk))
              stream.on('end', () => {
                try {
                  const text = Buffer.concat(chunks).toString('utf-8')
                  // File is newline-delimited JSON objects
                  const lines = text.split('\n')
                  for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || !trimmed.startsWith('{')) continue
                    try {
                      const obj = JSON.parse(trimmed)
                      if (obj.class !== 'DecalRoad' || !Array.isArray(obj.nodes)) continue
                      const mat = obj.material || ''
                      // Skip markings and invisible roads
                      if (SKIP_MATERIAL_RE.test(mat)) continue
                      // Only include actual road surfaces or roads with significant width
                      const nodes: DecalRoadNode[] = obj.nodes.map((n: number[]) => ({
                        x: n[0], y: n[1], width: n[3] || 3
                      }))
                      // Skip very thin elements (< 2m = likely markings)
                      if (nodes.length >= 2 && nodes[0].width >= 2) {
                        roads.push({ nodes, material: mat })
                      }
                    } catch { /* skip malformed lines */ }
                  }
                } catch { /* skip parse errors */ }
                res()
              })
            })
          })
          pending.push(p)
        }
        zipFile.readEntry()
      })
      zipFile.on('end', () => {
        Promise.all(pending).then(() => resolve(roads))
      })
      zipFile.on('error', () => resolve(roads))
    })
  })
}

/**
 * Read DecalRoad defs for routing — includes road_invisible and other driveable surfaces,
 * but excludes decorative overlays (tire marks, cracks, paint, rubber marks).
 */
function readRoutableRoadsFromZip(
  zipPath: string, levelName: string
): Promise<{ nodes: DecalRoadNode[]; material: string }[]> {
  return new Promise((resolve) => {
    const roads: { nodes: DecalRoadNode[]; material: string }[] = []
    const levelPrefix = `levels/${levelName}/`
    const pending: Promise<void>[] = []

    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(roads); return }

      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (entry.fileName.startsWith(levelPrefix) &&
            /decalroad/i.test(entry.fileName) &&
            entry.fileName.endsWith('items.level.json')) {
          const p = new Promise<void>((res) => {
            zipFile.openReadStream(entry, (streamErr, stream) => {
              if (streamErr || !stream) { res(); return }
              const chunks: Buffer[] = []
              stream.on('data', (chunk: Buffer) => chunks.push(chunk))
              stream.on('end', () => {
                try {
                  const text = Buffer.concat(chunks).toString('utf-8')
                  const lines = text.split('\n')
                  for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || !trimmed.startsWith('{')) continue
                    try {
                      const obj = JSON.parse(trimmed)
                      if (obj.class !== 'DecalRoad' || !Array.isArray(obj.nodes)) continue
                      const mat = obj.material || ''
                      // Skip decorative overlays
                      if (ROUTE_SKIP_RE.test(mat)) continue
                      // Include driveable surfaces (road_invisible, asphalt, concrete, dirt, etc.)
                      if (!ROUTE_MATERIAL_RE.test(mat)) continue
                      const nodes: DecalRoadNode[] = obj.nodes.map((n: number[]) => ({
                        x: n[0], y: n[1], width: n[3] || 3
                      }))
                      if (nodes.length >= 2 && nodes[0].width >= 2) {
                        roads.push({ nodes, material: mat })
                      }
                    } catch { /* skip malformed lines */ }
                  }
                } catch { /* skip parse errors */ }
                res()
              })
            })
          })
          pending.push(p)
        }
        zipFile.readEntry()
      })
      zipFile.on('end', () => {
        Promise.all(pending).then(() => resolve(roads))
      })
      zipFile.on('error', () => resolve(roads))
    })
  })
}

/** Draw a thick line segment on a PNG buffer */
function drawThickLine(
  out: PNG, outW: number, outH: number,
  x0: number, y0: number, x1: number, y1: number,
  radius: number, r: number, g: number, b: number, alpha: number
): void {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.sqrt(dx * dx + dy * dy)
  const steps = Math.max(1, Math.ceil(len))
  const ir = Math.ceil(radius)
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const cx = x0 + dx * t
    const cy = y0 + dy * t
    for (let ry = -ir; ry <= ir; ry++) {
      for (let rx = -ir; rx <= ir; rx++) {
        if (rx * rx + ry * ry > radius * radius) continue
        const px = Math.round(cx + rx), py = Math.round(cy + ry)
        if (px < 0 || px >= outW || py < 0 || py >= outH) continue
        const oi = (py * outW + px) * 4
        out.data[oi]     = Math.round(r * alpha + out.data[oi] * (1 - alpha))
        out.data[oi + 1] = Math.round(g * alpha + out.data[oi + 1] * (1 - alpha))
        out.data[oi + 2] = Math.round(b * alpha + out.data[oi + 2] * (1 - alpha))
      }
    }
  }
}

/**
 * Build a high-quality composite map image.
 *
 * If the level's info.json has a `minimap` tile array, composites all tiles
 * (terrain, island, bridge, etc.) into a single image covering the full world extent.
 * Otherwise falls back to the monolithic *_minimap.png + terrain base colour blend.
 *
 * Returns an opaque PNG Buffer + the world bounds the image covers.
 */
async function buildCompositeMapImage(
  zipPath: string,
  levelName: string,
  minimapRaw: Buffer
): Promise<{ image: Buffer; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } }> {
  // --- Try to read minimap tile definitions from info.json ---
  const infoRaw = await readRawFromZip(zipPath, new RegExp(`^levels/${levelName}/info\\.json$`, 'i'))
  let tiles: MinimapTile[] | null = null

  if (infoRaw) {
    try {
      const info = parseBeamNGJson<Record<string, unknown>>(infoRaw.toString('utf-8'))
      if (Array.isArray(info.minimap) && info.minimap.length > 0) {
        tiles = info.minimap as MinimapTile[]
      }
    } catch { /* ignore parse errors */ }
  }

  // --- Tile-based compositing: use monolithic minimap as base, overlay extra tiles ---
  if (tiles && tiles.length > 0) {
    // Identify the terrain tile and overlay tiles
    const terrainTile = tiles.find(t => /terrain/i.test(t.file) && !/t_terrain_base/i.test(t.file))
    const overlayTiles = tiles.filter(t => t !== terrainTile)

    // If no overlays, skip tile path entirely — monolithic fallback handles it
    if (overlayTiles.length === 0) {
      tiles = null
    } else {
      // Compute full world bounding box from ALL tiles
      let worldMinX = Infinity, worldMaxX = -Infinity
      let worldMinY = Infinity, worldMaxY = -Infinity

      for (const t of tiles) {
        const x0 = t.offset[0]
        const x1 = t.offset[0] + t.size[0]
        const y1 = t.offset[1]
        const y0 = t.offset[1] - t.size[1]
        if (x0 < worldMinX) worldMinX = x0
        if (x1 > worldMaxX) worldMaxX = x1
        if (y0 < worldMinY) worldMinY = y0
        if (y1 > worldMaxY) worldMaxY = y1
      }

      const worldW = worldMaxX - worldMinX
      const worldH = worldMaxY - worldMinY

      // Use minimap's native pixel density to preserve detail
      const mmPxPerMeter = PNG.sync.read(minimapRaw).width / (terrainTile ? terrainTile.size[0] : worldW)
      const maxDim = 6144
      const scale = Math.min(mmPxPerMeter, maxDim / Math.max(worldW, worldH))
      const outW = Math.round(worldW * scale)
      const outH = Math.round(worldH * scale)

      const out = new PNG({ width: outW, height: outH })
      // Fill with dark background
      for (let i = 0; i < out.data.length; i += 4) {
        out.data[i] = 14; out.data[i + 1] = 14; out.data[i + 2] = 20; out.data[i + 3] = 255
      }

      // --- Step 1: Render monolithic minimap using the proven Flavour A/B pipeline ---
      const mm = PNG.sync.read(minimapRaw)
      const mmW = mm.width
      const mmH = mm.height

      let lumSum = 0, lumCount = 0
      const step = Math.max(4, Math.floor(mm.data.length / 4 / 2000)) * 4
      for (let i = 0; i < mm.data.length && lumCount < 2000; i += step) {
        if (mm.data[i + 3] === 0) {
          lumSum += mm.data[i] * 0.299 + mm.data[i + 1] * 0.587 + mm.data[i + 2] * 0.114
          lumCount++
        }
      }
      const isFlavourA = lumCount > 0 && (lumSum / lumCount) > 30

      const baseRaw = await readRawFromZip(
        zipPath,
        new RegExp(`^levels/${levelName}/art/terrains/t_terrain_base_b\\.png$`, 'i')
      )
      const base = baseRaw ? PNG.sync.read(baseRaw) : null

      // Determine where the terrain tile sits in world coords
      const tWorldX0 = terrainTile ? terrainTile.offset[0] : worldMinX
      const tWorldY1 = terrainTile ? terrainTile.offset[1] : worldMaxY
      const tWorldW = terrainTile ? terrainTile.size[0] : worldW
      const tWorldH = terrainTile ? terrainTile.size[1] : worldH

      for (let y = 0; y < mmH; y++) {
        for (let x = 0; x < mmW; x++) {
          const mi = (y * mmW + x) * 4
          const a = mm.data[mi + 3] / 255

          // Map minimap pixel → world coords via terrain tile bounds
          const worldX = tWorldX0 + (x / mmW) * tWorldW
          const worldY = tWorldY1 - (y / mmH) * tWorldH

          // Map world coords → output pixel
          const ox = Math.round((worldX - worldMinX) * scale)
          const oy = Math.round((worldMaxY - worldY) * scale)
          if (ox < 0 || ox >= outW || oy < 0 || oy >= outH) continue

          const oi = (oy * outW + ox) * 4

          let bR: number, bG: number, bB: number
          if (base) {
            const bx = Math.floor(x * base.width / mmW)
            const by = Math.floor(y * base.height / mmH)
            const bi = (by * base.width + bx) * 4
            bR = base.data[bi]; bG = base.data[bi + 1]; bB = base.data[bi + 2]
          } else {
            bR = 14; bG = 14; bB = 20
          }

          if (isFlavourA) {
            if (a <= 0.01) {
              const mmLum = mm.data[mi] * 0.299 + mm.data[mi + 1] * 0.587 + mm.data[mi + 2] * 0.114
              const baseLum = bR * 0.299 + bG * 0.587 + bB * 0.114
              if (base && Math.abs(mmLum - baseLum) < 80) {
                out.data[oi]     = Math.round(mm.data[mi]     * 0.4 + bR * 0.6)
                out.data[oi + 1] = Math.round(mm.data[mi + 1] * 0.4 + bG * 0.6)
                out.data[oi + 2] = Math.round(mm.data[mi + 2] * 0.4 + bB * 0.6)
              } else {
                out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
              }
            } else {
              const inv = 1 - a
              if (base) {
                out.data[oi]     = Math.round(mm.data[mi] * a + bR * inv)
                out.data[oi + 1] = Math.round(mm.data[mi + 1] * a + bG * inv)
                out.data[oi + 2] = Math.round(mm.data[mi + 2] * a + bB * inv)
              } else {
                out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
              }
            }
          } else {
            if (a <= 0.01) {
              out.data[oi] = bR; out.data[oi + 1] = bG; out.data[oi + 2] = bB
            } else if (a >= 0.99) {
              out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
            } else {
              const inv = 1 - a
              out.data[oi]     = Math.round(mm.data[mi] * a + bR * inv)
              out.data[oi + 1] = Math.round(mm.data[mi + 1] * a + bG * inv)
              out.data[oi + 2] = Math.round(mm.data[mi + 2] * a + bB * inv)
            }
          }
        }
      }

      // --- Step 2: Overlay non-terrain tiles (island, steelFactory, tunnelEast) ---
      const overlayFileNames = overlayTiles.map(t => `levels/${levelName}/${t.file}`)
      const overlayBuffers = await readMultipleFromZip(zipPath, overlayFileNames)

      for (const t of overlayTiles) {
        const tileBuf = overlayBuffers.get(`levels/${levelName}/${t.file}`)
        if (!tileBuf) continue

        const tile = PNG.sync.read(tileBuf)

        // Detect chroma-key background from corner pixels
        let bgR = 0, bgG = 0, bgB = 0, bgA = 0
        let hasBgColor = false
        const corners = [
          [0, 0], [tile.width - 1, 0],
          [0, tile.height - 1], [tile.width - 1, tile.height - 1]
        ]
        let sr = 0, sg = 0, sb = 0, sa = 0
        for (const [cx, cy] of corners) {
          const ci = (cy * tile.width + cx) * 4
          sr += tile.data[ci]; sg += tile.data[ci + 1]
          sb += tile.data[ci + 2]; sa += tile.data[ci + 3]
        }
        sr /= 4; sg /= 4; sb /= 4; sa /= 4
        const allSimilar = corners.every(([cx, cy]) => {
          const ci = (cy * tile.width + cx) * 4
          return Math.abs(tile.data[ci] - sr) < 15 && Math.abs(tile.data[ci + 1] - sg) < 15 &&
                 Math.abs(tile.data[ci + 2] - sb) < 15 && Math.abs(tile.data[ci + 3] - sa) < 15
        })
        if (allSimilar) {
          hasBgColor = true
          bgR = Math.round(sr); bgG = Math.round(sg)
          bgB = Math.round(sb); bgA = Math.round(sa)
        }

        const tileWorldX0 = t.offset[0]
        const tileWorldY1 = t.offset[1]

        for (let ty = 0; ty < tile.height; ty++) {
          for (let tx = 0; tx < tile.width; tx++) {
            const ti = (ty * tile.width + tx) * 4
            const r = tile.data[ti], g = tile.data[ti + 1], b = tile.data[ti + 2]
            const a2 = tile.data[ti + 3]

            // Overlay tiles: A=0 always means "no content" — skip entirely
            if (a2 === 0) continue

            // Chroma key: skip background-colored pixels
            if (hasBgColor &&
                Math.abs(r - bgR) < 30 && Math.abs(g - bgG) < 30 &&
                Math.abs(b - bgB) < 30 && Math.abs(a2 - bgA) < 30) {
              continue
            }

            const worldX = tileWorldX0 + tx * (t.size[0] / tile.width)
            const worldY = tileWorldY1 - ty * (t.size[1] / tile.height)

            const ox = Math.round((worldX - worldMinX) * scale)
            const oy = Math.round((worldMaxY - worldY) * scale)
            if (ox < 0 || ox >= outW || oy < 0 || oy >= outH) continue

            const oi = (oy * outW + ox) * 4
            out.data[oi] = r
            out.data[oi + 1] = g
            out.data[oi + 2] = b
          }
        }
      }

      // --- Step 3: Draw roads from DecalRoad data ---
      const roads = await readDecalRoadsFromZip(zipPath, levelName)
      for (const road of roads) {
        // Determine road color based on material
        let rr = 60, rg = 60, rb = 60 // default asphalt gray
        const mat = road.material.toLowerCase()
        if (mat.includes('dirt') || mat.includes('gravel')) {
          rr = 90; rg = 75; rb = 55 // brownish
        } else if (mat.includes('concrete')) {
          rr = 85; rg = 85; rb = 85 // lighter gray
        }

        for (let i = 0; i < road.nodes.length - 1; i++) {
          const n0 = road.nodes[i], n1 = road.nodes[i + 1]
          const px0 = (n0.x - worldMinX) * scale
          const py0 = (worldMaxY - n0.y) * scale
          const px1 = (n1.x - worldMinX) * scale
          const py1 = (worldMaxY - n1.y) * scale
          const radius = Math.max(1, n0.width * scale * 0.5)
          drawThickLine(out, outW, outH, px0, py0, px1, py1, radius, rr, rg, rb, 0.7)
        }
      }

      return {
        image: PNG.sync.write(out),
        worldBounds: { minX: worldMinX, maxX: worldMaxX, minY: worldMinY, maxY: worldMaxY }
      }
    }
  }

  // --- Fallback: monolithic minimap (no tiles) ---
  const mm = PNG.sync.read(minimapRaw)
  const mmW = mm.width
  const mmH = mm.height

  // Detect minimap flavour by sampling A=0 pixels
  let lumSum = 0, lumCount = 0
  const step = Math.max(4, Math.floor(mm.data.length / 4 / 2000)) * 4
  for (let i = 0; i < mm.data.length && lumCount < 2000; i += step) {
    if (mm.data[i + 3] === 0) {
      lumSum += mm.data[i] * 0.299 + mm.data[i + 1] * 0.587 + mm.data[i + 2] * 0.114
      lumCount++
    }
  }
  const isFlavourA = lumCount > 0 && (lumSum / lumCount) > 30

  const baseRaw = await readRawFromZip(
    zipPath,
    new RegExp(`^levels/${levelName}/art/terrains/t_terrain_base_b\\.png$`, 'i')
  )
  const base = baseRaw ? PNG.sync.read(baseRaw) : null

  const out = new PNG({ width: mmW, height: mmH })
  const bgR = 14, bgG = 14, bgB = 20

  for (let y = 0; y < mmH; y++) {
    for (let x = 0; x < mmW; x++) {
      const oi = (y * mmW + x) * 4
      const mi = (y * mmW + x) * 4
      const a = mm.data[mi + 3] / 255

      let bR: number, bG: number, bB: number
      if (base) {
        const bx = Math.floor(x * base.width / mmW)
        const by = Math.floor(y * base.height / mmH)
        const bi = (by * base.width + bx) * 4
        bR = base.data[bi]; bG = base.data[bi + 1]; bB = base.data[bi + 2]
      } else {
        bR = bgR; bG = bgG; bB = bgB
      }

      if (isFlavourA) {
        if (a <= 0.01) {
          const mmLum = mm.data[mi] * 0.299 + mm.data[mi + 1] * 0.587 + mm.data[mi + 2] * 0.114
          const baseLum = bR * 0.299 + bG * 0.587 + bB * 0.114
          if (base && Math.abs(mmLum - baseLum) < 80) {
            out.data[oi]     = Math.round(mm.data[mi]     * 0.4 + bR * 0.6)
            out.data[oi + 1] = Math.round(mm.data[mi + 1] * 0.4 + bG * 0.6)
            out.data[oi + 2] = Math.round(mm.data[mi + 2] * 0.4 + bB * 0.6)
          } else {
            out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
          }
        } else {
          const inv = 1 - a
          if (base) {
            out.data[oi]     = Math.round(mm.data[mi] * a + bR * inv)
            out.data[oi + 1] = Math.round(mm.data[mi + 1] * a + bG * inv)
            out.data[oi + 2] = Math.round(mm.data[mi + 2] * a + bB * inv)
          } else {
            out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
          }
        }
      } else {
        if (a <= 0.01) {
          out.data[oi] = bR; out.data[oi + 1] = bG; out.data[oi + 2] = bB
        } else if (a >= 0.99) {
          out.data[oi] = mm.data[mi]; out.data[oi + 1] = mm.data[mi + 1]; out.data[oi + 2] = mm.data[mi + 2]
        } else {
          const inv = 1 - a
          out.data[oi]     = Math.round(mm.data[mi] * a + bR * inv)
          out.data[oi + 1] = Math.round(mm.data[mi + 1] * a + bG * inv)
          out.data[oi + 2] = Math.round(mm.data[mi + 2] * a + bB * inv)
        }
      }
      out.data[oi + 3] = 255
    }
  }

  return { image: PNG.sync.write(out) }
}

/** Read a heightmap image from a BeamNG level zip – tries *_heightmap.png first, falls back to *.ter.depth.png */
function readHeightmapFromZip(zipPath: string, levelName: string): Promise<string | null> {
  return new Promise(async (resolve) => {
    // Try dedicated heightmap first
    const hm = await readImageFromZip(zipPath, new RegExp(
      `^levels/${levelName}/[^/]*heightmap\\.png$`, 'i'
    ))
    if (hm) { resolve(hm); return }
    // Fall back to .ter.depth.png
    const depth = await readImageFromZip(zipPath, new RegExp(
      `^levels/${levelName}/[^/]*\\.ter\\.depth\\.png$`, 'i'
    ))
    resolve(depth)
  })
}

/** Read first image matching a regex from a zip, return as data URL */
function readImageFromZip(zipPath: string, pattern: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }

      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (found) return
        if (pattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => {
              zipFile.close()
              const buffer = Buffer.concat(chunks)
              const ext = entry.fileName.split('.').pop()?.toLowerCase() || 'png'
              const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
              resolve(`data:${mime};base64,${buffer.toString('base64')}`)
            })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

/** Read first text file matching a regex from a zip, return as string */
function readTextFromZip(zipPath: string, pattern: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }

      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry) => {
        if (found) return
        if (pattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => {
              zipFile.close()
              resolve(Buffer.concat(chunks).toString('utf-8'))
            })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

export function registerIpcHandlers(): void {
  // ── Config ──
  ipcMain.handle('config:get', async (): Promise<AppConfig> => {
    return configService.get()
  })

  ipcMain.handle('config:update', async (_event, partial: Partial<AppConfig>): Promise<AppConfig> => {
    return configService.update(partial)
  })

  ipcMain.handle('config:markSetupComplete', async (): Promise<void> => {
    return configService.markSetupComplete()
  })

  // ── Appearance / Zoom ──
  ipcMain.handle('appearance:setZoom', async (event, factor: number): Promise<void> => {
    const clamped = Math.max(0.5, Math.min(2.0, factor))
    event.sender.setZoomFactor(clamped)
  })

  ipcMain.handle('appearance:getZoom', async (event): Promise<number> => {
    return event.sender.getZoomFactor()
  })

  // ── Version Info ──
  let cachedServerVersion: string | null = null

  ipcMain.handle('app:getVersions', async () => {
    const config = configService.get()

    // Fetch latest release versions from GitHub (cached for the session)
    let launcherVersion = launcherService.getLauncherVersion()
    let serverVersion: string | null = cachedServerVersion
    try {
      const [launcherRes, serverRes] = await Promise.all([
        fetch('https://api.github.com/repos/BeamMP/BeamMP-Launcher/releases/latest'),
        fetch('https://api.github.com/repos/BeamMP/BeamMP-Server/releases/latest')
      ])
      if (launcherRes.ok) {
        const data = await launcherRes.json() as { tag_name?: string }
        if (data.tag_name) launcherVersion = data.tag_name.replace(/^v/, '')
      }
      if (serverRes.ok) {
        const data = await serverRes.json() as { tag_name?: string }
        if (data.tag_name) {
          serverVersion = data.tag_name.replace(/^v/, '')
          cachedServerVersion = serverVersion
        }
      }
    } catch {
      // Fall back to cached values
    }

    // If gameVersion is missing from config, try reading it from disk
    let gameVersion = config.gamePaths?.gameVersion ?? null
    if (!gameVersion && config.gamePaths?.userDir) {
      gameVersion = await discoveryService.readGameVersion(config.gamePaths.userDir)
    }

    return {
      appVersion: app.getVersion(),
      gameVersion,
      launcherVersion,
      serverVersion,
    }
  })

  // ── Game Discovery ──
  ipcMain.handle('game:discoverPaths', async (): Promise<GamePaths> => {
    return discoveryService.discoverPaths()
  })

  ipcMain.handle(
    'game:validatePaths',
    async (_event, paths: GamePaths): Promise<{ valid: boolean; errors: string[] }> => {
      return discoveryService.validatePaths(paths)
    }
  )

  ipcMain.handle('game:setCustomPaths', async (_event, installDir: string, userDir: string): Promise<void> => {
    const exeName = process.platform === 'win32' ? 'BeamNG.drive.exe' : 'BeamNG.drive'
    const executable = join(installDir, exeName)
    const gameVersion = await discoveryService.readGameVersion(userDir)
    // Detect Proton: on Linux, if the exe doesn't exist but a .exe does, it's Proton
    let isProton = false
    if (process.platform === 'linux') {
      if (!existsSync(executable)) {
        const protonExe = join(installDir, 'BeamNG.drive.exe')
        isProton = existsSync(protonExe)
      } else {
        isProton = installDir.includes('steamapps')
      }
    }
    await configService.setGamePaths(installDir, userDir, executable, gameVersion, isProton)
    discoveryService.clearCache()
  })

  // ── Game Launcher ──
  ipcMain.handle('game:launch', async (): Promise<{ success: boolean; error?: string }> => {
    const config = configService.get()
    return launcherService.launchGame(config.gamePaths)
  })

  ipcMain.handle('game:launchVanilla', async (_event, config?: { mode?: string; level?: string; vehicle?: string }): Promise<{ success: boolean; error?: string }> => {
    const gamePaths = configService.get().gamePaths
    return launcherService.launchVanilla(gamePaths, config)
  })

  // ── Vehicle scanning ──
  // Known non-vehicle zips (props, barriers, etc.) - filter these out for the vehicle browser
  const NON_VEHICLE_TYPES = new Set([
    'Prop', 'Trailer', 'Utility', 'prop', 'Barrier', 'Other'
  ])
  const NON_VEHICLE_NAMES = new Set([
    'anticut', 'ball', 'barrels', 'barrier', 'barrier_plastic', 'blockwall',
    'bollard', 'boxutility', 'boxutility_large', 'cannon', 'cardboard_box',
    'chair', 'christmas_tree', 'common', 'cones', 'containerTrailer',
    'couch', 'crowdbarrier', 'delineator', 'dolly', 'engine_props',
    'flail', 'flipramp', 'fridge', 'gate', 'haybale', 'inflated_mat',
    'kickplate', 'large_angletester', 'large_bridge', 'large_cannon',
    'large_crusher', 'large_hamster_wheel', 'large_roller', 'large_spinner',
    'large_tilt', 'large_tire', 'logs', 'log_trailer', 'marble_block',
    'mattress', 'metal_box', 'metal_ramp', 'piano', 'porta_potty',
    'pressure_ball', 'rallyflags', 'rallysigns', 'rallytape', 'roadsigns',
    'rocks', 'rock_pile', 'rollover', 'roof_crush_tester', 'sawhorse',
    'shipping_container', 'simple_traffic', 'spikestrip', 'steel_coil',
    'streetlight', 'suspensionbridge', 'testroller', 'tirestacks',
    'tirewall', 'trafficbarrel', 'trampoline', 'trashbin', 'tub', 'tube',
    'tv', 'wall', 'weightpad', 'woodcrate', 'woodplanks'
  ])

  type VehicleListItem = {
    name: string; displayName: string; brand: string; type: string;
    bodyStyle: string; country: string; source: 'stock' | 'mod'; configCount: number
  }

  let vehicleListCache: VehicleListItem[] | null = null
  let vehicleListPromise: Promise<VehicleListItem[]> | null = null

  /** Read all matching entries from a zip, calling handler for each match */
  function readEntriesFromZip(
    zipPath: string,
    matcher: (fileName: string) => boolean,
    handler: (fileName: string, data: Buffer) => void
  ): Promise<void> {
    return new Promise((resolve) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { resolve(); return }
        let pending = 0
        let ended = false
        const checkDone = (): void => { if (ended && pending === 0) { zipFile.close(); resolve() } }
        zipFile.readEntry()
        zipFile.on('entry', (entry) => {
          if (matcher(entry.fileName)) {
            pending++
            zipFile.openReadStream(entry, (err2, stream) => {
              if (err2 || !stream) { pending--; checkDone(); zipFile.readEntry(); return }
              const chunks: Buffer[] = []
              stream.on('data', (c: Buffer) => chunks.push(c))
              stream.on('end', () => {
                handler(entry.fileName, Buffer.concat(chunks))
                pending--
                checkDone()
              })
            })
          }
          zipFile.readEntry()
        })
        zipFile.on('end', () => { ended = true; checkDone() })
        zipFile.on('error', () => resolve())
      })
    })
  }

  /** Read a single entry from a zip */
  function readSingleFromZip(zipPath: string, pattern: RegExp): Promise<Buffer | null> {
    return new Promise((resolve) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { resolve(null); return }
        let found = false
        zipFile.readEntry()
        zipFile.on('entry', (entry) => {
          if (found) return
          if (pattern.test(entry.fileName)) {
            found = true
            zipFile.openReadStream(entry, (err2, stream) => {
              if (err2 || !stream) { zipFile.close(); resolve(null); return }
              const chunks: Buffer[] = []
              stream.on('data', (c: Buffer) => chunks.push(c))
              stream.on('end', () => { zipFile.close(); resolve(Buffer.concat(chunks)) })
              stream.on('error', () => { zipFile.close(); resolve(null) })
            })
          } else {
            zipFile.readEntry()
          }
        })
        zipFile.on('end', () => { if (!found) resolve(null) })
        zipFile.on('error', () => resolve(null))
      })
    })
  }

  async function scanVehicleZip(zipPath: string, modelName: string): Promise<VehicleListItem | null> {
    let info: Record<string, unknown> | null = null
    let configCount = 0
    const prefix = `vehicles/${modelName}/`

    await readEntriesFromZip(
      zipPath,
      (fn) => {
        const rel = fn.toLowerCase()
        return rel === `vehicles/${modelName}/info.json` || (rel.startsWith(prefix) && rel.endsWith('.pc'))
      },
      (fn, data) => {
        if (fn.toLowerCase().endsWith('info.json')) {
          try { info = parseBeamNGJson(data.toString('utf-8')) } catch { /* skip */ }
        } else if (fn.toLowerCase().endsWith('.pc')) {
          configCount++
        }
      }
    )

    if (!info) return null
    const infoRec = info as Record<string, unknown>
    const type = String(infoRec.Type || 'Vehicle')
    if (NON_VEHICLE_TYPES.has(type)) return null

    return {
      name: modelName,
      displayName: String(infoRec.Name || modelName),
      brand: String(infoRec.Brand || ''),
      type,
      bodyStyle: String(infoRec['Body Style'] || ''),
      country: String(infoRec.Country || ''),
      source: 'stock' as const,
      configCount
    }
  }

  /** Discover vehicle names inside a zip (looks for vehicles/{name}/info.json entries) */
  async function discoverVehiclesInZip(zipPath: string): Promise<string[]> {
    const vehicleNames = new Set<string>()
    await readEntriesFromZip(
      zipPath,
      (fn) => /^vehicles\/[^/]+\/info\.json$/i.test(fn),
      (fn) => {
        const match = fn.match(/^vehicles\/([^/]+)\//i)
        if (match) vehicleNames.add(match[1])
      }
    )
    return Array.from(vehicleNames)
  }

  /** Resolve zip path for a vehicle: mod registry → stock fallback */
  function getVehicleZipPath(vehicleName: string, installDir: string): string {
    return getModVehicleZip(vehicleName) || join(installDir, 'content', 'vehicles', `${vehicleName}.zip`)
  }

  ipcMain.handle('game:listVehicles', async () => {
    if (vehicleListCache) return vehicleListCache
    if (vehicleListPromise) return vehicleListPromise

    vehicleListPromise = (async () => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      const vehiclesDir = join(installDir, 'content', 'vehicles')
      const vehicles: VehicleListItem[] = []
      const stockNames = new Set<string>()

      // Clear mod registry (will be repopulated below)
      clearModVehicles()

      try {
        const entries = await readdir(vehiclesDir)
        const zipFiles = entries
          .filter((e) => e.endsWith('.zip'))
          .filter((e) => !NON_VEHICLE_NAMES.has(e.replace('.zip', '')))

        const batchSize = 8
        for (let i = 0; i < zipFiles.length; i += batchSize) {
          const batch = zipFiles.slice(i, i + batchSize)
          const results = await Promise.all(
            batch.map((f) => scanVehicleZip(join(vehiclesDir, f), f.replace('.zip', '')))
          )
          for (const r of results) {
            if (r) {
              vehicles.push(r)
              stockNames.add(r.name)
            }
          }
        }
      } catch { /* dir doesn't exist */ }

      // Scan active mod zips for vehicles
      const userDir = config.gamePaths?.userDir
      if (userDir) {
        try {
          const dbPath = join(userDir, 'mods', 'db.json')
          const raw = await readFile(dbPath, 'utf-8')
          const db = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
          const modsMap = (db.mods && typeof db.mods === 'object') ? db.mods : db

          for (const [, entry] of Object.entries(modsMap)) {
            const mod = entry as Record<string, unknown>
            if (!mod.active || !mod.filename) continue
            const dirname = String(mod.dirname || '/mods/repo/')
            const modZipPath = join(userDir, dirname.replace(/^\//, ''), String(mod.filename))
            try {
              await access(modZipPath)
              const vehicleNames = await discoverVehiclesInZip(modZipPath)
              for (const vName of vehicleNames) {
                if (stockNames.has(vName)) continue // don't duplicate stock vehicles
                const item = await scanVehicleZip(modZipPath, vName)
                if (item) {
                  item.source = 'mod'
                  vehicles.push(item)
                  registerModVehicle(vName, modZipPath)
                }
              }
            } catch { /* zip not found */ }
          }
        } catch { /* no db.json */ }
      }

      // Also count user configs per vehicle
      if (userDir) {
        try {
          const userVehiclesDir = join(userDir, 'vehicles')
          const userEntries = await readdir(userVehiclesDir)
          for (const dir of userEntries) {
            const vehicle = vehicles.find((v) => v.name === dir)
            if (vehicle) {
              try {
                const files = await readdir(join(userVehiclesDir, dir))
                vehicle.configCount += files.filter((f) => f.endsWith('.pc')).length
              } catch { /* skip */ }
            }
          }
        } catch { /* no user vehicles dir */ }
      }

      vehicles.sort((a, b) => a.displayName.localeCompare(b.displayName))
      vehicleListCache = vehicles
      return vehicles
    })()

    const result = await vehicleListPromise
    vehicleListPromise = null
    return result || []
  })

  // Vehicle preview extraction from zip
  const vehiclePreviewCache = new Map<string, string | null>()

  ipcMain.handle('game:getVehiclePreview', async (_event, vehicleName: string): Promise<string | null> => {
    if (vehiclePreviewCache.has(vehicleName)) return vehiclePreviewCache.get(vehicleName)!

    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    if (!installDir) return null

    const zipPath = getVehicleZipPath(vehicleName, installDir)
    try { await access(zipPath) } catch {
      vehiclePreviewCache.set(vehicleName, null)
      return null
    }

    // Try default.jpg first, then default.png
    const jpgBuf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/default\\.jpe?g$`, 'i'))
    if (jpgBuf) {
      const result = `data:image/jpeg;base64,${jpgBuf.toString('base64')}`
      vehiclePreviewCache.set(vehicleName, result)
      return result
    }
    const pngBuf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/default\\.png$`, 'i'))
    if (pngBuf) {
      const result = `data:image/png;base64,${pngBuf.toString('base64')}`
      vehiclePreviewCache.set(vehicleName, result)
      return result
    }

    vehiclePreviewCache.set(vehicleName, null)
    return null
  })

  // ── Vehicle Detail ──
  ipcMain.handle('game:getVehicleDetail', async (_event, vehicleName: string): Promise<VehicleDetail | null> => {
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    if (!installDir) return null

    const zipPath = getVehicleZipPath(vehicleName, installDir)
    try { await access(zipPath) } catch { return null }

    const infoBuf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/info\\.json$`, 'i'))
    if (!infoBuf) return null

    let info: Record<string, unknown>
    try { info = parseBeamNGJson(infoBuf.toString('utf-8')) } catch { return null }

    // Count configs in zip
    let configCount = 0
    await readEntriesFromZip(zipPath, (fn) => fn.endsWith('.pc'), () => { configCount++ })

    // Count user configs
    const userDir = config.gamePaths?.userDir
    if (userDir) {
      try {
        const files = await readdir(join(userDir, 'vehicles', vehicleName))
        configCount += files.filter((f) => f.endsWith('.pc')).length
      } catch { /* skip */ }
    }

    const years = info.Years as { min: number; max: number } | undefined

    return {
      id: vehicleName,
      name: String(info.Name || vehicleName),
      brand: String(info.Brand || ''),
      subModel: String(info.SubModel || ''),
      type: String(info.Type || 'Vehicle'),
      bodyStyle: String(info['Body Style'] || ''),
      country: String(info.Country || ''),
      description: String(info.Description || ''),
      author: String(info.Author || ''),
      years: years ? { min: years.min, max: years.max } : null,
      source: getModVehicleZip(vehicleName) ? 'mod' : 'stock',
      defaultConfig: info.default_pc ? String(info.default_pc) : null,
      configCount
    }
  })

  // ── Vehicle Configs ──
  ipcMain.handle('game:getVehicleConfigs', async (_event, vehicleName: string): Promise<VehicleConfigInfo[]> => {
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    if (!installDir) return []

    const configs: VehicleConfigInfo[] = []
    const zipPath = getVehicleZipPath(vehicleName, installDir)

    // Collect stock configs + their info jsons from zip
    const configInfos = new Map<string, Record<string, unknown>>()
    const pcNames = new Set<string>()

    try {
      await access(zipPath)
      await readEntriesFromZip(
        zipPath,
        (fn) => {
          const rel = fn.replace(/^vehicles\/[^/]+\//, '')
          return rel.endsWith('.pc') || /^info_.*\.json$/i.test(rel)
        },
        (fn, data) => {
          const rel = fn.replace(/^vehicles\/[^/]+\//, '')
          if (rel.endsWith('.pc')) {
            pcNames.add(rel.replace('.pc', ''))
          } else if (/^info_.*\.json$/i.test(rel)) {
            const cfgName = rel.replace(/^info_/i, '').replace('.json', '')
            try { configInfos.set(cfgName, parseBeamNGJson(data.toString('utf-8'))) } catch { /* skip */ }
          }
        }
      )
    } catch { /* zip doesn't exist */ }

    for (const pcName of pcNames) {
      const info = configInfos.get(pcName) || {}
      configs.push({
        name: pcName,
        displayName: String(info.Configuration || pcName),
        source: 'stock',
        power: info.Power != null ? Number(info.Power) : undefined,
        torque: info.Torque != null ? Number(info.Torque) : undefined,
        weight: info.Weight != null ? Number(info.Weight) : undefined,
        drivetrain: info.Drivetrain ? String(info.Drivetrain) : undefined,
        transmission: info.Transmission ? String(info.Transmission) : undefined,
        topSpeed: info['Top Speed'] != null ? Number(info['Top Speed']) : undefined,
        zeroToSixty: info['0-60 mph'] != null ? Number(info['0-60 mph']) : undefined,
        value: info.Value != null ? Number(info.Value) : undefined,
        configType: info['Config Type'] ? String(info['Config Type']) : undefined,
        fuelType: info['Fuel Type'] ? String(info['Fuel Type']) : undefined,
        description: info.Description ? String(info.Description) : undefined,
        hasPreview: true
      })
    }

    // User configs
    const userDir = config.gamePaths?.userDir
    if (userDir) {
      try {
        const userVehicleDir = join(userDir, 'vehicles', vehicleName)
        const files = await readdir(userVehicleDir)
        for (const f of files) {
          if (!f.endsWith('.pc')) continue
          const cfgName = f.replace('.pc', '')
          configs.push({
            name: cfgName,
            displayName: cfgName,
            source: 'user',
            hasPreview: false
          })
        }
      } catch { /* no user configs */ }
    }

    configs.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'stock' ? -1 : 1
      return a.displayName.localeCompare(b.displayName)
    })

    return configs
  })

  // ── Vehicle Config Preview Image ──
  ipcMain.handle('game:getVehicleConfigPreview', async (_event, vehicleName: string, configName: string): Promise<string | null> => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    const installDir = config.gamePaths?.installDir

    // 1) Check user dir first — user configs store previews as <name>.jpg/.png next to <name>.pc
    if (userDir) {
      const userVehicleDir = join(userDir, 'vehicles', vehicleName)
      for (const ext of ['jpg', 'jpeg', 'png']) {
        const imgPath = join(userVehicleDir, `${configName}.${ext}`)
        try {
          await access(imgPath)
          const buf = await readFile(imgPath)
          const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
          return `data:${mime};base64,${buf.toString('base64')}`
        } catch { /* try next */ }
      }
    }

    // 2) Check vehicle zip (stock or mod)
    if (installDir) {
      const zipPath = getVehicleZipPath(vehicleName, installDir)
      try { await access(zipPath) } catch { return null }

      const jpgBuf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/${configName}\\.jpe?g$`, 'i'))
      if (jpgBuf) return `data:image/jpeg;base64,${jpgBuf.toString('base64')}`

      const pngBuf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/${configName}\\.png$`, 'i'))
      if (pngBuf) return `data:image/png;base64,${pngBuf.toString('base64')}`
    }

    return null
  })

  // ── Vehicle Config Data (read .pc file) ──
  ipcMain.handle('game:getVehicleConfigData', async (_event, vehicleName: string, configName: string): Promise<VehicleConfigData | null> => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    const installDir = config.gamePaths?.installDir

    // Check user dir first
    if (userDir) {
      const userPcPath = join(userDir, 'vehicles', vehicleName, `${configName}.pc`)
      try {
        const data = await readFile(userPcPath, 'utf-8')
        return parseBeamNGJson(data)
      } catch { /* not a user config */ }
    }

    // Read from vehicle zip (stock or mod)
    if (installDir) {
      const zipPath = getVehicleZipPath(vehicleName, installDir)
      const buf = await readSingleFromZip(zipPath, new RegExp(`^vehicles/${vehicleName}/${configName}\\.pc$`, 'i'))
      if (buf) {
        try { return parseBeamNGJson(buf.toString('utf-8')) } catch { return null }
      }
    }

    return null
  })

  // ── Save Vehicle Config ──
  ipcMain.handle('game:saveVehicleConfig', async (_event, vehicleName: string, configName: string, data: VehicleConfigData): Promise<{ success: boolean; error?: string }> => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }

    // Sanitize config name
    const safeName = configName.replace(/[<>:"/\\|?*]/g, '_').trim()
    if (!safeName) return { success: false, error: 'Invalid config name' }

    const vehicleDir = join(userDir, 'vehicles', vehicleName)
    await mkdir(vehicleDir, { recursive: true })

    const pcPath = join(vehicleDir, `${safeName}.pc`)
    await writeFile(pcPath, JSON.stringify(data, null, 2), 'utf-8')

    // Invalidate vehicle list cache to update config counts
    vehicleListCache = null

    return { success: true }
  })

  // ── Delete Vehicle Config ──
  ipcMain.handle('game:deleteVehicleConfig', async (_event, vehicleName: string, configName: string): Promise<{ success: boolean; error?: string }> => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }

    const pcPath = join(userDir, 'vehicles', vehicleName, `${configName}.pc`)
    try {
      await access(pcPath)
      await unlink(pcPath)
      vehicleListCache = null
      return { success: true }
    } catch {
      return { success: false, error: 'Config not found or cannot be deleted (stock configs cannot be deleted)' }
    }
  })

  // ── Rename Vehicle Config ──
  ipcMain.handle('game:renameVehicleConfig', async (_event, vehicleName: string, oldName: string, newName: string): Promise<{ success: boolean; error?: string }> => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }

    const safeName = newName.replace(/[<>:"/\\|?*]/g, '_').trim()
    if (!safeName) return { success: false, error: 'Invalid config name' }

    const vehicleDir = join(userDir, 'vehicles', vehicleName)
    const oldPath = join(vehicleDir, `${oldName}.pc`)
    const newPath = join(vehicleDir, `${safeName}.pc`)

    try {
      await access(oldPath)
      try { await access(newPath); return { success: false, error: 'A config with that name already exists' } } catch { /* good, doesn't exist */ }
      await fsRename(oldPath, newPath)
      vehicleListCache = null
      return { success: true }
    } catch {
      return { success: false, error: 'Config not found' }
    }
  })

  // ── Get Vehicle 3D Model Data ──
  // Returns all relevant DAE file contents from the vehicle zip + common.zip.
  // Vehicles have multiple DAE files (e.g., body + cargobox + dump body + mechanicals).
  // When activeMeshes is provided, common.zip DAEs are filtered to only include files
  // that contain mesh nodes matching the active set.
  ipcMain.handle('game:getVehicle3DModel', async (_event, vehicleName: string, activeMeshes?: string[]): Promise<string[]> => {
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    if (!installDir) return []

    const daeTexts: string[] = []
    const activeMeshSet = activeMeshes ? new Set(activeMeshes) : null

    // Collect ALL DAE files from vehicle zip
    const vehicleZip = getVehicleZipPath(vehicleName, installDir)
    await readEntriesFromZip(
      vehicleZip,
      (fn) => fn.toLowerCase().endsWith('.dae'),
      (_fn, data) => {
        daeTexts.push(data.toString('utf-8'))
      }
    )

    // Collect relevant DAE files from common.zip (only those with matching mesh names)
    if (activeMeshSet && activeMeshSet.size > 0) {
      // First pass: collect mesh names already present in vehicle DAEs
      const vehicleMeshNames = new Set<string>()
      const nodeNameRegex = /<node[^>]* name="([^"]*)"/g
      for (const daeText of daeTexts) {
        nodeNameRegex.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = nodeNameRegex.exec(daeText)) !== null) {
          vehicleMeshNames.add(m[1])
        }
      }

      // Only look in common.zip for meshes NOT found in vehicle DAEs
      const missingMeshes = new Set<string>()
      for (const mesh of activeMeshSet) {
        if (!vehicleMeshNames.has(mesh)) missingMeshes.add(mesh)
      }

      if (missingMeshes.size > 0) {
        const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
        try {
          await readEntriesFromZip(
            commonZip,
            (fn) => fn.toLowerCase().endsWith('.dae'),
            (_fn, data) => {
              const text = data.toString('utf-8')
              // Quick check: does this DAE contain any missing mesh names?
              let hasMatch = false
              for (const mesh of missingMeshes) {
                if (text.includes(`name="${mesh}"`)) {
                  hasMatch = true
                  break
                }
              }
              if (hasMatch) daeTexts.push(text)
            }
          )
        } catch { /* common.zip may not exist */ }
      }
    }

    return daeTexts
  })

  // ── Get Vehicle Materials from .materials.json files ──
  // Reads all materials.json from the vehicle zip + common.zip.
  // Returns a record keyed by `mapTo` (which is the DAE material name).
  ipcMain.handle(
    'game:getVehicleMaterials',
    async (_event, vehicleName: string): Promise<Record<string, unknown>> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return {}

      const result: Record<string, unknown> = {}

      const readMats = (_fn: string, data: Buffer): void => {
        try {
          const parsed = JSON.parse(data.toString('utf-8'))
          for (const [, matDef] of Object.entries(parsed)) {
            const def = matDef as Record<string, unknown>
            const mapTo = (def.mapTo as string) || (def.name as string)
            if (mapTo && !result[mapTo]) {
              result[mapTo] = def
            }
          }
        } catch { /* skip malformed */ }
      }

      // Vehicle zip first (priority)
      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      await readEntriesFromZip(vehicleZip, (fn) => fn.endsWith('.materials.json'), readMats)

      // Then common.zip — read ALL shared materials (skip already-resolved from vehicle zip)
      const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
      try {
        await readEntriesFromZip(
          commonZip,
          (fn) => fn.endsWith('.materials.json'),
          readMats
        )
      } catch { /* common.zip may not exist */ }

      return result
    }
  )

  // ── Resolve default paint colors for a vehicle + config ──
  // Reads vehicle info.json for libraryPaints + defaultPaintName, per-config info for
  // defaultMultiPaintSetup, and common.paintLibrary.json to resolve 3 zone paint colors.
  // Returns an array of 3 paint objects matching the PaintData shape.
  ipcMain.handle(
    'game:getVehicleDefaultPaints',
    async (
      _event,
      vehicleName: string,
      configName: string
    ): Promise<Array<{ baseColor: number[]; metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number }>> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')

      // 1. Load global paint library from common.zip
      const paintLibrary: Record<string, { name: string; baseColor: number[]; metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number }> = {}
      try {
        await readEntriesFromZip(
          commonZip,
          (fn) => fn.toLowerCase().endsWith('.paintlibrary.json'),
          (_fn, data) => {
            try {
              const parsed = parseBeamNGJson<Record<string, unknown>>(data.toString('utf-8'))
              const paints = (parsed.paints || parsed) as Record<string, unknown>
              for (const [id, paint] of Object.entries(paints)) {
                const p = paint as Record<string, unknown>
                if (p.baseColor) {
                  paintLibrary[id] = {
                    name: (p.name as string) || id,
                    baseColor: p.baseColor as number[],
                    metallic: (p.metallic as number) ?? 0.5,
                    roughness: (p.roughness as number) ?? 0.5,
                    clearcoat: (p.clearcoat as number) ?? 0,
                    clearcoatRoughness: (p.clearcoatRoughness as number) ?? 0
                  }
                }
              }
            } catch { /* skip malformed */ }
          }
        )
      } catch { /* common.zip may not exist */ }

      // Also load paint libraries from vehicle zip
      try {
        await readEntriesFromZip(
          vehicleZip,
          (fn) => fn.toLowerCase().endsWith('.paintlibrary.json'),
          (_fn, data) => {
            try {
              const parsed = parseBeamNGJson<Record<string, unknown>>(data.toString('utf-8'))
              const paints = (parsed.paints || parsed) as Record<string, unknown>
              for (const [id, paint] of Object.entries(paints)) {
                const p = paint as Record<string, unknown>
                if (p.baseColor) {
                  paintLibrary[id] = {
                    name: (p.name as string) || id,
                    baseColor: p.baseColor as number[],
                    metallic: (p.metallic as number) ?? 0.5,
                    roughness: (p.roughness as number) ?? 0.5,
                    clearcoat: (p.clearcoat as number) ?? 0,
                    clearcoatRoughness: (p.clearcoatRoughness as number) ?? 0
                  }
                }
              }
            } catch { /* skip */ }
          }
        )
      } catch { /* */ }

      // Build name→paint and id→name lookup (mirrors vehiclePaints.lua logic)
      const paintByName: Record<string, typeof paintLibrary[string]> = {}
      const idToName: Record<string, string> = {}
      for (const [id, paint] of Object.entries(paintLibrary)) {
        paintByName[paint.name] = paint
        idToName[id] = paint.name
      }

      // 2. Read vehicle info.json for inline paints, libraryPaints, and defaultPaintName
      const infoBuf = await readSingleFromZip(vehicleZip, new RegExp(`^vehicles/${vehicleName}/info\\.json$`, 'i'))
      let modelDefaultPaint1: string | undefined
      let modelDefaultPaint2: string | undefined
      let modelDefaultPaint3: string | undefined
      if (infoBuf) {
        try {
          const info = parseBeamNGJson<Record<string, unknown>>(infoBuf.toString('utf-8'))

          // Add inline paints from info.paints (keyed by name)
          if (info.paints && typeof info.paints === 'object') {
            for (const [name, paint] of Object.entries(info.paints)) {
              const p = paint as Record<string, unknown>
              if (p.baseColor) {
                const entry = {
                  name,
                  baseColor: p.baseColor as number[],
                  metallic: (p.metallic as number) ?? 0.5,
                  roughness: (p.roughness as number) ?? 0.5,
                  clearcoat: (p.clearcoat as number) ?? 0,
                  clearcoatRoughness: (p.clearcoatRoughness as number) ?? 0
                }
                paintByName[name] = entry
              }
            }
          }

          // Resolve libraryPaints into paintByName (mirrors vehiclePaints.lua setupPaints)
          if (Array.isArray(info.libraryPaints)) {
            for (const ref of info.libraryPaints) {
              const id = typeof ref === 'string' ? ref : ref?.id
              if (id && paintLibrary[id]) {
                paintByName[paintLibrary[id].name] = paintLibrary[id]
                idToName[id] = paintLibrary[id].name
              }
            }
          }

          modelDefaultPaint1 = info.defaultPaintName1 as string | undefined
          modelDefaultPaint2 = (info.defaultPaintName2 || info.defaultPaintName1) as string | undefined
          modelDefaultPaint3 = (info.defaultPaintName3 || info.defaultPaintName1) as string | undefined
        } catch { /* */ }
      }

      // 3. Read per-config info for defaultMultiPaintSetup
      const configInfoBuf = await readSingleFromZip(
        vehicleZip,
        new RegExp(`^vehicles/${vehicleName}/info_${configName}\\.json$`, 'i')
      )

      let paint1Key: string | undefined
      let paint2Key: string | undefined
      let paint3Key: string | undefined

      if (configInfoBuf) {
        try {
          const configInfo = parseBeamNGJson<Record<string, unknown>>(configInfoBuf.toString('utf-8'))
          const paintSetup = configInfo.defaultMultiPaintSetup as Record<string, string> | undefined
          if (paintSetup) {
            paint1Key = paintSetup.paint1
            paint2Key = paintSetup.paint2
            paint3Key = paintSetup.paint3
          } else {
            // Fall back to per-config defaultPaintName fields
            paint1Key = configInfo.defaultPaintName1 as string | undefined
            paint2Key = configInfo.defaultPaintName2 as string | undefined
            paint3Key = configInfo.defaultPaintName3 as string | undefined
          }
        } catch { /* */ }
      }

      // Fall back to model defaults if config doesn't specify
      if (!paint1Key) paint1Key = modelDefaultPaint1
      if (!paint2Key) paint2Key = paint1Key || modelDefaultPaint2
      if (!paint3Key) paint3Key = paint1Key || modelDefaultPaint3

      // 4. Resolve paint names/IDs to actual paint data
      // Mirrors resolvePaintHelper: try by name, then by ID→name, then by name-lookup from library
      const resolvePaint = (key: string | undefined): typeof paintLibrary[string] | null => {
        if (!key) return null
        // Try direct name match
        if (paintByName[key]) return paintByName[key]
        // Try as library ID
        if (idToName[key] && paintByName[idToName[key]]) return paintByName[idToName[key]]
        // Try ID directly from library
        if (paintLibrary[key]) return paintLibrary[key]
        return null
      }

      const p1 = resolvePaint(paint1Key)
      const p2 = resolvePaint(paint2Key) || p1
      const p3 = resolvePaint(paint3Key) || p1

      const fallback = { baseColor: [0.5, 0.5, 0.5, 1.2], metallic: 0.5, roughness: 0.5, clearcoat: 0, clearcoatRoughness: 0 }

      return [
        p1 ? { baseColor: p1.baseColor, metallic: p1.metallic, roughness: p1.roughness, clearcoat: p1.clearcoat, clearcoatRoughness: p1.clearcoatRoughness } : fallback,
        p2 ? { baseColor: p2.baseColor, metallic: p2.metallic, roughness: p2.roughness, clearcoat: p2.clearcoat, clearcoatRoughness: p2.clearcoatRoughness } : fallback,
        p3 ? { baseColor: p3.baseColor, metallic: p3.metallic, roughness: p3.roughness, clearcoat: p3.clearcoat, clearcoatRoughness: p3.clearcoatRoughness } : fallback,
      ]
    }
  )

  // ── Resolve active globalSkin from config parts ──
  // Reads jbeam to find the `globalSkin` value for the active `paint_design` part.
  // Returns e.g. { skin: "bcpd", slotType: "skin_sedan" } which maps to material suffix
  // ".<slotType>.<skin>" (e.g. "fullsize.skin_sedan.bcpd")
  ipcMain.handle(
    'game:getActiveGlobalSkin',
    async (_event, vehicleName: string, configParts: Record<string, string>): Promise<{ skin: string; slotType: string } | null> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return null

      const paintDesignPart = configParts['paint_design']
      if (!paintDesignPart) return null

      let result: { skin: string; slotType: string } | null = null

      const scanJbeam = (_fn: string, data: Buffer): void => {
        if (result) return
        try {
          const parsed = parseBeamNGJson<Record<string, Record<string, unknown>>>(data.toString('utf-8'))
          for (const [partName, partDef] of Object.entries(parsed)) {
            if (partName === paintDesignPart && partDef.globalSkin) {
              result = {
                skin: partDef.globalSkin as string,
                slotType: (partDef.slotType as string) || 'paint_design'
              }
              return
            }
          }
        } catch { /* skip */ }
      }

      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      await readEntriesFromZip(vehicleZip, (fn) => fn.endsWith('.jbeam'), scanJbeam)
      if (!result) {
        const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
        try { await readEntriesFromZip(commonZip, (fn) => fn.endsWith('.jbeam'), scanJbeam) } catch { /* */ }
      }

      return result
    }
  )

  // ── Get Active Vehicle Meshes via slot tree walk ──
  // Builds a part database (meshes + slots) from jbeam files, then walks the slot tree
  // from the root part using config.parts to resolve which parts are active.
  // Returns the list of mesh names that should be visible.
  ipcMain.handle(
    'game:getActiveVehicleMeshes',
    async (_event, vehicleName: string, configParts: Record<string, string>): Promise<string[]> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      // Part database: partName → { meshes, slots }
      interface PartEntry {
        meshes: string[]
        slots: { name: string; defaultPart: string }[]
      }
      const partDB: Record<string, PartEntry> = {}

      let skipExisting = false
      const buildPartDB = (_fn: string, data: Buffer): void => {
        try {
          const parsed = parseBeamNGJson<Record<string, Record<string, unknown>>>(data.toString('utf-8'))
          for (const [partName, partDef] of Object.entries(parsed)) {
            if (!partDef || typeof partDef !== 'object') continue
            if (skipExisting && partDB[partName]) continue
            const entry: PartEntry = { meshes: [], slots: [] }

            // Extract meshes from flexbodies
            const flexbodies = partDef.flexbodies as unknown[][]
            if (Array.isArray(flexbodies)) {
              let meshCol = 0
              for (const row of flexbodies) {
                if (!Array.isArray(row)) continue
                if (typeof row[0] === 'string' && row[0] === 'mesh') { meshCol = 0; continue }
                if (typeof row[meshCol] === 'string') {
                  entry.meshes.push(row[meshCol] as string)
                }
              }
            }

            // Extract meshes from props
            const props = partDef.props as unknown[][]
            if (Array.isArray(props)) {
              let meshCol = -1
              for (const row of props) {
                if (!Array.isArray(row)) continue
                if (meshCol === -1) {
                  const idx = row.indexOf('mesh')
                  if (idx >= 0) { meshCol = idx; continue }
                }
                if (meshCol >= 0 && typeof row[meshCol] === 'string') {
                  entry.meshes.push(row[meshCol] as string)
                }
              }
            }

            // Extract slots from slots2 (newer format)
            // Header: ["name", "allowTypes", "denyTypes", "default", "description"]
            const slots2 = partDef.slots2 as unknown[][]
            if (Array.isArray(slots2)) {
              let nameCol = 0, defaultCol = 3
              for (const row of slots2) {
                if (!Array.isArray(row)) continue
                // Detect header row
                if (row.includes('name') && row.includes('default')) {
                  nameCol = row.indexOf('name')
                  defaultCol = row.indexOf('default')
                  continue
                }
                const slotName = typeof row[nameCol] === 'string' ? row[nameCol] as string : ''
                const defaultPart = typeof row[defaultCol] === 'string' ? row[defaultCol] as string : ''
                if (slotName) entry.slots.push({ name: slotName, defaultPart })
              }
            }

            // Extract slots from slots (older format)
            // Each row: ["slotType", "defaultPart", "description"]
            const slots = partDef.slots as unknown[][]
            if (Array.isArray(slots) && !slots2) {
              for (const row of slots) {
                if (!Array.isArray(row)) continue
                // Skip header rows
                if (row.includes('type') && row.includes('default')) continue
                const slotName = typeof row[0] === 'string' ? row[0] as string : ''
                const defaultPart = typeof row[1] === 'string' ? row[1] as string : ''
                if (slotName) entry.slots.push({ name: slotName, defaultPart })
              }
            }

            partDB[partName] = entry
          }
        } catch { /* skip malformed jbeam files */ }
      }

      // Scan vehicle zip first, then common.zip (skip parts already defined by vehicle)
      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      await readEntriesFromZip(vehicleZip, (fn) => fn.endsWith('.jbeam'), buildPartDB)
      skipExisting = true
      const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
      try {
        await readEntriesFromZip(commonZip, (fn) => fn.endsWith('.jbeam'), buildPartDB)
      } catch { /* common.zip may not exist */ }

      // Walk the slot tree from root part
      const activeMeshes: string[] = []
      const visited = new Set<string>()

      function walk(partName: string): void {
        if (!partName || visited.has(partName)) return
        visited.add(partName)
        const part = partDB[partName]
        if (!part) return

        // Collect this part's meshes
        activeMeshes.push(...part.meshes)

        // Recurse into slots
        for (const slot of part.slots) {
          const assigned = configParts[slot.name]
          // "" = explicitly removed, undefined = use default
          if (assigned === '') continue
          const resolved = assigned ?? slot.defaultPart
          if (resolved) walk(resolved)
        }
      }

      walk(vehicleName) // root part name = vehicle model name
      return activeMeshes
    }
  )

  // ── Get Wheel Placements ──
  // Walks the slot tree to find active wheel/tire/hubcap parts, extracts their flexbody
  // group assignments + node positions from hub parts to compute 3D wheel placement data.
  // Returns an array of { meshName, position, group } for each wheel instance.
  ipcMain.handle(
    'game:getWheelPlacements',
    async (_event, vehicleName: string, configParts: Record<string, string>): Promise<WheelPlacement[]> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      // Full part database: raw jbeam definitions
      const rawParts: Record<string, Record<string, unknown>> = {}

      let skipExisting = false
      const scanJbeam = (_fn: string, data: Buffer): void => {
        try {
          const parsed = parseBeamNGJson<Record<string, Record<string, unknown>>>(data.toString('utf-8'))
          for (const [partName, partDef] of Object.entries(parsed)) {
            if (!partDef || typeof partDef !== 'object') continue
            if (skipExisting && rawParts[partName]) continue
            rawParts[partName] = partDef
          }
        } catch { /* skip malformed */ }
      }

      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      await readEntriesFromZip(vehicleZip, (fn) => fn.endsWith('.jbeam'), scanJbeam)
      skipExisting = true
      const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
      try { await readEntriesFromZip(commonZip, (fn) => fn.endsWith('.jbeam'), scanJbeam) } catch { /* */ }

      // Extract slots from a part definition
      function getSlots(partDef: Record<string, unknown>): { name: string; defaultPart: string }[] {
        const slots: { name: string; defaultPart: string }[] = []
        const slots2 = partDef.slots2 as unknown[][] | undefined
        if (Array.isArray(slots2)) {
          let nameCol = 0, defaultCol = 3
          for (const row of slots2) {
            if (!Array.isArray(row)) continue
            if (row.includes('name') && row.includes('default')) {
              nameCol = row.indexOf('name'); defaultCol = row.indexOf('default'); continue
            }
            const slotName = typeof row[nameCol] === 'string' ? row[nameCol] as string : ''
            const defaultPart = typeof row[defaultCol] === 'string' ? row[defaultCol] as string : ''
            if (slotName) slots.push({ name: slotName, defaultPart })
          }
        }
        const slotsArr = partDef.slots as unknown[][] | undefined
        if (Array.isArray(slotsArr) && !slots2) {
          for (const row of slotsArr) {
            if (!Array.isArray(row)) continue
            if (row.includes('type') && row.includes('default')) continue
            const slotName = typeof row[0] === 'string' ? row[0] as string : ''
            const defaultPart = typeof row[1] === 'string' ? row[1] as string : ''
            if (slotName) slots.push({ name: slotName, defaultPart })
          }
        }
        return slots
      }

      // Walk the slot tree to find all active parts
      const activeParts: string[] = []
      const visited = new Set<string>()
      function walk(partName: string): void {
        if (!partName || visited.has(partName)) return
        visited.add(partName)
        const partDef = rawParts[partName]
        if (!partDef) return
        activeParts.push(partName)
        for (const slot of getSlots(partDef)) {
          const assigned = configParts[slot.name]
          if (assigned === '') continue
          const resolved = assigned ?? slot.defaultPart
          if (resolved) walk(resolved)
        }
      }
      walk(vehicleName)



      // ── 1. Collect ALL node positions and group memberships ──
      const allNodes: Record<string, [number, number, number]> = {}
      const groupNodeIds: Record<string, string[]> = {}

      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const nodes = partDef.nodes as unknown[] | undefined
        if (!Array.isArray(nodes)) continue

        let headers: unknown[] | null = null
        let currentGroups: string[] = []

        // Helper: update currentGroups from a group property value
        const applyGroup = (groupVal: unknown): void => {
          if (typeof groupVal === 'string') {
            currentGroups = groupVal.split(',').map(s => (s as string).trim()).filter(Boolean)
          } else if (Array.isArray(groupVal)) {
            currentGroups = (groupVal as string[]).map(s => String(s).trim()).filter(Boolean)
          } else {
            currentGroups = []
          }
        }

        for (const item of nodes) {
          // Standalone group object between rows: {"group": "..."}
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const opt = item as Record<string, unknown>
            if (opt.group !== undefined) applyGroup(opt.group)
            continue
          }
          if (!Array.isArray(item)) continue
          if (item.includes('id') && item.includes('posX')) { headers = item; continue }
          if (!headers) continue

          // Check for inline group objects within the data row
          for (const el of item) {
            if (el && typeof el === 'object' && !Array.isArray(el)) {
              const obj = el as Record<string, unknown>
              if (obj.group !== undefined) applyGroup(obj.group)
            }
          }

          const idIdx = headers.indexOf('id')
          const xIdx = headers.indexOf('posX')
          const yIdx = headers.indexOf('posY')
          const zIdx = headers.indexOf('posZ')
          if (idIdx < 0 || xIdx < 0 || yIdx < 0 || zIdx < 0) continue

          const nodeId = typeof item[idIdx] === 'string' ? item[idIdx] as string : ''
          if (!nodeId) continue
          const x = typeof item[xIdx] === 'number' ? item[xIdx] as number : 0
          const y = typeof item[yIdx] === 'number' ? item[yIdx] as number : 0
          const z = typeof item[zIdx] === 'number' ? item[zIdx] as number : 0

          allNodes[nodeId] = [x, y, z]
          for (const g of currentGroups) {
            if (!groupNodeIds[g]) groupNodeIds[g] = []
            groupNodeIds[g].push(nodeId)
          }
        }
      }

      // Helper: median of an array of numbers (robust to outlier nodes like upper strut mounts)
      const median = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      }

      // ── 2. Discover ALL wheel corners from pressureWheels ──
      // Instead of hardcoding FR/FL/RR/RL, discover corners dynamically from pressureWheels data.
      // This supports multi-axle vehicles (citybus: RL1/RR1/RL2/RR2), semi trucks (R0R/R0L/R1R/R1L),
      // steering wheels (pigeon: STR/STL), trailers, and any modded vehicle layout.
      const discoveredCorners = new Set<string>()
      const hubCenters: Record<string, [number, number, number]> = {}

      // Pass 1: Scan pressureWheels for corner names and nodeArm positions  
      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const pw = partDef.pressureWheels as unknown[] | undefined
        if (!Array.isArray(pw)) continue

        let pwHeaders: unknown[] | null = null
        for (const row of pw) {
          if (!Array.isArray(row)) continue
          if (row.includes('name')) {
            pwHeaders = row; continue
          }
          if (!pwHeaders) continue
          const nameIdx = pwHeaders.indexOf('name')
          const name = typeof row[nameIdx] === 'string' ? (row[nameIdx] as string) : ''
          if (!name) continue
          discoveredCorners.add(name)

          // Use nodeArm position as initial hub center estimate
          if (!hubCenters[name]) {
            const armIdx = pwHeaders.indexOf('nodeArm:')
            if (armIdx >= 0) {
              const armNode = typeof row[armIdx] === 'string' ? (row[armIdx] as string) : ''
              if (armNode && allNodes[armNode]) {
                hubCenters[name] = [...allNodes[armNode]]
              }
            }
          }
        }
      }

      // If no pressureWheels found, fall back to standard 4 corners
      if (discoveredCorners.size === 0) {
        for (const c of ['FR', 'FL', 'RR', 'RL']) discoveredCorners.add(c)
      }

      // Pass 2: Try exact hub groups (_hub_FR, _hub_RL1, etc.) — median node position
      for (const corner of discoveredCorners) {
        const suffix = `_hub_${corner}`
        for (const [g, nodeIds] of Object.entries(groupNodeIds)) {
          if (g.endsWith(suffix)) {
            const positions = nodeIds.map(id => allNodes[id]).filter(Boolean)
            if (positions.length > 0) {
              hubCenters[corner] = [
                median(positions.map(p => p[0])),
                median(positions.map(p => p[1])),
                median(positions.map(p => p[2]))
              ]
            }
            break
          }
        }
      }

      // Pass 3: For standard FR/FL/RR/RL corners still missing, try combined axle groups
      // (_hub_F splits by X sign, _hub_R splits by X sign)
      const axisPairs: Array<[string, string, string]> = [['F', 'FR', 'FL'], ['R', 'RR', 'RL']]
      for (const [axle, rightCorner, leftCorner] of axisPairs) {
        if (hubCenters[rightCorner] && hubCenters[leftCorner]) continue
        if (!discoveredCorners.has(rightCorner) && !discoveredCorners.has(leftCorner)) continue
        const suffix = `_hub_${axle}`
        for (const [g, nodeIds] of Object.entries(groupNodeIds)) {
          if (g.endsWith(suffix) && !g.endsWith(`_hub_F${axle}`) && !g.endsWith(`_hub_R${axle}`)) {
            const positions = nodeIds.map(id => allNodes[id]).filter(Boolean)
            const right = positions.filter(p => p[0] < 0) // negative X = right side
            const left = positions.filter(p => p[0] > 0)  // positive X = left side
            if (right.length > 0 && !hubCenters[rightCorner]) {
              hubCenters[rightCorner] = [
                median(right.map(p => p[0])),
                median(right.map(p => p[1])),
                median(right.map(p => p[2]))
              ]
            }
            if (left.length > 0 && !hubCenters[leftCorner]) {
              hubCenters[leftCorner] = [
                median(left.map(p => p[0])),
                median(left.map(p => p[1])),
                median(left.map(p => p[2]))
              ]
            }
            break
          }
        }
      }

      // ── 3. Override hub centers with absolute brake flexbody positions ──
      // Brake parts often have explicit absolute pos values (|Y| > 0.1) that are
      // more accurate than node-computed hub centers (e.g., front disc brake positions).
      // Dynamic regex: match any discovered corner suffix
      const allCornerNames = [...discoveredCorners]
      const cornerPattern = allCornerNames.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      const cornerRx = new RegExp(`(?:wheelhub|wheel|tire|hubcap|trimring)_(${cornerPattern})\\b`, 'i')
      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const fb = partDef.flexbodies as unknown[] | undefined
        if (!Array.isArray(fb)) continue

        let meshCol = -1, groupCol = -1, posCol = -1
        for (const row of fb) {
          if (!Array.isArray(row)) continue
          if (row.includes('mesh')) {
            meshCol = row.indexOf('mesh')
            groupCol = row.indexOf('[group]:')
            posCol = row.indexOf('pos')
            continue
          }
          if (meshCol < 0 || posCol < 0) continue
          const posVal = row[posCol]
          if (!posVal || typeof posVal !== 'object' || Array.isArray(posVal)) continue
          const pos = posVal as { x?: number; y?: number; z?: number }
          if (Math.abs(pos.y ?? 0) < 0.1) continue // relative pos, skip

          let groups: string[] = []
          if (groupCol >= 0) {
            const gv = row[groupCol]
            if (typeof gv === 'string') groups = gv.split(',').map(s => s.trim())
            else if (Array.isArray(gv)) groups = (gv as unknown[]).filter(g => typeof g === 'string').map(g => (g as string).trim())
          }
          for (const g of groups) {
            const m = cornerRx.exec(g)
            if (m) {
              const corner = m[1].toUpperCase()
              if (discoveredCorners.has(corner)) {
                hubCenters[corner] = [pos.x ?? 0, pos.y ?? 0, pos.z ?? 0]
              }
              break
            }
          }
        }
      }



      // ── 4. Scan ALL active parts for flexbodies attached to wheel corners ──
      const placements: WheelPlacement[] = []

      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue

        const fb = partDef.flexbodies as unknown[] | undefined
        if (!Array.isArray(fb)) continue

        let meshCol = -1, groupCol = -1
        for (const row of fb) {
          if (!Array.isArray(row)) continue
          if (row.includes('mesh')) {
            meshCol = row.indexOf('mesh')
            groupCol = row.indexOf('[group]:')
            continue
          }
          if (meshCol < 0) continue
          const meshName = typeof row[meshCol] === 'string' ? row[meshCol] as string : ''
          if (!meshName) continue

          // Parse groups
          let groups: string[] = []
          if (groupCol >= 0) {
            const groupVal = row[groupCol]
            if (typeof groupVal === 'string') {
              groups = groupVal.split(',').map(s => s.trim())
            } else if (Array.isArray(groupVal)) {
              groups = (groupVal as unknown[]).filter(g => typeof g === 'string').map(g => (g as string).trim())
            }
          }
          if (groups.length === 0) continue

          // Determine corner from group names (wheel_FR → FR, tire_RL1 → RL1, etc.)
          let corner: string | null = null
          let bestGroup = ''
          for (const g of groups) {
            const m = cornerRx.exec(g)
            if (m) {
              corner = m[1].toUpperCase()
              bestGroup = g
              break
            }
          }
          if (!corner || !hubCenters[corner]) continue

          placements.push({
            meshName,
            position: hubCenters[corner],
            group: bestGroup,
            corner
          })
        }
      }

      return placements
    }
  )

  // ── Vehicle Editor Data: slot options + variable metadata ──
  ipcMain.handle(
    'game:getVehicleEditorData',
    async (_event, vehicleName: string): Promise<VehicleEditorData> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return { slots: {}, variables: {} }

      // slotType → description (from the slot definition itself)
      const slotDescriptions: Record<string, string> = {}
      // slotType → partNames that declare this slotType
      const slotOptions: Record<string, string[]> = {}
      // All slots declared by parts (so we know which exist)
      const declaredSlots = new Set<string>()
      // variable metadata
      const variables: Record<string, VariableInfo> = {}

      let skipExisting = false
      const seenParts = new Set<string>()

      const scanJbeam = (_fn: string, data: Buffer): void => {
        try {
          const parsed = parseBeamNGJson<Record<string, Record<string, unknown>>>(data.toString('utf-8'))
          for (const [partName, partDef] of Object.entries(parsed)) {
            if (!partDef || typeof partDef !== 'object') continue
            if (skipExisting && seenParts.has(partName)) continue
            seenParts.add(partName)

            // Track which slotType this part fills
            if (typeof partDef.slotType === 'string') {
              const st = partDef.slotType
              if (!slotOptions[st]) slotOptions[st] = []
              slotOptions[st].push(partName)
            }

            // Scan slots2 for declared slots and descriptions
            const slots2 = partDef.slots2 as unknown[][]
            if (Array.isArray(slots2)) {
              let nameCol = 0, descCol = 4
              for (const row of slots2) {
                if (!Array.isArray(row)) continue
                if (row.includes('name') && row.includes('default')) {
                  nameCol = row.indexOf('name')
                  const di = row.indexOf('description')
                  if (di >= 0) descCol = di
                  continue
                }
                const slotName = typeof row[nameCol] === 'string' ? row[nameCol] as string : ''
                if (slotName) {
                  declaredSlots.add(slotName)
                  if (!slotDescriptions[slotName] && typeof row[descCol] === 'string') {
                    slotDescriptions[slotName] = row[descCol] as string
                  }
                }
              }
            }

            // Scan slots (older format)
            const slots = partDef.slots as unknown[][]
            if (Array.isArray(slots) && !slots2) {
              for (const row of slots) {
                if (!Array.isArray(row)) continue
                if (row.includes('type') && row.includes('default')) continue
                const slotName = typeof row[0] === 'string' ? row[0] as string : ''
                if (slotName) {
                  declaredSlots.add(slotName)
                  if (!slotDescriptions[slotName] && typeof row[2] === 'string') {
                    slotDescriptions[slotName] = row[2] as string
                  }
                }
              }
            }

            // Scan variables
            const vars = partDef.variables as unknown[][]
            if (Array.isArray(vars)) {
              let ni = 0, ti = 1, ui = 2, ci = 3, di = 4, mni = 5, mxi = 6, tii = 7
              for (const row of vars) {
                if (!Array.isArray(row)) continue
                if (row.includes('name') && row.includes('default')) {
                  ni = row.indexOf('name')
                  ti = row.indexOf('type')
                  ui = row.indexOf('unit')
                  ci = row.indexOf('category')
                  di = row.indexOf('default')
                  mni = row.indexOf('min')
                  mxi = row.indexOf('max')
                  tii = row.indexOf('title')
                  continue
                }
                const name = row[ni]
                if (typeof name !== 'string' || !name.startsWith('$')) continue
                if (variables[name]) continue
                variables[name] = {
                  name,
                  type: typeof row[ti] === 'string' ? row[ti] as string : 'range',
                  unit: typeof row[ui] === 'string' ? row[ui] as string : '',
                  category: typeof row[ci] === 'string' ? row[ci] as string : '',
                  default: typeof row[di] === 'number' ? row[di] as number : 0,
                  min: typeof row[mni] === 'number' ? row[mni] as number : 0,
                  max: typeof row[mxi] === 'number' ? row[mxi] as number : 1,
                  title: typeof row[tii] === 'string' ? row[tii] as string : name
                }
              }
            }
          }
        } catch { /* skip malformed */ }
      }

      const vehicleZip = getVehicleZipPath(vehicleName, installDir)
      await readEntriesFromZip(vehicleZip, (fn) => fn.endsWith('.jbeam'), scanJbeam)
      skipExisting = true
      const commonZip = join(installDir, 'content', 'vehicles', 'common.zip')
      try {
        await readEntriesFromZip(commonZip, (fn) => fn.endsWith('.jbeam'), scanJbeam)
      } catch { /* common.zip may not exist */ }

      // Build slot info for slots that appear in this vehicle's parts
      const slots: Record<string, SlotInfo> = {}
      for (const slotName of declaredSlots) {
        const options = slotOptions[slotName] || []
        slots[slotName] = {
          name: slotName,
          description: slotDescriptions[slotName] || '',
          options: options.map(p => ({ partName: p }))
        }
      }

      return { slots, variables }
    }
  )

  ipcMain.handle('game:listMaps', async (): Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string }[]> => {
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    const userDir = config.gamePaths?.userDir
    const maps: { name: string; source: 'stock' | 'mod'; modZipPath?: string }[] = []
    const seen = new Set<string>()

    // 1) Stock maps from installDir/content/levels/
    if (installDir) {
      const stockLevelsDir = join(installDir, 'content', 'levels')
      try {
        const entries = await readdir(stockLevelsDir)
        for (const entry of entries) {
          const name = entry.replace(/\.zip$/i, '')
          if (!seen.has(name)) {
            seen.add(name)
            maps.push({ name, source: 'stock' })
          }
        }
      } catch { /* dir doesn't exist */ }
    }

    // 2) Mod maps (enabled terrain mods from mod manager)
    try {
      const mods = await modManagerService.listMods(userDir || '')
      for (const mod of mods) {
        if (mod.modType === 'terrain' && mod.enabled && mod.title && !seen.has(mod.title)) {
          seen.add(mod.title)
          maps.push({ name: mod.title, source: 'mod', modZipPath: mod.filePath })
        }
      }
    } catch { /* ignore */ }

    maps.sort((a, b) => a.name.localeCompare(b.name))
    return maps
  })

  ipcMain.handle('game:kill', async (): Promise<void> => {
    launcherService.killGame()
  })

  ipcMain.handle('game:status', async () => {
    return launcherService.getStatus()
  })

  // Push game-status changes to renderer in real-time
  launcherService.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('game:statusChange', status)
    }
  })

  ipcMain.handle('game:joinServer', async (_event, ip: string, port: number) => {
    const config = configService.get()
    const ident = `${ip}:${port}`
    configService.addRecentServer(ident).catch(() => {})
    return launcherService.joinServer(ip, port, config.gamePaths)
  })

  ipcMain.handle('game:beammpLogin', async (_event, username: string, password: string) => {
    return launcherService.loginToBeamMP(username, password)
  })

  ipcMain.handle('game:beammpLoginAsGuest', async () => {
    await launcherService.loginAsGuest()
  })

  ipcMain.handle('game:beammpLogout', async () => {
    launcherService.logoutBeamMP()
  })

  ipcMain.handle('game:getAuthInfo', async () => {
    return launcherService.getAuthInfo()
  })

  ipcMain.handle('game:getLauncherLogs', async () => {
    return launcherService.getLogs()
  })

  // ── Backend API ──
  ipcMain.handle('backend:getServers', async () => {
    try {
      return { success: true, data: await backendService.getServerList() }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('backend:login', async (_event, username: string, password: string) => {
    return backendService.login(username, password)
  })

  ipcMain.handle('backend:checkHealth', async () => {
    return backendService.checkBackendHealth()
  })

  ipcMain.handle('backend:setUrl', async (_event, url: string) => {
    backendService.setBaseUrl(url)
    await configService.setBackendUrl(url)
  })

  // ── Map Preview ──
  // In-memory cache so we only read zip files once per level
  const mapPreviewCache = new Map<string, string | null>()

  ipcMain.handle('map:getPreview', async (_event, mapPath: string, modZipPath?: string): Promise<string | null> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      const userDir = config.gamePaths?.userDir

      // Extract level name: "/levels/west_coast_usa/info.json" → "west_coast_usa"
      const levelName = mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
      if (!levelName) return null

      if (mapPreviewCache.has(levelName)) return mapPreviewCache.get(levelName)!

      // 1) Check userDir for mod/custom maps (unpacked folders)
      if (userDir) {
        const userLevelDir = join(userDir, 'levels', levelName)
        const candidates = ['preview.jpg', 'preview.png', 'preview.jpeg']
        for (const file of candidates) {
          const filePath = join(userLevelDir, file)
          try {
            await access(filePath)
            const buffer = await readFile(filePath)
            const ext = file.split('.').pop() || 'jpg'
            const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
            const result = `data:${mime};base64,${buffer.toString('base64')}`
            mapPreviewCache.set(levelName, result)
            return result
          } catch {
            // try next
          }
        }
        // Also check for <name>_preview*.jpg in user folder
        try {
          const files = await readdir(userLevelDir)
          const preview = files.find((f) => f.match(new RegExp(`${levelName}_preview\\d*\\.jpg`, 'i')) || f.match(/preview\d*\.jpg/i))
          if (preview) {
            const buffer = await readFile(join(userLevelDir, preview))
            const result = `data:image/jpeg;base64,${buffer.toString('base64')}`
            mapPreviewCache.set(levelName, result)
            return result
          }
        } catch {
          // folder doesn't exist
        }
      }

      // 2) Read from stock zip in installDir/content/levels/<name>.zip
      if (installDir) {
        const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
        try {
          await access(zipPath)
          const result = await readPreviewFromZip(zipPath, levelName)
          if (result) {
            mapPreviewCache.set(levelName, result)
            return result
          }
        } catch { /* not a stock map */ }
      }

      // 3) Try mod zip — use wildcard level name since mod internal folder may differ
      if (modZipPath) {
        try {
          await access(modZipPath)
          const result = await readPreviewFromZip(modZipPath, '[^/]+')
          if (result) {
            mapPreviewCache.set(levelName, result)
            return result
          }
        } catch { /* mod zip not accessible */ }
      }

      mapPreviewCache.set(levelName, null)
      return null
    } catch {
      return null
    }
  })

  // ── Map Minimap (composite: terrain base colour + minimap overlay, disk-cached) ──
  const minimapCache = new Map<string, { dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>()
  const minimapCacheDir = join(app.getPath('userData'), 'cache', 'minimaps')

  ipcMain.handle('map:getMinimap', async (_event, mapPath: string): Promise<{ dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return null

      const levelName = mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
      if (!levelName) return null

      // Fast in-memory cache
      if (minimapCache.has(levelName)) return minimapCache.get(levelName)!

      // Check disk cache (version 3 — tile composite)
      const cachedPath = join(minimapCacheDir, `${levelName}_v3.png`)
      const boundsPath = join(minimapCacheDir, `${levelName}_v3.json`)
      try {
        await access(cachedPath)
        const buf = await readFile(cachedPath)
        const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
        let worldBounds: { minX: number; maxX: number; minY: number; maxY: number } | undefined
        try {
          const bJson = await readFile(boundsPath, 'utf-8')
          worldBounds = JSON.parse(bJson)
        } catch { /* no bounds file — monolithic map */ }
        const result = { dataUrl, worldBounds }
        minimapCache.set(levelName, result)
        return result
      } catch { /* no cached file yet */ }

      const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
      try { await access(zipPath) } catch { minimapCache.set(levelName, null); return null }

      // Extract monolithic minimap PNG raw bytes (fallback source for terrain tile)
      let mmRaw = await readRawFromZip(zipPath, new RegExp(
        `^levels/${levelName}/[^/]*_?minimap[^/]*\\.(?:png|jpe?g)$`, 'i'
      ))
      // Fallback: some maps (e.g. johnson_valley) only have minimap tiles in a subdirectory
      if (!mmRaw) {
        mmRaw = await readRawFromZip(zipPath, new RegExp(
          `^levels/${levelName}/minimap/minimap_terrain\\.png$`, 'i'
        ))
      }
      if (!mmRaw) { minimapCache.set(levelName, null); return null }

      // Build composite (tile-based or monolithic fallback)
      const { image, worldBounds } = await buildCompositeMapImage(zipPath, levelName, mmRaw)
      await mkdir(minimapCacheDir, { recursive: true })
      await writeFile(cachedPath, image)
      if (worldBounds) await writeFile(boundsPath, JSON.stringify(worldBounds))
      const dataUrl = `data:image/png;base64,${image.toString('base64')}`
      const result = { dataUrl, worldBounds }
      minimapCache.set(levelName, result)
      return result
    } catch {
      return null
    }
  })

  // ── Map Terrain Base ──
  const terrainBaseCache = new Map<string, string | null>()

  ipcMain.handle('map:getTerrainBase', async (_event, mapPath: string, modZipPath?: string): Promise<string | null> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir

      const levelName = mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
      if (!levelName) return null

      if (terrainBaseCache.has(levelName)) return terrainBaseCache.get(levelName)!

      // 1) Try stock zip
      if (installDir) {
        const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
        try {
          await access(zipPath)
          const raw = await readRawFromZip(
            zipPath,
            new RegExp(`^levels/${levelName}/art/terrains/t_terrain_base_b\\.png$`, 'i')
          )
          if (raw) {
            const dataUrl = `data:image/png;base64,${raw.toString('base64')}`
            terrainBaseCache.set(levelName, dataUrl)
            return dataUrl
          }
        } catch { /* not a stock map */ }
      }

      // 2) Try mod zip — wildcard level name since internal folder may differ
      if (modZipPath) {
        try {
          await access(modZipPath)
          const raw = await readRawFromZip(
            modZipPath,
            /^levels\/[^/]+\/art\/terrains\/t_terrain_base_b\.png$/i
          )
          if (raw) {
            const dataUrl = `data:image/png;base64,${raw.toString('base64')}`
            terrainBaseCache.set(levelName, dataUrl)
            return dataUrl
          }
        } catch { /* mod zip not accessible */ }
      }

      terrainBaseCache.set(levelName, null)
      return null
    } catch {
      return null
    }
  })

  // ── Map Heightmap ──
  const heightmapCache = new Map<string, string | null>()

  ipcMain.handle('map:getHeightmap', async (_event, mapPath: string): Promise<string | null> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      const userDir = config.gamePaths?.userDir
      if (!installDir) return null

      const levelName = mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
      if (!levelName) return null

      if (heightmapCache.has(levelName)) return heightmapCache.get(levelName)!

      // 1) Check userDir
      if (userDir) {
        const userLevelDir = join(userDir, 'levels', levelName)
        try {
          const files = await readdir(userLevelDir)
          // Prefer *_heightmap.png, fall back to *.ter.depth.png
          const hm = files.find((f) => /heightmap\.png$/i.test(f))
            || files.find((f) => /\.ter\.depth\.png$/i.test(f))
          if (hm) {
            const buf = await readFile(join(userLevelDir, hm))
            const result = `data:image/png;base64,${buf.toString('base64')}`
            heightmapCache.set(levelName, result)
            return result
          }
        } catch {
          // folder doesn't exist
        }
      }

      // 2) Check zip
      const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
      try { await access(zipPath) } catch { heightmapCache.set(levelName, null); return null }

      const result = await readHeightmapFromZip(zipPath, levelName)
      heightmapCache.set(levelName, result)
      return result
    } catch {
      return null
    }
  })

  // ── Map Terrain Info (from .terrain.json) ──
  ipcMain.handle('map:getTerrainInfo', async (_event, mapPath: string): Promise<{ size: number } | null> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return null

      const levelName = mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
      if (!levelName) return null

      // Try zip
      const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
      try { await access(zipPath) } catch { return null }

      const json = await readTextFromZip(zipPath, new RegExp(
        `^levels/${levelName}/[^/]*\\.terrain\\.json$`, 'i'
      ))
      if (!json) return null
      const data = JSON.parse(json)
      return { size: data.size || 2048 }
    } catch {
      return null
    }
  })

  // ── Map Rich Metadata (info.json + .terrain.json + mod registry) ──
  ipcMain.handle('map:getMetadata', async (_event, mapName: string, modZipPath?: string): Promise<MapRichMetadata> => {
    const meta: MapRichMetadata = {}
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    const userDir = config.gamePaths?.userDir

    // Determine zip path
    let zipPath: string | null = null
    if (modZipPath) {
      try { await access(modZipPath); zipPath = modZipPath } catch { /* ignore */ }
    }
    if (!zipPath && installDir) {
      const stockZip = join(installDir, 'content', 'levels', `${mapName}.zip`)
      try { await access(stockZip); zipPath = stockZip } catch { /* ignore */ }
    }

    // Determine the internal level folder name (mod zips may use different internal names)
    let internalName = mapName
    if (zipPath && modZipPath) {
      // For mod zips, scan for the levels/*/info.json path to get the actual internal name
      const infoRaw = await readRawFromZip(zipPath, /^levels\/([^\/]+)\/info\.json$/i)
      if (infoRaw) {
        // We got data, but we need the actual folder name — re-scan with a capture
        internalName = await new Promise<string>((resolve) => {
          yauzlOpen(zipPath!, { lazyEntries: true }, (err, zf) => {
            if (err || !zf) { resolve(mapName); return }
            zf.readEntry()
            zf.on('entry', (entry) => {
              const match = entry.fileName.match(/^levels\/([^\/]+)\/info\.json$/i)
              if (match) { zf.close(); resolve(match[1]) }
              else zf.readEntry()
            })
            zf.on('end', () => resolve(mapName))
            zf.on('error', () => resolve(mapName))
          })
        })
      }
    }

    // 1. Read info.json from level zip or user dir
    let infoJson: Record<string, unknown> | null = null
    if (userDir) {
      const userInfoPath = join(userDir, 'levels', internalName, 'info.json')
      try {
        const raw = await readFile(userInfoPath, 'utf-8')
        infoJson = parseBeamNGJson<Record<string, unknown>>(raw)
      } catch { /* not in user dir */ }
    }
    if (!infoJson && zipPath) {
      const raw = await readRawFromZip(zipPath, new RegExp(`^levels/${internalName}/info\.json$`, 'i'))
      if (raw) {
        try { infoJson = parseBeamNGJson<Record<string, unknown>>(raw.toString('utf-8')) } catch { /* ignore */ }
      }
    }

    if (infoJson) {
      if (typeof infoJson.title === 'string') meta.title = infoJson.title
      if (typeof infoJson.description === 'string') meta.description = infoJson.description
      if (typeof infoJson.biome === 'string' && !meta.description) meta.description = infoJson.biome
      if (Array.isArray(infoJson.authors)) {
        meta.authors = infoJson.authors.filter((a): a is string => typeof a === 'string')
      } else if (typeof infoJson.author === 'string') {
        meta.authors = [infoJson.author]
      }
      // Count spawn points (previews / spawnPoints arrays)
      if (Array.isArray(infoJson.spawnPoints)) {
        meta.spawnPointCount = infoJson.spawnPoints.length
      } else if (Array.isArray(infoJson.previews)) {
        meta.spawnPointCount = infoJson.previews.length
      }
    }

    // 2. Read .terrain.json for terrain size
    if (zipPath) {
      const terrainRaw = await readTextFromZip(zipPath, new RegExp(
        `^levels/${internalName}/[^/]*\\.terrain\\.json$`, 'i'
      ))
      if (terrainRaw) {
        try {
          const terrainData = JSON.parse(terrainRaw)
          if (typeof terrainData.size === 'number') meta.terrainSize = terrainData.size
        } catch { /* ignore */ }
      }
    }

    // 3. Get file size
    if (zipPath) {
      try {
        const s = await stat(zipPath)
        meta.fileSize = s.size
      } catch { /* ignore */ }
    }

    // 4. Look up mod registry metadata
    try {
      // Search registry for map mods matching this name
      const searchResult = registryService.search({ mod_type: 'map', per_page: 200 })
      for (const mod of searchResult.mods) {
        const latest = mod.versions[0]
        if (!latest) continue
        // Match by identifier or name (case-insensitive)
        const idMatch = latest.identifier.toLowerCase() === mapName.toLowerCase() ||
          latest.identifier.toLowerCase().replace(/[-_]/g, '') === mapName.toLowerCase().replace(/[-_]/g, '')
        const nameMatch = latest.name.toLowerCase().replace(/[^a-z0-9]/g, '') === mapName.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (idMatch || nameMatch) {
          meta.registryId = latest.identifier
          meta.registryAbstract = latest.abstract
          if (latest.description) meta.registryDescription = latest.description
          meta.registryVersion = latest.version
          meta.registryAuthor = latest.author
          meta.registryLicense = latest.license
          if (latest.tags) meta.registryTags = latest.tags
          if (latest.release_status) meta.registryReleaseStatus = latest.release_status
          if (latest.release_date) meta.registryReleaseDate = latest.release_date
          if (latest.beamng_version_min) meta.registryBeamngVersionMin = latest.beamng_version_min
          if (latest.beamng_version_max) meta.registryBeamngVersionMax = latest.beamng_version_max
          if (latest.thumbnail) meta.registryThumbnail = latest.thumbnail
          if (latest.resources) meta.registryResources = latest.resources
          if (latest.download_size) meta.registryDownloadSize = latest.download_size
          if (latest.install_size) meta.registryInstallSize = latest.install_size
          break
        }
      }
    } catch { /* registry not available */ }

    return meta
  })

  // ── Map Road Route (A* pathfinding along DecalRoads) ──
  const roadNetworkCache = new Map<string, RoadNetwork>()

  ipcMain.handle('map:findRoute', async (
    _event,
    mapPath: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Promise<{ x: number; y: number }[]> => {
    try {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      const levelName = mapPath
        .replace(/^\/levels\//, '')
        .replace(/\/info\.json$/, '')
        .replace(/\/$/, '')
      if (!levelName) return []

      // Build or retrieve cached road network
      let network = roadNetworkCache.get(levelName)
      if (!network) {
        const zipPath = join(installDir, 'content', 'levels', `${levelName}.zip`)
        try { await access(zipPath) } catch {
          console.log('[findRoute] zip not found:', zipPath)
          return []
        }
        const roads = await readRoutableRoadsFromZip(zipPath, levelName)
        console.log(`[findRoute] ${levelName}: loaded ${roads.length} routable roads`)
        if (roads.length === 0) return []
        network = new RoadNetwork()
        network.build(roads)
        console.log(`[findRoute] ${levelName}: graph has ${network.nodes.length} nodes`)
        roadNetworkCache.set(levelName, network)
      }

      const result = network.findPath(startX, startY, endX, endY)
      return result
    } catch {
      return []
    }
  })

  // ── Flag Image Cache ──
  const flagMemCache = new Map<string, string>()
  const flagCacheDir = join(app.getPath('userData'), 'cache', 'flags')

  ipcMain.handle('flags:batch', async (_event, codes: string[]): Promise<Record<string, string>> => {
    const results: Record<string, string> = {}
    const toFetch: string[] = []

    for (const raw of codes) {
      const code = raw.toLowerCase()
      if (flagMemCache.has(code)) {
        results[code] = flagMemCache.get(code)!
        continue
      }
      // Try disk cache
      const cachePath = join(flagCacheDir, `${code}.png`)
      try {
        const buf = await readFile(cachePath)
        const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
        flagMemCache.set(code, dataUrl)
        results[code] = dataUrl
      } catch {
        toFetch.push(code)
      }
    }

    if (toFetch.length > 0) {
      await mkdir(flagCacheDir, { recursive: true })
      await Promise.all(
        toFetch.map(async (code) => {
          try {
            const resp = await fetch(`https://flagcdn.com/w40/${code}.png`)
            if (!resp.ok) return
            const buf = Buffer.from(await resp.arrayBuffer())
            await writeFile(join(flagCacheDir, `${code}.png`), buf)
            const dataUrl = `data:image/png;base64,${buf.toString('base64')}`
            flagMemCache.set(code, dataUrl)
            results[code] = dataUrl
          } catch { /* skip failed flags */ }
        })
      )
    }

    return results
  })

  // ── Favorites ──
  ipcMain.handle('favorites:get', async () => {
    return configService.getFavorites()
  })

  ipcMain.handle('favorites:set', async (_event, ident: string, favorite: boolean) => {
    return configService.setFavorite(ident, favorite)
  })

  // ── Recent Servers ──
  ipcMain.handle('recentServers:get', async () => {
    return configService.getRecentServers()
  })

  // ── Background Image Picker ──
  ipcMain.handle('appearance:pickBackgroundImage', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Background Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('appearance:loadBackgroundImage', async (_event, filePath: string) => {
    try {
      const data = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  /** List bundled default background image paths from resources/backgrounds/ */
  ipcMain.handle('appearance:getDefaultBackgrounds', async (): Promise<string[]> => {
    try {
      // In production: process.resourcesPath/resources/backgrounds/
      // In dev: <project>/resources/backgrounds/
      const isDev = !app.isPackaged
      const bgDir = isDev
        ? join(app.getAppPath(), 'resources', 'backgrounds')
        : join(process.resourcesPath, 'resources', 'backgrounds')
      const entries = await readdir(bgDir)
      return entries
        .filter((e) => /\.(jpg|jpeg|png|webp)$/i.test(e))
        .map((e) => join(bgDir, e))
    } catch {
      return []
    }
  })

  /** Load a background image thumbnail (smaller base64 for gallery previews) */
  ipcMain.handle('appearance:loadBackgroundThumb', async (_event, filePath: string): Promise<string | null> => {
    try {
      const data = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })

  // ── Window Controls ──
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  // ── Mods ──
  ipcMain.handle('mods:list', async () => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      const mods = await modManagerService.listMods(userDir)

      // Enrich unknown mod types from registry metadata
      const installed = registryService.getInstalled()
      for (const mod of mods) {
        if (mod.modType !== 'unknown') continue
        const entry = Object.values(installed).find((e) =>
          e.installed_files?.some((f) => {
            const fn = f.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
            return fn === mod.fileName.toLowerCase()
          })
        )
        if (entry?.metadata?.mod_type) {
          mod.modType = entry.metadata.mod_type
        }
      }

      return { success: true, data: mods }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:toggle', async (_event, modKey: string, enabled: boolean) => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      await modManagerService.toggleMod(userDir, modKey, enabled)
      // Invalidate vehicle list cache so mod vehicles appear/disappear
      vehicleListCache = null
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:delete', async (_event, modKey: string) => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }

    // Always attempt registry cleanup, even if file deletion fails
    const cleanupRegistry = (): void => {
      try {
        const installed = registryService.getInstalled()
        let registryId = modKey
        for (const [id, entry] of Object.entries(installed)) {
          const matchesKey = id === modKey
          const matchesFile = entry.installed_files?.some((f) => {
            const fn = f.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
            return fn === `${modKey}.zip` || fn === modKey
          })
          if (matchesKey || matchesFile) {
            registryId = id
            break
          }
        }
        registryService.trackRemoval(registryId).catch(() => {})
      } catch { /* best effort */ }
    }

    try {
      await modManagerService.deleteMod(userDir, modKey)
      cleanupRegistry()
      vehicleListCache = null
      return { success: true }
    } catch (err) {
      // File may already be gone — still clean up registry
      cleanupRegistry()
      vehicleListCache = null
      return { success: true }
    }
  })

  ipcMain.handle('mods:install', async () => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    const result = await dialog.showOpenDialog({
      title: 'Select mod zip file(s)',
      filters: [{ name: 'Zip Archives', extensions: ['zip'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' }
    }
    try {
      const installed = []
      for (const filePath of result.filePaths) {
        const mod = await modManagerService.installMod(userDir, filePath)
        installed.push(mod as never)
      }
      vehicleListCache = null
      return { success: true, data: installed }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:openFolder', async () => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return
    const modsPath = await modManagerService.getModsPath(userDir)
    shell.openPath(modsPath)
  })

  ipcMain.handle('mods:preview', async (_event, filePath: string) => {
    try {
      const preview = await modManagerService.getModPreview(filePath)
      return { success: true, data: preview }
    } catch {
      return { success: false, data: null }
    }
  })

  // ── Mod Repository (BeamNG.com) ──
  ipcMain.handle(
    'repo:browse',
    async (_event, categoryId: number, page: number, sort: RepoSortOrder) => {
      try {
        const result = await repoService.browse(categoryId, page, sort)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  ipcMain.handle('repo:search', async (_event, query: string, page: number) => {
    try {
      const result = await repoService.search(query, page)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('repo:categories', async () => {
    return repoService.getCategories()
  })

  ipcMain.handle('repo:openPage', async (_event, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle(
    'repo:download',
    async (_event, resourceId: number, slug: string): Promise<{ success: boolean; fileName?: string; error?: string }> => {
      const config = configService.get()
      const userDir = config.gamePaths?.userDir
      if (!userDir) return { success: false, error: 'Game user directory not configured' }

      const beamngSession = session.fromPartition('persist:beamng')

      // Verify login before attempting download
      const cookies = await beamngSession.cookies.get({ url: 'https://www.beamng.com' })
      const loggedIn = cookies.some(c => c.name === 'xf_user' || c.name === 'xf_session')
      if (!loggedIn) return { success: false, error: 'Not logged in to BeamNG.com' }

      const resourcePageUrl = `https://www.beamng.com/resources/${encodeURIComponent(slug)}.${resourceId}/`
      const mainWin = BrowserWindow.getAllWindows()[0]

      return new Promise((resolve) => {
        const dlWin = new BrowserWindow({
          width: 900,
          height: 650,
          show: false,
          parent: mainWin || undefined,
          autoHideMenuBar: true,
          title: 'Downloading...',
          webPreferences: {
            session: beamngSession,
            sandbox: true
          }
        })

        let resolved = false
        const finish = (result: { success: boolean; fileName?: string; error?: string }): void => {
          if (resolved) return
          resolved = true
          beamngSession.removeListener('will-download', onWillDownload)
          if (!dlWin.isDestroyed()) dlWin.close()
          resolve(result)
        }

        // Intercept the actual file download — use named function so we can remove it
        const onWillDownload = (_e: Electron.Event, item: Electron.DownloadItem): void => {
          // Remove listener immediately to prevent double-fire on next download
          beamngSession.removeListener('will-download', onWillDownload)

          const fileName = item.getFilename()
          const tmpPath = join(app.getPath('temp'), `beammp-dl-${Date.now()}-${fileName}`)
          item.setSavePath(tmpPath)

          if (!dlWin.isDestroyed()) dlWin.hide()

          const sender = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== dlWin)
          item.on('updated', (_ev, state) => {
            if (state === 'progressing' && !item.isPaused()) {
              const received = item.getReceivedBytes()
              const total = item.getTotalBytes()
              sender?.webContents.send('repo:download-progress', { received, total, fileName })
            }
          })

          item.once('done', async (_ev, state) => {
            if (state === 'completed') {
              try {
                const mod = await modManagerService.installMod(userDir, tmpPath, fileName, resourceId)
                try { await unlink(tmpPath) } catch {}
                finish({ success: true, fileName: mod.fileName })
              } catch (err) {
                finish({ success: false, error: String(err) })
              }
            } else {
              finish({ success: false, error: `Download ${state}` })
            }
          })
        }

        beamngSession.on('will-download', onWillDownload)

        dlWin.on('closed', () => {
          finish({ success: false, error: 'Cancelled' })
        })

        // Load the resource page first, extract the download link with CSRF token, then click it
        dlWin.webContents.once('did-finish-load', async () => {
          if (resolved || dlWin.isDestroyed()) return
          try {
            const downloadHref = await dlWin.webContents.executeJavaScript(`
              (() => {
                const link = document.querySelector('a.inner[href*="/download"]') ||
                             document.querySelector('a[href*="/download"]') ||
                             document.querySelector('.downloadButton a');
                return link ? link.href : null;
              })()
            `)
            if (downloadHref) {
              dlWin.loadURL(downloadHref)
            } else {
              dlWin.loadURL(resourcePageUrl + 'download')
            }
          } catch {
            finish({ success: false, error: 'Failed to extract download link' })
          }
        })

        // After download URL loads as a page (not a file), show window for manual interaction
        let pageLoads = 0
        dlWin.webContents.on('did-finish-load', () => {
          pageLoads++
          if (pageLoads >= 3 && !resolved && !dlWin.isDestroyed() && !dlWin.isVisible()) {
            dlWin.setTitle('BeamNG.com — Complete download')
            dlWin.show()
          }
        })

        dlWin.loadURL(resourcePageUrl)
      })
    }
  )

  // ── Repo Thumbnail Cache ──

  // ── BeamNG.com Account ──
  ipcMain.handle('repo:beamngLoggedIn', async (): Promise<{ loggedIn: boolean; username: string }> => {
    const beamngSession = session.fromPartition('persist:beamng')
    const cookies = await beamngSession.cookies.get({ url: 'https://www.beamng.com' })
    // xf_user = "remember me", xf_session = session-only login. Either means logged in.
    const loggedIn = cookies.some(c => c.name === 'xf_user' || c.name === 'xf_session')
    return { loggedIn, username: '' }
  })

  ipcMain.handle('repo:beamngLogin', async (): Promise<{ success: boolean }> => {
    const mainWin = BrowserWindow.getAllWindows()[0]
    const beamngSession = session.fromPartition('persist:beamng')

    return new Promise((resolve) => {
      const loginWin = new BrowserWindow({
        width: 900,
        height: 700,
        parent: mainWin || undefined,
        autoHideMenuBar: true,
        title: 'BeamNG.com — Log in',
        backgroundColor: '#111113',
        webPreferences: {
          session: beamngSession,
          sandbox: true
        }
      })

      let resolved = false
      let startedOnLogin = false

      const finish = (success: boolean): void => {
        if (resolved) return
        resolved = true
        beamngSession.cookies.removeListener('changed', onCookieChanged)
        if (!loginWin.isDestroyed()) loginWin.close()
        resolve({ success })
      }

      // Watch for xf_user cookie (remember me)
      const onCookieChanged = (
        _event: Electron.Event,
        cookie: Electron.Cookie,
        _cause: string,
        removed: boolean
      ): void => {
        if (!removed && cookie.name === 'xf_user') {
          finish(true)
        }
      }

      beamngSession.cookies.on('changed', onCookieChanged)

      // Watch navigation — after login, XenForo redirects away from /login/
      loginWin.webContents.on('did-navigate', async (_e, url) => {
        if (resolved) return
        const onLoginPage = url.includes('/login') || url.includes('/register')
        if (onLoginPage) {
          startedOnLogin = true
          return
        }
        // Navigated away from login — login succeeded (xf_session is enough)
        if (startedOnLogin) {
          finish(true)
        }
      })

      loginWin.on('closed', () => {
        beamngSession.cookies.removeListener('changed', onCookieChanged)
        finish(false)
      })

      loginWin.loadURL('https://www.beamng.com/login/')
    })
  })

  ipcMain.handle('repo:beamngLogout', async (): Promise<void> => {
    const beamngSession = session.fromPartition('persist:beamng')
    await beamngSession.clearStorageData()
  })

  // ── Repo Thumbnail Cache ──
  const thumbMemCache = new Map<string, string>()
  const thumbCacheDir = join(app.getPath('userData'), 'cache', 'repo-thumbs')

  ipcMain.handle(
    'repo:thumbnails',
    async (_event, urls: string[]): Promise<Record<string, string>> => {
      const results: Record<string, string> = {}
      const toFetch: string[] = []

      for (const url of urls) {
        if (!url) continue
        if (thumbMemCache.has(url)) {
          results[url] = thumbMemCache.get(url)!
          continue
        }
        // Derive a safe filename from the URL
        const safeKey = url.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-120) + '.jpg'
        const cachePath = join(thumbCacheDir, safeKey)
        try {
          const buf = await readFile(cachePath)
          const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`
          thumbMemCache.set(url, dataUrl)
          results[url] = dataUrl
        } catch {
          toFetch.push(url)
        }
      }

      if (toFetch.length > 0) {
        await mkdir(thumbCacheDir, { recursive: true })
        // Fetch in parallel, max 6 concurrent
        const batchSize = 6
        for (let i = 0; i < toFetch.length; i += batchSize) {
          const batch = toFetch.slice(i, i + batchSize)
          await Promise.all(
            batch.map(async (url) => {
              try {
                const resp = await fetch(url, {
                  headers: { 'User-Agent': 'BeamMP-ContentManager/1.0' }
                })
                if (!resp.ok) return
                const buf = Buffer.from(await resp.arrayBuffer())
                const safeKey = url.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-120) + '.jpg'
                await writeFile(join(thumbCacheDir, safeKey), buf)
                const ext = url.match(/\.png/i) ? 'png' : 'jpeg'
                const dataUrl = `data:image/${ext};base64,${buf.toString('base64')}`
                thumbMemCache.set(url, dataUrl)
                results[url] = dataUrl
              } catch {
                /* skip failed thumbnails */
              }
            })
          )
        }
      }

      return results
    }
  )

  // ── Server Queue (Wait-to-Join) ──
  let queueTimer: ReturnType<typeof setInterval> | null = null
  let queueTarget: { ip: string; port: string; sname: string } | null = null
  let queueStartedAt: number = 0
  const QUEUE_POLL_MS = 1000

  // Direct TCP info query — sends 'I' byte to the server, gets back JSON info
  function queryServerDirect(
    ip: string,
    port: string
  ): Promise<{ players: number; maxPlayers: number } | null> {
    return new Promise((resolve) => {
      const portNum = parseInt(port, 10)
      if (!portNum || portNum < 1 || portNum > 65535) {
        resolve(null)
        return
      }

      const sock = new net.Socket()
      sock.setTimeout(3000)

      sock.connect(portNum, ip, () => {
        sock.write(Buffer.from('I'))
      })

      let recvBuf = Buffer.alloc(0)

      sock.on('data', (chunk) => {
        recvBuf = Buffer.concat([recvBuf, chunk])
        if (recvBuf.length >= 4) {
          const len = recvBuf.readUInt32LE(0)
          if (recvBuf.length >= 4 + len) {
            try {
              const info = JSON.parse(recvBuf.subarray(4, 4 + len).toString('utf-8'))
              resolve({
                players: parseInt(info.players, 10) || 0,
                maxPlayers: parseInt(info.maxplayers, 10) || 0
              })
            } catch {
              resolve(null)
            }
            sock.destroy()
          }
        }
      })

      sock.on('timeout', () => {
        resolve(null)
        sock.destroy()
      })

      sock.on('error', () => {
        resolve(null)
        sock.destroy()
      })
    })
  }

  // Full TCP probe — returns all server fields for direct-connect display
  interface ProbeResult {
    online: boolean
    sname?: string
    map?: string
    players?: string
    maxplayers?: string
    modstotal?: string
    modlist?: string
    playerslist?: string
  }

  function probeServer(ip: string, port: string): Promise<ProbeResult> {
    return new Promise((resolve) => {
      const portNum = parseInt(port, 10)
      if (!portNum || portNum < 1 || portNum > 65535) {
        resolve({ online: false })
        return
      }

      const sock = new net.Socket()
      sock.setTimeout(4000)

      sock.connect(portNum, ip, () => {
        sock.write(Buffer.from('I'))
      })

      let recvBuf = Buffer.alloc(0)

      sock.on('data', (chunk) => {
        recvBuf = Buffer.concat([recvBuf, chunk])
        if (recvBuf.length >= 4) {
          const len = recvBuf.readUInt32LE(0)
          if (recvBuf.length >= 4 + len) {
            try {
              const info = JSON.parse(recvBuf.subarray(4, 4 + len).toString('utf-8'))
              resolve({
                online: true,
                sname: info.sname || info.name || undefined,
                map: info.map || undefined,
                players: String(info.players ?? '0'),
                maxplayers: String(info.maxplayers ?? '0'),
                modstotal: String(info.modstotal ?? info.mods ?? '0'),
                modlist: info.modlist || undefined,
                playerslist: info.playerslist || undefined
              })
            } catch {
              resolve({ online: false })
            }
            sock.destroy()
          }
        }
      })

      sock.on('timeout', () => {
        resolve({ online: false })
        sock.destroy()
      })

      sock.on('error', () => {
        resolve({ online: false })
        sock.destroy()
      })
    })
  }

  ipcMain.handle('game:probeServer', async (_event, ip: string, port: string) => {
    return probeServer(ip, port)
  })

  // Fallback: look up the server in the backend API list (cached for 5s)
  let cachedServerList: ServerInfo[] = []
  let cachedListTimestamp = 0
  const CACHE_TTL_MS = 5000

  async function queryServerFallback(
    ip: string,
    port: string
  ): Promise<{ players: number; maxPlayers: number } | null> {
    const now = Date.now()
    if (now - cachedListTimestamp > CACHE_TTL_MS) {
      try {
        cachedServerList = await backendService.getServerList()
        cachedListTimestamp = now
      } catch {
        // use stale cache
      }
    }
    const s = cachedServerList.find((s) => s.ip === ip && s.port === port)
    if (!s) return null
    return {
      players: parseInt(s.players, 10) || 0,
      maxPlayers: parseInt(s.maxplayers, 10) || 0
    }
  }

  // Try direct TCP first, fall back to backend API
  async function queryServerInfo(
    ip: string,
    port: string
  ): Promise<{ players: number; maxPlayers: number } | null> {
    const direct = await queryServerDirect(ip, port)
    if (direct) return direct
    return queryServerFallback(ip, port)
  }

  ipcMain.handle('queue:start', async (event, ip: string, port: string, sname: string) => {
    // Cancel any existing queue
    if (queueTimer) {
      clearInterval(queueTimer)
      queueTimer = null
    }

    queueTarget = { ip, port, sname }
    queueStartedAt = Date.now()
    const win = BrowserWindow.fromWebContents(event.sender)

    // Notify renderer that queue started
    win?.webContents.send('queue:status', {
      active: true,
      ip,
      port,
      sname,
      elapsed: 0,
      message: 'Waiting for an open slot...'
    })

    const pollForSlot = async (): Promise<void> => {
      if (!queueTarget) return

      try {
        const info = await queryServerInfo(queueTarget.ip, queueTarget.port)

        if (!info) {
          // Server unreachable
          win?.webContents.send('queue:status', {
            active: true,
            ip: queueTarget!.ip,
            port: queueTarget!.port,
            sname: queueTarget!.sname,
            elapsed: Date.now() - queueStartedAt,
            message: 'Server unreachable — retrying...'
          })
          return
        }

        const { players, maxPlayers } = info
        const elapsed = Date.now() - queueStartedAt

        if (players < maxPlayers) {
          // Slot available — auto-join immediately
          if (queueTimer) clearInterval(queueTimer)
          queueTimer = null
          const savedTarget = { ...queueTarget! }
          queueTarget = null

          win?.webContents.send('queue:status', {
            active: false,
            ip: savedTarget.ip,
            port: savedTarget.port,
            sname: savedTarget.sname,
            elapsed,
            message: 'Slot found! Joining...'
          })

          // Trigger the join
          const config = configService.get()
          const result = await launcherService.joinServer(
            savedTarget.ip,
            parseInt(savedTarget.port, 10),
            config.gamePaths
          )

          win?.webContents.send('queue:joined', {
            success: result.success,
            error: result.error,
            ip: savedTarget.ip,
            port: savedTarget.port,
            sname: savedTarget.sname
          })
        } else {
          // Still full — update status
          win?.webContents.send('queue:status', {
            active: true,
            ip: queueTarget!.ip,
            port: queueTarget!.port,
            sname: queueTarget!.sname,
            elapsed,
            players,
            maxPlayers,
            message: `Server full (${players}/${maxPlayers}) — polling every second...`
          })
        }
      } catch (err) {
        // Network error — keep trying
        win?.webContents.send('queue:status', {
          active: true,
          ip: queueTarget?.ip ?? '',
          port: queueTarget?.port ?? '',
          sname: queueTarget?.sname ?? '',
          elapsed: Date.now() - queueStartedAt,
          message: `Poll error, retrying... (${String(err)})`
        })
      }
    }

    // First poll immediately
    await pollForSlot()

    // Then poll on interval (only if still queued)
    if (queueTarget) {
      queueTimer = setInterval(pollForSlot, QUEUE_POLL_MS)
    }

    return { success: true }
  })

  ipcMain.handle('queue:stop', async () => {
    if (queueTimer) {
      clearInterval(queueTimer)
      queueTimer = null
    }
    const target = queueTarget
    queueTarget = null
    return { cancelled: true, ip: target?.ip, port: target?.port }
  })

  ipcMain.handle('queue:status', async () => {
    return {
      active: queueTarget !== null,
      ip: queueTarget?.ip ?? null,
      port: queueTarget?.port ?? null,
      sname: queueTarget?.sname ?? null,
      elapsed: queueTarget ? Date.now() - queueStartedAt : 0
    }
  })

  // ── Hosted Server Manager ──

  ipcMain.handle('hostedServer:list', async () => {
    return serverManagerService.listServers()
  })

  ipcMain.handle('hostedServer:create', async (_event, partial?: Partial<HostedServerConfig>) => {
    const appConfig = configService.get()
    return serverManagerService.createServer(partial, appConfig.defaultPorts)
  })

  ipcMain.handle('hostedServer:update', async (_event, id: string, partial: Partial<HostedServerConfig>) => {
    // If map changed, auto-deploy mod map zip to server Resources/Client/
    if (partial.map) {
      try {
        const mapName = partial.map.replace(/^\/levels\//, '').replace(/\/info\.json$/, '')
        const config = configService.get()
        const userDir = config.gamePaths?.userDir
        if (userDir) {
          const mods = await modManagerService.listMods(userDir)
          const mapMod = mods.find(
            (m) => m.modType === 'terrain' && m.enabled && m.title === mapName
          )
          if (mapMod?.filePath) {
            // Remove any previously deployed map mods (terrain zips) from this server
            const deployed = await serverManagerService.getDeployedMods(id)
            for (const existingMod of deployed) {
              // Check if this deployed mod is a terrain mod
              const terrainMod = mods.find(
                (m) =>
                  m.modType === 'terrain' &&
                  m.filePath &&
                  basename(m.filePath).toLowerCase() === existingMod
              )
              if (terrainMod) {
                await serverManagerService.undeployMod(id, existingMod)
              }
            }
            // Copy the new map mod
            await serverManagerService.copyModToServer(id, mapMod.filePath)
          }
        }
      } catch (err) {
        console.error('[hostedServer:update] Failed to auto-deploy map mod:', err)
      }
    }
    return serverManagerService.updateServer(id, partial)
  })

  ipcMain.handle('hostedServer:delete', async (_event, id: string) => {
    return serverManagerService.deleteServer(id)
  })

  ipcMain.handle('hostedServer:start', async (_event, id: string) => {
    return serverManagerService.startServer(id)
  })

  ipcMain.handle('hostedServer:stop', async (_event, id: string) => {
    serverManagerService.stopServer(id)
    analyticsService.endAllSessions(id).catch(() => {})
    return { success: true }
  })

  ipcMain.handle('hostedServer:restart', async (_event, id: string) => {
    return serverManagerService.restartServer(id)
  })

  ipcMain.handle('hostedServer:getConsole', async (_event, id: string) => {
    return serverManagerService.getConsole(id)
  })

  ipcMain.handle('hostedServer:sendCommand', async (_event, id: string, command: string) => {
    serverManagerService.sendCommand(id, command)
  })

  ipcMain.handle('hostedServer:getExeStatus', async () => {
    return serverManagerService.getExeStatus()
  })

  ipcMain.handle('hostedServer:downloadExe', async () => {
    return serverManagerService.downloadExe()
  })

  ipcMain.handle('hostedServer:installExe', async (_event, sourcePath: string) => {
    return serverManagerService.installExeFromPath(sourcePath)
  })

  ipcMain.handle('hostedServer:browseExe', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Locate BeamMP-Server executable',
      filters: process.platform === 'win32'
        ? [{ name: 'BeamMP-Server', extensions: ['exe'] }]
        : [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return serverManagerService.installExeFromPath(result.filePaths[0])
  })

  // ── Server File Manager ──

  ipcMain.handle('hostedServer:deployedMods', async (_event, id: string) => {
    return serverManagerService.getDeployedMods(id)
  })

  ipcMain.handle('hostedServer:undeployMod', async (_event, id: string, modFileName: string) => {
    await serverManagerService.undeployMod(id, modFileName)
  })

  ipcMain.handle(
    'hostedServer:getServersWithMod',
    async (_event, modFileName: string) => {
      return serverManagerService.getServersWithMod(modFileName)
    }
  )

  ipcMain.handle('hostedServer:listFiles', async (_event, id: string, subPath?: string) => {
    return serverManagerService.listServerFiles(id, subPath ?? '')
  })

  ipcMain.handle('hostedServer:deleteFile', async (_event, id: string, filePath: string) => {
    return serverManagerService.deleteServerFile(id, filePath)
  })

  ipcMain.handle('hostedServer:createFolder', async (_event, id: string, folderPath: string) => {
    return serverManagerService.createServerFolder(id, folderPath)
  })

  ipcMain.handle('hostedServer:copyMod', async (_event, id: string, modFilePath: string) => {
    // Check if this mod is tracked by the registry with server components
    const installed = registryService.getInstalled()
    const registryEntry = Object.values(installed).find((entry) => {
      return entry.installed_files?.some((f) => {
        const normF = f.replace(/\\/g, '/').toLowerCase()
        const normMod = modFilePath.replace(/\\/g, '/').toLowerCase()
        return normF === normMod || normF.endsWith('/' + normMod.split('/').pop()?.toLowerCase())
      })
    })

    const scope = registryEntry?.metadata?.multiplayer_scope
    const result = await serverManagerService.copyModToServer(id, modFilePath)

    // If the mod has server components, also deploy the server plugin
    if (scope === 'both' || scope === 'server') {
      const meta = registryEntry!.metadata
      const serverDir = serverManagerService.getServerDir(id)

      // Check if the original download had a Resources/Server/ layout
      // by looking for server files in the installed_files list
      const serverFiles = registryEntry!.installed_files?.filter((f) =>
        f.replace(/\\/g, '/').includes('/Resources/Server/')
      )

      if (serverFiles && serverFiles.length > 0) {
        // Server files were already extracted — copy them to this server
        for (const sf of serverFiles) {
          const idx = sf.replace(/\\/g, '/').indexOf('/Resources/Server/')
          if (idx >= 0) {
            const relPath = sf.substring(idx + 1) // "Resources/Server/<id>/file"
            const destPath = join(serverDir, relPath)
            const destDir = join(destPath, '..')
            if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
            if (existsSync(sf)) await copyFile(sf, destPath)
          }
        }
      } else if (meta.download) {
        // Re-download and extract server component from outer-zip layout
        try {
          await registryService.installServerComponentToServer(meta, serverDir)
        } catch (err) {
          console.warn('[CopyMod] Failed to install server component:', err)
        }
      }
    }

    return result
  })

  ipcMain.handle('hostedServer:addFiles', async (_event, id: string, destSubPath: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return []
    const result = await dialog.showOpenDialog(win, {
      title: 'Add files to server',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    const added: string[] = []
    for (const fpath of result.filePaths) {
      const fname = fpath.split(/[\\/]/).pop()!
      const dest = destSubPath ? `${destSubPath}/${fname}` : fname
      await serverManagerService.addFileToServer(id, fpath, dest)
      added.push(dest)
    }
    return added
  })

  ipcMain.handle('hostedServer:readFile', async (_event, id: string, filePath: string) => {
    return serverManagerService.readServerFile(id, filePath)
  })

  ipcMain.handle('hostedServer:writeFile', async (_event, id: string, filePath: string, content: string) => {
    return serverManagerService.writeServerFile(id, filePath, content)
  })

  ipcMain.handle('hostedServer:extractZip', async (_event, id: string, zipPath: string) => {
    const count = await serverManagerService.extractZip(id, zipPath)
    return { success: true, extracted: count }
  })

  // Test if a port is reachable from the outside using a public port-check service
  ipcMain.handle('hostedServer:testPort', async (_event, port: number): Promise<{ open: boolean; ip?: string; error?: string }> => {
    try {
      // Use a public API to check if the port is reachable
      const result = await new Promise<{ open: boolean; ip?: string; error?: string }>((resolve) => {
        const url = `https://portchecker.io/api/v1/query`
        const postData = JSON.stringify({ host: '0.0.0.0', ports: [port] })
        const req = httpsRequest(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'BeamMP-ContentManager'
          }
        }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString())
              const portResult = body[port]
              resolve({
                open: portResult === true,
                ip: body.ip || undefined
              })
            } catch {
              resolve({ open: false, error: 'Failed to parse response' })
            }
          })
          res.on('error', () => resolve({ open: false, error: 'Network error' }))
        })
        req.on('error', () => resolve({ open: false, error: 'Network error' }))
        req.setTimeout(10000, () => {
          req.destroy()
          resolve({ open: false, error: 'Timeout' })
        })
        req.write(postData)
        req.end()
      })
      return result
    } catch {
      // Fallback: just try to detect public IP via a simple API
      try {
        const ipResult = await new Promise<string>((resolve, reject) => {
          httpsGet('https://api.ipify.org', (res) => {
            const chunks: Buffer[] = []
            res.on('data', (c: Buffer) => chunks.push(c))
            res.on('end', () => resolve(Buffer.concat(chunks).toString().trim()))
            res.on('error', reject)
          }).on('error', reject)
        })
        // Try TCP connect to our own public IP
        return await new Promise<{ open: boolean; ip?: string; error?: string }>((resolve) => {
          const sock = new net.Socket()
          sock.setTimeout(5000)
          sock.connect(port, ipResult, () => {
            sock.destroy()
            resolve({ open: true, ip: ipResult })
          })
          sock.on('error', () => {
            sock.destroy()
            resolve({ open: false, ip: ipResult })
          })
          sock.on('timeout', () => {
            sock.destroy()
            resolve({ open: false, ip: ipResult })
          })
        })
      } catch {
        return { open: false, error: 'Could not determine public IP' }
      }
    }
  })

  // Save a custom image for a server instance
  ipcMain.handle('hostedServer:saveCustomImage', async (_event, id: string, dataUrl: string): Promise<string> => {
    const serverDir = serverManagerService.getServerDir(id)
    // Extract mime type and data
    const match = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/)
    if (!match) throw new Error('Invalid image data')
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const buffer = Buffer.from(match[2], 'base64')
    // Delete any existing custom-banner files (different extensions)
    for (const oldExt of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      try { await unlink(join(serverDir, `custom-banner.${oldExt}`)) } catch { /* ignore */ }
    }
    const imagePath = join(serverDir, `custom-banner.${ext}`)
    await writeFile(imagePath, buffer)
    // Update server.json with the image filename
    await serverManagerService.updateServer(id, { customImage: `custom-banner.${ext}` } as Partial<HostedServerConfig>)
    // Return data URL back for immediate display
    return dataUrl
  })

  // Remove custom image for a server instance
  ipcMain.handle('hostedServer:removeCustomImage', async (_event, id: string): Promise<void> => {
    const config = await serverManagerService.getServerConfig(id)
    if (config?.customImage) {
      const serverDir = serverManagerService.getServerDir(id)
      const imagePath = join(serverDir, config.customImage)
      try { await unlink(imagePath) } catch { /* ignore if already gone */ }
      await serverManagerService.updateServer(id, { customImage: undefined } as Partial<HostedServerConfig>)
    }
  })

  // Load custom image for a server instance (returns data URL or null)
  ipcMain.handle('hostedServer:getCustomImage', async (_event, id: string): Promise<string | null> => {
    const config = await serverManagerService.getServerConfig(id)
    if (!config?.customImage) return null
    const serverDir = serverManagerService.getServerDir(id)
    let imagePath = join(serverDir, config.customImage)

    // If the stored filename has no extension, try common image extensions
    if (!existsSync(imagePath)) {
      const exts = ['jpg', 'jpeg', 'png', 'webp', 'gif']
      for (const ext of exts) {
        const candidate = `${imagePath}.${ext}`
        if (existsSync(candidate)) {
          imagePath = candidate
          // Fix the stored config to include the extension
          await serverManagerService.updateServer(id, { customImage: `${config.customImage}.${ext}` } as Partial<HostedServerConfig>)
          break
        }
      }
    }

    try {
      const buffer = await readFile(imagePath)
      const ext = imagePath.split('.').pop()?.toLowerCase() || 'jpg'
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  })

  // ── GPS Routes & Player Positions ──

  ipcMain.handle('hostedServer:getRoutes', async (_event, id: string) => {
    return serverManagerService.getRoutes(id)
  })

  ipcMain.handle('hostedServer:saveRoute', async (_event, id: string, route: GPSRoute) => {
    return serverManagerService.saveRoute(id, route)
  })

  ipcMain.handle('hostedServer:deleteRoute', async (_event, id: string, routeId: string) => {
    return serverManagerService.deleteRoute(id, routeId)
  })

  ipcMain.handle('hostedServer:getPlayerPositions', async (_event, id: string) => {
    const positions = await serverManagerService.getPlayerPositions(id)
    // Feed player names into analytics tracking
    const names = [...new Set(positions.map((p: { playerName?: string }) => p.playerName).filter(Boolean))] as string[]
    if (names.length > 0) {
      analyticsService.updatePlayers(id, names).catch(() => {})
    }
    return positions
  })

  ipcMain.handle('hostedServer:deployTracker', async (_event, id: string) => {
    return serverManagerService.deployTrackerPlugin(id)
  })

  // ── Backup Schedule ──

  ipcMain.handle('hostedServer:getSchedule', async (_event, id: string) => {
    return backupSchedulerService.getSchedule(id)
  })

  ipcMain.handle('hostedServer:saveSchedule', async (_event, id: string, schedule: Record<string, unknown>) => {
    return backupSchedulerService.saveSchedule(id, schedule)
  })

  ipcMain.handle('hostedServer:createBackup', async (_event, id: string) => {
    return backupSchedulerService.createBackup(id)
  })

  ipcMain.handle('hostedServer:listBackups', async (_event, id: string) => {
    return backupSchedulerService.listBackups(id)
  })

  ipcMain.handle('hostedServer:deleteBackup', async (_event, id: string, filename: string) => {
    return backupSchedulerService.deleteBackup(id, filename)
  })

  ipcMain.handle('hostedServer:restoreBackup', async (_event, id: string, filename: string) => {
    return backupSchedulerService.restoreBackup(id, filename)
  })

  // ── Scheduled Tasks ──

  ipcMain.handle('hostedServer:getTasks', async (_event, id: string) => {
    return taskSchedulerService.getTasks(id)
  })

  ipcMain.handle('hostedServer:saveTask', async (_event, id: string, task: ScheduledTask) => {
    return taskSchedulerService.saveTask(id, task)
  })

  ipcMain.handle('hostedServer:createTask', async (_event, id: string, task: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'lastResult'>) => {
    return taskSchedulerService.createTask(id, task)
  })

  ipcMain.handle('hostedServer:deleteTask', async (_event, id: string, taskId: string) => {
    return taskSchedulerService.deleteTask(id, taskId)
  })

  ipcMain.handle('hostedServer:runTaskNow', async (_event, id: string, taskId: string) => {
    return taskSchedulerService.runTaskNow(id, taskId)
  })

  // ── Analytics ──

  ipcMain.handle('hostedServer:getAnalytics', async (_event, id: string) => {
    return analyticsService.getAnalytics(id)
  })

  ipcMain.handle('hostedServer:clearAnalytics', async (_event, id: string) => {
    return analyticsService.clearAnalytics(id)
  })

  ipcMain.handle('hostedServer:updatePlayerTracking', async (_event, id: string, playerNames: string[]) => {
    return analyticsService.updatePlayers(id, playerNames)
  })

  ipcMain.handle('hostedServer:endAllSessions', async (_event, id: string) => {
    return analyticsService.endAllSessions(id)
  })

  // ── Mod Registry ──

  ipcMain.handle('registry:getStatus', async () => {
    return registryService.getStatus()
  })

  ipcMain.handle('registry:updateIndex', async () => {
    return registryService.updateIndex()
  })

  ipcMain.handle('registry:search', async (_event, options: RegistrySearchOptions) => {
    return registryService.search(options)
  })

  ipcMain.handle('registry:getMod', async (_event, identifier: string) => {
    return registryService.getMod(identifier)
  })

  ipcMain.handle('registry:getUpdatesAvailable', async () => {
    return registryService.getUpdatesAvailable()
  })

  ipcMain.handle('registry:getInstalled', async () => {
    return registryService.getInstalled()
  })

  ipcMain.handle('registry:resolve', async (_event, identifiers: string[]) => {
    const mods: BeamModMetadata[] = []
    const gameVersion = configService.get().gamePaths.gameVersion ?? undefined
    for (const id of identifiers) {
      const meta = registryService.getLatestCompatible(id, gameVersion)
      if (meta) mods.push(meta)
    }
    const resolver = new DependencyResolver(registryService)
    return resolver.resolve(mods)
  })

  ipcMain.handle('registry:checkReverseDeps', async (_event, identifiers: string[]) => {
    const resolver = new DependencyResolver(registryService)
    return resolver.findReverseDependencies(identifiers)
  })

  ipcMain.handle('registry:install', async (_event, identifiers: string[], targetServerId?: string) => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }

    // Resolve server directory if a target server is specified
    const serverDir = targetServerId
      ? serverManagerService.getServerDir(targetServerId)
      : undefined

    const gameVersion = config.gamePaths.gameVersion ?? undefined
    const mods: BeamModMetadata[] = []
    for (const id of identifiers) {
      const meta = registryService.getLatestCompatible(id, gameVersion)
      if (meta) mods.push(meta)
    }

    // Resolve full dependency tree
    const resolver = new DependencyResolver(registryService)
    const resolution = resolver.resolve(mods)
    if (!resolution.success) {
      return { success: false, error: resolution.errors.join('; '), resolution }
    }

    // Install each mod in dependency order
    const installed: string[] = []
    const errors: string[] = []
    for (const mod of resolution.to_install) {
      if (registryService.isInstalled(mod.identifier)) continue
      const isAuto = !identifiers.includes(mod.identifier)
      const result = await registryService.installFromRegistry(mod, userDir, isAuto, serverDir)
      if (result.success) {
        installed.push(mod.identifier)
      } else {
        errors.push(`${mod.identifier}: ${result.error}`)
      }
    }

    vehicleListCache = null
    if (errors.length > 0) {
      return { success: false, error: errors.join('; '), installed }
    }
    return { success: true, installed }
  })

  ipcMain.handle('registry:trackInstall', async (
    _event,
    metadata: BeamModMetadata,
    installedFiles: string[],
    source: InstalledRegistryMod['install_source'],
    autoInstalled: boolean
  ) => {
    return registryService.trackInstall(metadata, installedFiles, source, autoInstalled)
  })

  ipcMain.handle('registry:trackRemoval', async (_event, identifier: string) => {
    return registryService.trackRemoval(identifier)
  })

  ipcMain.handle('registry:getRepositories', async () => {
    return registryService.getRepositories()
  })

  ipcMain.handle('registry:setRepositories', async (_event, repos: RegistryRepository[]) => {
    return registryService.setRepositories(repos)
  })

  // Modpack export/import
  ipcMain.handle('registry:exportModpack', async (_event, name: string) => {
    return registryService.exportModpack(name)
  })

  ipcMain.handle('registry:importModpack', async (_event, modpackJson: string) => {
    try {
      const modpack = JSON.parse(modpackJson)
      return registryService.importModpack(modpack)
    } catch (err) {
      return { identifiers: [], missing: [], error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Supporters lookup
  ipcMain.handle('registry:getSupporters', async (_event, identifier: string) => {
    const resolver = new DependencyResolver(registryService)
    return resolver.findSupporters(identifier)
  })

  // News feed – cached for 1 hour
  let newsFeedCache: {
    items: Array<{ id: string; source: 'steam' | 'beammp'; title: string; url: string; date: number; summary: string }>
    fetchedAt: number
  } | null = null
  const NEWS_CACHE_TTL = 60 * 60 * 1000 // 1 hour in ms

  ipcMain.handle('news:getFeed', async () => {
    if (newsFeedCache && Date.now() - newsFeedCache.fetchedAt < NEWS_CACHE_TTL) {
      return newsFeedCache.items
    }

    const items: Array<{
      id: string
      source: 'steam' | 'beammp'
      title: string
      url: string
      date: number
      summary: string
    }> = []

    let steamOk = false
    let beammpOk = false

    // Fetch BeamNG.drive Steam news via RSS feed
    try {
      const steamRes = await fetch('https://store.steampowered.com/feeds/news/app/284160')
      if (steamRes.ok) {
        const xml = await steamRes.text()
        // Simple XML parsing for RSS items
        const itemRegex = /<item>([\s\S]*?)<\/item>/g
        let match: RegExpExecArray | null
        let count = 0
        while ((match = itemRegex.exec(xml)) !== null && count < 2) {
          const block = match[1]
          const title = block.match(/<title>(.*?)<\/title>/)?.[1] ?? ''
          const link = block.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/)?.[1]
            ?? block.match(/<link>(.*?)<\/link>/)?.[1] ?? ''
          const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? ''
          const desc = block.match(/<description>(.*?)<\/description>/s)?.[1] ?? ''
          // Strip HTML tags and CDATA for summary
          const summary = desc
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/<[^>]+>/g, '')
            .trim()
            .slice(0, 200)
          if (title) {
            items.push({
              id: `steam-${count}`,
              source: 'steam',
              title,
              url: link,
              date: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0,
              summary
            })
            count++
          }
        }
        steamOk = true
      }
    } catch { /* network error, skip */ }

    // Fetch BeamMP GitHub releases
    try {
      const ghRes = await fetch(
        'https://api.github.com/repos/BeamMP/BeamMP-Launcher/releases?per_page=2',
        { headers: { 'User-Agent': 'BeamMP-ContentManager', Accept: 'application/vnd.github+json' } }
      )
      if (ghRes.ok) {
        const releases = (await ghRes.json()) as Array<{
          id: number
          name: string
          html_url: string
          published_at: string
          body: string
        }>
        for (const rel of releases) {
          items.push({
            id: `gh-${rel.id}`,
            source: 'beammp',
            title: rel.name || 'BeamMP Release',
            url: rel.html_url,
            date: Math.floor(new Date(rel.published_at).getTime() / 1000),
            summary: (rel.body || '').slice(0, 200).replace(/[#*_\r]/g, '').trim()
          })
        }
        beammpOk = true
      }
    } catch { /* network error, skip */ }

    // Sort newest first
    items.sort((a, b) => b.date - a.date)

    // Only cache when both sources fetched successfully; otherwise retry next time
    if (steamOk && beammpOk) {
      newsFeedCache = { items, fetchedAt: Date.now() }
    }

    return items
  })

  // ── Tailscale ──

  ipcMain.handle('tailscale:getStatus', async () => {
    return tailscaleService.getStatus()
  })

  // ── Friends ──

  ipcMain.handle('friends:getAll', async () => {
    return configService.getFriends()
  })

  ipcMain.handle('friends:add', async (_event, id: string, displayName: string) => {
    return configService.addFriend(id, displayName)
  })

  ipcMain.handle('friends:remove', async (_event, id: string) => {
    return configService.removeFriend(id)
  })

  ipcMain.handle('friends:update', async (_event, id: string, updates: { displayName?: string; notes?: string; tags?: string[] }) => {
    return configService.updateFriend(id, updates)
  })

  ipcMain.handle('friends:getSessions', async () => {
    return configService.getSessions()
  })

  ipcMain.handle('friends:recordSession', async (_event, serverIdent: string, serverName: string, players: string[]) => {
    return configService.recordSession(serverIdent, serverName, players)
  })

  // ── Career Save Management ──
  const careerSaveService = new CareerSaveService(configService)

  ipcMain.handle('career:listProfiles', async () => {
    return careerSaveService.listProfiles()
  })

  ipcMain.handle('career:getSlotMetadata', async (_event, profileName: string, slotName: string) => {
    return careerSaveService.getSlotMetadata(profileName, slotName)
  })

  ipcMain.handle('career:getCareerLog', async (_event, profileName: string) => {
    return careerSaveService.getCareerLog(profileName)
  })

  ipcMain.handle('career:deployProfile', async (_event, profileName: string) => {
    return careerSaveService.deployProfile(profileName)
  })

  ipcMain.handle('career:undeployProfile', async (_event, profileName: string) => {
    return careerSaveService.undeployProfile(profileName)
  })

  ipcMain.handle('career:backupSlot', async (_event, profileName: string, slotName: string) => {
    return careerSaveService.backupSlot(profileName, slotName)
  })

  ipcMain.handle('career:backupProfile', async (_event, profileName: string) => {
    return careerSaveService.backupProfile(profileName)
  })

  ipcMain.handle('career:listProfileBackups', async (_event, profileName?: string) => {
    return careerSaveService.listProfileBackups(profileName)
  })

  ipcMain.handle('career:restoreProfileBackup', async (_event, backupName: string) => {
    return careerSaveService.restoreProfileBackup(backupName)
  })

  ipcMain.handle('career:deleteProfileBackup', async (_event, backupName: string) => {
    return careerSaveService.deleteProfileBackup(backupName)
  })

  ipcMain.handle('career:setSavePath', async (_event, savePath: string | null) => {
    if (savePath && !existsSync(savePath)) {
      return { success: false, error: 'Directory does not exist' }
    }
    await configService.update({ careerSavePath: savePath } as Partial<AppConfig>)
    return { success: true }
  })

  ipcMain.handle('career:browseSavePath', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Select CareerMP Saves Folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('career:getSavePath', async () => {
    return careerSaveService.getResolvedSavesDir()
  })
}
