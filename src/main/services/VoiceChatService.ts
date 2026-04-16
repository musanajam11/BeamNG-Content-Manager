import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import type { VoiceSignalMessage, VoiceChatState, VoicePeerInfo } from '../../shared/types'

/* ── Embedded Lua: Voice Chat Bridge (client-side, deployed to BeamNG) ── */

const VOICE_BRIDGE_LUA = `
-- BeamCM Voice Chat Bridge
-- Auto-deployed by BeamMP Content Manager
-- Bridges WebRTC signaling between CM (Electron) and BeamMP server events.
-- This extension does NOT handle audio — only signaling messages.

local M = {}

local incomingFile = "settings/BeamCM/vc_incoming.json"
local outgoingFile = "settings/BeamCM/vc_outgoing.json"
local pollInterval = 0.25
local timer = 0
local registered = false
local pollCount = 0
local signalsSent = 0
local signalsReceived = 0

local function tryRegister()
  if registered then return end
  if type(AddEventHandler) ~= "function" then return end
  pcall(function()
    AddEventHandler("vc_peer_joined", "beamcmVoiceOnPeerJoined")
    AddEventHandler("vc_peer_left", "beamcmVoiceOnPeerLeft")
    AddEventHandler("vc_signal", "beamcmVoiceOnSignal")
    AddEventHandler("vc_peers_list", "beamcmVoiceOnPeersList")
  end)
  registered = true
  log('I', 'beamcmVoice', 'Registered BeamMP event handlers (AddEventHandler available)')
end

-- Append a message to the incoming JSON file for CM to read
local function appendIncoming(msg)
  local existing = {}
  local ok, content = pcall(jsonReadFile, incomingFile)
  if ok and type(content) == "table" then existing = content end
  table.insert(existing, msg)
  jsonWriteFile(incomingFile, existing)
  signalsReceived = signalsReceived + 1
end

-- Global event handlers (called by BeamMP event system)
function beamcmVoiceOnPeerJoined(senderId, data)
  log('I', 'beamcmVoice', 'Peer joined event from server: sender=' .. tostring(senderId) .. ' data=' .. tostring(data))
  appendIncoming({ event = "vc_peer_joined", data = tostring(senderId) .. "|" .. tostring(data) })
end

function beamcmVoiceOnPeerLeft(senderId, data)
  log('I', 'beamcmVoice', 'Peer left event from server: sender=' .. tostring(senderId) .. ' data=' .. tostring(data))
  appendIncoming({ event = "vc_peer_left", data = tostring(senderId) .. "|" .. tostring(data) })
end

function beamcmVoiceOnSignal(senderId, data)
  appendIncoming({ event = "vc_signal", data = tostring(senderId) .. "|" .. tostring(data) })
end

function beamcmVoiceOnPeersList(senderId, data)
  log('I', 'beamcmVoice', 'Peers list from server: ' .. tostring(data))
  appendIncoming({ event = "vc_peers_list", data = tostring(data) })
end

local function onExtensionLoaded()
  -- Survive level transitions so voice chat stays active across map loads
  if setExtensionUnloadMode then
    setExtensionUnloadMode('beamcmVoice', 'manual')
    log('I', 'beamcmVoice', 'Set unload mode to manual (survives level transitions)')
  end
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge loaded')
  log('I', 'beamcmVoice', 'Outgoing file: ' .. outgoingFile)
  log('I', 'beamcmVoice', 'Incoming file: ' .. incomingFile)
  log('I', 'beamcmVoice', 'Poll interval: ' .. tostring(pollInterval) .. 's')
  tryRegister()
end

local function onUpdate(dt)
  if not registered then tryRegister() end
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  pollCount = pollCount + 1

  -- Read outgoing signals written by CM and send them as BeamMP events
  local ok, content = pcall(jsonReadFile, outgoingFile)
  if ok and type(content) == "table" and #content > 0 then
    local sent = 0
    local skipped = 0
    for _, msg in ipairs(content) do
      if msg.event and msg.data then
        if type(TriggerServerEvent) == "function" then
          local sendOk, sendErr = pcall(function() TriggerServerEvent(msg.event, msg.data) end)
          if sendOk then
            sent = sent + 1
            signalsSent = signalsSent + 1
          else
            log('W', 'beamcmVoice', 'TriggerServerEvent failed: ' .. tostring(sendErr))
          end
        else
          skipped = skipped + 1
        end
      end
    end
    -- Clear the file after processing
    jsonWriteFile(outgoingFile, {})
    if sent > 0 then
      log('I', 'beamcmVoice', 'Sent ' .. sent .. ' signal(s) to server (total: ' .. signalsSent .. ')')
    end
    if skipped > 0 then
      log('W', 'beamcmVoice', 'Skipped ' .. skipped .. ' signal(s) — TriggerServerEvent not available (not in multiplayer?)')
    end
  end

  -- Periodic status log every 60s (240 polls at 0.25s)
  if pollCount % 240 == 0 then
    log('I', 'beamcmVoice', 'Status: registered=' .. tostring(registered) .. ', sent=' .. signalsSent .. ', received=' .. signalsReceived .. ', TriggerServerEvent=' .. tostring(type(TriggerServerEvent) == "function"))
  end
end

local function onExtensionUnloaded()
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge unloaded (sent=' .. signalsSent .. ', received=' .. signalsReceived .. ')')
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate
return M
`

/* ── Embedded Lua: Voice Chat Server Plugin (deployed to BeamMP server) ── */

const VOICE_SERVER_PLUGIN = `-- BeamCM Voice Chat Server Plugin
-- Auto-deployed by BeamMP Content Manager
-- Relays WebRTC signaling between voice-chat-enabled players.

local TAG = "[BeamCM-Voice] "
local voicePeers = {}  -- [playerId] = { name = "...", joinedAt = os.time() }
local signalCount = 0

print(TAG .. "Voice chat server plugin loading...")

MP.RegisterEvent("vc_enable", "vcOnEnable")
MP.RegisterEvent("vc_disable", "vcOnDisable")
MP.RegisterEvent("vc_signal", "vcOnSignal")
MP.RegisterEvent("onPlayerDisconnect", "vcOnDisconnect")
MP.RegisterEvent("onPlayerJoin", "vcOnPlayerJoin")

print(TAG .. "Events registered: vc_enable, vc_disable, vc_signal, onPlayerDisconnect, onPlayerJoin")

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
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  voicePeers[player_id] = { name = name, joinedAt = os.time() }
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
    MP.TriggerClientEvent(player_id, "vc_peers_list", table.concat(peerList, ","))
    print(TAG .. "Sent peers list to " .. name .. ": " .. #peerList .. " peer(s)")
  else
    print(TAG .. name .. " is the first voice peer (no existing peers to send)")
  end
end

function vcOnDisable(player_id, data)
  if voicePeers[player_id] then
    local name = voicePeers[player_id].name
    local duration = os.time() - (voicePeers[player_id].joinedAt or os.time())
    voicePeers[player_id] = nil
    local remaining = getPeerCount()
    print(TAG .. "DISABLED: " .. name .. " (pid=" .. tostring(player_id) .. ") left voice chat (was active " .. duration .. "s)")
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
    print(TAG .. "WARNING: Malformed signal from pid=" .. tostring(player_id) .. " (no separator)")
    return
  end
  local targetId = tonumber(string.sub(data, 1, sep - 1))
  local payload = string.sub(data, sep + 1)
  if not targetId then
    print(TAG .. "WARNING: Invalid target ID in signal from pid=" .. tostring(player_id))
    return
  end
  if voicePeers[targetId] then
    MP.TriggerClientEvent(targetId, "vc_signal", player_id .. "|" .. payload)
    signalCount = signalCount + 1
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
    local name = voicePeers[player_id].name
    local duration = os.time() - (voicePeers[player_id].joinedAt or os.time())
    voicePeers[player_id] = nil
    local remaining = getPeerCount()
    print(TAG .. "DISCONNECT: " .. name .. " (pid=" .. tostring(player_id) .. ") left server (was in voice " .. duration .. "s)")
    local notified = 0
    for pid, _ in pairs(voicePeers) do
      MP.TriggerClientEvent(pid, "vc_peer_left", tostring(player_id))
      notified = notified + 1
    end
    print(TAG .. "Active voice peers: " .. remaining .. (remaining > 0 and (" [" .. getPeerNames() .. "]") or " (none)"))
  end
end

function vcOnPlayerJoin(player_id)
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  print(TAG .. "Player joined server: " .. name .. " (pid=" .. tostring(player_id) .. ") — voice not yet enabled")
end

print(TAG .. "Plugin loaded successfully — waiting for players to enable voice chat")
`

export class VoiceChatService {
  private signalPoller: ReturnType<typeof setInterval> | null = null
  private deployed = false
  private userDir: string | null = null
  private window: BrowserWindow | null = null

  // State
  private enabled = false
  private peers: VoicePeerInfo[] = []

  setWindow(win: BrowserWindow): void {
    this.window = win
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
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy voice bridge: ${err}` }
    }
  }

  undeployBridge(): { success: boolean; error?: string } {
    try {
      this.stopSignalPoller()

      if (this.userDir && existsSync(this.extensionPath)) {
        unlinkSync(this.extensionPath)
      }
      // Clean up signal files
      if (this.userDir) {
        for (const f of [this.incomingPath, this.outgoingPath]) {
          if (existsSync(f)) unlinkSync(f)
        }
      }

      this.deployed = false
      this.enabled = false
      this.peers = []
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
    if (!existsSync(pluginPath)) {
      await writeFile(pluginPath, VOICE_SERVER_PLUGIN, 'utf-8')
      this.log('Server voice plugin deployed to ' + pluginPath)
    } else {
      this.log('Server voice plugin already exists at ' + pluginPath)
    }
  }

  /* ── Signal File Poller ── */

  private startSignalPoller(): void {
    if (this.signalPoller) return
    this.signalPoller = setInterval(() => this.pollIncomingSignals(), 100)
    this.log('Signal poller started (100ms)')
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
    if (!this.window || this.window.isDestroyed()) return

    switch (msg.event) {
      case 'vc_peer_joined': {
        // data: "senderId|playerId,playerName"
        const pipeIdx = msg.data.indexOf('|')
        if (pipeIdx < 0) break
        const payload = msg.data.substring(pipeIdx + 1)
        const commaIdx = payload.indexOf(',')
        if (commaIdx < 0) break
        const playerId = parseInt(payload.substring(0, commaIdx), 10)
        const playerName = payload.substring(commaIdx + 1)
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          this.peers.push({ playerId, playerName, speaking: false })
          this.window.webContents.send('voice:peerJoined', { playerId, playerName })
        }
        break
      }
      case 'vc_peer_left': {
        // data: "senderId|playerId"
        const pipeIdx = msg.data.indexOf('|')
        const idStr = pipeIdx >= 0 ? msg.data.substring(pipeIdx + 1) : msg.data
        const playerId = parseInt(idStr, 10)
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          this.window.webContents.send('voice:peerLeft', { playerId })
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
          this.window.webContents.send('voice:signal', { fromId, payload })
        }
        break
      }
      case 'vc_peers_list': {
        // data: "id1:name1,id2:name2,..."
        const pipeIdx = msg.data.indexOf('|')
        const listStr = pipeIdx >= 0 ? msg.data.substring(pipeIdx + 1) : msg.data
        if (!listStr) break
        const entries = listStr.split(',')
        for (const entry of entries) {
          const [idStr, name] = entry.split(':')
          const playerId = parseInt(idStr, 10)
          if (!isNaN(playerId) && name) {
            if (!this.peers.find((p) => p.playerId === playerId)) {
              this.peers.push({ playerId, playerName: name, speaking: false })
            }
            this.window.webContents.send('voice:peerJoined', { playerId, playerName: name })
          }
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
    try {
      // Ensure signal directory exists
      if (!existsSync(this.signalDir)) {
        mkdirSync(this.signalDir, { recursive: true })
      }
      // Write as a single-element array — the Lua bridge reads and clears the file
      // each poll cycle, so we don't need to accumulate
      await writeFile(this.outgoingPath, JSON.stringify([{ event, data }]), 'utf-8')
      this.log(`Signal '${event}' written to ${this.outgoingPath}`)
    } catch (err) {
      this.log(`Failed to write outgoing signal '${event}': ${err}`)
    }
  }

  /* ── Enable / Disable ── */

  async enable(): Promise<void> {
    this.enabled = true
    await this.sendSignal('vc_enable', '')
    this.log('Voice chat enabled — vc_enable signal queued for server')
  }

  async disable(): Promise<void> {
    const peerCount = this.peers.length
    this.enabled = false
    this.peers = []
    await this.sendSignal('vc_disable', '')
    this.log(`Voice chat disabled — vc_disable signal queued (had ${peerCount} peer(s))`)
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
}
