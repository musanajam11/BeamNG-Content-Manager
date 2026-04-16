import RPC from 'discord-rpc'
import { ipcMain } from 'electron'

// ── Discord Application Setup ──
// 1. Go to https://discord.com/developers/applications
// 2. Click "New Application" and name it "BeamNG.drive (CM)" (this is what shows in Discord)
// 3. Copy the Application ID and paste it below
// 4. (Optional) Under "Rich Presence > Art Assets", upload images for large/small icons
const CLIENT_ID = '1493802117809311765'

let rpcClient: RPC.Client | null = null
let connected = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let appStartTimestamp = new Date()
let lastPresence: PresenceOptions = { details: 'Browsing content', state: 'Home' }

const RECONNECT_INTERVAL = 15_000
const HEARTBEAT_INTERVAL = 30_000

// ── Page ID → friendly label mapping ──
const PAGE_LABELS: Record<string, string> = {
  home: 'Home',
  servers: 'Browsing Servers',
  friends: 'Friends',
  vehicles: 'Managing Vehicles',
  maps: 'Managing Maps',
  mods: 'Managing Mods',
  career: 'Managing CareerMP Saves',
  'server-admin': 'Server Administration',
  launcher: 'Launcher Settings',
  controls: 'Configuring Controls',
  'live-gps': 'Live GPS',
  'livery-editor': 'Livery Editor',
  'voice-chat': 'Voice Chat',
  settings: 'Settings'
}

// ── Tag → activity verb mapping ──
const TAG_VERBS: Record<string, string> = {
  // Motorsports
  drift: 'Drifting',
  drifting: 'Drifting',
  touge: 'Drifting Touge',
  togue: 'Drifting Touge',
  racing: 'Racing',
  race: 'Racing',
  circuit: 'Circuit Racing',
  track: 'Track Racing',
  nascar: 'NASCAR Racing',
  rally: 'Rallying',
  dakar: 'Rallying',
  'drag racing': 'Drag Racing',
  drag: 'Drag Racing',

  // Gameplay modes
  freeroam: 'Cruising',
  'free roam': 'Cruising',
  career: 'Playing Career',
  careermp: 'Playing CareerMP',
  'career mp': 'Playing CareerMP',
  roleplay: 'Roleplaying',
  rp: 'Roleplaying',
  custom: 'Playing Custom Gamemode',

  // Off-road
  offroad: 'Off-roading',
  'off-road': 'Off-roading',
  'off road': 'Off-roading',
  'rock crawling': 'Rock Crawling',
  rockcrawling: 'Rock Crawling',
  crawling: 'Rock Crawling',

  // Gamemodes
  derby: 'Demolition Derby',
  'demolition derby': 'Demolition Derby',
  'demo derby': 'Demolition Derby',
  demolition: 'Demolition Derby',
  destruction: 'Demolition Derby',
  infection: 'Playing Infection',
  zombie: 'Playing Infection',
  zombies: 'Playing Infection',
  sumo: 'Playing Sumo',
  chase: 'Police Chase',
  chases: 'Police Chase',
  pursuit: 'Police Chase',
  police: 'Police RP',
  'cops-robbers': 'Cops & Robbers',
  'cops and robbers': 'Cops & Robbers',
  'cops robbers': 'Cops & Robbers',

  // Features
  delivery: 'Making Deliveries',
  deliveries: 'Making Deliveries',
  economy: 'Playing Economy',
  trading: 'Trading',
  trade: 'Trading',
  missions: 'Running Missions',
  mission: 'Running Missions',
  traffic: 'Driving in Traffic'
}

function getVerbFromTags(tags: string): string {
  const lower = tags.toLowerCase()
  for (const [keyword, verb] of Object.entries(TAG_VERBS)) {
    if (lower.includes(keyword)) return verb
  }
  return 'Playing'
}

// ── Map name cleaning (mirrors renderer's cleanMapName) ──
const MAP_NAMES: Record<string, string> = {
  gridmap_v2: 'Grid Map',
  gridmap: 'Grid Map (legacy)',
  west_coast_usa: 'West Coast USA',
  east_coast_usa: 'East Coast USA',
  utah: 'Utah',
  italy: 'Italy',
  industrial: 'Industrial',
  jungle_rock_island: 'Jungle Rock Island',
  small_island: 'Small Island',
  hirochi_raceway: 'Hirochi Raceway',
  derby: 'Derby Arena',
  driver_training: 'Driver Training',
  automation_test_track: 'Automation Test Track',
  johnson_valley: 'Johnson Valley',
  east_coast_usa_v2: 'East Coast USA v2',
  cliff: 'Cliff',
  autotest: 'Auto Test',
  glow_city: 'Glow City',
  garage_v2: 'Garage',
  showroom_v2: 'Showroom',
  smallgrid: 'Small Grid',
  template: 'Template',
  port: 'Port',
  garage: 'Garage'
}

function cleanMapName(raw: string): string {
  const id = raw.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
  return MAP_NAMES[id.toLowerCase()] || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function initDiscordRPC(): void {
  try {
    connect()
    registerIpcHandlers()
  } catch (err) {
    // On Linux (especially Steam Deck) Discord IPC socket may not exist.
    // Swallow and skip — DiscordRPC is non-essential.
    console.warn('[DiscordRPC] Init failed (Discord may not be installed):', err)
  }
}

function connect(): void {
  if (connected) return

  try {
    rpcClient = new RPC.Client({ transport: 'ipc' })
  } catch (err) {
    console.warn('[DiscordRPC] Could not create RPC client:', err)
    return
  }

  rpcClient.on('ready', () => {
    connected = true
    appStartTimestamp = new Date()
    console.log('[DiscordRPC] Connected to Discord')
    setPresence({ state: 'Home', details: 'Browsing content' })
    startHeartbeat()
  })

  rpcClient.on('disconnected', () => {
    connected = false
    console.log('[DiscordRPC] Disconnected from Discord')
    stopHeartbeat()
    scheduleReconnect()
  })

  rpcClient.login({ clientId: CLIENT_ID }).catch((err) => {
    console.warn('[DiscordRPC] Failed to connect:', err.message)
    connected = false
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_INTERVAL)
}

function startHeartbeat(): void {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (!rpcClient || !connected) {
      stopHeartbeat()
      return
    }
    // Re-set the last known presence — if the pipe is dead this will fail
    // and we can reconnect
    rpcClient.setActivity({
      details: lastPresence.details,
      state: lastPresence.state,
      startTimestamp: lastPresence.startTimestamp ?? appStartTimestamp,
      largeImageKey: lastPresence.largeImageKey,
      largeImageText: lastPresence.largeImageText,
      smallImageKey: lastPresence.smallImageKey,
      smallImageText: lastPresence.smallImageText,
      instance: false
    }).catch(() => {
      console.warn('[DiscordRPC] Heartbeat failed — reconnecting')
      connected = false
      stopHeartbeat()
      try { rpcClient?.destroy().catch(() => {}) } catch { /* ignore */ }
      rpcClient = null
      scheduleReconnect()
    })
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

function registerIpcHandlers(): void {
  // Renderer tells us which page the user navigated to
  ipcMain.on('discord:setPage', (_event, pageId: string) => {
    const label = PAGE_LABELS[pageId] || 'Browsing content'
    setPresence({ details: label, state: undefined })
  })

  // Renderer tells us the user joined a server and is playing
  ipcMain.on('discord:setPlaying', (_event, info: {
    serverName: string
    mapName: string
    carName?: string
    tags?: string
    playerCount?: number
    maxPlayers?: number
  }) => {
    const verb = info.tags ? getVerbFromTags(info.tags) : 'Playing'
    const mapDisplay = info.mapName ? cleanMapName(info.mapName) : undefined

    // e.g. "Drifting in West Coast Drift — ETK 800"
    const details = info.carName
      ? `${verb} in ${info.serverName} — ${info.carName}`
      : `${verb} in ${info.serverName}`

    const state = mapDisplay
      ? `on ${mapDisplay}`
      : undefined

    const partySize = info.playerCount && info.maxPlayers
      ? `(${info.playerCount}/${info.maxPlayers})`
      : undefined

    setPresence({
      details,
      state: [state, partySize].filter(Boolean).join(' ')
    })
  })

  // Renderer clears the "playing" state (back to CM browsing)
  ipcMain.on('discord:clearPlaying', () => {
    setPresence({ details: 'Browsing content', state: undefined })
  })
}

export interface PresenceOptions {
  details?: string
  state?: string
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
  startTimestamp?: Date
}

export function setPresence(opts: PresenceOptions): void {
  lastPresence = opts
  if (!rpcClient || !connected) return

  rpcClient.setActivity({
    details: opts.details,
    state: opts.state,
    startTimestamp: opts.startTimestamp ?? appStartTimestamp,
    largeImageKey: opts.largeImageKey,
    largeImageText: opts.largeImageText,
    smallImageKey: opts.smallImageKey,
    smallImageText: opts.smallImageText,
    instance: false
  }).catch((err) => {
    console.warn('[DiscordRPC] Failed to set activity:', err.message)
    // Connection may be dead — tear down and reconnect
    connected = false
    stopHeartbeat()
    try { rpcClient?.destroy().catch(() => {}) } catch { /* ignore */ }
    rpcClient = null
    scheduleReconnect()
  })
}

export function clearPresence(): void {
  if (!rpcClient || !connected) return
  rpcClient.clearActivity().catch(() => {})
}

export function destroyDiscordRPC(): void {
  stopHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (rpcClient) {
    // Clear activity first so Discord doesn't show stale presence
    try { rpcClient.clearActivity().catch(() => {}) } catch { /* ignore */ }
    try { rpcClient.destroy().catch(() => {}) } catch { /* ignore */ }
    rpcClient = null
    connected = false
  }
}
