import { ipcMain, BrowserWindow, app, shell, dialog, session, nativeImage } from 'electron'
import { readFile, writeFile, mkdir, access, readdir, unlink, rename as fsRename, stat, copyFile } from 'node:fs/promises'
import { existsSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import net from 'node:net'
import { get as httpsGet, request as httpsRequest } from 'node:https'
import { PNG } from 'pngjs'
import {
  readFirstMatch, readFirstMatchWithName, readMultiple, forEachMatch
} from '../utils/archiveConverter'
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
import { CareerModService } from '../services/CareerModService'
import { CareerPluginService } from '../services/CareerPluginService'
import { LoadOrderService } from '../services/LoadOrderService'
import { ConflictDetectionService } from '../services/ConflictDetectionService'
import { InputBindingsService } from '../services/InputBindingsService'
import { VoiceChatService } from '../services/VoiceChatService'
import { VoiceMeshService } from '../services/VoiceMeshService'
import { LuaConsoleService, type LuaScope } from '../services/LuaConsoleService'
import { BeamUIFilesService } from '../services/BeamUIFilesService'
import { EditorSyncSessionController, type SessionStatus } from '../services/EditorSyncSessionController'
import type { SessionProjectInfo } from '../services/EditorSyncSessionController'
import { WorldSaveService } from '../services/WorldSaveService'
import { convertProjectZipToWorld, convertWorldToProjectZip } from '../services/WorldProjectConverter'
import { setPresence as setDiscordPresence } from '../services/DiscordRPCService'
import { parseBeamNGJson } from '../utils/parseBeamNGJson'
import { LRUCache } from '../utils/lruCache'
import type { AppConfig, GamePaths, ServerInfo, RepoSortOrder, VehicleDetail, VehicleConfigInfo, VehicleConfigData, VehicleEditorData, SlotInfo, VariableInfo, WheelPlacement, ActiveMeshResult, HostedServerConfig, GPSRoute, ScheduledTask, MapRichMetadata } from '../../shared/types'
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
let loadOrderService: LoadOrderService
let conflictDetectionService: ConflictDetectionService
let inputBindingsService: InputBindingsService
let voiceChatService: VoiceChatService
let voiceMeshService: VoiceMeshService
let luaConsoleService: LuaConsoleService
let beamUIFilesService: BeamUIFilesService
let careerSaveService: CareerSaveService
let editorSession: EditorSyncSessionController
let worldSaveService: WorldSaveService

// ── Server ↔ career-save tracking state ──
// On join we snapshot the most-recent lastSaved per deployed profile.
// On disconnect we compare — only profiles whose saves actually changed get associated.
let serverSessionSnapshot: {
  serverIdent: string
  serverName: string | null
  /** profileName → newest lastSaved ISO string at the moment of join */
  timestamps: Record<string, string | null>
} | null = null

export function initializeServices(): {
  config: ConfigService
  discovery: GameDiscoveryService
  launcher: GameLauncherService
  backend: BackendApiService
  modManager: ModManagerService
  serverManager: ServerManagerService
  modManagerService: ModManagerService
} {
  discoveryService = new GameDiscoveryService()
  launcherService = new GameLauncherService()
  launcherService.setBackendUrlResolver(() => {
    const cfg = configService.get()
    return cfg.useOfficialBackend ? 'https://backend.beammp.com' : cfg.backendUrl
  })
  launcherService.setAuthUrlResolver(() => {
    const cfg = configService.get()
    return cfg.useOfficialBackend ? 'https://auth.beammp.com' : cfg.authUrl
  })
  launcherService.setWorldEditSyncTier4Resolver(() => {
    return configService.get().worldEditSync.tier4
  })
  configService = new ConfigService()
  backendService = new BackendApiService()
  modManagerService = new ModManagerService()
  repoService = new BeamNGRepoService()
  serverManagerService = new ServerManagerService()
  serverManagerService.setCustomExeResolver(() => configService.get().customServerExe ?? null)
  backupSchedulerService = new BackupSchedulerService()
  taskSchedulerService = new TaskSchedulerService()
  taskSchedulerService.setDependencies(serverManagerService, backupSchedulerService)
  analyticsService = new AnalyticsService()
  registryService = new RegistryService()
  tailscaleService = new TailscaleService()
  loadOrderService = new LoadOrderService()
  conflictDetectionService = new ConflictDetectionService()
  inputBindingsService = new InputBindingsService()
  voiceChatService = new VoiceChatService()
  voiceMeshService = new VoiceMeshService()
  luaConsoleService = new LuaConsoleService()
  beamUIFilesService = new BeamUIFilesService()
  registryService.setModManager(modManagerService)

  // World-editor collaborative session controller. Hooks into the
  // GameLauncher's editor bridge and exposes host/join/leave to the renderer.
  editorSession = new EditorSyncSessionController(launcherService)
  // Tier 4 Phase 3: let the controller enumerate the joiner's local mod
  // library when it needs to diff against `welcome.mods`. Resolves userDir
  // lazily so a config change between sessions is picked up automatically.
  editorSession.setModEnumerator(async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return []
    try {
      return await modManagerService.listMods(userDir)
    } catch {
      return []
    }
  })
  editorSession.setUserDirResolver(() => configService.get().gamePaths?.userDir ?? null)
  // Tier 4 Phase 3 #21: configurable confirm threshold for mod downloads.
  editorSession.setModSyncThresholdResolver(
    () => configService.get().worldEditSync?.modSync?.confirmThresholdBytes ?? 500 * 1024 * 1024,
  )
  editorSession.on('statusChanged', (st: SessionStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:status', st)
    }
    // Mirror the session into Discord Rich Presence so friends can see what
    // we're up to. "Editing worlds with Friends" is the marketed phrase.
    try {
      if (st.state === 'hosting' || st.state === 'joined') {
        const peerCount = (st.peers?.length ?? 0) + 1 // +1 for self
        const role = st.state === 'hosting' ? 'Hosting' : 'Joined'
        const where = st.levelName ? ` · ${st.levelName.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')}` : ''
        setDiscordPresence({
          details: 'Editing worlds with Friends',
          state: `${role}${where} · ${peerCount} player${peerCount === 1 ? '' : 's'}`,
        })
      } else if (st.state === 'connecting') {
        setDiscordPresence({
          details: 'Editing worlds with Friends',
          state: 'Connecting…',
        })
      } else {
        // idle — fall back to the generic browsing label
        setDiscordPresence({ details: 'Browsing content', state: 'Home' })
      }
    } catch {
      /* discord unavailable, ignore */
    }
  })
  editorSession.on('opBroadcast', (op) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:op', op)
    }
  })
  editorSession.on('log', (entry) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:log', entry)
    }
  })
  editorSession.on('peerPose', (pose) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:peerPose', pose)
    }
  })
  editorSession.on('peerActivity', (act) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:peerActivity', act)
    }
  })
  editorSession.on('peerPendingApproval', (p) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:peerPendingApproval', p)
    }
  })
  editorSession.on('levelRequired', (info) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:levelRequired', info)
    }
  })
  editorSession.on('projectOffered', (info) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('worldEdit:session:projectOffered', info)
    }
  })
  editorSession.on('error', (err) => {
    console.warn('[EditorSession]', err.message)
  })

  // §E.7 — World save/load orchestrator. The `resolveModZip` callback
  // walks the user's installed mod library to find the on-disk zip for
  // any modId the writer is asked to embed. We resolve lazily (on every
  // call) rather than caching, so a mid-session install picks up new
  // mods without rebuilding the service.
  worldSaveService = new WorldSaveService(launcherService, editorSession, async (modId) => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return null
    try {
      const mods = await modManagerService.listMods(userDir)
      const hit = mods.find((m) => m.key === modId)
      return hit?.filePath ?? null
    } catch {
      return null
    }
  })

  // Auto-deploy/undeploy voice bridge on server join/leave.
  // Always re-run deployBridge on relay-true so the embedded Lua source
  // overwrites any stale beamcmVoice.lua left over from an older CM build.
  // (The on-disk file from a previous install can lack _G.BeamCMVoice,
  // worldReady gating, retry loop, vc_audio handler, etc., which silently
  // breaks both the in-game overlay and vc_enable delivery.)
  launcherService.setOnRelayStateChange((inRelay) => {
    const cfg = configService.get()
    if (!cfg.voiceChat.enabled) return
    const userDir = cfg.gamePaths.userDir
    if (!userDir) return
    if (inRelay) {
      voiceChatService.deployBridge(userDir)
    }
    // Notify renderer so it can auto-init/teardown WebRTC stack.
    // The renderer will then call window.api.voiceEnable() which starts the
    // main-side service (file-based bridge), keeping both sides in lock-step.
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      try { win.webContents.send('voice:relayState', { inRelay }) } catch { /* ignore */ }
    }
  })

  // Auto-undeploy every CM-owned BeamNG extension when the game exits, so
  // the userDir is left clean and no beamcm*.lua files linger to produce
  // orphan logs / poll signal files when CM is not running. Each service
  // is responsible for removing its own .lua + signal artefacts; the
  // launcher already sweeps its own (bridge, GPS, World Editor Sync).
  launcherService.onGameExit((userDir) => {
    try {
      if (voiceChatService.isDeployed()) {
        void voiceChatService.disable().catch(() => { /* best-effort */ })
        voiceChatService.undeployBridge()
      }
    } catch (err) {
      console.warn('[GameExit] Voice bridge cleanup failed:', err)
    }
    try {
      if (luaConsoleService.isDeployed()) {
        luaConsoleService.undeploy()
      }
    } catch (err) {
      console.warn('[GameExit] Lua console cleanup failed:', err)
    }
    // Notify the renderer so pages that show a "deployed" badge can refresh.
    const wins = BrowserWindow.getAllWindows()
    for (const win of wins) {
      try { win.webContents.send('game:cleanedUp', { userDir }) } catch { /* ignore */ }
    }
  })

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

  // Eagerly REFRESH (not deploy) the voice chat artifacts on startup so
  // embedded source updates propagate without requiring the user to toggle
  // voice off+on. We only overwrite payloads that are already on disk; we
  // never freshly inject anything at app boot, so unused servers / userDirs
  // stay clean until something actually triggers a real deploy:
  //   1. Client bridge Lua at <userDir>/lua/ge/extensions/beamcmVoice.lua
  //      (so a CM update can't leave the previous build's bridge in place)
  //   2. Server plugin + client overlay zip at every managed hosted server
  //      that already has the plugin from a prior session.
  try {
    const cfg = configService.get()
    if (cfg.voiceChat?.enabled) {
      if (cfg.gamePaths?.userDir) {
        const bridgePath = join(cfg.gamePaths.userDir, 'lua', 'ge', 'extensions', 'beamcmVoice.lua')
        if (existsSync(bridgePath)) {
          const r = voiceChatService.deployBridge(cfg.gamePaths.userDir)
          if (!r.success) console.warn('[VoiceChat] Startup bridge refresh failed:', r.error)
        }
      }
      // Refresh server plugin + client overlay only on managed servers that
      // already have the plugin. Servers that have never had voice deployed
      // stay untouched until they're started (see setOnServerStart below).
      serverManagerService
        .listServers()
        .then(async (servers) => {
          for (const s of servers) {
            try {
              const alreadyDeployed = await serverManagerService.isVoicePluginDeployed(s.config.id)
              if (!alreadyDeployed) continue
              const serverDir = serverManagerService.getServerDir(s.config.id)
              await voiceChatService.deployServerPlugin(serverDir, s.config.resourceFolder)
              console.log(`[VoiceChat] Refreshed server plugin + overlay for "${s.config.name}" (${s.config.id})`)
            } catch (err) {
              console.warn(`[VoiceChat] Startup refresh failed for server ${s.config.id}:`, err)
            }
          }
        })
        .catch((err) => console.warn('[VoiceChat] listServers failed during startup refresh:', err))
    }
  } catch (err) {
    console.warn('[VoiceChat] Startup refresh threw:', err)
  }

  // Lazily deploy the voice chat server plugin + client overlay when a
  // managed server is actually started, instead of carpet-bombing every
  // server folder at CM startup. Servers that never run never receive the
  // injected files.
  serverManagerService.setOnServerStart((id, serverDir, resourceFolder) => {
    const cfg = configService.get()
    if (!cfg.voiceChat?.enabled) return
    void voiceChatService.deployServerPlugin(serverDir, resourceFolder)
      .then(() => console.log(`[VoiceChat] Deployed server plugin + overlay for server ${id}`))
      .catch((err) => console.warn(`[VoiceChat] Per-start deploy failed for ${id}:`, err))
  })

  return {
    config: configService,
    discovery: discoveryService,
    launcher: launcherService,
    backend: backendService,
    modManager: modManagerService,
    serverManager: serverManagerService,
    modManagerService
  }
}

/** Read a preview image from a BeamNG level archive (.zip) */
async function readPreviewFromZip(zipPath: string, levelName: string): Promise<string | null> {
  const levelDirPattern = new RegExp(
    `^levels/${levelName}/[^/]*preview[^/]*\\.(?:jpe?g|png)$`, 'i'
  )
  const result = await readFirstMatchWithName(zipPath, levelDirPattern)
  if (!result) return null
  const ext = result.fileName.split('.').pop()?.toLowerCase() || 'jpg'
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${result.data.toString('base64')}`
}

/** Read raw bytes of first file matching a regex from an archive */
function readRawFromZip(zipPath: string, pattern: RegExp): Promise<Buffer | null> {
  return readFirstMatch(zipPath, pattern)
}

/**
 * Read multiple files from an archive in a single pass.
 * Returns a Map of filename → Buffer for each matched file.
 */
function readMultipleFromZip(zipPath: string, fileNames: string[]): Promise<Map<string, Buffer>> {
  return readMultiple(zipPath, fileNames)
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
 * Read all DecalRoad definitions from a level archive.
 * Returns an array of roads, each with nodes [x, y, width] and material.
 */
async function readDecalRoadsFromZip(
  zipPath: string, levelName: string
): Promise<{ nodes: DecalRoadNode[]; material: string }[]> {
  const roads: { nodes: DecalRoadNode[]; material: string }[] = []
  const levelPrefix = `levels/${levelName}/`

  await forEachMatch(
    zipPath,
    (fn) => fn.startsWith(levelPrefix) && /decalroad/i.test(fn) && fn.endsWith('items.level.json'),
    (_fn, data) => {
      try {
        const text = data.toString('utf-8')
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('{')) continue
          try {
            const obj = JSON.parse(trimmed)
            if (obj.class !== 'DecalRoad' || !Array.isArray(obj.nodes)) continue
            const mat = obj.material || ''
            if (SKIP_MATERIAL_RE.test(mat)) continue
            const nodes: DecalRoadNode[] = obj.nodes.map((n: number[]) => ({
              x: n[0], y: n[1], width: n[3] || 3
            }))
            if (nodes.length >= 2 && nodes[0].width >= 2) {
              roads.push({ nodes, material: mat })
            }
          } catch { /* skip malformed lines */ }
        }
      } catch { /* skip parse errors */ }
    }
  )

  return roads
}

/**
 * Read DecalRoad defs for routing — includes road_invisible and other driveable surfaces,
 * but excludes decorative overlays (tire marks, cracks, paint, rubber marks).
 */
async function readRoutableRoadsFromZip(
  zipPath: string, levelName: string
): Promise<{ nodes: DecalRoadNode[]; material: string }[]> {
  const roads: { nodes: DecalRoadNode[]; material: string }[] = []
  const levelPrefix = `levels/${levelName}/`

  await forEachMatch(
    zipPath,
    (fn) => fn.startsWith(levelPrefix) && /decalroad/i.test(fn) && fn.endsWith('items.level.json'),
    (_fn, data) => {
      try {
        const text = data.toString('utf-8')
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('{')) continue
          try {
            const obj = JSON.parse(trimmed)
            if (obj.class !== 'DecalRoad' || !Array.isArray(obj.nodes)) continue
            const mat = obj.material || ''
            if (ROUTE_SKIP_RE.test(mat)) continue
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
    }
  )

  return roads
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
async function readHeightmapFromZip(zipPath: string, levelName: string): Promise<string | null> {
  // Try dedicated heightmap first
  const hm = await readImageFromZip(zipPath, new RegExp(
    `^levels/${levelName}/[^/]*heightmap\\.png$`, 'i'
  ))
  if (hm) return hm
  // Fall back to .ter.depth.png
  return readImageFromZip(zipPath, new RegExp(
    `^levels/${levelName}/[^/]*\\.ter\\.depth\\.png$`, 'i'
  ))
}

/** Read first image matching a regex from an archive, return as data URL */
async function readImageFromZip(zipPath: string, pattern: RegExp): Promise<string | null> {
  const result = await readFirstMatchWithName(zipPath, pattern)
  if (!result) return null
  const ext = result.fileName.split('.').pop()?.toLowerCase() || 'png'
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${result.data.toString('base64')}`
}

/** Read first text file matching a regex from an archive, return as string */
async function readTextFromZip(zipPath: string, pattern: RegExp): Promise<string | null> {
  const result = await readFirstMatch(zipPath, pattern)
  return result ? result.toString('utf-8') : null
}

export function registerIpcHandlers(): void {
  // ── Config ──
  ipcMain.handle('config:get', async (): Promise<AppConfig> => {
    return configService.get()
  })

  ipcMain.handle('config:update', async (_event, partial: Partial<AppConfig>): Promise<AppConfig> => {
    const before = configService.get()
    const after = await configService.update(partial)

    // If voice chat was just disabled, undeploy every CM-injected voice
    // artifact so nothing is left polling / loading on next game launch and
    // managed server folders shed the plugin + client overlay.
    const wasEnabled = !!before.voiceChat?.enabled
    const isEnabled = !!after.voiceChat?.enabled
    if (wasEnabled && !isEnabled) {
      try {
        if (voiceChatService.isDeployed()) {
          await voiceChatService.disable().catch(() => { /* best-effort */ })
          voiceChatService.undeployBridge()
        } else if (after.gamePaths?.userDir) {
          // Bridge may have been written by a previous session even if the
          // service isn't currently "active" — sweep the on-disk artefact
          // directly so it doesn't keep polling on the next game launch.
          try {
            const stalePath = join(after.gamePaths.userDir, 'lua', 'ge', 'extensions', 'beamcmVoice.lua')
            if (existsSync(stalePath)) unlinkSync(stalePath)
          } catch (err) {
            console.warn('[VoiceChat] Stale bridge sweep failed:', err)
          }
        }
      } catch (err) {
        console.warn('[VoiceChat] Bridge undeploy on disable failed:', err)
      }
      try {
        const servers = await serverManagerService.listServers()
        for (const s of servers) {
          try {
            if (await serverManagerService.isVoicePluginDeployed(s.config.id)) {
              await serverManagerService.undeployVoicePlugin(s.config.id)
              console.log(`[VoiceChat] Undeployed server plugin from "${s.config.name}" (${s.config.id}) — voice chat disabled`)
            }
          } catch (err) {
            console.warn(`[VoiceChat] Undeploy failed for ${s.config.id}:`, err)
          }
        }
      } catch (err) {
        console.warn('[VoiceChat] listServers during disable cleanup failed:', err)
      }
    }

    return after
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
    let executable = join(installDir, exeName)
    // Normalize: if the user pointed at the root user folder (e.g. E:\BeamData),
    // descend into the active version subfolder (e.g. E:\BeamData\current) so all
    // downstream path joins (mods/, lua/, settings/) resolve correctly.
    const normalizedUserDir = discoveryService.normalizeUserDir(userDir)
    const gameVersion = await discoveryService.readGameVersion(normalizedUserDir)
    // Detect Proton: on Linux, if the native binary doesn't exist but a .exe does, it's Proton
    let isProton = false
    if (process.platform === 'linux') {
      if (!existsSync(executable)) {
        const protonExe = join(installDir, 'BeamNG.drive.exe')
        if (existsSync(protonExe)) {
          isProton = true
          executable = protonExe
        }
      } else {
        isProton = installDir.includes('steamapps')
      }
    }
    await configService.setGamePaths(installDir, normalizedUserDir, executable, gameVersion, isProton)
    discoveryService.clearCache()
  })

  // ── Game Launcher ──
  ipcMain.handle('game:launch', async (): Promise<{ success: boolean; error?: string }> => {
    const config = configService.get()
    const rendererArgs = config.renderer === 'vulkan' ? ['-gfx', 'vk'] : config.renderer === 'dx11' ? ['-gfx', 'dx11'] : []
    return launcherService.launchGame(config.gamePaths, { args: rendererArgs })
  })

  ipcMain.handle('game:launchVanilla', async (_event, config?: { mode?: string; level?: string; vehicle?: string }): Promise<{ success: boolean; error?: string }> => {
    const appConfig = configService.get()
    const rendererArgs = appConfig.renderer === 'vulkan' ? ['-gfx', 'vk'] : appConfig.renderer === 'dx11' ? ['-gfx', 'dx11'] : []
    return launcherService.launchVanilla(appConfig.gamePaths, config, { args: rendererArgs })
  })

  // ── Support Tools ──

  ipcMain.handle('game:openUserFolder', async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    shell.openPath(userDir)
    return { success: true }
  })

  ipcMain.handle('game:clearCache', async (): Promise<{ success: boolean; error?: string; freedBytes?: number }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }

    const cacheDirs = ['cache', 'temp']
    let freedBytes = 0
    const backupRoot = join(userDir, 'cache_backup_' + Date.now())

    try {
      await mkdir(backupRoot, { recursive: true })
      for (const dirName of cacheDirs) {
        const dirPath = join(userDir, dirName)
        if (!existsSync(dirPath)) continue

        const backupDest = join(backupRoot, dirName)
        try {
          await fsRename(dirPath, backupDest)
          // Estimate freed bytes by walking backup
          const entries = await readdir(backupDest, { recursive: true, withFileTypes: true }).catch(() => [])
          for (const entry of entries) {
            if (entry.isFile()) {
              try {
                const s = await stat(join(entry.parentPath ?? entry.path, entry.name))
                freedBytes += s.size
              } catch { /* skip */ }
            }
          }
        } catch (err) {
          console.warn(`Failed to move ${dirName}: ${err}`)
        }
      }
      return { success: true, freedBytes }
    } catch (err) {
      return { success: false, error: `Failed to clear cache: ${err}` }
    }
  })

  ipcMain.handle('game:clearModCache', async (): Promise<{ success: boolean; error?: string; freedBytes?: number; fileCount?: number }> => {
    // Cached BeamMP mod downloads live in <CM appData>/Resources — separate
    // from BeamNG's cache/temp dirs cleared by game:clearCache.
    const cacheDir = join(app.getPath('userData'), 'Resources')
    if (!existsSync(cacheDir)) return { success: true, freedBytes: 0, fileCount: 0 }
    let freedBytes = 0
    let fileCount = 0
    try {
      const entries = await readdir(cacheDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = join(cacheDir, entry.name)
        try {
          const s = await stat(filePath)
          await unlink(filePath)
          freedBytes += s.size
          fileCount++
        } catch (err) {
          console.warn(`Failed to remove ${entry.name}: ${err}`)
        }
      }
      return { success: true, freedBytes, fileCount }
    } catch (err) {
      return { success: false, error: `Failed to clear mod cache: ${err}` }
    }
  })

  ipcMain.handle('game:launchSafeMode', async (): Promise<{ success: boolean; error?: string }> => {
    const paths = configService.get().gamePaths
    if (!paths?.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }
    // Safe mode: launch with -userpath pointing to a temp empty folder
    const { spawn } = await import('node:child_process')
    const tmpDir = join(app.getPath('temp'), 'BeamNG-SafeMode-' + Date.now())
    await mkdir(tmpDir, { recursive: true })
    // Proton/Wine sees Linux paths via Z: drive — convert for the game process
    const userpath = paths.isProton ? 'Z:' + tmpDir.replace(/\//g, '\\') : tmpDir
    const args = ['-userpath', userpath]
    if (paths.isProton) {
      // Proton: must launch through Steam — direct exe won't work on Linux
      const steamBin = launcherService.findSteamBinaryPublic()
      if (!steamBin) return { success: false, error: 'Steam not found — required to launch via Proton' }
      spawn(steamBin, ['-applaunch', '284160', ...args], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    } else {
      spawn(paths.executable, args, {
        cwd: paths.installDir ?? undefined,
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
    return { success: true }
  })

  ipcMain.handle('game:launchSafeVulkan', async (): Promise<{ success: boolean; error?: string }> => {
    const paths = configService.get().gamePaths
    if (!paths?.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }
    const { spawn } = await import('node:child_process')
    const tmpDir = join(app.getPath('temp'), 'BeamNG-SafeVulkan-' + Date.now())
    await mkdir(tmpDir, { recursive: true })
    const userpath = paths.isProton ? 'Z:' + tmpDir.replace(/\//g, '\\') : tmpDir
    const args = ['-userpath', userpath, '-gfx', 'vk']
    if (paths.isProton) {
      const steamBin = launcherService.findSteamBinaryPublic()
      if (!steamBin) return { success: false, error: 'Steam not found — required to launch via Proton' }
      spawn(steamBin, ['-applaunch', '284160', ...args], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    } else {
      spawn(paths.executable, args, {
        cwd: paths.installDir ?? undefined,
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
    return { success: true }
  })

  ipcMain.handle('game:verifyIntegrity', async (): Promise<{ success: boolean; error?: string }> => {
    // Trigger Steam's verify integrity via the steam:// protocol
    try {
      shell.openExternal('steam://validate/284160')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to trigger integrity check: ${err}` }
    }
  })

  // ── GPS Tracker ──
  ipcMain.handle('gps:deployTracker', async (): Promise<{ success: boolean; error?: string }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.deployGPSTracker(userDir)
  })

  ipcMain.handle('gps:undeployTracker', async (): Promise<{ success: boolean; error?: string }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.undeployGPSTracker(userDir)
  })

  ipcMain.handle('gps:isTrackerDeployed', async (): Promise<boolean> => {
    return launcherService.isGPSTrackerDeployed()
  })

  ipcMain.handle('gps:getTelemetry', async () => {
    return launcherService.getGPSTelemetry()
  })

  // ── World Editor Sync (Phase 0 spike) ──
  //
  // Capture-only extension that wraps editor.history and writes captured
  // actions to settings/BeamCM/we_capture.log. No networking yet — this is
  // the validation gate for the broader design in Project/Docs/WORLD-EDITOR-SYNC.md.

  ipcMain.handle('worldEdit:deploy', async (): Promise<{ success: boolean; error?: string }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.deployEditorSync(userDir)
  })

  ipcMain.handle('worldEdit:undeploy', async (): Promise<{ success: boolean; error?: string }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.undeployEditorSync(userDir)
  })

  ipcMain.handle('worldEdit:isDeployed', async (): Promise<boolean> => {
    return launcherService.isEditorSyncDeployed()
  })

  ipcMain.handle(
    'worldEdit:signal',
    async (
      _event,
      action:
        | 'start'
        | 'stop'
        | 'replay'
        | 'install'
        | 'uninstall'
        | 'undo'
        | 'redo'
        | 'save'
        | 'saveAs'
        | 'saveProject'
        | 'loadProject',
      payload?: { path?: string }
    ): Promise<{ success: boolean; error?: string }> => {
      const userDir = configService.get().gamePaths?.userDir
      if (!userDir) return { success: false, error: 'User data folder not configured' }
      return launcherService.editorSyncSignal(userDir, action, payload)
    }
  )

  ipcMain.handle('worldEdit:getStatus', async () => {
    return launcherService.getEditorSyncStatus()
  })

  ipcMain.handle('worldEdit:readCapture', async (_event, tail?: number) => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { entries: [], total: 0 }
    return launcherService.readEditorSyncCapture(userDir, tail ?? 100)
  })

  ipcMain.handle('worldEdit:listProjects', async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return []
    return launcherService.listEditorProjects(userDir)
  })

  ipcMain.handle(
    'worldEdit:saveProject',
    async (_event, levelName: string, projectName: string) => {
      const userDir = configService.get().gamePaths?.userDir
      if (!userDir) return { success: false, error: 'User data folder not configured' }
      return launcherService.saveEditorProject(userDir, levelName, projectName)
    }
  )

  ipcMain.handle('worldEdit:loadProject', async (_event, levelPath: string) => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.loadEditorProject(userDir, levelPath)
  })

  ipcMain.handle('worldEdit:deleteProject', async (_event, absolutePath: string) => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return launcherService.deleteEditorProject(userDir, absolutePath)
  })

  // ── World Editor Session (Phase 2/3: host + join) ──

  ipcMain.handle('worldEdit:session:getStatus', async () => {
    return editorSession.getStatus()
  })

  ipcMain.handle(
    'worldEdit:session:host',
    async (
      _event,
      opts: {
        port?: number
        token?: string | null
        levelName?: string | null
        displayName?: string
        authMode?: 'open' | 'token' | 'approval' | 'friends'
        friendsWhitelist?: string[]
        advertiseHost?: string | null
        mapModKey?: string | null
      }
    ): Promise<{ success: boolean; error?: string; status?: SessionStatus }> => {
      const userDir = configService.get().gamePaths?.userDir
      if (!userDir) return { success: false, error: 'User data folder not configured' }
      const beamcmDir = join(userDir, 'settings', 'BeamCM')
      try {
        const status = await editorSession.startHost({
          beamcmDir,
          port: opts.port,
          token: opts.token ?? null,
          levelName: opts.levelName ?? null,
          displayName: opts.displayName,
          authMode: opts.authMode,
          friendsWhitelist: opts.friendsWhitelist,
          advertiseHost: opts.advertiseHost ?? null,
          mapModKey: opts.mapModKey ?? null,
        })
        return { success: true, status }
      } catch (err) {
        return { success: false, error: `${err}` }
      }
    }
  )

  ipcMain.handle(
    'worldEdit:session:join',
    async (
      _event,
      opts: { host: string; port: number; token?: string | null; displayName?: string }
    ): Promise<{ success: boolean; error?: string; status?: SessionStatus }> => {
      try {
        const status = await editorSession.startJoin({
          host: opts.host,
          port: opts.port,
          token: opts.token ?? null,
          displayName: opts.displayName,
        })
        return { success: true, status }
      } catch (err) {
        return { success: false, error: `${err}` }
      }
    }
  )

  /**
   * Parse a session code without side effects. Useful for the join UI to
   * preview what's inside before committing to connect.
   */
  ipcMain.handle(
    'worldEdit:session:decodeCode',
    async (_event, code: string): Promise<{
      ok: boolean
      host?: string
      port?: number
      token?: string | null
      level?: string | null
      sessionId?: string | null
      displayName?: string | null
      error?: string
    }> => {
      const { decodeSessionCode } = await import('../../shared/sessionCode')
      const parsed = decodeSessionCode(code)
      if (!parsed) return { ok: false, error: 'Invalid session code' }
      return {
        ok: true,
        host: parsed.host,
        port: parsed.port,
        token: parsed.token,
        level: parsed.level,
        sessionId: parsed.sessionId,
        displayName: parsed.displayName,
      }
    }
  )

  /** One-click: start hosting AND launch BeamNG into the editor. */
  ipcMain.handle(
    'worldEdit:session:hostAndLaunch',
    async (
      _event,
      opts: {
        port?: number
        token?: string | null
        levelName?: string | null
        displayName?: string
        authMode?: 'open' | 'token' | 'approval' | 'friends'
        friendsWhitelist?: string[]
        advertiseHost?: string | null
        mapModKey?: string | null
      }
    ): Promise<{ success: boolean; error?: string; status?: SessionStatus; level?: string }> => {
      const appConfig = configService.get()
      const userDir = appConfig.gamePaths?.userDir
      if (!userDir) return { success: false, error: 'User data folder not configured' }
      const beamcmDir = join(userDir, 'settings', 'BeamCM')
      let status: SessionStatus
      try {
        status = await editorSession.startHost({
          beamcmDir,
          port: opts.port,
          token: opts.token ?? null,
          levelName: opts.levelName ?? null,
          displayName: opts.displayName,
          authMode: opts.authMode,
          friendsWhitelist: opts.friendsWhitelist,
          advertiseHost: opts.advertiseHost ?? null,
          mapModKey: opts.mapModKey ?? null,
        })
      } catch (err) {
        return { success: false, error: `${err}` }
      }
      // Launch BeamNG vanilla + editor autostart signal.
      const prep = editorSession.prepareEditorLaunch({
        userDir,
        levelOverride: opts.levelName ?? null,
      })
      if (prep.error || !prep.level) {
        // Session is up, just couldn't launch — report partial success.
        return { success: true, status, error: prep.error ?? 'No level selected' }
      }
      const rendererArgs =
        appConfig.renderer === 'vulkan' ? ['-gfx', 'vk']
        : appConfig.renderer === 'dx11' ? ['-gfx', 'dx11']
        : []
      const launch = await launcherService.launchVanilla(
        appConfig.gamePaths,
        { mode: 'freeroam', level: prep.level },
        { args: rendererArgs }
      )
      if (!launch.success) {
        return { success: true, status, error: launch.error ?? 'Launch failed', level: prep.level }
      }
      return { success: true, status, level: prep.level }
    }
  )

  /**
   * Parse a session code and start the join. Despite the legacy
   * `joinCodeAndLaunch` channel name, this NO LONGER auto-launches BeamNG —
   * joiners explicitly press "Launch into Editor" when they're ready so we
   * never alt-tab away from whatever they're doing the moment they paste an
   * invite. The `level` field in the response is the host-advertised level
   * the renderer can pass back into `worldEdit:session:launchIntoEditor`.
   */
  ipcMain.handle(
    'worldEdit:session:joinCodeAndLaunch',
    async (
      _event,
      opts: { code: string; displayName?: string }
    ): Promise<{ success: boolean; error?: string; status?: SessionStatus; level?: string }> => {
      const { decodeSessionCode } = await import('../../shared/sessionCode')
      const parsed = decodeSessionCode(opts.code)
      if (!parsed) return { success: false, error: 'Invalid session code' }
      let status: SessionStatus
      try {
        status = await editorSession.startJoin({
          host: parsed.host,
          port: parsed.port,
          token: parsed.token,
          displayName: opts.displayName,
        })
      } catch (err) {
        return { success: false, error: `${err}` }
      }
      // Surface the advertised level so the UI can pre-fill it for the
      // user's manual launch button — but do NOT spawn the game.
      return { success: true, status, level: parsed.level ?? undefined }
    }
  )

  /** Host-only: approve a pending joiner (approval auth mode). */
  ipcMain.handle(
    'worldEdit:session:approvePeer',
    async (_event, authorId: string): Promise<{ success: boolean }> => {
      return { success: editorSession.approvePeer(authorId) }
    }
  )

  /** Host-only: reject a pending joiner (approval auth mode). */
  ipcMain.handle(
    'worldEdit:session:rejectPeer',
    async (_event, opts: { authorId: string; reason?: string }): Promise<{ success: boolean }> => {
      return { success: editorSession.rejectPeer(opts.authorId, opts.reason) }
    }
  )

  /** Host-only: change auth mode at runtime. */
  ipcMain.handle(
    'worldEdit:session:setAuthMode',
    async (_event, mode: 'open' | 'token' | 'approval' | 'friends'): Promise<{ success: boolean }> => {
      return { success: editorSession.setAuthMode(mode) }
    }
  )

  /** Host-only: replace the friends whitelist (BeamMP usernames, case-insensitive). */
  ipcMain.handle(
    'worldEdit:session:setFriendsWhitelist',
    async (_event, usernames: string[]): Promise<{ success: boolean }> => {
      return { success: editorSession.setFriendsWhitelist(usernames) }
    }
  )

  /** Host-only: re-mint session code for a different advertise-host. */
  ipcMain.handle(
    'worldEdit:session:setAdvertiseHost',
    async (_event, host: string): Promise<{ success: boolean }> => {
      editorSession.setAdvertiseHost(host)
      return { success: true }
    }
  )

  ipcMain.handle('worldEdit:session:leave', async () => {
    editorSession.leave()
    return { success: true }
  })

  /**
   * §D undo/redo. Pops the local-author stack, builds an inverse op and
   * broadcasts it (or replays the original on redo). Returns a small
   * status object so the renderer can show the §D first-time toast on
   * the very first successful undo.
   */
  ipcMain.handle(
    'worldEdit:session:undo',
    async (): Promise<{ ok: boolean; reason?: string; name?: string }> => {
      return editorSession.undo()
    }
  )
  ipcMain.handle(
    'worldEdit:session:redo',
    async (): Promise<{ ok: boolean; reason?: string; name?: string }> => {
      return editorSession.redo()
    }
  )
  ipcMain.handle(
    'worldEdit:session:undoDepths',
    async (): Promise<{ undo: number; redo: number }> => {
      return editorSession.getUndoDepths()
    }
  )

  /* ── §E world save / load / convert ─────────────────────────────── */

  /**
   * Save the currently-open world to a `.beamcmworld`. If `destPath`
   * is omitted, opens a save dialog scoped to the user's `Documents`
   * folder. Returns the chosen path, byte size and (lightweight)
   * manifest so the renderer can show a confirmation toast without
   * re-reading the zip.
   */
  ipcMain.handle(
    'worldSave:save',
    async (_event, opts: {
      destPath?: string
      title?: string
      description?: string
      includeOpLog?: boolean
      previewPngPath?: string
      forceBuildSnapshot?: boolean
    } = {}): Promise<
      { success: true; path: string; bytes: number; title: string }
      | { success: false; cancelled?: true; error?: string }
    > => {
      try {
        let dest = opts.destPath ?? null
        if (!dest) {
          const win = BrowserWindow.getFocusedWindow()
          const safeTitle = (opts.title ?? 'world').replace(/[^a-z0-9._-]+/gi, '_')
          const result = await dialog.showSaveDialog(win!, {
            title: 'Save World As',
            defaultPath: `${safeTitle}.beamcmworld`,
            filters: [{ name: 'BeamMP CM World', extensions: ['beamcmworld'] }],
          })
          if (result.canceled || !result.filePath) {
            return { success: false, cancelled: true }
          }
          dest = result.filePath
        }
        const out = await worldSaveService.saveCurrentWorld({
          destPath: dest,
          title: opts.title,
          description: opts.description,
          includeOpLog: opts.includeOpLog ?? false,
          previewPngPath: opts.previewPngPath,
          forceBuildSnapshot: opts.forceBuildSnapshot,
        })
        return { success: true, path: out.path, bytes: out.bytes, title: out.manifest.title }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  /**
   * Inspect a `.beamcmworld` without unpacking. Cheap manifest-only
   * read; safe to call from a file-picker preview.
   */
  ipcMain.handle(
    'worldSave:inspect',
    async (_event, sourcePath?: string): Promise<
      { success: true; manifest: unknown; compressedBytes: number; uncompressedBytes: number; entryCount: number }
      | { success: false; cancelled?: true; error?: string }
    > => {
      try {
        let src = sourcePath ?? null
        if (!src) {
          const win = BrowserWindow.getFocusedWindow()
          const result = await dialog.showOpenDialog(win!, {
            title: 'Open World',
            filters: [{ name: 'BeamMP CM World', extensions: ['beamcmworld'] }],
            properties: ['openFile'],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, cancelled: true }
          }
          src = result.filePaths[0]
        }
        const info = await worldSaveService.inspectWorld(src)
        return {
          success: true,
          manifest: info.manifest,
          compressedBytes: info.compressedBytes,
          uncompressedBytes: info.uncompressedBytes,
          entryCount: info.entryCount,
        }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  /**
   * Load a `.beamcmworld` and stage its mods. Does NOT launch the
   * game — the renderer typically chains this with
   * `worldEdit:session:launchIntoEditor`. Returns the level identity
   * so the caller can pass `levelOverride` on launch.
   */
  ipcMain.handle(
    'worldSave:load',
    async (_event, opts: { sourcePath?: string } = {}): Promise<
      {
        success: true
        levelName: string
        worldId: string
        stagedModsPath: string | null
        modCount: number
        hasSnapshot: boolean
        opLogCount: number
        seededIntoRelay: boolean
      }
      | { success: false; cancelled?: true; error?: string }
    > => {
      try {
        let src = opts.sourcePath ?? null
        if (!src) {
          const win = BrowserWindow.getFocusedWindow()
          const result = await dialog.showOpenDialog(win!, {
            title: 'Load World',
            filters: [{ name: 'BeamMP CM World', extensions: ['beamcmworld'] }],
            properties: ['openFile'],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false, cancelled: true }
          }
          src = result.filePaths[0]
        }
        const userDir = configService.get().gamePaths?.userDir
        if (!userDir) {
          return { success: false, error: 'User data folder not configured' }
        }
        const inspect = await worldSaveService.inspectWorld(src)
        const stagingRoot = join(
          userDir,
          'mods',
          'multiplayer',
          `world-${inspect.manifest.worldId}`,
        )
        const out = await worldSaveService.loadWorld({ sourcePath: src, stagingRoot })
        return {
          success: true,
          levelName: out.levelName,
          worldId: out.worldId,
          stagedModsPath: out.stagedModsPath,
          modCount: out.stagedMods.length,
          hasSnapshot: out.snapshotBytes !== null,
          opLogCount: out.opLogCount,
          seededIntoRelay: out.seededIntoRelay,
        }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  /**
   * §E.6 — wrap an existing CM project zip in a `.beamcmworld` shell.
   * The original zip is embedded verbatim so `worldSave:convertWorldToProject`
   * is a perfect round-trip.
   */
  ipcMain.handle(
    'worldSave:convertProjectToWorld',
    async (_event, opts: {
      sourceProjectZip?: string
      destPath?: string
      levelName: string
      title?: string
      description?: string
      authorId: string
      authorDisplayName: string
      beamngBuild?: string
    }): Promise<
      { success: true; path: string; bytes: number }
      | { success: false; cancelled?: true; error?: string }
    > => {
      try {
        let src = opts.sourceProjectZip ?? null
        if (!src) {
          const win = BrowserWindow.getFocusedWindow()
          const r = await dialog.showOpenDialog(win!, {
            title: 'Select Project Zip',
            filters: [{ name: 'CM Project Zip', extensions: ['zip'] }],
            properties: ['openFile'],
          })
          if (r.canceled || r.filePaths.length === 0) return { success: false, cancelled: true }
          src = r.filePaths[0]
        }
        let dest = opts.destPath ?? null
        if (!dest) {
          const win = BrowserWindow.getFocusedWindow()
          const safe = (opts.title ?? basename(src, '.zip')).replace(/[^a-z0-9._-]+/gi, '_')
          const r = await dialog.showSaveDialog(win!, {
            title: 'Save World As',
            defaultPath: `${safe}.beamcmworld`,
            filters: [{ name: 'BeamMP CM World', extensions: ['beamcmworld'] }],
          })
          if (r.canceled || !r.filePath) return { success: false, cancelled: true }
          dest = r.filePath
        }
        const out = await convertProjectZipToWorld({
          sourceProjectZip: src,
          destPath: dest,
          levelName: opts.levelName,
          title: opts.title,
          description: opts.description,
          authorId: opts.authorId,
          authorDisplayName: opts.authorDisplayName,
          beamngBuild: opts.beamngBuild,
        })
        return { success: true, path: out.path, bytes: out.bytes }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  /**
   * §E.6 — extract the embedded `project.zip` from a `.beamcmworld`
   * back to a standalone project zip. Errors with a clear message if
   * the world wasn't produced by the wrapper above.
   */
  ipcMain.handle(
    'worldSave:convertWorldToProject',
    async (_event, opts: { sourceWorld?: string; destProjectZip?: string } = {}): Promise<
      { success: true; path: string; bytes: number }
      | { success: false; cancelled?: true; error?: string }
    > => {
      try {
        let src = opts.sourceWorld ?? null
        if (!src) {
          const win = BrowserWindow.getFocusedWindow()
          const r = await dialog.showOpenDialog(win!, {
            title: 'Select World',
            filters: [{ name: 'BeamMP CM World', extensions: ['beamcmworld'] }],
            properties: ['openFile'],
          })
          if (r.canceled || r.filePaths.length === 0) return { success: false, cancelled: true }
          src = r.filePaths[0]
        }
        let dest = opts.destProjectZip ?? null
        if (!dest) {
          const win = BrowserWindow.getFocusedWindow()
          const safe = basename(src).replace(/\.beamcmworld$/i, '')
          const r = await dialog.showSaveDialog(win!, {
            title: 'Export Project Zip',
            defaultPath: `${safe}.zip`,
            filters: [{ name: 'CM Project Zip', extensions: ['zip'] }],
          })
          if (r.canceled || !r.filePath) return { success: false, cancelled: true }
          dest = r.filePath
        }
        const out = await convertWorldToProjectZip({ sourceWorld: src, destProjectZip: dest })
        return { success: true, path: out.path, bytes: out.bytes }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    'worldEdit:session:launchIntoEditor',
    async (
      _event,
      opts?: { levelOverride?: string | null }
    ): Promise<{ success: boolean; error?: string; level?: string }> => {
      const appConfig = configService.get()
      const userDir = appConfig.gamePaths?.userDir
      if (!userDir) return { success: false, error: 'User data folder not configured' }
      // Refuse to launch while the host's map mod is still being
      // downloaded — BeamNG would either fail to find the level or
      // silently bounce the player back to the main menu.
      if (editorSession.isModSyncBlocking()) {
        return {
          success: false,
          error: 'Map mod is still downloading from the host — wait for the transfer to finish, then try again.',
        }
      }
      const prep = editorSession.prepareEditorLaunch({
        userDir,
        levelOverride: opts?.levelOverride ?? null,
      })
      if (prep.error || !prep.level) {
        return { success: false, error: prep.error ?? 'No level available' }
      }
      const rendererArgs =
        appConfig.renderer === 'vulkan'
          ? ['-gfx', 'vk']
          : appConfig.renderer === 'dx11'
            ? ['-gfx', 'dx11']
            : []
      const res = await launcherService.launchVanilla(
        appConfig.gamePaths,
        { mode: 'freeroam', level: prep.level },
        { args: rendererArgs }
      )
      return { success: res.success, error: res.error, level: prep.level }
    }
  )

  /* ── Coop-session project: advertise (host) / download (joiner) ────── */

  /**
   * Host-only: register a project folder as the one the relay advertises
   * to joiners. Path is either an absolute folder or one surfaced by
   * `worldEdit:listProjects` (which has `.path` relative to userDir).
   */
  ipcMain.handle(
    'worldEdit:session:setActiveProject',
    async (
      _event,
      args: { path: string; name: string; levelName: string; folder: string }
    ): Promise<{ success: boolean; error?: string; project?: SessionProjectInfo | null }> => {
      try {
        const { resolve, isAbsolute } = await import('node:path')
        const appConfig = configService.get()
        const userDir = appConfig.gamePaths?.userDir
        const absDir = isAbsolute(args.path)
          ? args.path
          : userDir
            ? resolve(userDir, args.path)
            : resolve(args.path)
        const project = await editorSession.setActiveProject({
          name: args.name,
          levelName: args.levelName,
          folder: args.folder,
          absDir,
        })
        return { success: true, project }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    'worldEdit:session:clearActiveProject',
    async (): Promise<{ success: boolean }> => {
      // For now a no-op: clearing means "relay keeps serving until session
      // ends". We just reset the controller's cached metadata.
      editorSession.reportProjectInstalled(null)
      return { success: true }
    }
  )

  /**
   * Joiner-only: REMOVED.
   *
   * The project-zip download mechanism was decommissioned. Joiner catch-up
   * now flows entirely through the live snapshot pipeline (scene graph,
   * fields, objects, env, terrain, forest), which is more responsive and
   * avoids the empty-zip race that plagued the static folder snapshot.
   *
   * The handler is kept registered but stubbed so any stale renderer
   * binding gets a clean error instead of an unhandled-IPC crash.
   */
  ipcMain.handle(
    'worldEdit:session:downloadOfferedProject',
    async (): Promise<{ success: boolean; error?: string; localPath?: string }> => {
      return {
        success: false,
        error:
          'Project zip downloads are no longer supported. Joiners are caught up via the live snapshot pipeline.',
      }
    }
  )

  ipcMain.handle('worldEdit:session:getLanIps', async (): Promise<string[]> => {
    const nets = (await import('node:os')).networkInterfaces()
    const out: string[] = []
    for (const ifaces of Object.values(nets)) {
      if (!ifaces) continue
      for (const info of ifaces) {
        if (info.family === 'IPv4' && !info.internal) out.push(info.address)
      }
    }
    return out
  })

  ipcMain.handle(
    'worldEdit:session:getPublicIp',
    async (): Promise<{ ip: string | null; error?: string }> => {
      try {
        // ipify is the lightest no-auth public-IP echo service; BeamMP launcher
        // does something equivalent to discover its own public-facing address.
        const https = await import('node:https')
        const ip = await new Promise<string>((resolve, reject) => {
          const req = https.get('https://api.ipify.org', { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            let buf = ''
            res.on('data', (c) => (buf += c))
            res.on('end', () => resolve(buf.trim()))
            res.on('error', reject)
          })
          req.on('error', reject)
          req.on('timeout', () => {
            req.destroy(new Error('timeout'))
          })
        })
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          return { ip: null, error: `unexpected response: ${ip.slice(0, 60)}` }
        }
        return { ip }
      } catch (err) {
        return { ip: null, error: `${err}` }
      }
    }
  )

  /**
   * Aggregated host-address candidates for the Coop Editor host wizard.
   * Returns every plausible address the host could give to a joiner, tagged
   * by source and whether it should be recommended. Order of preference
   * (highest first): tailscale → public IP → first LAN → others → loopback.
   */
  ipcMain.handle(
    'worldEdit:session:getHostAddresses',
    async (): Promise<Array<{
      kind: 'tailscale' | 'lan' | 'public' | 'loopback'
      address: string
      label: string
      recommended: boolean
    }>> => {
      const out: Array<{
        kind: 'tailscale' | 'lan' | 'public' | 'loopback'
        address: string
        label: string
        recommended: boolean
      }> = []

      // Tailscale — probe non-fatally (service might not be installed).
      try {
        const st = await tailscaleService.getStatus()
        if (st.installed && st.running && st.ip) {
          out.push({
            kind: 'tailscale',
            address: st.ip,
            label: st.hostname ? `Tailscale (${st.hostname})` : 'Tailscale',
            recommended: true,
          })
        }
      } catch { /* non-fatal */ }

      // Public IP — best-effort. Many users will want this for internet hosts.
      try {
        const https = await import('node:https')
        const ip = await new Promise<string>((resolve, reject) => {
          const req = https.get('https://api.ipify.org', { timeout: 3000 }, (res) => {
            if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
            let buf = ''
            res.on('data', (c) => (buf += c))
            res.on('end', () => resolve(buf.trim()))
            res.on('error', reject)
          })
          req.on('error', reject)
          req.on('timeout', () => req.destroy(new Error('timeout')))
        })
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          out.push({
            kind: 'public',
            address: ip,
            label: 'Public IP (requires port-forward)',
            recommended: out.length === 0,
          })
        }
      } catch { /* non-fatal */ }

      // LAN — always include so the host can choose for LAN sessions.
      try {
        const nets = (await import('node:os')).networkInterfaces()
        let firstLan = true
        for (const [name, ifaces] of Object.entries(nets)) {
          if (!ifaces) continue
          for (const info of ifaces) {
            if (info.family === 'IPv4' && !info.internal) {
              out.push({
                kind: 'lan',
                address: info.address,
                label: `LAN (${name})`,
                recommended: out.length === 0 && firstLan,
              })
              firstLan = false
            }
          }
        }
      } catch { /* non-fatal */ }

      // Loopback last — useful for same-machine testing only.
      out.push({
        kind: 'loopback',
        address: '127.0.0.1',
        label: 'This machine (same-PC testing)',
        recommended: false,
      })
      return out
    }
  )

  // Check whether a Windows Firewall inbound TCP allow-rule already exists for
  // this port under our well-known display name. Read-only — no UAC needed.
  ipcMain.handle(
    'worldEdit:session:checkFirewallHole',
    async (
      _event,
      port: number
    ): Promise<{ supported: boolean; exists?: boolean; error?: string }> => {
      if (process.platform !== 'win32') return { supported: false }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { supported: true, error: 'Invalid port' }
      }
      // Match by display-name prefix so legacy rules (without "(port)" suffix)
      // and the new per-port rules are both detected.
      const psScript =
        `$rules = Get-NetFirewallRule -DisplayName 'BeamMP CM World Editor Sync*' -ErrorAction SilentlyContinue;` +
        `if ($rules) {` +
        ` foreach ($r in $rules) {` +
        `  $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue;` +
        `  if ($pf -and ($pf.LocalPort -eq '${port}' -or $pf.LocalPort -contains '${port}')) { 'YES'; exit 0 }` +
        ` }` +
        `}; 'NO'`
      try {
        const { spawn } = await import('node:child_process')
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
        const exists = await new Promise<boolean>((resolve) => {
          const ps = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { windowsHide: true }
          )
          let out = ''
          ps.stdout.on('data', (c) => (out += c.toString()))
          ps.on('error', () => resolve(false))
          ps.on('close', () => resolve(out.includes('YES')))
        })
        return { supported: true, exists }
      } catch (err) {
        return { supported: true, error: `${err}` }
      }
    }
  )

  // Create a Windows Firewall inbound TCP allow-rule for the session port.
  // Spawns an elevated PowerShell via UAC; the user must accept the prompt.
  //
  // We need TWO things to make Tailscale work reliably:
  //
  //   1. A port-based Allow rule (Profile=Any, covers wintun adapter).
  //   2. Per-program Allow rules for our exe — and removal of any
  //      auto-created Block rules for the same exe. This is the hidden
  //      gotcha: the very first time Electron binds a listener, Windows
  //      pops a "Allow on Public networks?" dialog. If the user dismissed
  //      it (or only allowed Private), Windows silently created an inbound
  //      Block rule for our binary, and that Block beats the port Allow on
  //      the wintun (Public-classified) interface — so Tailscale joiners
  //      time out at TCP-SYN even though the port rule looks fine.
  //
  // So we build a script that:
  //   a) Removes every inbound TCP Block rule whose Program = our exe
  //   b) Adds a per-program Allow rule for our exe (Profile=Any) if missing
  //   c) Adds the port Allow rule for `port,port+1` if missing
  ipcMain.handle(
    'worldEdit:session:openFirewallHole',
    async (
      _event,
      port: number
    ): Promise<{ success: boolean; cancelled?: boolean; error?: string }> => {
      if (process.platform !== 'win32') {
        return { success: false, error: 'Only supported on Windows' }
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: 'Invalid port' }
      }
      const portRuleName = `BeamMP CM World Editor Sync (${port})`
      const programRuleName = 'BeamMP CM World Editor Sync (program)'
      const portsArg = `${port},${port + 1}`
      // Resolve the actual exe path Windows Firewall sees.
      const { app } = await import('electron')
      const exePath = app.getPath('exe').replace(/'/g, "''")
      try {
        const { spawn } = await import('node:child_process')
        // Elevated child script. Idempotent.
        const childScript = [
          // (a) Remove auto-created inbound Block rules for our exe.
          `try {`,
          `  $blockers = Get-NetFirewallApplicationFilter -Program '${exePath}' -ErrorAction SilentlyContinue |`,
          `    Get-NetFirewallRule -ErrorAction SilentlyContinue |`,
          `    Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' };`,
          `  if ($blockers) { $blockers | Remove-NetFirewallRule -ErrorAction SilentlyContinue }`,
          `} catch {}`,
          // (b) Per-program Allow rule (Profile=Any) for the exe.
          `if (-not (Get-NetFirewallRule -DisplayName '${programRuleName}' -ErrorAction SilentlyContinue)) {`,
          `  New-NetFirewallRule -DisplayName '${programRuleName}'`,
          `    -Description 'Allow BeamMP CM (Coop World Editor) on all profiles'`,
          `    -Direction Inbound -Action Allow -Profile Any`,
          `    -Program '${exePath}' | Out-Null`,
          `}`,
          // (c) Port-based Allow rule.
          `if (-not (Get-NetFirewallRule -DisplayName '${portRuleName}' -ErrorAction SilentlyContinue)) {`,
          `  New-NetFirewallRule -DisplayName '${portRuleName}'`,
          `    -Description 'BeamMP CM World-Editor coop session ports'`,
          `    -Direction Inbound -Protocol TCP -LocalPort ${portsArg}`,
          `    -Action Allow -Profile Any | Out-Null`,
          `}`,
        ].join(' ')
        const childEncoded = Buffer.from(childScript, 'utf16le').toString('base64')
        // Outer (non-elevated) script that triggers the UAC prompt.
        const outerScript =
          `try {` +
          ` Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait` +
          ` -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${childEncoded}';` +
          ` exit 0` +
          `} catch {` +
          ` $msg = $_.Exception.Message;` +
          ` if ($msg -like '*canceled*' -or $msg -like '*cancelled*') { exit 2 }` +
          ` else { Write-Error $msg; exit 1 }` +
          `}`
        const outerEncoded = Buffer.from(outerScript, 'utf16le').toString('base64')
        const result = await new Promise<{ success: boolean; cancelled?: boolean; error?: string }>((resolve) => {
          const ps = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', outerEncoded],
            { windowsHide: true }
          )
          let stderr = ''
          ps.stderr.on('data', (c) => (stderr += c.toString()))
          ps.on('error', (err) => resolve({ success: false, error: err.message }))
          ps.on('close', (code) => {
            if (code === 0) resolve({ success: true })
            else if (code === 2) resolve({ success: false, cancelled: true })
            else resolve({ success: false, error: stderr.trim() || `exit ${code}` })
          })
        })
        return result
      } catch (err) {
        return { success: false, error: `${err}` }
      }
    }
  )

  // Reachability self-test: try a TCP connect to the host's own advertised
  // IP:port. If it fails, surface a specific error so the host can fix the
  // issue (firewall block, wrong IP, listener crashed, etc.) before sharing
  // the invite. Tailscale hairpin: connecting to your own 100.x address from
  // the same machine traverses the wintun adapter, so this is a real
  // smoke-test — if a SYN can't reach the listener locally over Tailscale,
  // a remote peer won't get through either.
  ipcMain.handle(
    'worldEdit:session:testReachability',
    async (
      _event,
      host: string,
      port: number
    ): Promise<{ success: boolean; latencyMs?: number; error?: string }> => {
      if (typeof host !== 'string' || !host.trim()) {
        return { success: false, error: 'No host address' }
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { success: false, error: 'Invalid port' }
      }
      const net = await import('node:net')
      const TIMEOUT_MS = 5000
      const t0 = Date.now()
      return new Promise((resolve) => {
        let settled = false
        const sock = net.createConnection({ host, port })
        const done = (r: { success: boolean; latencyMs?: number; error?: string }): void => {
          if (settled) return
          settled = true
          try { sock.destroy() } catch { /* ignore */ }
          resolve(r)
        }
        const timer = setTimeout(() => {
          done({
            success: false,
            error: `TCP connect timed out after ${TIMEOUT_MS}ms — firewall is dropping SYN packets to ${host}:${port}. ` +
              `If this is your own Tailscale IP, Windows Firewall is blocking the listener on the wintun adapter ` +
              `(usually a stale per-binary Block rule from the first launch). Click "Open firewall hole" again — ` +
              `the new script removes any blocking rules.`,
          })
        }, TIMEOUT_MS)
        sock.once('connect', () => {
          clearTimeout(timer)
          done({ success: true, latencyMs: Date.now() - t0 })
        })
        sock.once('error', (err) => {
          clearTimeout(timer)
          done({ success: false, error: `${(err as Error & { code?: string }).code ?? 'ERR'}: ${err.message}` })
        })
      })
    }
  )

  // ── Voice Chat ──

  ipcMain.handle('voice:enable', async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    // Always re-deploy so the embedded Lua source overwrites any stale
    // beamcmVoice.lua on disk from an older CM build. Idempotent + cheap.
    {
      const result = voiceChatService.deployBridge(userDir)
      if (!result.success) return result
    }
    // Auto-deploy voice server plugin to all hosted servers
    try {
      const servers = await serverManagerService.listServers()
      for (const s of servers) {
        const serverDir = serverManagerService.getServerDir(s.config.id)
        await voiceChatService.deployServerPlugin(serverDir, s.config.resourceFolder)
      }
    } catch (err) {
      console.warn('[VoiceChat] Failed to auto-deploy server plugin:', err)
    }
    await voiceChatService.enable()
    return { success: true }
  })

  ipcMain.handle('voice:disable', async () => {
    await voiceChatService.disable()
    return { success: true }
  })

  ipcMain.handle('voice:sendSignal', async (_event, data: string) => {
    await voiceChatService.sendSignal('vc_signal', data)
  })

  ipcMain.handle('voice:sendAudio', async (_event, payload: { seq: number; data: string }) => {
    await voiceChatService.sendAudio(payload.seq, payload.data)
  })

  ipcMain.handle('voice:getState', async () => {
    return voiceChatService.getState()
  })

  ipcMain.handle('voice:updateSettings', async (_event, settings: import('../../shared/types').VoiceChatSettings) => {
    await configService.update({ voiceChat: settings })
  })

  ipcMain.handle('voice:deployBridge', async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return voiceChatService.deployBridge(userDir)
  })

  ipcMain.handle('voice:undeployBridge', async () => {
    return voiceChatService.undeployBridge()
  })

  // ── Voice mesh tier (Tier 2) ──
  ipcMain.handle('voiceMesh:listen', async () => {
    return voiceMeshService.listen()
  })
  ipcMain.handle('voiceMesh:stop', async () => {
    voiceMeshService.stop()
    return { success: true }
  })
  ipcMain.handle(
    'voiceMesh:connect',
    async (_event, payload: { peerId: string; host: string; port: number; selfPeerId: string }) => {
      try {
        await voiceMeshService.connect(payload.peerId, payload.host, payload.port, payload.selfPeerId)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )
  ipcMain.handle('voiceMesh:disconnect', async (_event, peerId: string) => {
    voiceMeshService.disconnect(peerId)
    return { success: true }
  })
  ipcMain.handle('voiceMesh:send', async (_event, payload: { peerId: string; data: ArrayBuffer | Uint8Array }) => {
    const buf = Buffer.isBuffer(payload.data)
      ? payload.data
      : Buffer.from(payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data))
    return voiceMeshService.send(payload.peerId, buf)
  })

  // ── Lua Console (live REPL into BeamNG.drive GE-Lua) ──
  ipcMain.handle('luaConsole:deploy', async () => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'User data folder not configured' }
    return luaConsoleService.deploy(userDir)
  })
  ipcMain.handle('luaConsole:undeploy', async () => {
    return luaConsoleService.undeploy()
  })
  ipcMain.handle('luaConsole:isDeployed', async () => {
    return luaConsoleService.isDeployed()
  })
  ipcMain.handle('luaConsole:isConnected', async () => {
    return luaConsoleService.isConnected()
  })
  ipcMain.handle('luaConsole:execute', async (_event, payload: { reqId: number; source: string }) => {
    luaConsoleService.execute(payload.reqId, payload.source)
    return { success: true }
  })
  ipcMain.handle('luaConsole:inspect', async (_event, payload: { reqId: number; path: string }) => {
    luaConsoleService.inspect(payload.reqId, payload.path)
    return { success: true }
  })
  ipcMain.handle('luaConsole:setScope', async (_event, payload: { scope: LuaScope; vehId?: number | null }) => {
    luaConsoleService.setScope(payload.scope, payload.vehId ?? null)
    return { success: true }
  })
  ipcMain.handle('luaConsole:clear', async () => {
    luaConsoleService.clearBuffer()
    return { success: true }
  })
  ipcMain.handle('luaConsole:complete', async (_event, payload: { reqId: number; prefix: string }) => {
    luaConsoleService.complete(payload.reqId, payload.prefix)
    return { success: true }
  })
  ipcMain.handle('luaConsole:tree', async (_event, payload: { reqId: number; path: string }) => {
    luaConsoleService.tree(payload.reqId, payload.path)
    return { success: true }
  })
  ipcMain.handle('luaConsole:query', async (_event, payload: { reqId: number; query: string }) => {
    luaConsoleService.query(payload.reqId, payload.query)
    return { success: true }
  })
  ipcMain.handle('luaConsole:reload', async (_event, payload: { reqId: number | null; action: 'ge' | 'veh' | 'env' }) => {
    luaConsoleService.reload(payload.reqId, payload.action)
    return { success: true }
  })

  // ── BeamNG UI Files (HTML/JS/CSS/JSON live editor) ──
  ipcMain.handle('beamUI:listRoots', async (_event, payload: { includeInstall: boolean; installWritable?: boolean }) => {
    const cfg = configService.get()
    let userDir = cfg.gamePaths?.userDir ?? null
    let installDir = cfg.gamePaths?.installDir ?? null
    // Fallback to live discovery if the persisted config is empty (some features
    // discover paths on demand without writing them back into AppConfig).
    if (!userDir || !installDir) {
      try {
        const discovered = await discoveryService.discoverPaths()
        userDir = userDir ?? discovered.userDir ?? null
        installDir = installDir ?? discovered.installDir ?? null
      } catch { /* ignore */ }
    }
    const roots = await beamUIFilesService.listRoots({ userDir, installDir }, {
      includeInstall: !!payload?.includeInstall,
      installWritable: !!payload?.installWritable,
    })
    return { roots, resolvedUserDir: userDir, resolvedInstallDir: installDir }
  })
  ipcMain.handle('beamUI:listDir', async (_event, payload: { rootId: string; subPath: string }) => {
    return beamUIFilesService.listDir(payload.rootId, payload.subPath ?? '')
  })
  ipcMain.handle('beamUI:readFile', async (_event, payload: { rootId: string; subPath: string }) => {
    return beamUIFilesService.readFile(payload.rootId, payload.subPath)
  })
  ipcMain.handle('beamUI:readFileSmart', async (_event, payload: { rootId: string; subPath: string; maxBytes?: number }) => {
    return beamUIFilesService.readFileSmart(payload.rootId, payload.subPath, payload.maxBytes)
  })
  ipcMain.handle('beamUI:readBinaryDataUrl', async (_event, payload: { rootId: string; subPath: string; mime: string; maxBytes?: number }) => {
    return beamUIFilesService.readBinaryDataUrl(payload.rootId, payload.subPath, payload.mime, payload.maxBytes)
  })
  ipcMain.handle('beamUI:writeFile', async (_event, payload: { rootId: string; subPath: string; content: string }) => {
    await beamUIFilesService.writeFile(payload.rootId, payload.subPath, payload.content)
    return { success: true }
  })
  ipcMain.handle('beamUI:createFolder', async (_event, payload: { rootId: string; subPath: string }) => {
    await beamUIFilesService.createFolder(payload.rootId, payload.subPath)
    return { success: true }
  })
  ipcMain.handle('beamUI:delete', async (_event, payload: { rootId: string; subPath: string }) => {
    await beamUIFilesService.deleteEntry(payload.rootId, payload.subPath)
    return { success: true }
  })
  ipcMain.handle('beamUI:rename', async (_event, payload: { rootId: string; subPath: string; newName: string }) => {
    return beamUIFilesService.renameEntry(payload.rootId, payload.subPath, payload.newName)
  })
  ipcMain.handle('beamUI:revealInExplorer', async (_event, payload: { rootId: string; subPath: string }) => {
    const abs = beamUIFilesService.getAbsolutePath(payload.rootId, payload.subPath)
    shell.showItemInFolder(abs)
    return { success: true }
  })

  // Staging / commit / revert
  ipcMain.handle('beamUI:listStaged', async () => beamUIFilesService.listStagedChanges())
  ipcMain.handle('beamUI:commit', async (_event, payload: { rootId: string; subPath: string }) => {
    await beamUIFilesService.commitFile(payload.rootId, payload.subPath)
    return { success: true }
  })
  ipcMain.handle('beamUI:commitAll', async () => ({ committed: await beamUIFilesService.commitAll() }))
  ipcMain.handle('beamUI:revert', async (_event, payload: { rootId: string; subPath: string }) => {
    await beamUIFilesService.revertFile(payload.rootId, payload.subPath)
    return { success: true }
  })
  ipcMain.handle('beamUI:revertAll', async () => ({ reverted: await beamUIFilesService.revertAll() }))
  ipcMain.handle('beamUI:getAutoRevert', async () => beamUIFilesService.getAutoRevertOnExit())
  ipcMain.handle('beamUI:setAutoRevert', async (_event, payload: { value: boolean }) => {
    await beamUIFilesService.setAutoRevertOnExit(!!payload?.value)
    return { success: true }
  })

  // Projects
  ipcMain.handle('beamUI:listProjects', async () => beamUIFilesService.listProjects())
  ipcMain.handle('beamUI:saveProject', async (_event, payload: { name: string }) => {
    return beamUIFilesService.saveProject(payload.name)
  })
  ipcMain.handle('beamUI:loadProject', async (_event, payload: { name: string }) => {
    return beamUIFilesService.loadProject(payload.name)
  })
  ipcMain.handle('beamUI:deleteProject', async (_event, payload: { name: string }) => {
    await beamUIFilesService.deleteProject(payload.name)
    return { success: true }
  })

  // ── GPS Map POIs ──
  const poiCache = new LRUCache<string, import('../../shared/types').GPSMapPOI[]>(20)

  /** Turn raw POI names (e.g. "spawns_gasStation01_parking", "gasStation_01") into short readable labels */
  function cleanPOIName(raw: string, type: import('../../shared/types').GPSMapPOI['type']): string {
    // Strip common prefixes like "spawn_", "spawns_", "dropPlayerAtXxx_"
    let name = raw.replace(/^(spawns?_|dropplayerat_?)/i, '')
    // Strip numeric suffixes like "_01", "_02", trailing digits
    name = name.replace(/[_-]?\d+$/g, '')
    // Replace underscores/camelCase with spaces
    name = name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
    // Title-case
    name = name.replace(/\b\w/g, c => c.toUpperCase())
    // If the name ended up empty or is just the type name, use a nice default
    if (!name || name.length < 2) {
      const defaults: Record<string, string> = {
        spawn: 'Spawn', gas_station: 'Gas Station', garage: 'Garage',
        dealership: 'Dealership', shop: 'Shop', restaurant: 'Restaurant',
        mechanic: 'Mechanic', waypoint: 'Waypoint'
      }
      name = defaults[type] || 'POI'
    }
    return name
  }

  ipcMain.handle('gps:getMapPOIs', async (_event, mapName: string): Promise<import('../../shared/types').GPSMapPOI[]> => {
    if (poiCache.has(mapName)) return poiCache.get(mapName)!
    const pois: import('../../shared/types').GPSMapPOI[] = []
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    if (!installDir) { poiCache.set(mapName, pois); return pois }

    const zipPath = join(installDir, 'content', 'levels', `${mapName}.zip`)
    try { await access(zipPath) } catch { poiCache.set(mapName, pois); return pois }

    // 1. Extract spawn points from info.json
    const infoRaw = await readRawFromZip(zipPath, new RegExp(`^levels/${mapName}/info\\.json$`, 'i'))
    if (infoRaw) {
      try {
        const info = parseBeamNGJson<Record<string, unknown>>(infoRaw.toString('utf-8'))
        if (Array.isArray(info.spawnPoints)) {
          for (const sp of info.spawnPoints) {
            if (sp && typeof sp === 'object' && 'objectname' in sp) {
              pois.push({ type: 'spawn', name: cleanPOIName(String((sp as Record<string, unknown>).translationId || (sp as Record<string, unknown>).objectname || 'Spawn'), 'spawn'), x: 0, y: 0 })
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 2. Extract spawn positions, facilities, and delivery data from scene files
    const levelPrefix = `levels/${mapName}/`
    await forEachMatch(
      zipPath,
      (fn) => fn.startsWith(levelPrefix) && (
        (/playerdroppoints/i.test(fn) && fn.endsWith('items.level.json')) ||
        /facilities\.facilities\.json$/i.test(fn) ||
        /facilities\.sites\.json$/i.test(fn) ||
        /delivery.*\.facilities\.json$/i.test(fn)
      ),
      (fn, data) => {
        try {
          const text = data.toString('utf-8')
          if (/playerdroppoints/i.test(fn) && fn.endsWith('items.level.json')) {
            for (const line of text.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('{')) continue
              try {
                const obj = parseBeamNGJson<Record<string, unknown>>(trimmed)
                if (obj.class === 'SpawnSphere' && Array.isArray(obj.position)) {
                  const pos = obj.position as number[]
                  pois.push({ type: 'spawn', name: cleanPOIName(String(obj.name || 'Spawn Point'), 'spawn'), x: pos[0], y: pos[1] })
                }
              } catch { /* skip */ }
            }
          } else if (/facilities\.facilities\.json$/i.test(fn)) {
            const fdata = parseBeamNGJson<Record<string, unknown[]>>(text)
            const facilityMap: Record<string, import('../../shared/types').GPSMapPOI['type']> = {
              gasStations: 'gas_station', garages: 'garage', dealerships: 'dealership',
              computers: 'shop'
            }
            for (const [key, poiType] of Object.entries(facilityMap)) {
              if (Array.isArray(fdata[key])) {
                for (const fac of fdata[key]) {
                  const f = fac as Record<string, unknown>
                  pois.push({ type: poiType, name: cleanPOIName(String(f.name || key), poiType), x: 0, y: 0 })
                }
              }
            }
          } else if (/facilities\.sites\.json$/i.test(fn)) {
            const sdata = parseBeamNGJson<Record<string, unknown>>(text)
            if (Array.isArray(sdata.parkingSpots)) {
              for (const spot of sdata.parkingSpots as Record<string, unknown>[]) {
                if (Array.isArray(spot.pos)) {
                  const pos = spot.pos as number[]
                  const name = String(spot.name || 'Parking')
                  const matched = pois.find(p => p.x === 0 && p.y === 0 && name.toLowerCase().includes(p.name.toLowerCase()))
                  if (matched) { matched.x = pos[0]; matched.y = pos[1] }
                }
              }
            }
            if (Array.isArray(sdata.zones)) {
              for (const zone of sdata.zones as Record<string, unknown>[]) {
                if (Array.isArray(zone.vertices) && zone.vertices.length > 0) {
                  const verts = zone.vertices as number[][]
                  const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length
                  const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length
                  const name = String(zone.name || '')
                  const matched = pois.find(p => p.x === 0 && p.y === 0 && name.toLowerCase().includes(p.name.toLowerCase()))
                  if (matched) { matched.x = cx; matched.y = cy }
                }
              }
            }
          } else if (/delivery.*\.facilities\.json$/i.test(fn)) {
            const ddata = parseBeamNGJson<Record<string, unknown[]>>(text)
            for (const [key, items] of Object.entries(ddata)) {
              if (!Array.isArray(items)) continue
              let poiType: import('../../shared/types').GPSMapPOI['type'] = 'shop'
              const k = key.toLowerCase()
              if (k.includes('restaurant') || k.includes('food')) poiType = 'restaurant'
              else if (k.includes('mechanic') || k.includes('repair')) poiType = 'mechanic'
              for (const item of items) {
                const f = item as Record<string, unknown>
                pois.push({ type: poiType, name: cleanPOIName(String(f.name || key), poiType), x: 0, y: 0 })
              }
            }
          }
        } catch { /* skip */ }
      }
    )

    // Filter out POIs that still have no position (couldn't resolve from sites)
    const resolved = pois.filter(p => p.x !== 0 || p.y !== 0)
    poiCache.set(mapName, resolved)
    return resolved
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

  /** Read all matching entries from an archive, calling handler for each match */
  function readEntriesFromZip(
    zipPath: string,
    matcher: (fileName: string) => boolean,
    handler: (fileName: string, data: Buffer) => void
  ): Promise<void> {
    return forEachMatch(zipPath, matcher, handler)
  }

  /** Read a single entry from an archive */
  function readSingleFromZip(zipPath: string, pattern: RegExp): Promise<Buffer | null> {
    return readFirstMatch(zipPath, pattern)
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
  const vehiclePreviewCache = new LRUCache<string, string | null>(80)

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

  // ── Shared JBeam Part Database + Slot Tree Utility ──
  // Used by both getActiveVehicleMeshes and getWheelPlacements to avoid code duplication.

  interface FlexbodyEntry { mesh: string; groups: string[] }
  interface SlotEntry { name: string; defaultPart: string; allowTypes?: string[]; denyTypes?: string[] }
  interface PartEntry {
    slotType?: string
    meshes: FlexbodyEntry[]
    propMeshes: string[]
    slots: SlotEntry[]
  }

  interface SlotWalkResult {
    activeMeshes: string[]
    meshOwnership: Record<string, string>
    activeNodeGroups: Set<string>
    activeParts: string[]
  }

  function buildPartDB(
    rawParts: Record<string, Record<string, unknown>>
  ): Record<string, PartEntry> {
    const partDB: Record<string, PartEntry> = {}
    for (const [partName, partDef] of Object.entries(rawParts)) {
      if (!partDef || typeof partDef !== 'object') continue
      const entry: PartEntry = { meshes: [], propMeshes: [], slots: [] }

      // slotType
      if (typeof partDef.slotType === 'string') entry.slotType = partDef.slotType

      // flexbodies → mesh + groups
      const flexbodies = partDef.flexbodies as unknown[][]
      if (Array.isArray(flexbodies)) {
        let meshCol = -1, groupCol = -1
        for (const row of flexbodies) {
          if (!Array.isArray(row)) continue
          if (row.includes('mesh')) {
            meshCol = row.indexOf('mesh')
            groupCol = row.indexOf('[group]:')
            continue
          }
          if (meshCol < 0) continue
          const mesh = typeof row[meshCol] === 'string' ? (row[meshCol] as string) : ''
          if (!mesh) continue
          let groups: string[] = []
          if (groupCol >= 0) {
            const gv = row[groupCol]
            if (typeof gv === 'string') groups = gv.split(',').map(s => s.trim()).filter(Boolean)
            else if (Array.isArray(gv)) groups = (gv as unknown[]).filter(g => typeof g === 'string').map(g => (g as string).trim())
          }
          entry.meshes.push({ mesh, groups })
        }
      }

      // props → mesh names only
      const props = partDef.props as unknown[][]
      if (Array.isArray(props)) {
        let meshCol = -1
        for (const row of props) {
          if (!Array.isArray(row)) continue
          if (meshCol === -1) { const idx = row.indexOf('mesh'); if (idx >= 0) { meshCol = idx; continue } }
          if (meshCol >= 0 && typeof row[meshCol] === 'string') entry.propMeshes.push(row[meshCol] as string)
        }
      }

      // slots2 (newer) — extract allowTypes/denyTypes
      const slots2 = partDef.slots2 as unknown[][]
      if (Array.isArray(slots2)) {
        let nameCol = 0, defaultCol = 3, allowCol = 1, denyCol = 2
        for (const row of slots2) {
          if (!Array.isArray(row)) continue
          if (row.includes('name') && row.includes('default')) {
            nameCol = row.indexOf('name')
            defaultCol = row.indexOf('default')
            const ai = row.indexOf('allowTypes'); if (ai >= 0) allowCol = ai
            const di = row.indexOf('denyTypes'); if (di >= 0) denyCol = di
            continue
          }
          const slotName = typeof row[nameCol] === 'string' ? (row[nameCol] as string) : ''
          const defaultPart = typeof row[defaultCol] === 'string' ? (row[defaultCol] as string) : ''
          if (!slotName) continue
          const slot: SlotEntry = { name: slotName, defaultPart }
          const allow = row[allowCol]
          if (typeof allow === 'string' && allow) slot.allowTypes = allow.split(',').map(s => s.trim()).filter(Boolean)
          const deny = row[denyCol]
          if (typeof deny === 'string' && deny) slot.denyTypes = deny.split(',').map(s => s.trim()).filter(Boolean)
          entry.slots.push(slot)
        }
      }

      // slots (older) — no allow/deny
      const slotsArr = partDef.slots as unknown[][]
      if (Array.isArray(slotsArr) && !slots2) {
        for (const row of slotsArr) {
          if (!Array.isArray(row)) continue
          if (row.includes('type') && row.includes('default')) continue
          const slotName = typeof row[0] === 'string' ? (row[0] as string) : ''
          const defaultPart = typeof row[1] === 'string' ? (row[1] as string) : ''
          if (slotName) entry.slots.push({ name: slotName, defaultPart })
        }
      }

      partDB[partName] = entry
    }
    return partDB
  }

  /** Check if a part's slotType is compatible with a slot's allow/deny lists */
  function isSlotTypeCompatible(partSlotType: string | undefined, slot: SlotEntry): boolean {
    if (!slot.allowTypes && !slot.denyTypes) return true
    if (!partSlotType) return true // root parts and untyped parts always pass
    if (slot.denyTypes?.includes(partSlotType)) return false
    if (slot.allowTypes && slot.allowTypes.length > 0) return slot.allowTypes.includes(partSlotType)
    return true
  }

  /** Collect node group names from raw jbeam nodes AND pressureWheels sections */
  function collectNodeGroups(rawParts: Record<string, Record<string, unknown>>, activePartNames: string[]): Set<string> {
    const groups = new Set<string>()
    const applyGroup = (groupVal: unknown, target: Set<string>): void => {
      if (typeof groupVal === 'string') {
        for (const g of groupVal.split(',')) { const t = g.trim(); if (t) target.add(t) }
      } else if (Array.isArray(groupVal)) {
        for (const g of groupVal) { const t = String(g).trim(); if (t) target.add(t) }
      }
    }
    for (const partName of activePartNames) {
      const partDef = rawParts[partName]
      if (!partDef) continue
      // Scan nodes sections
      const nodes = partDef.nodes as unknown[] | undefined
      if (Array.isArray(nodes)) {
        for (const item of nodes) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const opt = item as Record<string, unknown>
            if (opt.group !== undefined) applyGroup(opt.group, groups)
            continue
          }
          if (!Array.isArray(item)) continue
          for (const el of item) {
            if (el && typeof el === 'object' && !Array.isArray(el)) {
              const obj = el as Record<string, unknown>
              if (obj.group !== undefined) applyGroup(obj.group, groups)
            }
          }
        }
      }
      // Scan pressureWheels for hubGroup and group columns (these define wheel/tire groups
      // that are dynamically generated at runtime — they don't appear in nodes sections)
      const pw = partDef.pressureWheels as unknown[] | undefined
      if (Array.isArray(pw)) {
        let pwHeaders: unknown[] | null = null
        for (const row of pw) {
          if (!Array.isArray(row)) continue
          if (row.includes('name')) { pwHeaders = row; continue }
          if (!pwHeaders) continue
          const hgIdx = pwHeaders.indexOf('hubGroup')
          const gIdx = pwHeaders.indexOf('group')
          if (hgIdx >= 0) {
            const val = row[hgIdx]
            if (typeof val === 'string' && val) groups.add(val)
          }
          if (gIdx >= 0) {
            const val = row[gIdx]
            if (typeof val === 'string' && val) groups.add(val)
          }
        }
      }
    }
    return groups
  }

  /** Walk the slot tree, validate slotTypes, collect meshes with group filtering */
  function walkSlotTree(
    partDB: Record<string, PartEntry>,
    rawParts: Record<string, Record<string, unknown>>,
    rootPartName: string,
    configParts: Record<string, string>
  ): SlotWalkResult {
    const activeParts: string[] = []
    const visited = new Set<string>()

    function walk(partName: string): void {
      if (!partName || visited.has(partName)) return
      visited.add(partName)
      const part = partDB[partName]
      if (!part) return
      activeParts.push(partName)

      for (const slot of part.slots) {
        const assigned = configParts[slot.name]
        if (assigned === '') continue // explicitly removed
        let resolved = assigned ?? slot.defaultPart
        // Validate slotType if assigned part doesn't match, fall back to default
        if (resolved && assigned !== undefined && partDB[resolved]) {
          if (!isSlotTypeCompatible(partDB[resolved].slotType, slot)) {
            resolved = slot.defaultPart // fall back
            if (resolved && partDB[resolved] && !isSlotTypeCompatible(partDB[resolved].slotType, slot)) {
              continue // default also invalid → skip
            }
          }
        }
        if (resolved) walk(resolved)
      }
    }
    walk(rootPartName)

    // Collect active node groups
    const activeNodeGroups = collectNodeGroups(rawParts, activeParts)

    // Collect meshes with group filtering + ownership
    const activeMeshes: string[] = []
    const meshOwnership: Record<string, string> = {}
    for (const partName of activeParts) {
      const part = partDB[partName]
      if (!part) continue
      for (const fb of part.meshes) {
        // Group filter: if flexbody has groups, at least one must exist in active node groups
        if (fb.groups.length > 0 && !fb.groups.some(g => activeNodeGroups.has(g))) continue
        if (!meshOwnership[fb.mesh]) {
          activeMeshes.push(fb.mesh)
          meshOwnership[fb.mesh] = partName
        }
      }
      // Props always pass (no group filtering)
      for (const mesh of part.propMeshes) {
        if (!meshOwnership[mesh]) {
          activeMeshes.push(mesh)
          meshOwnership[mesh] = partName
        }
      }
    }

    return { activeMeshes, meshOwnership, activeNodeGroups, activeParts }
  }

  // ── Get Active Vehicle Meshes via slot tree walk ──
  // Builds a part database (meshes + slots) from jbeam files, then walks the slot tree
  // from the root part using config.parts to resolve which parts are active.
  // Returns the list of mesh names that should be visible + ownership map.
  ipcMain.handle(
    'game:getActiveVehicleMeshes',
    async (_event, vehicleName: string, configParts: Record<string, string>): Promise<ActiveMeshResult> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return { meshes: [], meshOwnership: {} }

      // Scan all jbeam files into raw parts
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

      // Build enriched part DB + walk with validation
      const partDB = buildPartDB(rawParts)
      const result = walkSlotTree(partDB, rawParts, vehicleName, configParts)
      return { meshes: result.activeMeshes, meshOwnership: result.meshOwnership }
    }
  )

  // ── Get Wheel Placements ──
  // Uses shared slot-tree walk, then computes wheel hub centers from pressureWheels
  // node1:/node2: midpoints (authoritative), falling back to hub group medians.
  ipcMain.handle(
    'game:getWheelPlacements',
    async (_event, vehicleName: string, configParts: Record<string, string>): Promise<WheelPlacement[]> => {
      const config = configService.get()
      const installDir = config.gamePaths?.installDir
      if (!installDir) return []

      // Scan all jbeam into raw definitions
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

      // Build part DB + walk slot tree using shared utility (with slotType validation)
      const partDB = buildPartDB(rawParts)
      const { activeParts } = walkSlotTree(partDB, rawParts, vehicleName, configParts)

      // ── 1. Collect ALL node positions and group memberships from active parts ──
      const allNodes: Record<string, [number, number, number]> = {}
      const groupNodeIds: Record<string, string[]> = {}

      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const nodes = partDef.nodes as unknown[] | undefined
        if (!Array.isArray(nodes)) continue
        let headers: unknown[] | null = null
        let currentGroups: string[] = []
        const applyGroup = (groupVal: unknown): void => {
          if (typeof groupVal === 'string') {
            currentGroups = groupVal.split(',').map(s => s.trim()).filter(Boolean)
          } else if (Array.isArray(groupVal)) {
            currentGroups = (groupVal as string[]).map(s => String(s).trim()).filter(Boolean)
          } else { currentGroups = [] }
        }
        for (const item of nodes) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const opt = item as Record<string, unknown>
            if (opt.group !== undefined) applyGroup(opt.group)
            continue
          }
          if (!Array.isArray(item)) continue
          if (item.includes('id') && item.includes('posX')) { headers = item; continue }
          if (!headers) continue
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
          const nodeId = typeof item[idIdx] === 'string' ? (item[idIdx] as string) : ''
          if (!nodeId) continue
          allNodes[nodeId] = [
            typeof item[xIdx] === 'number' ? (item[xIdx] as number) : 0,
            typeof item[yIdx] === 'number' ? (item[yIdx] as number) : 0,
            typeof item[zIdx] === 'number' ? (item[zIdx] as number) : 0
          ]
          for (const g of currentGroups) {
            if (!groupNodeIds[g]) groupNodeIds[g] = []
            groupNodeIds[g].push(nodeId)
          }
        }
      }

      const median = (arr: number[]): number => {
        const sorted = [...arr].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      }

      // ── 2. Discover wheel corners from pressureWheels ──
      // node1:/node2: only have X (lateral) offsets in jbeam — Y and Z are 0 (set at runtime).
      // Hub group median is the best source; nodeArm is a single-node fallback.
      const discoveredCorners = new Set<string>()
      const hubCenters: Record<string, [number, number, number]> = {}
      const nodeArmPositions: Record<string, [number, number, number]> = {}

      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const pw = partDef.pressureWheels as unknown[] | undefined
        if (!Array.isArray(pw)) continue
        let pwHeaders: unknown[] | null = null
        for (const row of pw) {
          if (!Array.isArray(row)) continue
          if (row.includes('name')) { pwHeaders = row; continue }
          if (!pwHeaders) continue
          const nameIdx = pwHeaders.indexOf('name')
          const name = typeof row[nameIdx] === 'string' ? (row[nameIdx] as string) : ''
          if (!name) continue
          discoveredCorners.add(name)

          // Save nodeArm position separately — only used as LAST fallback
          if (!nodeArmPositions[name]) {
            const armIdx = pwHeaders.indexOf('nodeArm:')
            if (armIdx >= 0) {
              const armNode = typeof row[armIdx] === 'string' ? (row[armIdx] as string) : ''
              if (armNode && allNodes[armNode]) nodeArmPositions[name] = [...allNodes[armNode]]
            }
          }
        }
      }

      if (discoveredCorners.size === 0) {
        for (const c of ['FR', 'FL', 'RR', 'RL']) discoveredCorners.add(c)
      }

      // Priority 1: exact hub groups (_hub_FR, _hub_RL1, etc.) — median (best full 3D)
      // Hub groups have the most nodes with real 3D positions, making median robust.
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

      // Priority 2: combined axle groups (_hub_F → split by X sign)
      // For X: use average of the 2 outermost nodes (biased toward wheel face),
      // because inner structural nodes (shock mounts, trailing arms) drag median inward.
      // For Y, Z: median works well (structural spread is smaller).
      const axisPairs: Array<[string, string, string]> = [['F', 'FR', 'FL'], ['R', 'RR', 'RL']]
      for (const [axle, rightCorner, leftCorner] of axisPairs) {
        if (hubCenters[rightCorner] && hubCenters[leftCorner]) continue
        if (!discoveredCorners.has(rightCorner) && !discoveredCorners.has(leftCorner)) continue
        const suffix = `_hub_${axle}`
        for (const [g, nodeIds] of Object.entries(groupNodeIds)) {
          if (g.endsWith(suffix) && !g.endsWith(`_hub_F${axle}`) && !g.endsWith(`_hub_R${axle}`)) {
            const positions = nodeIds.map(id => allNodes[id]).filter(Boolean)
            const right = positions.filter(p => p[0] < 0)
            const left = positions.filter(p => p[0] > 0)
            const outerBiasedX = (side: [number, number, number][]): number => {
              if (side.length <= 2) return median(side.map(p => p[0]))
              // Sort by |X| descending (outermost first), average top 2
              const sorted = [...side].sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
              return (sorted[0][0] + sorted[1][0]) / 2
            }
            if (right.length > 0 && !hubCenters[rightCorner]) {
              hubCenters[rightCorner] = [outerBiasedX(right), median(right.map(p => p[1])), median(right.map(p => p[2]))]
            }
            if (left.length > 0 && !hubCenters[leftCorner]) {
              hubCenters[leftCorner] = [outerBiasedX(left), median(left.map(p => p[1])), median(left.map(p => p[2]))]
            }
            break
          }
        }
      }

      // Priority 3: nodeArm fallback for any corners still without positions
      for (const corner of discoveredCorners) {
        if (!hubCenters[corner] && nodeArmPositions[corner]) {
          hubCenters[corner] = nodeArmPositions[corner]
        }
      }

      // ── 3. Scan active parts for wheel-related flexbodies ──
      const allCornerNames = [...discoveredCorners]
      const cornerPattern = allCornerNames.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      const cornerRx = new RegExp(`(?:wheelhub|wheel|tire|hubcap|trimring)_(${cornerPattern})\\b`, 'i')
      const placements: WheelPlacement[] = []
      const seenMeshCorner = new Set<string>() // deduplicate mesh+corner combos

      for (const partName of activeParts) {
        const partDef = rawParts[partName]
        if (!partDef) continue
        const fb = partDef.flexbodies as unknown[] | undefined
        if (!Array.isArray(fb)) continue
        let meshCol = -1, groupCol = -1
        for (const row of fb) {
          if (!Array.isArray(row)) continue
          if (row.includes('mesh')) { meshCol = row.indexOf('mesh'); groupCol = row.indexOf('[group]:'); continue }
          if (meshCol < 0) continue
          const meshName = typeof row[meshCol] === 'string' ? (row[meshCol] as string) : ''
          if (!meshName) continue
          let groups: string[] = []
          if (groupCol >= 0) {
            const groupVal = row[groupCol]
            if (typeof groupVal === 'string') groups = groupVal.split(',').map(s => s.trim())
            else if (Array.isArray(groupVal)) groups = (groupVal as unknown[]).filter(g => typeof g === 'string').map(g => (g as string).trim())
          }
          if (groups.length === 0) continue
          let corner: string | null = null
          let bestGroup = ''
          for (const g of groups) {
            const m = cornerRx.exec(g)
            if (m) { corner = m[1].toUpperCase(); bestGroup = g; break }
          }
          if (!corner || !hubCenters[corner]) continue
          const key = `${meshName}::${corner}`
          if (seenMeshCorner.has(key)) continue
          seenMeshCorner.add(key)
          placements.push({ meshName, position: hubCenters[corner], group: bestGroup, corner })
        }
      }

      // ── DIAGNOSTIC: dump placement data to file ──
      try {
        const { writeFileSync } = await import('fs')
        const { join: pjoin } = await import('path')
        const debugPath = pjoin(installDir, '..', 'wheel-debug.txt')
        const lines: string[] = [`=== getWheelPlacements for ${vehicleName} ===`, `Time: ${new Date().toISOString()}`, '']

        lines.push('--- Discovered corners ---')
        for (const c of discoveredCorners) {
          const pos = hubCenters[c]
          lines.push(`  ${c}: ${pos ? `[${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}, ${pos[2].toFixed(4)}]` : 'NO POSITION'}`)
        }

        lines.push('', '--- Hub groups found ---')
        for (const [g, nodeIds] of Object.entries(groupNodeIds)) {
          if (g.includes('hub') || g.includes('wheel') || g.includes('tire')) {
            const positions = nodeIds.map(id => allNodes[id]).filter(Boolean)
            lines.push(`  group "${g}": ${nodeIds.length} node IDs, ${positions.length} with positions`)
            for (const id of nodeIds) {
              const pos = allNodes[id]
              if (pos) lines.push(`    ${id}: [${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}, ${pos[2].toFixed(4)}]`)
              else lines.push(`    ${id}: NO POSITION (probably dynamic)`)
            }
          }
        }

        lines.push('', '--- Placements ---')
        for (const p of placements) {
          lines.push(`  mesh="${p.meshName}" corner=${p.corner} group="${p.group}" pos=[${p.position[0].toFixed(4)}, ${p.position[1].toFixed(4)}, ${p.position[2].toFixed(4)}]`)
        }

        lines.push('', '--- All pressureWheels nodeArm data ---')
        for (const partName of activeParts) {
          const partDef = rawParts[partName]
          if (!partDef) continue
          const pw = partDef.pressureWheels as unknown[] | undefined
          if (!Array.isArray(pw)) continue
          let pwHeaders: unknown[] | null = null
          for (const row of pw) {
            if (!Array.isArray(row)) continue
            if (row.includes('name')) { pwHeaders = row; continue }
            if (!pwHeaders) continue
            const nameIdx = pwHeaders.indexOf('name')
            const armIdx = pwHeaders.indexOf('nodeArm:')
            const n1Idx = pwHeaders.indexOf('node1:')
            const n2Idx = pwHeaders.indexOf('node2:')
            const hubIdx = pwHeaders.indexOf('hubGroup')
            const name = typeof row[nameIdx] === 'string' ? (row[nameIdx] as string) : ''
            const arm = armIdx >= 0 && typeof row[armIdx] === 'string' ? (row[armIdx] as string) : ''
            const n1 = n1Idx >= 0 && typeof row[n1Idx] === 'string' ? (row[n1Idx] as string) : ''
            const n2 = n2Idx >= 0 && typeof row[n2Idx] === 'string' ? (row[n2Idx] as string) : ''
            const hub = hubIdx >= 0 && typeof row[hubIdx] === 'string' ? (row[hubIdx] as string) : ''
            if (name) {
              lines.push(`  ${name}: nodeArm=${arm}${arm && allNodes[arm] ? `[${allNodes[arm][0].toFixed(4)},${allNodes[arm][1].toFixed(4)},${allNodes[arm][2].toFixed(4)}]` : ''} node1=${n1}${n1 && allNodes[n1] ? `[${allNodes[n1][0].toFixed(4)},${allNodes[n1][1].toFixed(4)},${allNodes[n1][2].toFixed(4)}]` : ''} node2=${n2}${n2 && allNodes[n2] ? `[${allNodes[n2][0].toFixed(4)},${allNodes[n2][1].toFixed(4)},${allNodes[n2][2].toFixed(4)}]` : ''} hubGroup=${hub}`)
            }
          }
        }

        writeFileSync(debugPath, lines.join('\n'), 'utf-8')
      } catch { /* ignore debug errors */ }

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

  ipcMain.handle('game:listMaps', async (): Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string; modKey?: string }[]> => {
    const config = configService.get()
    const installDir = config.gamePaths?.installDir
    const userDir = config.gamePaths?.userDir
    const maps: { name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string; modKey?: string }[] = []
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

    // 2) Mod maps. We treat ANY enabled mod with a `levels/<dir>/`
    //    folder (i.e. `levelDir` set) as a candidate map — the older
    //    strict `modType === 'terrain' || 'map'` filter silently dropped
    //    map mods that BeamNG itself classified as `'unknown'` in db.json.
    //    `levelDir` is populated by `scanModZip` whenever the archive
    //    contains a `levels/` entry, which is the most reliable signal
    //    we have. We also fall back to `levelDir` when `title` is null
    //    so the dropdown still shows a usable label.
    try {
      const mods = await modManagerService.listMods(userDir || '')
      for (const mod of mods) {
        if (!mod.enabled) continue
        const isMapMod =
          mod.modType === 'terrain' ||
          mod.modType === 'map' ||
          !!mod.levelDir
        if (!isMapMod) continue
        const levelDir = mod.levelDir || mod.title || mod.key
        if (!levelDir) continue
        if (seen.has(levelDir)) continue
        seen.add(levelDir)
        maps.push({
          name: mod.title || levelDir,
          source: 'mod',
          modZipPath: mod.filePath,
          levelDir,
          modKey: mod.key,
        })
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
  let lastGamePid: number | null = null
  launcherService.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('game:statusChange', status)
    }

    // Detect game-exit transition (had a pid, now doesn't) and revert any
    // uncommitted UI-file edits unless the user disabled auto-revert.
    const pid = status.pid ?? null
    if (lastGamePid && !pid) {
      ;(async () => {
        try {
          const res = await beamUIFilesService.onGameExited()
          if ('reverted' in res && res.reverted > 0) {
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) win.webContents.send('beamUI:stagingChanged', { reason: 'gameExit', reverted: res.reverted })
            }
          }
        } catch { /* best-effort */ }
      })()
    }
    lastGamePid = pid

    // When player disconnects from a server, check if any deployed career saves were updated
    if (!status.connectedServer && serverSessionSnapshot) {
      const snap = serverSessionSnapshot
      serverSessionSnapshot = null
      ;(async () => {
        try {
          const profiles = await careerSaveService.listProfiles()
          for (const p of profiles.filter(pp => pp.deployed)) {
            const newestSlot = p.slots
              .filter(s => !s.corrupted && s.lastSaved && s.lastSaved !== '0')
              .sort((a, b) => (b.lastSaved ?? '').localeCompare(a.lastSaved ?? ''))[0]
            const currentTimestamp = newestSlot?.lastSaved ?? null
            const previousTimestamp = snap.timestamps[p.name] ?? null
            // Only associate if the save was actually updated during this session
            if (currentTimestamp && currentTimestamp !== previousTimestamp) {
              await careerSaveService.recordServerAssociation(p.name, snap.serverIdent, snap.serverName)
            }
          }
        } catch { /* best-effort */ }
      })()
    }
  })

  ipcMain.handle('game:joinServer', async (_event, ip: string, port: number) => {
    const config = configService.get()
    const ident = `${ip}:${port}`
    configService.addRecentServer(ident).catch(() => {})
    const rendererArgs = config.renderer === 'vulkan' ? ['-gfx', 'vk'] : config.renderer === 'dx11' ? ['-gfx', 'dx11'] : []
    const result = await launcherService.joinServer(ip, port, config.gamePaths, { args: rendererArgs })

    // Snapshot deployed save timestamps so we can diff on disconnect
    if (result.success) {
      ;(async () => {
        try {
          let serverName: string | null = null
          try {
            const servers = await backendService.getServerList()
            const match = servers.find(s => s.ip === ip && s.port === String(port))
            if (match) serverName = match.sname
          } catch { /* offline or timeout */ }

          const profiles = await careerSaveService.listProfiles()
          const timestamps: Record<string, string | null> = {}
          for (const p of profiles.filter(pp => pp.deployed)) {
            const newestSlot = p.slots
              .filter(s => !s.corrupted && s.lastSaved && s.lastSaved !== '0')
              .sort((a, b) => (b.lastSaved ?? '').localeCompare(a.lastSaved ?? ''))[0]
            timestamps[p.name] = newestSlot?.lastSaved ?? null
          }
          serverSessionSnapshot = { serverIdent: ident, serverName, timestamps }
        } catch { /* best-effort */ }
      })()
    }

    return result
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

  // Resolve possible BeamMP.zip locations under a configured user folder.
  // BeamNG accepts either the root user folder (e.g. E:\BeamData) or a
  // version subfolder (e.g. E:\BeamData\current). Mods live under the
  // version subfolder. Probe `current`, the root itself, and any numeric
  // version subfolders (e.g. 0.32) so the check works regardless of how
  // the user pointed us.
  const resolveBeamMPZipCandidates = async (userDir: string): Promise<string[]> => {
    const { readdirSync, statSync } = await import('fs')
    const { join } = await import('path')
    const subdirs = new Set<string>(['current', ''])
    try {
      for (const entry of readdirSync(userDir)) {
        try {
          if (/^\d+\.\d+$/.test(entry) && statSync(join(userDir, entry)).isDirectory()) {
            subdirs.add(entry)
          }
        } catch { /* ignore unreadable entry */ }
      }
    } catch { /* userDir may not exist yet */ }
    const candidates = new Set<string>()
    for (const sub of subdirs) {
      const base = sub ? join(userDir, sub) : userDir
      candidates.add(join(base, 'mods', 'multiplayer', 'BeamMP.zip'))
    }
    return Array.from(candidates)
  }

  ipcMain.handle('game:checkBeamMPInstalled', async (): Promise<boolean> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return false
    const { existsSync } = await import('fs')
    const candidates = await resolveBeamMPZipCandidates(userDir)
    return candidates.some((p) => existsSync(p))
  })

  ipcMain.handle('game:installBeamMP', async (): Promise<{ success: boolean; error?: string }> => {
    const userDir = configService.get().gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      const { existsSync, mkdirSync, writeFileSync } = await import('fs')
      const { join } = await import('path')
      // If the zip already exists in any known version folder, we're done.
      const candidates = await resolveBeamMPZipCandidates(userDir)
      const existing = candidates.find((p) => existsSync(p))
      if (existing) return { success: true }
      // Pick install destination: prefer <userDir>\current if that folder
      // exists (canonical BeamNG layout), else fall back to <userDir>.
      const currentDir = join(userDir, 'current')
      const baseDir = existsSync(currentDir) ? currentDir : userDir
      const modDir = join(baseDir, 'mods', 'multiplayer')
      const zipPath = join(modDir, 'BeamMP.zip')
      mkdirSync(modDir, { recursive: true })
      const data = await backendService.downloadMod()
      writeFileSync(zipPath, Buffer.from(data))
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
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
    await configService.setBackendUrl(url)
    // Only update BackendApiService if using custom backend
    if (!configService.get().useOfficialBackend) {
      backendService.setBaseUrl(url)
    }
  })

  ipcMain.handle('backend:setAuthUrl', async (_event, url: string) => {
    const cfg = configService.get()
    cfg.authUrl = url
    await configService.update(cfg)
  })

  ipcMain.handle('backend:setUseOfficial', async (_event, useOfficial: boolean) => {
    const cfg = configService.get()
    cfg.useOfficialBackend = useOfficial
    await configService.update(cfg)
    // Also update BackendApiService base URL
    if (useOfficial) {
      backendService.setBaseUrl('https://backend.beammp.com')
    } else {
      backendService.setBaseUrl(cfg.backendUrl)
    }
  })

  // ── Map Preview ──
  // In-memory cache so we only read zip files once per level
  const mapPreviewCache = new LRUCache<string, string | null>(30)

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
  const minimapCache = new LRUCache<string, { dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>(10)
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
  const terrainBaseCache = new LRUCache<string, string | null>(10)

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
  const heightmapCache = new LRUCache<string, string | null>(8)

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
      // For mod archives, scan for the levels/*/info.json path to get the actual internal name
      const result = await readFirstMatchWithName(zipPath, /^levels\/([^/]+)\/info\.json$/i)
      if (result) {
        const match = result.fileName.match(/^levels\/([^/]+)\/info\.json$/i)
        if (match) internalName = match[1]
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
      const raw = await readRawFromZip(zipPath, new RegExp(`^levels/${internalName}/info\\.json$`, 'i'))
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
  const roadNetworkCache = new LRUCache<string, RoadNetwork>(8)

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
  const flagMemCache = new LRUCache<string, string>(64)
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
      // Resize large images to max 1920px wide to avoid IPC/memory issues
      if (data.length > 2 * 1024 * 1024) {
        const img = nativeImage.createFromBuffer(data)
        const size = img.getSize()
        if (size.width > 1920) {
          const resized = img.resize({ width: 1920, quality: 'best' })
          const jpeg = resized.toJPEG(85)
          return `data:image/jpeg;base64,${jpeg.toString('base64')}`
        }
        const jpeg = img.toJPEG(85)
        return `data:image/jpeg;base64,${jpeg.toString('base64')}`
      }
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
      // app.getAppPath() works for both dev (project dir) and prod (asar path).
      // Electron's patched fs transparently resolves asarUnpack'd files.
      const bgDir = join(app.getAppPath(), 'resources', 'backgrounds')
      const entries = await readdir(bgDir)
      return entries
        .filter((e) => /\.(jpg|jpeg|png|webp|gif|apng)$/i.test(e))
        .map((e) => join(bgDir, e))
    } catch {
      return []
    }
  })

  /** Delete a default background image file from the bundled backgrounds directory */
  ipcMain.handle('appearance:deleteDefaultBackground', async (_event, filePath: string): Promise<boolean> => {
    try {
      const bgDir = join(app.getAppPath(), 'resources', 'backgrounds')
      // Security: ensure the resolved path is inside the backgrounds directory
      const resolved = join(filePath)
      if (!resolved.startsWith(bgDir)) return false
      await unlink(resolved)
      return true
    } catch {
      return false
    }
  })

  /** Load a background image thumbnail (smaller base64 for gallery previews) */
  ipcMain.handle('appearance:loadBackgroundThumb', async (_event, filePath: string): Promise<string | null> => {
    try {
      const data = await readFile(filePath)
      const ext = filePath.toLowerCase().split('.').pop() || ''
      // Animated formats: nativeImage can't resize them properly (only first frame, often blank).
      // Return the raw bytes as a data URL so the gallery shows the actual (animated) preview.
      if (ext === 'gif' || ext === 'webp' || ext === 'apng') {
        const mime = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/apng'
        return `data:${mime};base64,${data.toString('base64')}`
      }
      const img = nativeImage.createFromBuffer(data)
      if (img.isEmpty()) {
        // Unknown / unsupported by nativeImage — fall back to raw bytes with best-guess mime
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif'
        }
        const mime = mimeMap[ext] || 'application/octet-stream'
        return `data:${mime};base64,${data.toString('base64')}`
      }
      const resized = img.resize({ width: 384, quality: 'best' })
      const jpeg = resized.toJPEG(80)
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`
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

      // Enrich from registry metadata
      const installed = registryService.getInstalled()
      for (const mod of mods) {
        const entry = Object.values(installed).find((e) =>
          e.installed_files?.some((f) => {
            const fn = f.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
            return fn === mod.fileName.toLowerCase()
          })
        )
        if (!entry?.metadata) continue
        const meta = entry.metadata
        if (mod.modType === 'unknown' && meta.mod_type) {
          mod.modType = meta.mod_type
        }
        if (!mod.title && meta.name) {
          mod.title = meta.name
        }
        if (!mod.author && meta.author) {
          mod.author = Array.isArray(meta.author) ? meta.author.join(', ') : meta.author
        }
        if (!mod.version && meta.version) {
          mod.version = meta.version
        }
        if (!mod.tagLine && meta.abstract) {
          mod.tagLine = meta.abstract
        }
      }

      // Enrich with load order positions
      const loadOrder = await loadOrderService.getClientOrder()
      for (const mod of mods) {
        mod.loadOrder = loadOrder.orders[mod.key] ?? null
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
      conflictDetectionService.invalidate()
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
      loadOrderService.removeClientEntry(modKey).catch(() => {})
      conflictDetectionService.invalidate()
      vehicleListCache = null
      return { success: true }
    } catch {
      // File may already be gone — still clean up registry
      cleanupRegistry()
      loadOrderService.removeClientEntry(modKey).catch(() => {})
      conflictDetectionService.invalidate()
      vehicleListCache = null
      return { success: true }
    }
  })

  ipcMain.handle('mods:install', async () => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    const result = await dialog.showOpenDialog({
      title: 'Select mod archive(s)',
      filters: [{ name: 'Mod Archives', extensions: ['zip'] }],
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

  ipcMain.handle('mods:updateScope', async (_event, modKey: string, scope: 'client' | 'server' | 'both') => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      await modManagerService.updateModScope(userDir, modKey, scope)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:updateType', async (_event, modKey: string, modType: string) => {
    const allowedTypes = ['terrain', 'vehicle', 'sound', 'ui_app', 'unknown']
    if (!allowedTypes.includes(modType)) return { success: false, error: 'Invalid mod type' }
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      await modManagerService.updateModType(userDir, modKey, modType)
      vehicleListCache = null
      return { success: true }
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

  // ── Mod Load Order ──
  ipcMain.handle('mods:getLoadOrder', async () => {
    try {
      const data = await loadOrderService.getClientOrder()
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:setLoadOrder', async (_event, orderedKeys: string[]) => {
    try {
      const data = await loadOrderService.setClientOrder(orderedKeys)
      conflictDetectionService.invalidate()
      // If enforcement is enabled, apply prefixes
      const config = configService.get()
      if (config.loadOrderEnforcement && config.gamePaths?.userDir) {
        await loadOrderService.applyPrefixes(config.gamePaths.userDir)
      }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:toggleEnforcement', async (_event, enabled: boolean) => {
    try {
      const config = configService.get()
      const userDir = config.gamePaths?.userDir
      if (!userDir) return { success: false, error: 'Game user directory not configured' }

      if (enabled) {
        await loadOrderService.applyPrefixes(userDir)
      } else {
        await loadOrderService.stripPrefixes(userDir)
      }
      await configService.update({ loadOrderEnforcement: enabled })
      vehicleListCache = null
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Mod Conflict Detection ──
  ipcMain.handle('mods:scanConflicts', async () => {
    const config = configService.get()
    const userDir = config.gamePaths?.userDir
    if (!userDir) return { success: false, error: 'Game user directory not configured' }
    try {
      const mods = await modManagerService.listMods(userDir)
      const order = await loadOrderService.getClientOrder()
      const report = await conflictDetectionService.scanConflicts(mods, order)
      return { success: true, data: report }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('mods:getModConflicts', async (_event, modKey: string) => {
    try {
      const conflicts = conflictDetectionService.getModConflicts(modKey)
      return { success: true, data: conflicts }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Server Mod Load Order ──
  ipcMain.handle('hostedServer:getModLoadOrder', async (_event, serverId: string) => {
    try {
      const data = await loadOrderService.getServerOrder(serverId)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('hostedServer:setModLoadOrder', async (_event, serverId: string, orderedKeys: string[]) => {
    try {
      const data = await loadOrderService.setServerOrder(serverId, orderedKeys)
      // If enforcement is enabled, apply prefixes to server too
      const config = configService.get()
      if (config.loadOrderEnforcement) {
        await loadOrderService.applyServerPrefixes(serverId)
      }
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
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
                try { await unlink(tmpPath) } catch { /* ignore cleanup failure */ }
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
  const thumbMemCache = new LRUCache<string, string>(150)
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
          const queueRendererArgs = config.renderer === 'vulkan' ? ['-vulkan'] : config.renderer === 'dx11' ? ['-dx11'] : []
          const result = await launcherService.joinServer(
            savedTarget.ip,
            parseInt(savedTarget.port, 10),
            config.gamePaths,
            { args: queueRendererArgs }
          )

          win?.webContents.send('queue:joined', {
            success: result.success,
            error: result.error,
            ip: savedTarget.ip,
            port: savedTarget.port,
            sname: savedTarget.sname
          })

          // Snapshot deployed save timestamps so we can diff on disconnect (queue path)
          if (result.success) {
            const queueIdent = `${savedTarget.ip}:${savedTarget.port}`
            ;(async () => {
              try {
                const profiles = await careerSaveService.listProfiles()
                const timestamps: Record<string, string | null> = {}
                for (const p of profiles.filter(pp => pp.deployed)) {
                  const newestSlot = p.slots
                    .filter(s => !s.corrupted && s.lastSaved && s.lastSaved !== '0')
                    .sort((a, b) => (b.lastSaved ?? '').localeCompare(a.lastSaved ?? ''))[0]
                  timestamps[p.name] = newestSlot?.lastSaved ?? null
                }
                serverSessionSnapshot = { serverIdent: queueIdent, serverName: savedTarget.sname ?? null, timestamps }
              } catch { /* best-effort */ }
            })()
          }
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
          // Match by levelDir first (actual directory name), then fall back to title
          const mapMod = mods.find(
            (m) => m.modType === 'terrain' && m.enabled && (m.levelDir === mapName || m.title === mapName)
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

    let scope = registryEntry?.metadata?.multiplayer_scope

    // Fall back to manually-classified scope from db.json
    if (!scope) {
      const config = configService.get()
      const userDir = config.gamePaths?.userDir
      if (userDir) {
        try {
          const allMods = await modManagerService.listMods(userDir)
          const matchedMod = allMods.find((m) => {
            const normA = m.filePath.replace(/\\/g, '/').toLowerCase()
            const normB = modFilePath.replace(/\\/g, '/').toLowerCase()
            return normA === normB || normA.endsWith('/' + normB.split('/').pop()?.toLowerCase())
          })
          if (matchedMod?.multiplayerScope) {
            scope = matchedMod.multiplayerScope
          }
        } catch { /* not critical */ }
      }
    }

    // For server-only mods, skip client copy; for both/client, deploy to client
    let result: { success: boolean; error?: string }
    if (scope === 'server') {
      // Server-only: don't copy to Resources/Client/, only extract server component below
      result = { success: true }
    } else if (scope === 'both') {
      // For scope 'both', check if it's a Resources-layout outer zip (Resources/Client/*.zip)
      // and extract just the inner client zips instead of copying the full outer container
      try {
        const config = await serverManagerService.getServerConfig(id)
        const serverDir = serverManagerService.getServerDir(id)
        const clientDir = join(serverDir, config?.resourceFolder ?? 'Resources', 'Client')
        const extracted = await registryService.extractClientZipsFromOuterZip(modFilePath, clientDir)
        if (extracted.length > 0) {
          // Record the mapping so the UI can match the source mod to the deployed files
          const deployedNames = extracted.map((p) => basename(p))
          await serverManagerService.setDeployMapping(id, basename(modFilePath), deployedNames)
          result = { success: true }
        } else {
          // Not a Resources-layout zip — fall back to copying the full zip
          await serverManagerService.copyModToServer(id, modFilePath)
          result = { success: true }
        }
      } catch (err) {
        result = { success: false, error: String(err) }
      }
    } else {
      try {
        await serverManagerService.copyModToServer(id, modFilePath)
        result = { success: true }
      } catch (err) {
        result = { success: false, error: String(err) }
      }
    }

    // If the mod has server components, also deploy the server plugin
    if (scope === 'both' || scope === 'server') {
      if (registryEntry) {
        const meta = registryEntry.metadata
        const serverDir = serverManagerService.getServerDir(id)

      // Check if the original download had a Resources/Server/ layout
      // by looking for server files in the installed_files list
      const serverFiles = registryEntry.installed_files?.filter((f) =>
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
      } else {
        // Manual mod — extract Resources/Server/ entries from the zip
        const serverDir = serverManagerService.getServerDir(id)
        try {
          const extracted = await registryService.extractServerComponentFromZip(modFilePath, serverDir)
          if (extracted.length === 0) {
            console.warn('[CopyMod] Manual mod marked as', scope, 'but no Resources/Server/ entries found in zip')
          }
        } catch (err) {
          console.warn('[CopyMod] Failed to extract server component from manual mod:', err)
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

  ipcMain.handle('hostedServer:renameFile', async (_event, id: string, oldPath: string, newName: string) => {
    return serverManagerService.renameServerEntry(id, oldPath, newName)
  })

  ipcMain.handle('hostedServer:duplicateFile', async (_event, id: string, filePath: string) => {
    return serverManagerService.duplicateServerEntry(id, filePath)
  })

  ipcMain.handle('hostedServer:zipEntry', async (_event, id: string, filePath: string) => {
    const created = await serverManagerService.zipServerEntry(id, filePath)
    return { success: true, path: created }
  })

  ipcMain.handle('hostedServer:searchFiles', async (
    _event,
    id: string,
    subPath: string,
    query: string
  ) => {
    return serverManagerService.searchServerFiles(id, subPath, query)
  })

  ipcMain.handle('hostedServer:revealInExplorer', async (_event, id: string, filePath: string) => {
    const abs = serverManagerService.getServerEntryAbsolutePath(id, filePath)
    if (!existsSync(abs)) throw new Error('File not found')
    shell.showItemInFolder(abs)
  })

  ipcMain.handle('hostedServer:openEntry', async (_event, id: string, filePath: string) => {
    const abs = serverManagerService.getServerEntryAbsolutePath(id, filePath)
    if (!existsSync(abs)) throw new Error('File not found')
    const err = await shell.openPath(abs)
    if (err) throw new Error(err)
  })

  ipcMain.handle('hostedServer:downloadEntry', async (_event, id: string, filePath: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return { success: false, canceled: true }
    const abs = serverManagerService.getServerEntryAbsolutePath(id, filePath)
    if (!existsSync(abs)) throw new Error('File not found')
    const name = filePath.split(/[\\/]/).pop() ?? 'download'
    const { stat: statAsync } = await import('node:fs/promises')
    const isDir = (await statAsync(abs)).isDirectory()
    if (isDir) {
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose destination folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
      const dest = `${result.filePaths[0]}/${name}`
      await serverManagerService.downloadServerEntry(id, filePath, dest)
      return { success: true, path: dest }
    }
    const result = await dialog.showSaveDialog(win, {
      title: 'Save file as',
      defaultPath: name
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    await serverManagerService.downloadServerEntry(id, filePath, result.filePath)
    return { success: true, path: result.filePath }
  })

  ipcMain.handle('hostedServer:uploadFiles', async (
    _event,
    id: string,
    destSubPath: string,
    sourcePaths: string[]
  ) => {
    const added: string[] = []
    for (const src of sourcePaths) {
      if (!src) continue
      const fname = src.split(/[\\/]/).pop()!
      const dest = destSubPath ? `${destSubPath}/${fname}` : fname
      try {
        await serverManagerService.addFileToServer(id, src, dest)
        added.push(dest)
      } catch {
        // skip individual failures
      }
    }
    return added
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
      // If the port-check API didn't return our public IP, fetch it separately
      if (!result.ip) {
        try {
          result.ip = await new Promise<string>((resolve, reject) => {
            httpsGet('https://api.ipify.org', (res) => {
              const chunks: Buffer[] = []
              res.on('data', (c: Buffer) => chunks.push(c))
              res.on('end', () => resolve(Buffer.concat(chunks).toString().trim()))
              res.on('error', reject)
            }).on('error', reject)
          })
        } catch {
          // IP lookup failed — continue without it
        }
      }
      return result
    } catch {
      // Primary API failed entirely — try ipify.org + TCP check as fallback
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

  ipcMain.handle('hostedServer:isTrackerDeployed', async (_event, id: string) => {
    return serverManagerService.isTrackerPluginDeployed(id)
  })

  ipcMain.handle('hostedServer:undeployTracker', async (_event, id: string) => {
    return serverManagerService.undeployTrackerPlugin(id)
  })

  ipcMain.handle('hostedServer:deployVoicePlugin', async (_event, id: string) => {
    const config = await serverManagerService.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const serverDir = serverManagerService.getServerDir(id)
    return voiceChatService.deployServerPlugin(serverDir, config.resourceFolder)
  })

  ipcMain.handle('hostedServer:isVoicePluginDeployed', async (_event, id: string) => {
    return serverManagerService.isVoicePluginDeployed(id)
  })

  ipcMain.handle('hostedServer:undeployVoicePlugin', async (_event, id: string) => {
    return serverManagerService.undeployVoicePlugin(id)
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
          // Strip HTML tags and CDATA for summary (loop to handle nested/broken tags)
          let cleaned = desc.replace(/<!\[CDATA\[|\]\]>/g, '')
          let prev = cleaned
          do { prev = cleaned; cleaned = cleaned.replace(/<[^>]+>/g, '') } while (cleaned !== prev)
          // Decode entities after tag stripping; &amp; must be last to avoid double-decoding
          const summary = cleaned
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&')
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
  careerSaveService = new CareerSaveService(configService)

  ipcMain.handle('career:listProfiles', async () => {
    return careerSaveService.listProfiles()
  })

  ipcMain.handle('career:getSlotMetadata', async (_event, profileName: string, slotName: string) => {
    return careerSaveService.getSlotMetadata(profileName, slotName)
  })

  ipcMain.handle('career:getProfileSummary', async (_event, profileName: string) => {
    return careerSaveService.getProfileSummary(profileName)
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

  ipcMain.handle('career:deleteProfile', async (_event, profileName: string, options?: { backup?: boolean }) => {
    return careerSaveService.deleteProfile(profileName, options ?? {})
  })

  ipcMain.handle('career:deleteSlot', async (_event, profileName: string, slotName: string, options?: { backup?: boolean }) => {
    return careerSaveService.deleteSlot(profileName, slotName, options ?? {})
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

  ipcMain.handle('career:recordServerAssociation', async (_event, profileName: string, serverIdent: string, serverName: string | null) => {
    await careerSaveService.recordServerAssociation(profileName, serverIdent, serverName)
  })

  ipcMain.handle('career:getServerAssociations', async () => {
    return careerSaveService.getAllServerAssociations()
  })

  // ── Career Mod Management ──
  const careerModService = new CareerModService()

  ipcMain.handle('career:fetchCareerMPReleases', async () => {
    return careerModService.fetchCareerMPReleases()
  })

  ipcMain.handle('career:fetchRLSReleases', async () => {
    return careerModService.fetchRLSReleases()
  })

  ipcMain.handle('career:installCareerMP', async (_event, downloadUrl: string, version: string, serverDir: string) => {
    return careerModService.installCareerMP(downloadUrl, version, serverDir)
  })

  ipcMain.handle('career:installRLS', async (_event, downloadUrl: string, version: string, traffic: boolean, serverDir: string) => {
    return careerModService.installRLS(downloadUrl, version, traffic, serverDir)
  })

  ipcMain.handle('career:getInstalledMods', async (_event, serverDir: string) => {
    return careerModService.getInstalledMods(serverDir)
  })

  ipcMain.handle('careerMP:getServerConfig', async (_event, serverId: string) => {
    const dir = serverManagerService.getServerDir(serverId)
    return careerModService.getCareerMPServerConfig(dir)
  })

  ipcMain.handle(
    'careerMP:saveServerConfig',
    async (_event, serverId: string, config: Parameters<typeof careerModService.saveCareerMPServerConfig>[1]) => {
      const dir = serverManagerService.getServerDir(serverId)
      return careerModService.saveCareerMPServerConfig(dir, config)
    }
  )

  ipcMain.handle('dynamicTraffic:getConfig', async (_event, serverId: string) => {
    const dir = serverManagerService.getServerDir(serverId)
    return careerModService.getDynamicTrafficConfig(dir)
  })

  ipcMain.handle(
    'dynamicTraffic:saveConfig',
    async (_event, serverId: string, config: Parameters<typeof careerModService.saveDynamicTrafficConfig>[1]) => {
      const dir = serverManagerService.getServerDir(serverId)
      return careerModService.saveDynamicTrafficConfig(dir, config)
    }
  )

  // ── Career Plugin Browser ──
  const careerPluginService = new CareerPluginService()

  ipcMain.handle('career:listPluginCatalog', async () => {
    return careerPluginService.listCatalog()
  })

  ipcMain.handle('career:fetchPluginReleases', async (_event, pluginId: string) => {
    return careerPluginService.fetchPluginReleases(pluginId)
  })

  ipcMain.handle('career:installPlugin', async (_event, pluginId: string, version: string, downloadUrl: string, serverDir: string) => {
    return careerPluginService.installPlugin(pluginId, version, downloadUrl, serverDir)
  })

  ipcMain.handle('career:uninstallPlugin', async (_event, pluginId: string, serverDir: string) => {
    return careerPluginService.uninstallPlugin(pluginId, serverDir)
  })

  ipcMain.handle('career:getInstalledPlugins', async (_event, serverDir: string) => {
    return careerPluginService.getInstalledPlugins(serverDir)
  })

  // ── Server Admin Tools (CEI / CobaltEssentials / etc) ──
  // These reuse CareerPluginService with the 'admin' category and resolve hosted server dirs by id.
  ipcMain.handle('serverAdmin:listPluginCatalog', async () => {
    return careerPluginService.listCatalog('admin')
  })

  ipcMain.handle('serverAdmin:fetchPluginReleases', async (_event, pluginId: string) => {
    return careerPluginService.fetchPluginReleases(pluginId, 'admin')
  })

  ipcMain.handle(
    'serverAdmin:installPlugin',
    async (_event, pluginId: string, version: string, downloadUrl: string, serverId: string) => {
      const dir = serverManagerService.getServerDir(serverId)
      return careerPluginService.installPlugin(pluginId, version, downloadUrl, dir, 'admin')
    }
  )

  ipcMain.handle('serverAdmin:uninstallPlugin', async (_event, pluginId: string, serverId: string) => {
    const dir = serverManagerService.getServerDir(serverId)
    return careerPluginService.uninstallPlugin(pluginId, dir, 'admin')
  })

  ipcMain.handle('serverAdmin:getInstalledPlugins', async (_event, serverId: string) => {
    const dir = serverManagerService.getServerDir(serverId)
    return careerPluginService.getInstalledPlugins(dir, 'admin')
  })

  ipcMain.handle('career:browseServerDir', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Select BeamMP Server Directory',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('career:getServerDir', async (_event, serverId: string) => {
    return serverManagerService.getServerDir(serverId)
  })

  // ── Custom Executable Paths ──

  ipcMain.handle('config:browseServerExe', async () => {
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
    return result.filePaths[0]
  })

  // ── Controls / Input Bindings ──

  ipcMain.handle('controls:getDevices', async () => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    const userDir = cfg.gamePaths?.userDir
    if (!installDir || !userDir) return []
    return inputBindingsService.listDevices(installDir, userDir)
  })

  ipcMain.handle('controls:getActions', async () => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    if (!installDir) return []
    return inputBindingsService.getActions(installDir)
  })

  ipcMain.handle('controls:getCategories', async () => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    if (!installDir) return []
    return inputBindingsService.getCategories(installDir)
  })

  ipcMain.handle('controls:getBindings', async (_event, deviceFileName: string) => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    const userDir = cfg.gamePaths?.userDir
    if (!installDir || !userDir) return null
    return inputBindingsService.getMergedBindings(installDir, userDir, deviceFileName)
  })

  ipcMain.handle('controls:setBinding', async (_event, deviceFileName: string, binding: unknown) => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    const userDir = cfg.gamePaths?.userDir
    if (!installDir || !userDir) throw new Error('Game paths not configured')
    return inputBindingsService.setBinding(installDir, userDir, deviceFileName, binding as import('../../shared/types').InputBinding)
  })

  ipcMain.handle('controls:removeBinding', async (_event, deviceFileName: string, control: string, action: string) => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    const userDir = cfg.gamePaths?.userDir
    if (!installDir || !userDir) throw new Error('Game paths not configured')
    return inputBindingsService.removeBinding(installDir, userDir, deviceFileName, control, action)
  })

  ipcMain.handle('controls:resetDevice', async (_event, deviceFileName: string) => {
    const cfg = configService.get()
    const userDir = cfg.gamePaths?.userDir
    if (!userDir) throw new Error('Game paths not configured')
    return inputBindingsService.resetDevice(userDir, deviceFileName)
  })

  ipcMain.handle('controls:setFFBConfig', async (_event, deviceFileName: string, control: string, ffb: unknown) => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    const userDir = cfg.gamePaths?.userDir
    if (!installDir || !userDir) throw new Error('Game paths not configured')
    return inputBindingsService.setFFBConfig(installDir, userDir, deviceFileName, control, ffb as import('../../shared/types').FFBConfig)
  })

  ipcMain.handle('controls:getSteeringSettings', async () => {
    const cfg = configService.get()
    const userDir = cfg.gamePaths?.userDir
    if (!userDir) return null
    return inputBindingsService.getSteeringSettings(userDir)
  })

  ipcMain.handle('controls:setSteeringSettings', async (_event, settings: unknown) => {
    const cfg = configService.get()
    const userDir = cfg.gamePaths?.userDir
    if (!userDir) throw new Error('Game paths not configured')
    return inputBindingsService.setSteeringSettings(userDir, settings as Partial<import('../../shared/types').SteeringFilterSettings>)
  })

  ipcMain.handle('controls:listPresets', async () => {
    return inputBindingsService.listPresets()
  })

  ipcMain.handle('controls:savePreset', async (_event, name: string, deviceFileName: string, device: unknown) => {
    const cfg = configService.get()
    const userDir = cfg.gamePaths?.userDir
    if (!userDir) throw new Error('Game paths not configured')
    return inputBindingsService.savePreset(name, deviceFileName, userDir, device as import('../../shared/types').InputDevice)
  })

  ipcMain.handle('controls:loadPreset', async (_event, presetId: string) => {
    const cfg = configService.get()
    const userDir = cfg.gamePaths?.userDir
    if (!userDir) throw new Error('Game paths not configured')
    return inputBindingsService.loadPreset(presetId, userDir)
  })

  ipcMain.handle('controls:deletePreset', async (_event, presetId: string) => {
    return inputBindingsService.deletePreset(presetId)
  })

  ipcMain.handle('controls:exportPreset', async (_event, presetId: string) => {
    return inputBindingsService.exportPreset(presetId)
  })

  ipcMain.handle('controls:importPreset', async (_event, jsonString: string) => {
    return inputBindingsService.importPreset(jsonString)
  })

  // ── Livery Editor ──

  ipcMain.handle('livery:getUVTemplate', async (_event, vehicleName: string): Promise<{ template: string | null; width: number; height: number }> => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    if (!installDir) return { template: null, width: 2048, height: 2048 }

    const modZip = getModVehicleZip(vehicleName)
    const zipPath = modZip || join(installDir, 'content', 'vehicles', `${vehicleName}.zip`)

    // Search for *skin_UVs.png or *_skin_UVs.png pattern
    const uvPatterns = [
      new RegExp(`^vehicles/${vehicleName}/[^/]*skin_UVs\\.png$`, 'i'),
      new RegExp(`^vehicles/${vehicleName}/[^/]*_skin_UVs\\.png$`, 'i'),
      new RegExp(`^vehicles/${vehicleName}/[^/]*uv[^/]*\\.png$`, 'i'),
      new RegExp(`^vehicles/${vehicleName}/[^/]*template[^/]*\\.png$`, 'i')
    ]

    for (const pattern of uvPatterns) {
      const result = await readFirstMatchWithName(zipPath, pattern)
      if (result) {
        try {
          const png = PNG.sync.read(result.data)
          return {
            template: `data:image/png;base64,${result.data.toString('base64')}`,
            width: png.width,
            height: png.height
          }
        } catch {
          return {
            template: `data:image/png;base64,${result.data.toString('base64')}`,
            width: 2048,
            height: 2048
          }
        }
      }
    }

    // No UV template found — look for skin baseColor textures to determine resolution
    const skinTexPattern = new RegExp(`^vehicles/${vehicleName}/[^/]*\\.color\\.(png|dds)$`, 'i')
    const texResult = await readFirstMatchWithName(zipPath, skinTexPattern)
    if (texResult && texResult.fileName.toLowerCase().endsWith('.png')) {
      try {
        const png = PNG.sync.read(texResult.data)
        return { template: null, width: png.width, height: png.height }
      } catch { /* fall through */ }
    }

    return { template: null, width: 2048, height: 2048 }
  })

  ipcMain.handle('livery:getVehicleSkinMaterials', async (_event, vehicleName: string): Promise<Array<{ materialName: string; texturePath: string; uvChannel: 0 | 1; hasPaletteMap: boolean }>> => {
    const cfg = configService.get()
    const installDir = cfg.gamePaths?.installDir
    if (!installDir) return []

    const modZip = getModVehicleZip(vehicleName)
    const zipPath = modZip || join(installDir, 'content', 'vehicles', `${vehicleName}.zip`)

    const matPattern = new RegExp(`^vehicles/${vehicleName}/[^/]*\\.materials\\.json$`, 'i')
    const results: Array<{ materialName: string; texturePath: string; uvChannel: 0 | 1; hasPaletteMap: boolean }> = []

    await forEachMatch(zipPath, (fn) => matPattern.test(fn), (_fn, data) => {
      try {
        const parsed = parseBeamNGJson(data.toString('utf-8'))
        for (const [matName, matDef] of Object.entries<Record<string, unknown>>(parsed as Record<string, Record<string, unknown>>)) {
          const stages = matDef.Stages as Array<Record<string, unknown>> | undefined
          if (!stages) continue
          for (const stage of stages) {
            if (stage.colorPaletteMap || stage.instanceDiffuse) {
              results.push({
                materialName: matName,
                texturePath: (stage.baseColorMap as string) || '',
                uvChannel: (stage.colorPaletteMapUseUV as number) === 1 ? 1 : 0,
                hasPaletteMap: !!stage.colorPaletteMap
              })
            }
          }
        }
      } catch { /* skip malformed material files */ }
    })

    return results
  })

  ipcMain.handle('livery:exportSkinMod', async (_event, params: {
    vehicleName: string; skinName: string; authorName: string
    canvasDataUrl: string
    metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number
  }): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const { vehicleName, skinName, authorName, canvasDataUrl, metallic, roughness, clearcoat, clearcoatRoughness } = params
      const safeSkinName = skinName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()
      const skinId = `${vehicleName}_${safeSkinName}`

      // Decode canvas data URL to PNG buffer
      const base64Data = canvasDataUrl.replace(/^data:image\/\w+;base64,/, '')
      const pngBuffer = Buffer.from(base64Data, 'base64')

      // Generate jbeam
      const jbeam = JSON.stringify({
        [skinId]: {
          information: {
            authors: authorName || 'BeamMP Content Manager',
            name: skinName
          },
          slotType: 'paint_design',
          globalSkin: skinId
        }
      }, null, 2)

      // Generate materials.json
      const materials = JSON.stringify({
        [`${vehicleName}.skin.${safeSkinName}`]: {
          name: `${vehicleName}.skin.${safeSkinName}`,
          mapTo: `${vehicleName}.skin.${safeSkinName}`,
          class: 'Material',
          persistentId: crypto.randomUUID(),
          Stages: [
            {},
            {
              baseColorMap: `vehicles/${vehicleName}/${safeSkinName}.color.png`,
              baseColorFactor: [1, 1, 1, 1],
              metallicFactor: metallic,
              roughnessFactor: roughness,
              clearCoatFactor: clearcoat,
              clearCoatRoughnessFactor: clearcoatRoughness,
              instanceDiffuse: false,
              colorPaletteMapUseUV: 1
            }
          ],
          activeLayers: 2,
          version: 1.5
        }
      }, null, 2)

      // Ask user where to save
      const cfg = configService.get()
      const defaultPath = cfg.gamePaths?.userDir
        ? join(cfg.gamePaths.userDir, 'mods', 'repo', `${skinId}.zip`)
        : `${skinId}.zip`

      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export Livery Mod',
        defaultPath,
        filters: [{ name: 'BeamNG Mod', extensions: ['zip'] }]
      })

      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

      // Build zip using archiver pattern with basic buffer
      const { createWriteStream } = await import('node:fs')
      const archiver = await import('archiver')
      const output = createWriteStream(result.filePath)
      const archive = archiver.default('zip', { zlib: { level: 9 } })

      await new Promise<void>((resolve, reject) => {
        output.on('close', resolve)
        archive.on('error', reject)
        archive.pipe(output)
        archive.append(jbeam, { name: `vehicles/${vehicleName}/${safeSkinName}.jbeam` })
        archive.append(materials, { name: `vehicles/${vehicleName}/${safeSkinName}.materials.json` })
        archive.append(pngBuffer, { name: `vehicles/${vehicleName}/${safeSkinName}.color.png` })
        archive.finalize()
      })

      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('livery:saveProject', async (_event, data: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(win!, {
        title: 'Save Livery Project',
        filters: [{ name: 'BeamMP Livery Project', extensions: ['bmcl'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }
      await writeFile(result.filePath, data, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('livery:loadProject', async (): Promise<{ success: boolean; data?: string; error?: string }> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Open Livery Project',
        filters: [{ name: 'BeamMP Livery Project', extensions: ['bmcl'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'Cancelled' }
      const data = await readFile(result.filePaths[0], 'utf-8')
      return { success: true, data }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('livery:importImage', async (): Promise<string | null> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: 'Import Image',
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }
        ],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const buf = await readFile(result.filePaths[0])
      const ext = result.filePaths[0].split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
}
