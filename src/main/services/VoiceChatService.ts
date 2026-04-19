import { writeFile, mkdir } from 'fs/promises'
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import type { VoiceChatState, VoicePeerInfo } from '../../shared/types'
import { VoiceBridgeSocket } from './VoiceBridgeSocket'

/* ── Embedded Lua: Voice Chat Bridge (client-side, deployed to BeamNG) ── */

const VOICE_BRIDGE_LUA = `
-- BeamCM Voice Chat Bridge
-- Auto-deployed by BeamMP Content Manager
-- Bridges WebRTC signaling AND audio between CM (Electron) and BeamMP
-- server events over a local TCP socket. Replaces the previous JSON-file
-- IPC, which suffered from a read-modify-write race and 50ms+50ms poll
-- jitter that made audio unusable on the receive path.

local M = {}

local socket = require("socket")
local portFile = "settings/BeamCM/vc_port.txt"
local cmHost = "127.0.0.1"
local cmPort = nil
local client = nil
local clientBuf = ""
local reconnectTimer = 0
local reconnectInterval = 1.0  -- seconds
local registered = false
local signalsSent = 0
local signalsReceived = 0
local audioOut = 0
local audioIn = 0

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

-- ── TCP bridge to CM ──────────────────────────────────────────────────
-- CM writes its listening port to settings/BeamCM/vc_port.txt on startup.
-- We connect, then exchange newline-delimited frames in BOTH directions:
--   S|event|data            signal (vc_enable, vc_signal, vc_disable, ...)
--   A|seq|b64               outbound audio (CM → us → vc_audio server event)
--   R|fromId|seq|b64        inbound audio  (server → us → CM)
--   H|                      heartbeat from us → CM (idle keepalive)
local function readPort()
  local f = io.open(portFile, "r")
  if not f then return nil end
  local txt = f:read("*l")
  f:close()
  if not txt then return nil end
  local n = tonumber(txt)
  if not n or n <= 0 then return nil end
  return n
end

local function tryConnect()
  if client then return end
  if not cmPort then
    cmPort = readPort()
    if not cmPort then return end
    log('I', 'beamcmVoice', 'Read CM port from ' .. portFile .. ': ' .. tostring(cmPort))
  end
  local sock = socket.tcp()
  sock:settimeout(0.05)
  local ok, err = sock:connect(cmHost, cmPort)
  if not ok and err ~= "already connected" then
    -- "Operation already in progress" / "timeout" are expected on async connect;
    -- fall through and let the next reconnect attempt re-poll.
    sock:close()
    return
  end
  sock:settimeout(0)        -- non-blocking for both send + receive
  sock:setoption("tcp-nodelay", true)
  client = sock
  clientBuf = ""
  log('I', 'beamcmVoice', 'Connected to CM bridge at 127.0.0.1:' .. tostring(cmPort))
end

local function disconnectClient(reason)
  if not client then return end
  pcall(function() client:close() end)
  client = nil
  clientBuf = ""
  log('W', 'beamcmVoice', 'Disconnected from CM bridge: ' .. tostring(reason))
end

local function sendLine(line)
  if not client then return false end
  local _, err = client:send(line)
  if err and err ~= "timeout" then
    disconnectClient(err)
    return false
  end
  return true
end

-- Drain everything currently readable from the client and dispatch each
-- complete line. Non-blocking; returns immediately if nothing pending.
local function pumpClient()
  if not client then return end
  while true do
    local data, err, partial = client:receive(4096)
    if data then
      clientBuf = clientBuf .. data
    elseif partial and #partial > 0 then
      clientBuf = clientBuf .. partial
    end
    if err == "closed" then
      disconnectClient("peer closed")
      return
    end
    -- Process complete lines from the buffer.
    while true do
      local nl = string.find(clientBuf, "\\n", 1, true)
      if not nl then break end
      local line = string.sub(clientBuf, 1, nl - 1)
      clientBuf = string.sub(clientBuf, nl + 1)
      if #line > 0 then
        local t = string.sub(line, 1, 1)
        if t == "S" then
          -- S|event|data
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local event = string.sub(line, 3, p1 - 1)
            local data = string.sub(line, p1 + 1)
            signalsReceived = signalsReceived + 1
            if event == "vc_enable" then
              enableRequested = true
              enableConfirmed = false
              enableRetryCount = 0
              enableRetryTimer = 0
              if worldReady then
                pcall(function() TriggerServerEvent("vc_enable", "enable") end)
                signalsSent = signalsSent + 1
              end
            elseif event == "vc_disable" then
              enableRequested = false
              enableConfirmed = false
              if worldReady then
                pcall(function() TriggerServerEvent("vc_disable", data) end)
                signalsSent = signalsSent + 1
              end
            else
              if worldReady then
                pcall(function() TriggerServerEvent(event, data) end)
                signalsSent = signalsSent + 1
              end
            end
          end
        elseif t == "A" then
          -- A|seq|b64 → forward as vc_audio server event
          if worldReady then
            local payload = string.sub(line, 3)
            pcall(function() TriggerServerEvent("vc_audio", payload) end)
            audioOut = audioOut + 1
          end
        end
      end
    end
    -- If there's no more data, stop the loop. (timeout means nothing
    -- currently available, not an error.)
    if err == "timeout" or not data then break end
  end
end

-- Append to CM via TCP, replacing the old appendIncoming(json) path.
local function pushSignal(event, data)
  signalsReceived = signalsReceived + 1   -- "received from server"
  sendLine("S|" .. event .. "|" .. tostring(data) .. "\\n")
end

-- BeamMP event handlers
local function onPeerJoined(data)
  enableConfirmed = true
  log('I', 'beamcmVoice', 'Peer joined event from server: data=' .. tostring(data))
  pushSignal("vc_peer_joined", data)
end

local function onPeerLeft(data)
  log('I', 'beamcmVoice', 'Peer left event from server: data=' .. tostring(data))
  pushSignal("vc_peer_left", data)
end

local function onSignal(data)
  pushSignal("vc_signal", data)
end

local function onPeersList(data)
  enableConfirmed = true
  log('I', 'beamcmVoice', 'Peers list from server: ' .. tostring(data))
  pushSignal("vc_peers_list", data)
end

-- vc_audio is high-volume (~17 frames/sec/talker). No per-frame log.
-- Server forwards "<senderId>|<seq>|<base64opus>"; we relay verbatim as
-- R|... to CM. The line stays a single line because b64 is single-line.
local function onAudio(data)
  if not client then return end
  audioIn = audioIn + 1
  client:send("R|" .. tostring(data) .. "\\n")
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
  log('I', 'beamcmVoice', 'Registered BeamMP event handlers')
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

-- Public API. The in-game overlay app has been removed; the global stays as
-- a no-op stub so any leftover overlay zips on disk don't error out.
_G.BeamCMVoice = _G.BeamCMVoice or {}
function _G.BeamCMVoice.getStatus()
  return jsonEncode({ available = false, enabled = false, connected = false, peers = {} })
end
function _G.BeamCMVoice.sendCommand(_) end

local function onExtensionLoaded()
  if setExtensionUnloadMode then
    setExtensionUnloadMode('beamcmVoice', 'manual')
    log('I', 'beamcmVoice', 'Set unload mode to manual (survives level transitions)')
  end
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge loaded (TCP IPC mode)')
  log('I', 'beamcmVoice', 'Will look for CM port at: ' .. portFile)
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

local statsTimer = 0
local function onUpdate(dt)
  if not registered then tryRegister() end
  startupElapsed = startupElapsed + dt

  -- Reconnect ladder
  if not client then
    reconnectTimer = reconnectTimer + dt
    if reconnectTimer >= reconnectInterval then
      reconnectTimer = 0
      tryConnect()
    end
  else
    pumpClient()
  end

  -- vc_enable retry loop
  if enableRequested and not enableConfirmed and worldReady then
    enableRetryTimer = enableRetryTimer + dt
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

  -- Periodic stats + heartbeat
  statsTimer = statsTimer + dt
  if statsTimer >= 30 then
    statsTimer = 0
    log('I', 'beamcmVoice', 'Status: connected=' .. tostring(client ~= nil)
      .. ', worldReady=' .. tostring(worldReady)
      .. ', enableReq=' .. tostring(enableRequested)
      .. ', enableConf=' .. tostring(enableConfirmed)
      .. ', sigSent=' .. signalsSent .. ', sigRecv=' .. signalsReceived
      .. ', audOut=' .. audioOut .. ', audIn=' .. audioIn
      .. ', uptime=' .. string.format("%.0f", startupElapsed) .. 's')
    if client then sendLine("H|\\n") end
  end
end

local function onExtensionUnloaded()
  log('I', 'beamcmVoice', 'BeamCM Voice Chat bridge unloaded (sigSent=' .. signalsSent .. ', sigRecv=' .. signalsReceived .. ', audOut=' .. audioOut .. ', audIn=' .. audioIn .. ')')
  disconnectClient("extension unload")
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
  private bridge: VoiceBridgeSocket | null = null
  private deployed = false
  private userDir: string | null = null

  // Buffered outgoing messages while bridge isn't connected yet (e.g. game
  // not yet launched). Replaces the legacy outgoing-file queue.
  private outboundBacklog: Array<{ kind: 'S' | 'A'; a: string; b: string }> = []
  private static readonly OUTBOUND_CAP = 256

  // State
  private enabled = false
  private peers: VoicePeerInfo[] = []

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

  /** Legacy paths — only used for cleanup of stale files from older builds. */
  private get legacyIncomingPath(): string {
    return join(this.signalDir, 'vc_incoming.json')
  }
  private get legacyOutgoingPath(): string {
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

      // Sweep stale legacy file-IPC artifacts so the new TCP bridge can't
      // accidentally pick up garbage on first run.
      for (const f of [this.legacyIncomingPath, this.legacyOutgoingPath]) {
        if (existsSync(f)) unlinkSync(f)
      }

      // Bring up the TCP listener and write the port file Lua looks for.
      void this.startBridge()

      this.deployed = true
      this.log('Bridge deployed to ' + this.extensionPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy voice bridge: ${err}` }
    }
  }

  private async startBridge(): Promise<void> {
    if (this.bridge) return
    const bridge = new VoiceBridgeSocket()
    bridge.onSignal((event, data) => this.handleIncomingSignal(event, data))
    bridge.onAudio((fromId, seq, b64) => this.handleIncomingAudio(fromId, seq, b64))
    bridge.onConnect(() => {
      this.log(`Bridge client connected — flushing ${this.outboundBacklog.length} queued message(s)`)
      const backlog = this.outboundBacklog.splice(0)
      for (const m of backlog) {
        if (m.kind === 'S') bridge.sendSignal(m.a, m.b)
        else bridge.sendAudio(parseInt(m.a, 10), m.b)
      }
    })
    try {
      const port = await bridge.start(this.signalDir)
      this.bridge = bridge
      this.log(`TCP bridge listening on 127.0.0.1:${port}`)
    } catch (err) {
      this.log(`Bridge start failed: ${err}`)
    }
  }

  undeployBridge(): { success: boolean; error?: string } {
    try {
      if (this.bridge) {
        this.bridge.stop()
        this.bridge = null
      }

      if (this.userDir && existsSync(this.extensionPath)) {
        unlinkSync(this.extensionPath)
      }
      // Clean up signal files (incl. legacy status/command files)
      if (this.userDir) {
        for (const f of [
          this.legacyIncomingPath,
          this.legacyOutgoingPath,
          join(this.signalDir, 'vc_status.json'),
          join(this.signalDir, 'vc_command.json'),
          join(this.signalDir, 'vc_port.txt'),
        ]) {
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
    // Always overwrite so embedded plugin updates propagate
    await writeFile(pluginPath, VOICE_SERVER_PLUGIN, 'utf-8')
    this.log('Server voice plugin deployed to ' + pluginPath)

    // Sweep any previously-deployed in-game overlay zip; the overlay system
    // has been removed entirely.
    const overlayZipPath = join(serverDir, resourceFolder, 'Client', 'beamcm-voice-overlay.zip')
    try {
      if (existsSync(overlayZipPath)) {
        unlinkSync(overlayZipPath)
        this.log('Removed legacy overlay zip ' + overlayZipPath)
      }
    } catch {
      /* noop */
    }
  }

  /* ── Bridge Inbound Dispatch ── */

  private handleIncomingAudio(fromId: number, seq: number, b64: string): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('voice:audio', { fromId, seq, data: b64 })
  }

  private handleIncomingSignal(event: string, data: string): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      this.log(`Dropping signal '${event}': no BrowserWindow available`)
      return
    }

    switch (event) {
      case 'vc_peer_joined': {
        // data: "playerId,playerName"
        const commaIdx = data.indexOf(',')
        if (commaIdx < 0) break
        const playerId = parseInt(data.substring(0, commaIdx), 10)
        const playerName = data.substring(commaIdx + 1) || `Player_${playerId}`
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          this.peers.push({ playerId, playerName, speaking: false })
          win.webContents.send('voice:peerJoined', { playerId, playerName, polite: false })
          this.log(`Peer joined: ${playerName} (pid=${playerId})`)
        }
        break
      }
      case 'vc_peer_left': {
        const playerId = parseInt(data, 10)
        if (!isNaN(playerId)) {
          this.peers = this.peers.filter((p) => p.playerId !== playerId)
          win.webContents.send('voice:peerLeft', { playerId })
        }
        break
      }
      case 'vc_signal': {
        const pipeIdx = data.indexOf('|')
        if (pipeIdx < 0) break
        const fromId = parseInt(data.substring(0, pipeIdx), 10)
        const payload = data.substring(pipeIdx + 1)
        if (!isNaN(fromId)) {
          win.webContents.send('voice:signal', { fromId, payload })
        }
        break
      }
      case 'vc_peers_list': {
        if (!data) break
        const pipeIdx = data.indexOf('|')
        let listPart = data
        if (pipeIdx >= 0) {
          const selfId = parseInt(data.substring(0, pipeIdx), 10)
          listPart = data.substring(pipeIdx + 1)
          if (!isNaN(selfId)) {
            win.webContents.send('voice:selfId', { selfId })
            this.log(`Self player id from server: ${selfId}`)
          }
        }
        if (!listPart) break
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
            win.webContents.send('voice:peerJoined', { playerId, playerName: name, polite: true })
            this.log(`Peers list: added ${name} (pid=${playerId})`)
          }
        }
        break
      }
    }
  }

  /* ── Outgoing (CM → bridge → Lua → BeamMP server) ── */

  async sendSignal(event: string, data: string): Promise<void> {
    if (!this.userDir) {
      this.log(`Cannot send signal '${event}': userDir not set`)
      return
    }
    if (this.bridge && this.bridge.isConnected()) {
      this.bridge.sendSignal(event, data)
      return
    }
    if (this.outboundBacklog.length >= VoiceChatService.OUTBOUND_CAP) {
      this.outboundBacklog.shift()
    }
    this.outboundBacklog.push({ kind: 'S', a: event, b: data })
  }

  /**
   * Tier 3 outbound audio frame. Bypasses the signal queue entirely — drops
   * the frame on the floor if the bridge isn't connected (audio is
   * loss-tolerant; queueing would only add jitter).
   */
  async sendAudio(seq: number, base64Opus: string): Promise<void> {
    if (!this.userDir || !this.enabled) return
    if (!this.bridge || !this.bridge.isConnected()) return
    this.bridge.sendAudio(seq, base64Opus)
  }

  /* ── Enable / Disable ── */

  async enable(): Promise<void> {
    this.enabled = true
    await this.sendSignal('vc_enable', 'enable')
    this.log('Voice chat enabled — vc_enable signal queued for server')
  }

  async disable(): Promise<void> {
    const peerCount = this.peers.length
    this.enabled = false
    this.peers = []
    await this.sendSignal('vc_disable', 'disable')
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
