import RPC from 'discord-rpc'

// ── Discord Application Setup ──
// 1. Go to https://discord.com/developers/applications
// 2. Click "New Application" and name it "BeamNG.drive (CM)" (this is what shows in Discord)
// 3. Copy the Application ID and paste it below
// 4. (Optional) Under "Rich Presence > Art Assets", upload images for large/small icons
const CLIENT_ID = '1493802117809311765'

let rpcClient: RPC.Client | null = null
let connected = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const RECONNECT_INTERVAL = 15_000

export function initDiscordRPC(): void {
  connect()
}

function connect(): void {
  if (connected) return

  rpcClient = new RPC.Client({ transport: 'ipc' })

  rpcClient.on('ready', () => {
    connected = true
    console.log('[DiscordRPC] Connected to Discord')
    setPresence({ state: 'Browsing content' })
  })

  rpcClient.on('disconnected', () => {
    connected = false
    console.log('[DiscordRPC] Disconnected from Discord')
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
  if (!rpcClient || !connected) return

  rpcClient.setActivity({
    details: opts.details,
    state: opts.state,
    startTimestamp: opts.startTimestamp ?? new Date(),
    largeImageKey: opts.largeImageKey,
    largeImageText: opts.largeImageText,
    smallImageKey: opts.smallImageKey,
    smallImageText: opts.smallImageText,
    instance: false
  }).catch((err) => {
    console.warn('[DiscordRPC] Failed to set activity:', err.message)
  })
}

export function clearPresence(): void {
  if (!rpcClient || !connected) return
  rpcClient.clearActivity().catch(() => {})
}

export function destroyDiscordRPC(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (rpcClient) {
    rpcClient.destroy().catch(() => {})
    rpcClient = null
    connected = false
  }
}
