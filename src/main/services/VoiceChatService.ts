import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import type { VoiceSignalMessage, VoiceChatState, VoicePeerInfo } from '../../shared/types'
import { buildVoiceOverlayZip } from './VoiceOverlayMod'

/* ── Embedded Lua: Voice Chat Bridge (client-side, deployed to BeamNG) ── */

const VOICE_BRIDGE_LUA = `
-- BeamCM Voice Chat Bridge
-- Auto-deployed by BeamMP Content Manager
-- Bridges WebRTC signaling between CM (Electron) and BeamMP server events.
-- This extension does NOT handle audio — only signaling messages.

local M = {}

local incomingFile = "settings/BeamCM/vc_incoming.json"
local outgoingFile = "settings/BeamCM/vc_outgoing.json"
local statusFile = "settings/BeamCM/vc_status.json"
local commandFile = "settings/BeamCM/vc_command.json"
local pollInterval = 0.05
local timer = 0
local registered = false
local pollCount = 0
local signalsSent = 0
local signalsReceived = 0

-- Multiplayer readiness: TriggerServerEvent exists early but events only
-- reach the server after the world is fully loaded (onWorldReadyState == 2).
local worldReady = false

-- vc_enable retry: server may not have the plugin, or events may silently
-- drop if the network isn't fully up yet. Retry until server acknowledges.
local enableRequested = false   -- CM asked us to enable voice
local enableConfirmed = false   -- server responded (peers_list or peer_joined)
local enableRetryTimer = 0
local enableRetryInterval = 2   -- seconds between retries
local enableRetryCount = 0
local enableMaxRetries = 30     -- give up after ~60s
local startupElapsed = 0

-- Append a message to the incoming JSON file for CM to read
local function appendIncoming(msg)
  local existing = {}
  local ok, content = pcall(jsonReadFile, incomingFile)
  if ok and type(content) == "table" then existing = content end
  table.insert(existing, msg)
  jsonWriteFile(incomingFile, existing)
  signalsReceived = signalsReceived + 1
end

-- Event handlers (called by BeamMP event system)
local function onPeerJoined(data)
  enableConfirmed = true
  log('I', 'beamcmVoice', 'Peer joined event from server: data=' .. tostring(data))
  appendIncoming({ event = "vc_peer_joined", data = tostring(data) })
end

local function onPeerLeft(data)
  log('I', 'beamcmVoice', 'Peer left event from server: data=' .. tostring(data))
  appendIncoming({ event = "vc_peer_left", data = tostring(data) })
end

local function onSignal(data)
  appendIncoming({ event = "vc_signal", data = tostring(data) })
end

local function onPeersList(data)
  enableConfirmed = true
  log('I', 'beamcmVoice', 'Peers list from server: ' .. tostring(data))
  appendIncoming({ event = "vc_peers_list", data = tostring(data) })
end

-- vc_audio is high-volume (~17 frames/sec/talker). Don't log each one.
local function onAudio(data)
  appendIncoming({ event = "vc_audio", data = tostring(data) })
end

local function tryRegister()
  if registered then return end
  if type(AddEventHandler) ~= "function" then return end
  pcall(function()
    AddEventHandler("vc_peer_joined", onPeerJoined)
    AddEventHandler("vc_peer_left", onPeerLeft)
    AddEventHandler("vc_signal", onSignal)
    AddEventHandler("vc_peers_list", onPeersList)
    AddEventHandler("vc_audio", onAudio)
  end)
  registered = true
  log('I', 'beamcmVoice', 'Registered BeamMP event handlers (AddEventHandler available)')
end

local function trySendServerEvent(event, data)
  if not worldReady then return false end
  if type(TriggerServerEvent) ~= "function" then return false end
  local ok, err = pcall(function() TriggerServerEvent(event, data) end)
  if ok then
    signalsSent = signalsSent + 1
    return true
  else
    log('W', 'beamcmVoice', 'TriggerServerEvent("' .. event .. '") failed: ' .. tostring(err))
    return false
  end
end

-- Public API consumed by the in-game BeamCM Voice overlay app.
-- The overlay is shipped as a BeamMP-distributed Client mod and runs for ALL
-- players on the server, including those without the Manager. We expose these
-- helpers via _G so the overlay can call them with bngApi.engineLua().
_G.BeamCMVoice = _G.BeamCMVoice or {}
function _G.BeamCMVoice.getStatus()
  local ok, content = pcall(jsonReadFile, statusFile)
  if ok and type(content) == "table" then
    local okEnc, encoded = pcall(jsonEncode, content)
    if okEnc and type(encoded) == "string" then return encoded end
  end
  return jsonEncode({ available = false, enabled = false, connected = false, peers = {} })
end
function _G.BeamCMVoice.sendCommand(action)
  if type(action) ~= "string" then return end
  if action ~= "enable" and action ~= "disable" and action ~= "mute" and action ~= "unmute" then return end
  pcall(jsonWriteFile, commandFile, { action = action, ts = os.time() })
end

local function onExtensionLoaded()
  if setExtensionUnloadMode then
    setExtensionUnloadMode('beamcmVoice', 'manual')
    log('I', 'beamcmVoice', 'Set unload mode to manual (survives level transitions)')
  end
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge loaded')
  log('I', 'beamcmVoice', 'Outgoing: ' .. outgoingFile .. ', Incoming: ' .. incomingFile)
  log('I', 'beamcmVoice', 'Poll: ' .. tostring(pollInterval) .. 's, retry: ' .. tostring(enableRetryInterval) .. 's')
  log('I', 'beamcmVoice', 'BeamCMVoice global API exposed for in-game overlay')
  tryRegister()
end

-- BeamNG calls this when the multiplayer world state changes.
-- state 2 = world fully loaded and game ready for multiplayer interaction.
local function onWorldReadyState(state)
  log('I', 'beamcmVoice', 'onWorldReadyState(' .. tostring(state) .. ') — worldReady was ' .. tostring(worldReady))
  if state == 2 then
    local wasReady = worldReady
    worldReady = true
    log('I', 'beamcmVoice', 'World is READY — multiplayer events will now be sent to server')
    -- Re-arm enable on every world-ready transition so map changes / level
    -- reloads automatically re-register us on the server. The server's
    -- vc_enable handler is idempotent (replaces the entry, sends fresh
    -- peers_list).
    if enableRequested then
      enableConfirmed = false
      enableRetryCount = 0
      enableRetryTimer = 0
      log('I', 'beamcmVoice', 'Re-sending vc_enable on world ready (wasReady=' .. tostring(wasReady) .. ')')
      trySendServerEvent("vc_enable", "enable")
    end
  elseif state == 0 then
    worldReady = false
    log('I', 'beamcmVoice', 'World state reset to 0 — pausing server events')
  end
end

local function onUpdate(dt)
  if not registered then tryRegister() end
  startupElapsed = startupElapsed + dt
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  pollCount = pollCount + 1

  -- Read outgoing signals written by CM and send them as BeamMP events
  local ok, content = pcall(jsonReadFile, outgoingFile)
  if ok and type(content) == "table" and #content > 0 then
    local sent = 0
    local deferred = 0
    local skipped = 0
    for _, msg in ipairs(content) do
      if msg.event and msg.data then
        if msg.event == "vc_enable" then
          -- Store request; retry loop sends when server is reachable
          enableRequested = true
          enableConfirmed = false
          enableRetryCount = 0
          enableRetryTimer = 0
          log('I', 'beamcmVoice', 'vc_enable requested by CM (worldReady=' .. tostring(worldReady) .. ')')
          if worldReady then
            if trySendServerEvent("vc_enable", "enable") then
              sent = sent + 1
              log('I', 'beamcmVoice', 'vc_enable sent immediately (world was ready)')
            end
          else
            deferred = deferred + 1
            log('I', 'beamcmVoice', 'vc_enable deferred — waiting for world ready')
          end
        elseif msg.event == "vc_disable" then
          enableRequested = false
          enableConfirmed = false
          if trySendServerEvent("vc_disable", msg.data) then
            sent = sent + 1
          end
        else
          -- vc_signal and others: only send if world is ready
          if worldReady then
            if trySendServerEvent(msg.event, msg.data) then
              sent = sent + 1
            else
              skipped = skipped + 1
            end
          else
            skipped = skipped + 1
          end
        end
      end
    end
    jsonWriteFile(outgoingFile, {})
    if sent > 0 then
      log('I', 'beamcmVoice', 'Sent ' .. sent .. ' signal(s) to server (total: ' .. signalsSent .. ')')
    end
    if deferred > 0 then
      log('I', 'beamcmVoice', 'Deferred ' .. deferred .. ' signal(s) — world not ready')
    end
    if skipped > 0 then
      log('W', 'beamcmVoice', 'Skipped ' .. skipped .. ' signal(s)')
    end
  end

  -- vc_enable retry loop: keep retrying until server acknowledges
  if enableRequested and not enableConfirmed and worldReady then
    enableRetryTimer = enableRetryTimer + pollInterval
    if enableRetryTimer >= enableRetryInterval then
      enableRetryTimer = 0
      enableRetryCount = enableRetryCount + 1
      if enableRetryCount > enableMaxRetries then
        log('E', 'beamcmVoice', 'vc_enable: no server response after ' .. enableMaxRetries .. ' retries — server plugin may not be installed')
        enableRequested = false
      else
        trySendServerEvent("vc_enable", "enable")
        log('I', 'beamcmVoice', 'vc_enable retry #' .. enableRetryCount .. ' (uptime=' .. string.format("%.0f", startupElapsed) .. 's)')
      end
    end
  end

  -- Status log every 30s
  if pollCount % 120 == 0 then
    log('I', 'beamcmVoice', 'Status: worldReady=' .. tostring(worldReady)
      .. ', registered=' .. tostring(registered)
      .. ', enableReq=' .. tostring(enableRequested)
      .. ', enableConf=' .. tostring(enableConfirmed)
      .. ', sent=' .. signalsSent
      .. ', recv=' .. signalsReceived
      .. ', uptime=' .. string.format("%.0f", startupElapsed) .. 's')
  end
end

local function onExtensionUnloaded()
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge unloaded (sent=' .. signalsSent .. ', recv=' .. signalsReceived .. ')')
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onWorldReadyState = onWorldReadyState
M.onUpdate = onUpdate
return M
`

/* ── Embedded Lua: Voice Chat Server Plugin (deployed to BeamMP server) ── */

const VOICE_SERVER_PLUGIN = `-- BeamCM Voice Chat Server Plugin
-- Auto-deployed by BeamMP Content Manager
-- Relays WebRTC signaling between voice-chat-enabled players.

local TAG = "[BeamCM-Voice] "
local voicePeers = {}  -- [playerId] = { name = "...", joinedAt = os.time(), signalsIn=0, signalsOut=0, audioIn=0, audioOut=0, lastSeenAt=os.time() }
local signalCount = 0
local audioFrameCount = 0
local pluginStartedAt = os.time()
local lastStatsDump = os.time()
local STATS_INTERVAL = 60  -- seconds between detailed stats dumps

print(string.rep("=", 60))
print(TAG .. "Voice chat server plugin loading...")
print(TAG .. "Build: BeamCM Voice v1")
print(TAG .. "Started at: " .. os.date("%Y-%m-%d %H:%M:%S"))
print(string.rep("=", 60))

MP.RegisterEvent("vc_enable", "vcOnEnable")
MP.RegisterEvent("vc_disable", "vcOnDisable")
MP.RegisterEvent("vc_signal", "vcOnSignal")
MP.RegisterEvent("vc_audio", "vcOnAudio")
MP.RegisterEvent("onPlayerDisconnect", "vcOnDisconnect")
MP.RegisterEvent("onPlayerJoin", "vcOnPlayerJoin")
-- Periodic stats tick (every 1s; we throttle the actual dump internally).
MP.CreateEventTimer("vcStatsTick", 1000)
MP.RegisterEvent("vcStatsTick", "vcOnStatsTick")

print(TAG .. "Events registered: vc_enable, vc_disable, vc_signal, vc_audio, onPlayerDisconnect, onPlayerJoin, vcStatsTick(1s)")

local function getPeerCount()
  local count = 0
  for _ in pairs(voicePeers) do count = count + 1 end
  return count
end

local function getPeerNames()
  local names = {}
  for _, info in pairs(voicePeers) do
    table.insert(names, info.name)
  end
  return table.concat(names, ", ")
end

function vcOnEnable(player_id, data)
  local name = MP.GetPlayerName(player_id) or ""
  if name == "" then name = "Player_" .. tostring(player_id) end
  voicePeers[player_id] = {
    name = name,
    joinedAt = os.time(),
    signalsIn = 0,
    signalsOut = 0,
    audioIn = 0,
    audioOut = 0,
    lastSeenAt = os.time(),
  }
  local peerCount = getPeerCount()
  print(TAG .. "ENABLED: " .. name .. " (pid=" .. tostring(player_id) .. ") joined voice chat")
  print(TAG .. "Active voice peers: " .. peerCount .. " [" .. getPeerNames() .. "]")
  -- Notify all other voice peers that this player joined
  local notified = 0
  for pid, _ in pairs(voicePeers) do
    if pid ~= player_id then
      MP.TriggerClientEvent(pid, "vc_peer_joined", player_id .. "," .. name)
      notified = notified + 1
    end
  end
  if notified > 0 then
    print(TAG .. "Notified " .. notified .. " existing peer(s) about new joiner")
  end
  -- Send existing peers list to the new voice peer
  local peerList = {}
  for pid, info in pairs(voicePeers) do
    if pid ~= player_id then
      table.insert(peerList, tostring(pid) .. ":" .. info.name)
    end
  end
  if #peerList > 0 then
    MP.TriggerClientEvent(player_id, "vc_peers_list", tostring(player_id) .. "|" .. table.concat(peerList, ","))
    print(TAG .. "Sent peers list to " .. name .. ": " .. #peerList .. " peer(s)")
  else
    -- Always acknowledge so the client's retry loop stops, even if alone
    MP.TriggerClientEvent(player_id, "vc_peers_list", tostring(player_id) .. "|")
    print(TAG .. name .. " is the first voice peer (sent empty peers list as ack)")
  end
end

function vcOnDisable(player_id, data)
  if voicePeers[player_id] then
    local info = voicePeers[player_id]
    local name = info.name
    local duration = os.time() - (info.joinedAt or os.time())
    print(string.format(
      "%sDISABLED: %s (pid=%d) left voice chat — active=%ds, sigOut=%d sigIn=%d audOut=%d audIn=%d",
      TAG, name, player_id, duration, info.signalsOut, info.signalsIn, info.audioOut, info.audioIn
    ))
    voicePeers[player_id] = nil
    local remaining = getPeerCount()
    -- Notify all remaining voice peers
    local notified = 0
    for pid, _ in pairs(voicePeers) do
      MP.TriggerClientEvent(pid, "vc_peer_left", tostring(player_id))
      notified = notified + 1
    end
    print(TAG .. "Active voice peers: " .. remaining .. (remaining > 0 and (" [" .. getPeerNames() .. "]") or " (none)"))
    if notified > 0 then
      print(TAG .. "Notified " .. notified .. " remaining peer(s) about departure")
    end
  else
    print(TAG .. "WARNING: vc_disable from pid=" .. tostring(player_id) .. " but they were not in voice peers")
  end
end

function vcOnSignal(player_id, data)
  -- data format: "targetId|jsonPayload"
  local sep = string.find(data, "|", 1, true)
  if not sep then
    print(TAG .. "WARNING: Malformed signal from pid=" .. tostring(player_id) .. " (no separator, len=" .. tostring(#data) .. ")")
    return
  end
  local targetId = tonumber(string.sub(data, 1, sep - 1))
  local payload = string.sub(data, sep + 1)
  if not targetId then
    print(TAG .. "WARNING: Invalid target ID in signal from pid=" .. tostring(player_id) .. " (raw='" .. tostring(string.sub(data, 1, sep - 1)) .. "')")
    return
  end
  if not voicePeers[player_id] then
    print(TAG .. "WARNING: Signal from pid=" .. tostring(player_id) .. " who has not enabled voice chat (rogue client?)")
    return
  end
  if voicePeers[targetId] then
    MP.TriggerClientEvent(targetId, "vc_signal", player_id .. "|" .. payload)
    signalCount = signalCount + 1
    voicePeers[player_id].signalsOut = voicePeers[player_id].signalsOut + 1
    voicePeers[player_id].lastSeenAt = os.time()
    voicePeers[targetId].signalsIn = voicePeers[targetId].signalsIn + 1
    -- Log signal relay activity periodically (every 50 signals)
    if signalCount % 50 == 0 then
      print(TAG .. "Relayed " .. signalCount .. " total signals (" .. getPeerCount() .. " active peers)")
    end
  else
    print(TAG .. "WARNING: Signal from pid=" .. tostring(player_id) .. " to pid=" .. tostring(targetId) .. " but target is not a voice peer")
  end
end

function vcOnDisconnect(player_id)
  if voicePeers[player_id] then
    local info = voicePeers[player_id]
    local name = info.name
    local duration = os.time() - (info.joinedAt or os.time())
    print(string.format(
      "%sDISCONNECT: %s (pid=%d) left server — was in voice %ds, sigOut=%d sigIn=%d audOut=%d audIn=%d",
      TAG, name, player_id, duration, info.signalsOut, info.signalsIn, info.audioOut, info.audioIn
    ))
    voicePeers[player_id] = nil
    local remaining = getPeerCount()
    local notified = 0
    for pid, _ in pairs(voicePeers) do
      MP.TriggerClientEvent(pid, "vc_peer_left", tostring(player_id))
      notified = notified + 1
    end
    print(TAG .. "Active voice peers: " .. remaining .. (remaining > 0 and (" [" .. getPeerNames() .. "]") or " (none)"))
  end
end

function vcOnPlayerJoin(player_id)
  local name = MP.GetPlayerName(player_id) or ""
  if name == "" then name = "Player_" .. tostring(player_id) end
  print(TAG .. "Player joined server: " .. name .. " (pid=" .. tostring(player_id) .. ") — voice not yet enabled")
end

-- Tier 3 audio relay. Data format from sender: "<seq>|<base64opus>".
-- We rebroadcast as "<senderId>|<seq>|<base64opus>" to all other voice peers.
-- High-volume (~17 frames/sec/talker) — no per-frame logging.
function vcOnAudio(player_id, data)
  if not voicePeers[player_id] then return end
  audioFrameCount = audioFrameCount + 1
  voicePeers[player_id].audioOut = voicePeers[player_id].audioOut + 1
  voicePeers[player_id].lastSeenAt = os.time()
  local relayed = player_id .. "|" .. data
  local fanOut = 0
  for pid, info in pairs(voicePeers) do
    if pid ~= player_id then
      MP.TriggerClientEvent(pid, "vc_audio", relayed)
      info.audioIn = info.audioIn + 1
      fanOut = fanOut + 1
    end
  end
  if audioFrameCount % 500 == 0 then
    print(TAG .. "Relayed " .. audioFrameCount .. " audio frames (last fan-out=" .. fanOut .. ", " .. getPeerCount() .. " active peers)")
  end
end

-- Periodic detailed stats dump. Throttled to STATS_INTERVAL seconds and only
-- emitted when at least one peer is active, so an idle server stays quiet.
function vcOnStatsTick()
  local now = os.time()
  if now - lastStatsDump < STATS_INTERVAL then return end
  local count = getPeerCount()
  if count == 0 then
    lastStatsDump = now
    return
  end
  lastStatsDump = now
  local uptime = now - pluginStartedAt
  print(string.rep("-", 60))
  print(TAG .. "=== Stats dump @ " .. os.date("%H:%M:%S") .. " (uptime " .. uptime .. "s) ===")
  print(TAG .. "Active voice peers: " .. count)
  print(TAG .. "Cumulative signals relayed: " .. signalCount)
  print(TAG .. "Cumulative audio frames relayed: " .. audioFrameCount)
  for pid, info in pairs(voicePeers) do
    local active = now - info.joinedAt
    local idle = now - info.lastSeenAt
    print(string.format(
      "%s  - pid=%d  name=%-20s  active=%4ds  idle=%3ds  sigOut=%5d sigIn=%5d audOut=%6d audIn=%6d",
      TAG, pid, info.name, active, idle,
      info.signalsOut, info.signalsIn, info.audioOut, info.audioIn
    ))
  end
  print(string.rep("-", 60))
end

print(TAG .. "Plugin loaded successfully — waiting for players to enable voice chat")
`

export class VoiceChatService {
  private signalPoller: ReturnType<typeof setInterval> | null = null
  private deployed = false
  private userDir: string | null = null
  private outgoingQueue: Array<{ event: string; data: string }> = []
  private flushScheduled = false
  private flushing = false

  // State
  private enabled = false
  private peers: VoicePeerInfo[] = []
  private selfId: number | null = null
  private gameReady = true

  // Overlay state pushed by renderer (rich UI signals)
  private selfMuted = false
  private tier: 'p2p' | 'relay' | 'server' | 'unknown' = 'unknown'
  private mutedPeerIds: Set<number> = new Set()
  private speakingPeerIds: Set<number> = new Set()
  private deployOverlay = true

  // Status file write throttle
  private statusWriteTimer: ReturnType<typeof setTimeout> | null = null
  private lastStatusWriteAt = 0
  private static readonly STATUS_MIN_INTERVAL_MS = 200

  // Command file polling cadence (overlay → manager)
  private commandPoller: ReturnType<typeof setInterval> | null = null
  private lastCommandTs = 0

  /** Get the main BrowserWindow dynamically (avoids init-order issues) */
  private getWindow(): BrowserWindow | null {
    const wins = BrowserWindow.getAllWindows()
    return wins.length > 0 ? wins[0] : null
  }

  private log(msg: string): void {
    console.log(`[VoiceChat] ${msg}`)
  }

  private get signalDir(): string {
    return join(this.userDir!, 'settings', 'BeamCM')
  }

  private get incomingPath(): string {
    return join(this.signalDir, 'vc_incoming.json')
  }

  private get outgoingPath(): string {
    return join(this.signalDir, 'vc_outgoing.json')
  }

  private get extensionPath(): string {
    return join(this.userDir!, 'lua', 'ge', 'extensions', 'beamcmVoice.lua')
  }

  private get statusFilePath(): string {
    return join(this.signalDir, 'vc_status.json')
  }

  private get commandFilePath(): string {
    return join(this.signalDir, 'vc_command.json')
  }

  /* ── Deploy / Undeploy ── */

  deployBridge(userDir: string): { success: boolean; error?: string } {
    try {
      this.userDir = userDir

      // Write Lua extension
      const extDir = join(userDir, 'lua', 'ge', 'extensions')
      mkdirSync(extDir, { recursive: true })
      writeFileSync(join(extDir, 'beamcmVoice.lua'), VOICE_BRIDGE_LUA.trim())

      // Ensure signal directory exists
      mkdirSync(this.signalDir, { recursive: true })

      // Clear stale signal files
      for (const f of [this.incomingPath, this.outgoingPath]) {
        if (existsSync(f)) unlinkSync(f)
      }

      this.deployed = true
      this.log('Bridge deployed to ' + this.extensionPath)
      this.startSignalPoller()
      this.startCommandPoller()
      this.writeStatusFileNow()
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy voice bridge: ${err}` }
    }
  }

  undeployBridge(): { success: boolean; error?: string } {
    try {
      this.stopSignalPoller()
      this.stopCommandPoller()

      if (this.userDir && existsSync(this.extensionPath)) {
        unlinkSync(this.extensionPath)
      }
      // Clean up signal files
      if (this.userDir) {
        for (const f of [this.incomingPath, this.outgoingPath, this.statusFilePath, this.commandFilePath]) {
          if (existsSync(f)) unlinkSync(f)
        }
      }

      this.deployed = false
      this.enabled = false
      this.peers = []
      this.selfId = null
      this.log('Bridge undeployed')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to undeploy voice bridge: ${err}` }
    }
  }

  isDeployed(): boolean {
    return this.deployed
  }

  /* ── Server Plugin ── */

  async deployServerPlugin(serverDir: string, resourceFolder: string): Promise<void> {
    const pluginDir = join(serverDir, resourceFolder, 'Server', 'BeamMPCMVoice')
    if (!existsSync(pluginDir)) await mkdir(pluginDir, { recursive: true })
    const pluginPath = join(pluginDir, 'main.lua')
    // Always overwrite so embedded plugin updates propagate
    await writeFile(pluginPath, VOICE_SERVER_PLUGIN, 'utf-8')
    this.log('Server voice plugin deployed to ' + pluginPath)

    // Deploy the BeamMP-distributed Client overlay mod alongside. BeamMP
    // automatically pushes Resources/Client/*.zip to every joining player,
    // so the in-game voice status overlay lights up for the whole lobby.
    const overlayZipPath = join(serverDir, resourceFolder, 'Client', 'beamcm-voice-overlay.zip')
    if (this.deployOverlay) {
      try {
        const clientDir = join(serverDir, resourceFolder, 'Client')
        if (!existsSync(clientDir)) await mkdir(clientDir, { recursive: true })
        await buildVoiceOverlayZip(overlayZipPath)
        this.log('Client voice overlay deployed to ' + overlayZipPath)
      } catch (err) {
        this.log('WARNING: Failed to deploy client voice overlay: ' + String(err))
      }
    } else {
      // User opted out — remove any previously deployed overlay so it stops
      // shipping to new joiners.
      try {
        if (existsSync(overlayZipPath)) {
          unlinkSync(overlayZipPath)
          this.log('Removed previously deployed overlay (deployOverlay=false)')
        }
      } catch {
        /* noop */
      }
    }
  }

  /** Toggle whether the in-game overlay mod is included with new server plugin deployments. */
  setDeployOverlay(value: boolean): void {
    this.deployOverlay = !!value
  }

  /* ── Signal File Poller ── */

  private startSignalPoller(): void {
    if (this.signalPoller) return
    this.signalPoller = setInterval(() => this.pollIncomingSignals(), 50)
    this.log('Signal poller started (50ms)')
  }

  private stopSignalPoller(): void {
    if (this.signalPoller) {
      clearInterval(this.signalPoller)
      this.signalPoller = null
      this.log('Signal poller stopped')
    }
  }

  private async pollIncomingSignals(): Promise<void> {
    if (!this.userDir || !existsSync(this.incomingPath)) return
    try {
      const raw = await readFile(this.incomingPath, 'utf-8')
      const messages: VoiceSignalMessage[] = JSON.parse(raw)
      if (!Array.isArray(messages) || messages.length === 0) return

      // Clear immediately after reading
      await writeFile(this.incomingPath, '[]', 'utf-8')

      for (const msg of messages) {
        this.handleIncomingMessage(msg)
      }
    } catch {
      // File might be empty, malformed, or being written — ignore
    }
  }

  private handleIncomingMessage(msg: VoiceSignalMessage): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      this.log(`Dropping signal '${msg.event}': no BrowserWindow available`)
      return
    }

    switch (msg.event) {
      case 'vc_peer_joined': {
        // data: "playerId,playerName"
        const commaIdx = msg.data.indexOf(',')
        if (commaIdx < 0) break
        const playerId = parseInt(msg.data.substring(0, commaIdx), 10)
        const playerName = msg.data.substring(commaIdx + 1) || `Player_${playerId}`
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          this.peers.push({ playerId, playerName, speaking: false })
          // We are the existing peer being notified → impolite (our offer wins)
          win.webContents.send('voice:peerJoined', { playerId, playerName, polite: false })
          this.log(`Peer joined: ${playerName} (pid=${playerId})`)
          this.scheduleStatusWrite()
        }
        break
      }
      case 'vc_peer_left': {
        // data: "playerId"
        const playerId = parseInt(msg.data, 10)
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          win.webContents.send('voice:peerLeft', { playerId })
          this.scheduleStatusWrite()
        }
        break
      }
      case 'vc_signal': {
        // data: "fromPlayerId|jsonPayload"
        const pipeIdx = msg.data.indexOf('|')
        if (pipeIdx < 0) break
        const fromId = parseInt(msg.data.substring(0, pipeIdx), 10)
        const payload = msg.data.substring(pipeIdx + 1)
        if (!isNaN(fromId)) {
          win.webContents.send('voice:signal', { fromId, payload })
        }
        break
      }
      case 'vc_peers_list': {
        // data: "<recipientSelfId>|id1:name1,id2:name2,..."
        // The leading recipientId is the player id the server assigned to US.
        // It allows the renderer's mesh tier to elect supernodes correctly.
        if (msg.data === undefined || msg.data === null) break
        const pipeIdx = (msg.data as string).indexOf('|')
        let listPart = msg.data as string
        if (pipeIdx >= 0) {
          const selfIdRaw = (msg.data as string).substring(0, pipeIdx)
          const selfId = parseInt(selfIdRaw, 10)
          listPart = (msg.data as string).substring(pipeIdx + 1)
          if (!isNaN(selfId)) {
            this.selfId = selfId
            win.webContents.send('voice:selfId', { selfId })
            this.log(`Self player id from server: ${selfId}`)
          }
        }
        if (!listPart) {
          this.scheduleStatusWrite()
          break
        }
        const entries = listPart.split(',')
        for (const entry of entries) {
          const colonIdx = entry.indexOf(':')
          if (colonIdx < 0) continue
          const playerId = parseInt(entry.substring(0, colonIdx), 10)
          const name = entry.substring(colonIdx + 1) || `Player_${playerId}`
          if (!isNaN(playerId)) {
            if (!this.peers.find((p) => p.playerId === playerId)) {
              this.peers.push({ playerId, playerName: name, speaking: false })
            }
            // We are the newcomer receiving the existing peer list → polite (yield on collision)
            win.webContents.send('voice:peerJoined', { playerId, playerName: name, polite: true })
            this.log(`Peers list: added ${name} (pid=${playerId})`)
          }
        }
        this.scheduleStatusWrite()
        break
      }
      case 'vc_audio': {
        // data: "<senderId>|<seq>|<base64opus>" — Tier 3 (server relay) audio frame.
        // High-volume (~17/s/talker); no per-frame log.
        const first = msg.data.indexOf('|')
        if (first < 0) break
        const second = msg.data.indexOf('|', first + 1)
        if (second < 0) break
        const fromId = parseInt(msg.data.substring(0, first), 10)
        const seq = parseInt(msg.data.substring(first + 1, second), 10)
        const b64 = msg.data.substring(second + 1)
        if (!isNaN(fromId) && !isNaN(seq) && b64) {
          win.webContents.send('voice:audio', { fromId, seq, data: b64 })
        }
        break
      }
    }
  }

  /* ── Outgoing Signals (renderer → file → Lua → server) ── */

  async sendSignal(event: string, data: string): Promise<void> {
    if (!this.userDir) {
      this.log(`Cannot send signal '${event}': userDir not set`)
      return
    }
    // Queue the signal and schedule a batched flush to avoid read-modify-write
    // races when multiple signals (offer + ICE candidates) fire in rapid succession.
    this.outgoingQueue.push({ event, data })
    if (!this.flushScheduled) {
      this.flushScheduled = true
      queueMicrotask(() => this.flushOutgoingQueue())
    }
  }

  /**
   * Tier 3 outbound audio frame. Same queue as sendSignal; the Lua bridge
   * forwards `vc_audio` events to the server which broadcasts to all other
   * voice peers. Wire format: data = "<seq>|<base64opus>".
   */
  async sendAudio(seq: number, base64Opus: string): Promise<void> {
    if (!this.userDir || !this.enabled) return
    this.outgoingQueue.push({ event: 'vc_audio', data: `${seq}|${base64Opus}` })
    if (!this.flushScheduled) {
      this.flushScheduled = true
      queueMicrotask(() => this.flushOutgoingQueue())
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    this.flushScheduled = false

    // Prevent concurrent flushes — async read+write can interleave and lose signals
    if (this.flushing) {
      if (this.outgoingQueue.length > 0 && !this.flushScheduled) {
        this.flushScheduled = true
        setTimeout(() => this.flushOutgoingQueue(), 10)
      }
      return
    }
    this.flushing = true

    try {
      const batch = this.outgoingQueue.splice(0)
      if (batch.length === 0) return
      if (!existsSync(this.signalDir)) {
        mkdirSync(this.signalDir, { recursive: true })
      }
      // Read existing signals that Lua hasn't consumed yet
      let existing: Array<{ event: string; data: string }> = []
      if (existsSync(this.outgoingPath)) {
        try {
          const raw = await readFile(this.outgoingPath, 'utf-8')
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) existing = parsed
        } catch { /* empty or malformed — start fresh */ }
      }
      existing.push(...batch)
      await writeFile(this.outgoingPath, JSON.stringify(existing), 'utf-8')
      this.log(`Flushed ${batch.length} signal(s) to outgoing (${existing.length} total queued)`)
    } catch (err) {
      this.log(`Failed to flush outgoing signals: ${err}`)
    } finally {
      this.flushing = false
      // If more signals accumulated while we were flushing, flush again
      if (this.outgoingQueue.length > 0 && !this.flushScheduled) {
        this.flushScheduled = true
        queueMicrotask(() => this.flushOutgoingQueue())
      }
    }
  }

  /* ── Enable / Disable ── */

  async enable(): Promise<void> {
    this.enabled = true
    await this.sendSignal('vc_enable', 'enable')
    this.scheduleStatusWrite()
    this.log('Voice chat enabled — vc_enable signal queued for server')
  }

  async disable(): Promise<void> {
    const peerCount = this.peers.length
    this.enabled = false
    this.peers = []
    this.selfId = null
    await this.sendSignal('vc_disable', 'disable')
    this.scheduleStatusWrite()
    this.log(`Voice chat disabled — vc_disable signal queued (had ${peerCount} peer(s))`)
  }

  /** Renderer can push richer state (e.g. game-running gate) into the overlay. */
  setGameReady(ready: boolean): void {
    if (this.gameReady === ready) return
    this.gameReady = ready
    this.scheduleStatusWrite()
  }

  /** Renderer can push live speaking flags so the overlay highlights talkers. */
  setSpeakingPeers(speakingPeerIds: number[]): void {
    let changed = false
    const speakingSet = new Set(speakingPeerIds)
    for (const p of this.peers) {
      const next = speakingSet.has(p.playerId)
      if (p.speaking !== next) {
        p.speaking = next
        changed = true
      }
    }
    // Cache the set so writeStatusFileNow can also mark peers we don't yet have rows for
    if (this.speakingPeerIds.size !== speakingSet.size) changed = true
    this.speakingPeerIds = speakingSet
    if (changed) this.scheduleStatusWrite()
  }

  /** Renderer pushes consolidated overlay state (self-mute, mesh tier, per-peer mute set). */
  setOverlayState(state: {
    selfMuted?: boolean
    tier?: 'p2p' | 'relay' | 'server' | 'unknown'
    mutedPeerIds?: number[]
  }): void {
    let changed = false
    if (typeof state.selfMuted === 'boolean' && state.selfMuted !== this.selfMuted) {
      this.selfMuted = state.selfMuted
      changed = true
    }
    if (state.tier && state.tier !== this.tier) {
      this.tier = state.tier
      changed = true
    }
    if (Array.isArray(state.mutedPeerIds)) {
      const next = new Set(state.mutedPeerIds)
      if (next.size !== this.mutedPeerIds.size || [...next].some((id) => !this.mutedPeerIds.has(id))) {
        this.mutedPeerIds = next
        changed = true
      }
    }
    if (changed) this.scheduleStatusWrite()
  }

  /* ── State Query ── */

  getState(): VoiceChatState {
    return {
      available: this.deployed,
      enabled: this.enabled,
      connected: this.deployed && this.enabled,
      peers: [...this.peers]
    }
  }

  /* ── Overlay status file writer (throttled) ── */

  /**
   * Write a snapshot of voice state to vc_status.json so the in-game overlay
   * can read it via the BeamCMVoice Lua global. Throttled to MIN_INTERVAL to
   * avoid hammering the disk on every speaking/peer event.
   */
  private scheduleStatusWrite(): void {
    if (!this.deployed || !this.userDir) return
    if (this.statusWriteTimer) return
    const sinceLast = Date.now() - this.lastStatusWriteAt
    const delay = Math.max(0, VoiceChatService.STATUS_MIN_INTERVAL_MS - sinceLast)
    this.statusWriteTimer = setTimeout(() => {
      this.statusWriteTimer = null
      this.writeStatusFileNow()
    }, delay)
  }

  private writeStatusFileNow(): void {
    if (!this.deployed || !this.userDir) return
    try {
      if (!existsSync(this.signalDir)) mkdirSync(this.signalDir, { recursive: true })
      const status = {
        available: this.deployed,
        enabled: this.enabled,
        connected: this.deployed && this.enabled,
        gameReady: this.gameReady,
        selfId: this.selfId,
        speaking: this.peers.some((p) => p.speaking) || false,
        muted: this.selfMuted,
        tier: this.tier,
        peers: this.peers.map((p) => ({
          id: p.playerId,
          name: p.playerName,
          speaking: !!p.speaking,
          muted: this.mutedPeerIds.has(p.playerId)
        })),
        ts: Date.now()
      }
      writeFileSync(this.statusFilePath, JSON.stringify(status), 'utf-8')
      this.lastStatusWriteAt = Date.now()
    } catch (err) {
      this.log('WARNING: failed to write status file: ' + String(err))
    }
  }

  /* ── Overlay command poller (overlay button → enable/disable) ── */

  private startCommandPoller(): void {
    if (this.commandPoller) return
    this.commandPoller = setInterval(() => this.pollOverlayCommand(), 250)
  }

  private stopCommandPoller(): void {
    if (this.commandPoller) {
      clearInterval(this.commandPoller)
      this.commandPoller = null
    }
  }

  private async pollOverlayCommand(): Promise<void> {
    if (!this.userDir || !existsSync(this.commandFilePath)) return
    try {
      const raw = await readFile(this.commandFilePath, 'utf-8')
      // Consume by deleting first so concurrent writes from Lua don't double-fire
      try { unlinkSync(this.commandFilePath) } catch { /* noop */ }
      const cmd = JSON.parse(raw) as { action?: string; ts?: number }
      if (!cmd || typeof cmd.action !== 'string') return
      // De-dupe via timestamp in case Lua re-wrote the same command rapidly
      if (typeof cmd.ts === 'number' && cmd.ts === this.lastCommandTs) return
      if (typeof cmd.ts === 'number') this.lastCommandTs = cmd.ts
      if (cmd.action === 'enable' && !this.enabled) {
        const win = this.getWindow()
        if (win && !win.isDestroyed()) {
          // Route through the renderer so the game-running gate + permissions
          // checks fire identically to clicking the in-app toggle button.
          win.webContents.send('voice:overlayCommand', { action: 'enable' })
        } else {
          await this.enable()
        }
        this.log('Overlay requested ENABLE')
      } else if (cmd.action === 'disable' && this.enabled) {
        const win = this.getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('voice:overlayCommand', { action: 'disable' })
        } else {
          await this.disable()
        }
        this.log('Overlay requested DISABLE')
      } else if (cmd.action === 'mute' || cmd.action === 'unmute') {
        const win = this.getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('voice:overlayCommand', { action: cmd.action })
        }
      } else if (typeof cmd.action === 'string' && cmd.action.startsWith('mute_peer:')) {
        const id = parseInt(cmd.action.slice('mute_peer:'.length), 10)
        if (!isNaN(id)) {
          const win = this.getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('voice:overlayCommand', { action: 'mute_peer', peerId: id })
          }
        }
      } else if (typeof cmd.action === 'string' && cmd.action.startsWith('unmute_peer:')) {
        const id = parseInt(cmd.action.slice('unmute_peer:'.length), 10)
        if (!isNaN(id)) {
          const win = this.getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('voice:overlayCommand', { action: 'unmute_peer', peerId: id })
          }
        }
      }
    } catch {
      /* ignore — file might be partially written */
    }
  }
}
