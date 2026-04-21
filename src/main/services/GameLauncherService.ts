import { spawn, ChildProcess, execSync } from 'child_process'
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  createReadStream,
  readdirSync,
  statSync,
  rmSync
} from 'fs'
import { join, extname, basename } from 'path'
import {
  createServer as createHttpServer,
  IncomingMessage,
  ServerResponse
} from 'http'
import { request as httpsRequest } from 'https'
import type { Server as HttpServer } from 'http'
import * as net from 'net'
import * as dgram from 'dgram'
import * as zlib from 'zlib'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { app, BrowserWindow, safeStorage } from 'electron'
import type { GamePaths, GameStatus } from '../../shared/types'
import { EditorSyncBridgeSocket, type LuaOpEnvelope, type LuaHello, type LuaPose } from './EditorSyncBridgeSocket'

interface ModInfo {
  file_name: string
  file_size: number
  hash: string
  hash_algorithm: string
  protected?: boolean
}

const LAUNCHER_VERSION = '2.8.0'

// Lua bridge extension deployed into BeamNG as a mod ZIP to properly initiate server connections
const BRIDGE_LUA = `
local M = {}
local signalFile = "settings/BeamMP/cm_join.json"
local pollInterval = 0.25
local timer = 0
local joined = false
local voiceLoaded = false
local consoleLoaded = false

local function tryAutoLoadConsole()
  local f = io.open("lua/ge/extensions/beamcmConsole.lua", "r")
  if not f then return end
  f:close()
  if consoleLoaded then return end
  extensions.load('beamcmConsole')
  setExtensionUnloadMode('beamcmConsole', 'manual')
  consoleLoaded = true
  log('I', 'beammpCMBridge', 'Auto-loaded beamcmConsole extension (manual unload mode)')
end

local function onExtensionLoaded()
  log('I', 'beammpCMBridge', 'BeamMP Content Manager bridge extension loaded')
  -- Auto-load voice chat bridge if deployed
  local voiceExt = "lua/ge/extensions/beamcmVoice.lua"
  local f = io.open(voiceExt, "r")
  if f then
    f:close()
    extensions.load('beamcmVoice')
    setExtensionUnloadMode('beamcmVoice', 'manual')
    voiceLoaded = true
    log('I', 'beammpCMBridge', 'Auto-loaded beamcmVoice extension (manual unload mode)')
  end
  -- Auto-load Lua console bridge if deployed
  tryAutoLoadConsole()
end

-- ── GPS tracker hot-load support ──
local gpsSignalFile = "settings/BeamCM/gps_signal.json"
local gpsPollInterval = 0.5
local gpsTimer = 0
local gpsLoaded = false

local function pollGpsSignal(dt)
  gpsTimer = gpsTimer + dt
  if gpsTimer < gpsPollInterval then return end
  gpsTimer = 0
  local sig = jsonReadFile(gpsSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(gpsSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not gpsLoaded then
    log('I', 'beammpCMBridge', 'Hot-loading GPS tracker extension')
    extensions.load('beamcmGPS')
    gpsLoaded = true
  elseif sig.action == "unload" and gpsLoaded then
    log('I', 'beammpCMBridge', 'Unloading GPS tracker extension')
    extensions.unload('beamcmGPS')
    gpsLoaded = false
  end
end

-- ── Lua console hot-load support ──
local consoleSignalFile = "settings/BeamCM/console_signal.json"
local consoleTimer = 0
local consolePollInterval = 0.5

local function pollConsoleSignal(dt)
  consoleTimer = consoleTimer + dt
  if consoleTimer < consolePollInterval then return end
  consoleTimer = 0
  local sig = jsonReadFile(consoleSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(consoleSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" then
    if not consoleLoaded then
      tryAutoLoadConsole()
    end
  elseif sig.action == "unload" and consoleLoaded then
    log('I', 'beammpCMBridge', 'Unloading Lua console extension')
    extensions.unload('beamcmConsole')
    consoleLoaded = false
  end
end

-- ── World Editor Sync hot-load support ──
local editorSyncSignalFile = "settings/BeamCM/editorsync_signal.json"
local editorSyncTimer = 0
local editorSyncPollInterval = 0.5
local editorSyncLoaded = false

local function pollEditorSyncSignal(dt)
  editorSyncTimer = editorSyncTimer + dt
  if editorSyncTimer < editorSyncPollInterval then return end
  editorSyncTimer = 0
  local sig = jsonReadFile(editorSyncSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(editorSyncSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not editorSyncLoaded then
    log('I', 'beammpCMBridge', 'Hot-loading World Editor Sync extension')
    extensions.load('beamcmEditorSync')
    setExtensionUnloadMode('beamcmEditorSync', 'manual')
    editorSyncLoaded = true
  elseif sig.action == "unload" and editorSyncLoaded then
    log('I', 'beammpCMBridge', 'Unloading World Editor Sync extension')
    extensions.unload('beamcmEditorSync')
    editorSyncLoaded = false
  end
end

local function onUpdate(dt)
  -- GPS hot-load polling always runs
  pollGpsSignal(dt)
  -- Lua console hot-load polling always runs
  pollConsoleSignal(dt)
  -- World Editor Sync hot-load polling always runs
  pollEditorSyncSignal(dt)

  if joined then return end
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  local content = jsonReadFile(signalFile)
  if not content or content.processed then return end
  if not content.ip or not content.port then return end
  jsonWriteFile(signalFile, {processed = true})
  joined = true
  log('I', 'beammpCMBridge', 'CM join signal: ' .. content.ip .. ':' .. tostring(content.port))
  if extensions.MPCoreNetwork and extensions.MPCoreNetwork.connectToServer then
    -- Navigate to the BeamMP multiplayer menu so the loading overlay is visible
    guihooks.trigger('MenuOpenModule', 'multiplayer')
    -- Show immediate loading feedback
    guihooks.trigger('LoadingInfo', {message = 'Connecting to server...'})
    log('I', 'beammpCMBridge', 'Calling MPCoreNetwork.connectToServer')
    extensions.MPCoreNetwork.connectToServer(content.ip, tonumber(content.port), "", content.name or "")
  else
    log('E', 'beammpCMBridge', 'MPCoreNetwork not available - is BeamMP mod loaded?')
    joined = false
  end
end

M.onExtensionLoaded = onExtensionLoaded
M.onUpdate = onUpdate
return M
`

// Lua bridge for singleplayer launches — deployed as an unpacked mod so BeamNG loads
// it automatically. Reads a signal file and auto-loads the requested level + vehicle.
const VANILLA_BRIDGE_LUA = `
local M = {}
local signalFile = "settings/BeamCM/launch_signal.json"
local pollInterval = 0.5
local timer = 0
local acted = false
local pendingVehicle = nil
local startupDelay = 3
local startupTimer = 0
local ready = false

local function onExtensionLoaded()
  log('I', 'beamcmBridge', 'BeamCM singleplayer bridge loaded')
  -- Auto-load Lua console bridge if deployed
  local consoleExt = "lua/ge/extensions/beamcmConsole.lua"
  local cf = io.open(consoleExt, "r")
  if cf then
    cf:close()
    extensions.load('beamcmConsole')
    setExtensionUnloadMode('beamcmConsole', 'manual')
    log('I', 'beamcmBridge', 'Auto-loaded beamcmConsole extension')
  end
end

local function onUpdate(dt)
  if acted then return end
  -- Wait a few seconds after game start so the engine is fully ready
  if not ready then
    startupTimer = startupTimer + dt
    if startupTimer < startupDelay then return end
    ready = true
  end
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  local content = jsonReadFile(signalFile)
  if not content or content.processed then return end
  jsonWriteFile(signalFile, {processed = true})
  acted = true
  local mode = content.mode or "freeroam"
  log('I', 'beamcmBridge', 'CM launch signal: mode=' .. mode)
  if content.vehicle then pendingVehicle = content.vehicle end
  if mode == "freeroam" then
    local level = content.level or "gridmap_v2/info.json"
    log('I', 'beamcmBridge', 'Loading level: ' .. level)
    if core_levels and core_levels.startLevel then
      core_levels.startLevel(level)
    end
  else
    -- For game-mode screens, try to navigate via the UI system
    log('I', 'beamcmBridge', 'Navigating to game mode: ' .. mode)
    local modeMap = {
      campaigns    = "/menu/campaigns",
      scenarios    = "/menu/scenarios",
      challenges   = "/menu/challenges",
      rally        = "/menu/rally",
      timeTrials   = "/menu/timeTrials",
      busRoutes    = "/menu/busRoutes",
      lightRunner  = "/menu/lightRunner",
      trackBuilder = "/menu/trackBuilder",
      garage       = "/menu/garage",
      replays      = "/menu/replays",
      stats        = "/menu/stats"
    }
    local path = modeMap[mode]
    if path and guihooks and guihooks.trigger then
      guihooks.trigger('MenuOpenModule', path)
    end
  end
end

local function onClientStartMission()
  if not pendingVehicle then return end
  local veh = pendingVehicle
  pendingVehicle = nil
  log('I', 'beamcmBridge', 'Spawning vehicle: ' .. veh)
  if core_vehicles and core_vehicles.replaceVehicle then
    core_vehicles.replaceVehicle(veh, {})
  end
end

-- ── GPS tracker hot-load support ──
local gpsSignalFile = "settings/BeamCM/gps_signal.json"
local gpsPollInterval = 0.5
local gpsTimer = 0
local gpsLoaded = false

local function pollGpsSignal(dt)
  gpsTimer = gpsTimer + dt
  if gpsTimer < gpsPollInterval then return end
  gpsTimer = 0
  local sig = jsonReadFile(gpsSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(gpsSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not gpsLoaded then
    log('I', 'beamcmBridge', 'Hot-loading GPS tracker extension')
    extensions.load('beamcmGPS')
    gpsLoaded = true
  elseif sig.action == "unload" and gpsLoaded then
    log('I', 'beamcmBridge', 'Unloading GPS tracker extension')
    extensions.unload('beamcmGPS')
    gpsLoaded = false
  end
end

-- ── Lua console hot-load support ──
local consoleSignalFile = "settings/BeamCM/console_signal.json"
local consoleTimer = 0
local consolePollInterval = 0.5
local consoleLoaded = false

local function pollConsoleSignal(dt)
  consoleTimer = consoleTimer + dt
  if consoleTimer < consolePollInterval then return end
  consoleTimer = 0
  local sig = jsonReadFile(consoleSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(consoleSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not consoleLoaded then
    log('I', 'beamcmBridge', 'Hot-loading Lua console extension')
    extensions.load('beamcmConsole')
    setExtensionUnloadMode('beamcmConsole', 'manual')
    consoleLoaded = true
  elseif sig.action == "unload" and consoleLoaded then
    log('I', 'beamcmBridge', 'Unloading Lua console extension')
    extensions.unload('beamcmConsole')
    consoleLoaded = false
  end
end

-- ── World Editor Sync hot-load support ──
local editorSyncSignalFile = "settings/BeamCM/editorsync_signal.json"
local editorSyncTimer = 0
local editorSyncPollInterval = 0.5
local editorSyncLoaded = false

local function pollEditorSyncSignal(dt)
  editorSyncTimer = editorSyncTimer + dt
  if editorSyncTimer < editorSyncPollInterval then return end
  editorSyncTimer = 0
  local sig = jsonReadFile(editorSyncSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(editorSyncSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not editorSyncLoaded then
    log('I', 'beamcmBridge', 'Hot-loading World Editor Sync extension')
    extensions.load('beamcmEditorSync')
    setExtensionUnloadMode('beamcmEditorSync', 'manual')
    editorSyncLoaded = true
  elseif sig.action == "unload" and editorSyncLoaded then
    log('I', 'beamcmBridge', 'Unloading World Editor Sync extension')
    extensions.unload('beamcmEditorSync')
    editorSyncLoaded = false
  end
end

local origOnUpdate = onUpdate
local function onUpdateWithGps(dt)
  origOnUpdate(dt)
  pollGpsSignal(dt)
  pollConsoleSignal(dt)
  pollEditorSyncSignal(dt)
end

M.onExtensionLoaded = onExtensionLoaded
M.onUpdate = onUpdateWithGps
M.onClientStartMission = onClientStartMission
return M
`

// ── GPS Tracker Lua scripts ──

// GE extension: reads vehicle position each frame and writes it to a JSON file for the Content Manager
const GPS_TRACKER_GE_LUA = `
local M = {}
local telemetryFile = "settings/BeamCM/gps_telemetry.json"
local sendInterval = 0.05 -- 20 Hz
local timer = 0

local function onExtensionLoaded()
  log('I', 'beamcmGPS', 'BeamCM GPS tracker extension loaded')
end

local function onExtensionUnloaded()
  log('I', 'beamcmGPS', 'BeamCM GPS tracker extension unloaded')
end

local function getOtherVehicles(myVeh)
  local others = {}
  local count = be:getObjectCount()
  for i = 0, count - 1 do
    local obj = be:getObject(i)
    if obj and obj ~= myVeh then
      local p = obj:getPosition()
      local d = obj:getDirectionVector()
      local v = obj:getVelocity()
      local name = ""
      -- Try to get player name from BeamMP if available
      if MPVehicleGE and MPVehicleGE.getVehicleByGameID then
        local mpData = MPVehicleGE.getVehicleByGameID(obj:getID())
        if mpData and mpData.ownerName then
          name = mpData.ownerName
        end
      end
      table.insert(others, {
        x = p.x, y = p.y, z = p.z,
        heading = math.atan2(d.x, d.y),
        speed = v:length(),
        name = name
      })
    end
  end
  return others
end

local function getNavRoute()
  -- Read the active GPS navigation route from core_groundMarkers
  if not core_groundMarkers or not core_groundMarkers.currentlyHasTarget or not core_groundMarkers.currentlyHasTarget() then
    return nil
  end
  local rp = core_groundMarkers.routePlanner
  if not rp or not rp.path or #rp.path == 0 then return nil end
  -- Sample the route: take every Nth point to keep the JSON manageable
  local route = {}
  local step = math.max(1, math.floor(#rp.path / 200))
  for i = 1, #rp.path, step do
    local node = rp.path[i]
    if node and node.pos then
      table.insert(route, {x = node.pos.x, y = node.pos.y})
    end
  end
  -- Always include the final destination
  local last = rp.path[#rp.path]
  if last and last.pos and (#route == 0 or route[#route].x ~= last.pos.x or route[#route].y ~= last.pos.y) then
    table.insert(route, {x = last.pos.x, y = last.pos.y})
  end
  return route
end

local function onUpdate(dt)
  timer = timer + dt
  if timer < sendInterval then return end
  timer = 0
  local veh = be:getPlayerVehicle(0)
  if not veh then return end
  local pos = veh:getPosition()
  local vel = veh:getVelocity()
  local dir = veh:getDirectionVector()
  local heading = math.atan2(dir.x, dir.y)
  local speed = vel:length()
  local levelName = ""
  if getMissionFilename then
    levelName = getMissionFilename() or ""
  end
  if (levelName == "" or levelName == "unknown") and getCurrentLevelIdentifier then
    levelName = getCurrentLevelIdentifier() or ""
  end
  jsonWriteFile(telemetryFile, {
    x = pos.x,
    y = pos.y,
    z = pos.z,
    heading = heading,
    speed = speed,
    map = levelName,
    vehicle = veh:getJBeamFilename() or "",
    others = getOtherVehicles(veh),
    route = getNavRoute(),
    t = os.clock()
  })
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate
return M
`

// ── World Editor Sync (Phase 0 spike) ─────────────────────────────────────────
//
// This is the read-only capture/replay extension used to validate that we can
// wrap `editor.history:commitAction` without destabilising the BeamNG world
// editor. It does NOT do any networking. It writes captured actions as JSON
// lines to settings/BeamCM/we_capture.log and supports a one-shot replay mode
// triggered by writing settings/BeamCM/we_capture_signal.json with
// `{action:"replay", processed:false}`.
//
// Once Phase 0 confirms the hook is stable, this extension grows to add the
// TCP bridge (Phase 1+) and the apply path for remote ops. See
// Project/Docs/WORLD-EDITOR-SYNC.md for the full design.

const EDITOR_SYNC_GE_LUA = `
local M = {}
local logFile = "settings/BeamCM/we_capture.log"
local signalFile = "settings/BeamCM/we_capture_signal.json"
local statusFile = "settings/BeamCM/we_capture_status.json"
local portFile = "settings/BeamCM/we_port.txt"

-- LuaSocket (shipped with BeamNG).
local socket = nil
do
  local ok, s = pcall(require, "socket")
  if ok then socket = s end
end

-- Capture state
local hooked = false
local origCommitAction = nil
local origUndo = nil
local origRedo = nil
local origBeginTx = nil
local origEndTx = nil
local capturing = false
local suppressCapture = false  -- true while replaying so we don't re-capture
local captureCount = 0
local sessionStart = 0
local pollTimer = 0
local pollInterval = 0.5

-- Replay state
local replayQueue = nil
local replayIndex = 0
local replayDelay = 0.1  -- seconds between replayed actions
local replayTimer = 0

-- ── TCP bridge to CM (Phase 1+) ───────────────────────────────────────────────
-- CM writes its listening port to we_port.txt. We connect, send an H|
-- handshake, then push O| frames for every captured op and receive R| remote
-- ops + A| acks. Reconnection is attempted every ~2s if disconnected.
local cmHost = "127.0.0.1"
local cmPort = nil
local cmClient = nil          -- LuaSocket client
local cmBuf = ""              -- receive buffer for line framing
local cmReconnectTimer = 0
local cmReconnectInterval = 2 -- seconds between reconnect attempts
local cmPingTimer = 0
local cmPingInterval = 5
local cmGreeted = false       -- received K| reply from CM
local cmInflight = {}         -- clientOpId -> true, awaiting A| ack
local opsSent = 0
local opsRcvd = 0
local acksRcvd = 0

-- Pose tick state (presence awareness for peers in a session).
local cmPoseTimer = 0
local cmPoseInterval = 0.2    -- seconds between V| pose frames (~5 Hz)

-- In-game ghost markers for peers. Populated by S| frames from CM, drawn
-- every frame in onPreRender. Stale entries (>5 s) are skipped; CM also
-- prunes its own pose map at 10 s so we usually stop receiving updates well
-- before then.
local cmPeerPoses = {}        -- authorId -> { x,y,z, heading?, name, vehicle?, levelName?, ts }
local CM_GHOST_TTL_MS = 5000

-- Editor autostart state. CM writes editor_autostart.json before launch;
-- we open the World Editor automatically once the level is loaded so the
-- user doesn't have to press F11.
local editorAutostartFile = "settings/BeamCM/editor_autostart.json"
local editorAutostartArmed = false
local editorAutostartHandled = false

-- Apply queue for remote ops received via R|. Drained in onUpdate to spread
-- work across frames (max APPLY_PER_FRAME each tick).
local applyQueue = {}
local APPLY_PER_FRAME = 8

local function uuidv4()
  -- Not cryptographically strong — advisory correlation id only.
  local function hex(n) return string.format("%x", math.random(0, n)) end
  return string.format(
    "%s%s%s%s-%s%s-4%s%s-%s%s%s-%s%s%s%s%s%s",
    hex(15),hex(15),hex(15),hex(15),
    hex(15),hex(15),
    hex(15),hex(15),
    hex(3+8),hex(15),hex(15),
    hex(15),hex(15),hex(15),hex(15),hex(15),hex(15)
  )
end

local function readCmPort()
  local f = io.open(portFile, "r")
  if not f then return nil end
  local txt = f:read("*l")
  f:close()
  if not txt then return nil end
  local n = tonumber(txt)
  if not n or n <= 0 then return nil end
  return n
end

local function cmDisconnect(reason)
  if not cmClient then return end
  pcall(function() cmClient:close() end)
  cmClient = nil
  cmBuf = ""
  cmGreeted = false
  -- Clear all peer-tied state so a fresh reconnect doesn't see ghosts at
  -- stale positions or try to apply ops queued for a previous session.
  cmPeerPoses = {}
  applyQueue = {}
  cmInflight = {}
  -- Reset cadence timers so the first tick after reconnect doesn't immediately
  -- fire a pose+ping just because the timers grew unbounded while disconnected.
  cmPoseTimer = 0
  cmPingTimer = 0
  cmReconnectTimer = 0
  log('W', 'beamcmEditorSync', 'CM bridge disconnected: ' .. tostring(reason))
end

local function cmSendLine(line)
  if not cmClient then return false end
  local _, err = cmClient:send(line)
  if err and err ~= "timeout" then
    cmDisconnect(err)
    return false
  end
  return true
end

local function cmTryConnect()
  if cmClient or not socket then return end
  if not cmPort then
    cmPort = readCmPort()
    if not cmPort then return end
    log('I', 'beamcmEditorSync', 'Read CM port ' .. tostring(cmPort) .. ' from ' .. portFile)
  end
  local sock = socket.tcp()
  sock:settimeout(0.05)
  local ok, err = sock:connect(cmHost, cmPort)
  if not ok and err ~= "already connected" then
    sock:close()
    cmPort = nil  -- re-read the port file next attempt; CM may have restarted
    return
  end
  sock:settimeout(0)
  sock:setoption("tcp-nodelay", true)
  cmClient = sock
  cmBuf = ""
  cmGreeted = false
  log('I', 'beamcmEditorSync', 'Connected to CM bridge at ' .. cmHost .. ':' .. tostring(cmPort))

  -- Send handshake with what we know right now. CM replies with K|.
  local hello = {
    beamngBuild = (beamng_buildinfo and beamng_buildinfo.version) or nil,
    editorActive = (editor ~= nil and editor.isEditorActive and editor.isEditorActive()) or false,
    levelName = (editor and editor.getLevelName) and editor.getLevelName() or nil,
    hooked = hooked,
    capturing = capturing,
  }
  local helloJson = jsonEncode(hello) or "{}"
  cmSendLine("H|" .. helloJson .. "\\n")
end

-- Send an op envelope over TCP. Returns clientOpId so the caller can await ack
-- if desired; Phase 1 is fire-and-forget.
local function cmSendOp(entry)
  if not cmClient then return nil end
  local cid = uuidv4()
  entry.clientOpId = cid
  local json = jsonEncode(entry)
  if not json then return nil end
  if cmSendLine("O|" .. json .. "\\n") then
    cmInflight[cid] = true
    opsSent = opsSent + 1
    return cid
  end
  return nil
end

-- Gather camera + active-vehicle pose and send a V| frame. Ephemeral, best
-- effort — if the APIs aren't available we just skip this tick.
local function cmSendPose()
  if not cmClient or not cmGreeted then return end
  -- Millisecond timestamps via LuaSocket (already required); os.time() is
  -- only second-precision and would make idle detection coarse.
  local pose = { ts = math.floor((socket and socket.gettime and socket.gettime() or os.time()) * 1000) }
  -- Camera position (falls back to player vehicle if camera API absent).
  local px, py, pz = nil, nil, nil
  if core_camera and core_camera.getPosition then
    local ok, pos = pcall(core_camera.getPosition)
    if ok and pos and pos.x then
      px, py, pz = pos.x, pos.y, pos.z
    end
  end
  -- Active vehicle (optional; gives peers a richer presence signal).
  if be and be.getPlayerVehicle then
    local ok, veh = pcall(function() return be:getPlayerVehicle(0) end)
    if ok and veh and veh.getPosition then
      local vok, vpos = pcall(function() return veh:getPosition() end)
      if vok and vpos and vpos.x then
        if not px then px, py, pz = vpos.x, vpos.y, vpos.z end
        pose.inVehicle = true
        if veh.getJBeamFilename then
          local jok, jb = pcall(function() return veh:getJBeamFilename() end)
          if jok and type(jb) == "string" then pose.vehicle = jb end
        end
        -- Heading from vehicle directionVec if available.
        if veh.getDirectionVector then
          local dok, dir = pcall(function() return veh:getDirectionVector() end)
          if dok and dir and dir.x then
            pose.heading = math.atan2(dir.y, dir.x)
          end
        end
      end
    end
  end
  if not px then return end
  pose.x, pose.y, pose.z = px, py, pz
  -- Level name (helps detect mismatches on the peer side).
  if getMissionFilename then
    local ok, m = pcall(getMissionFilename)
    if ok and type(m) == "string" and m ~= "" then pose.levelName = m end
  end
  local json = jsonEncode(pose)
  if not json then return end
  cmSendLine("V|" .. json .. "\\n")
end

-- Drain readable bytes, dispatch complete lines. Non-blocking.
local function cmPump()
  if not cmClient then return end
  while true do
    local data, err, partial = cmClient:receive(8192)
    if data then
      cmBuf = cmBuf .. data
    elseif partial and #partial > 0 then
      cmBuf = cmBuf .. partial
    end
    if err == "closed" then
      cmDisconnect("peer closed")
      return
    end
    while true do
      local nl = string.find(cmBuf, "\\n", 1, true)
      if not nl then break end
      local line = string.sub(cmBuf, 1, nl - 1)
      cmBuf = string.sub(cmBuf, nl + 1)
      if #line > 0 then
        local t = string.sub(line, 1, 1)
        if t == "K" then
          cmGreeted = true
        elseif t == "A" then
          -- A|clientOpId|seq|status
          local p1 = string.find(line, "|", 3, true)
          local p2 = p1 and string.find(line, "|", p1 + 1, true) or nil
          local p3 = p2 and string.find(line, "|", p2 + 1, true) or nil
          if p1 and p2 then
            local cid = string.sub(line, 3, p1 - 1)
            cmInflight[cid] = nil
            acksRcvd = acksRcvd + 1
          end
        elseif t == "R" then
          -- R|<json> — queue for application on the editor thread
          local json = string.sub(line, 3)
          local ok, env = pcall(jsonDecode, json)
          if ok and type(env) == "table" then
            table.insert(applyQueue, env)
            opsRcvd = opsRcvd + 1
          else
            log('W', 'beamcmEditorSync', 'malformed R frame: ' .. tostring(json))
          end
        elseif t == "S" then
          -- S|<json> — peer pose for in-world ghost markers (ephemeral).
          local json = string.sub(line, 3)
          local ok, p = pcall(jsonDecode, json)
          if ok and type(p) == "table" and type(p.authorId) == "string" and p.x and p.y and p.z then
            cmPeerPoses[p.authorId] = {
              x = p.x, y = p.y, z = p.z,
              heading = p.heading,
              name = p.displayName or string.sub(p.authorId, 1, 8),
              vehicle = p.vehicle,
              inVehicle = p.inVehicle,
              levelName = p.levelName,
              ts = math.floor((socket and socket.gettime and socket.gettime() or os.time()) * 1000),
            }
          end
        elseif t == "P" then
          cmSendLine("Q|\\n")
        elseif t == "E" then
          log('W', 'beamcmEditorSync', 'CM soft error: ' .. string.sub(line, 3))
        end
      end
    end
    if err == "timeout" or not data then break end
  end
end

-- Apply at most APPLY_PER_FRAME queued remote ops. Phase 1 is a stub that just
-- logs — full apply path with netId resolution + suppressCapture is Phase 2.
local function cmDrainApplyQueue()
  local budget = APPLY_PER_FRAME
  while budget > 0 and #applyQueue > 0 do
    local env = table.remove(applyQueue, 1)
    budget = budget - 1
    applyRemoteOp(env)
  end
end

-- ── NetId / persistentId translation (Phase 2) ────────────────────────────────
-- BeamNG scene objects carry a stable persistentId (UUID string) that survives
-- save/load. We use it as the cross-instance identity — the "netId".
-- Outgoing ops: known id fields in \`data\` are rewritten from sim ids to
-- { __pid = "<uuid>" } tables. Inbound ops: reverse. Unknown pids are dropped.

local function simToPid(simId)
  local n = tonumber(simId)
  if not n then return nil end
  if not scenetree or not scenetree.findObjectById then return nil end
  local obj = scenetree.findObjectById(n)
  if not obj then return nil end
  local pid = nil
  if obj.getField then
    local ok, v = pcall(function() return obj:getField('persistentId', 0) end)
    if ok and v and v ~= '' then pid = v end
  end
  if (not pid or pid == '') and obj.persistentId then pid = obj.persistentId end
  return (pid and pid ~= '') and pid or nil
end

local function pidToSim(pid)
  if type(pid) ~= 'string' or #pid == 0 then return nil end
  if scenetree and scenetree.findObjectByPersistentId then
    local obj = scenetree.findObjectByPersistentId(pid)
    if obj and obj.getId then return obj:getId() end
  end
  return nil
end

-- Known id-bearing key paths in action data. These are the shapes observed in
-- describeAction plus a few extras from the BeamNG editor source audit.
local ID_KEYS_SCALAR = {
  objectId = true, objectID = true,
  roadId = true, roadID = true,
  meshID = true, meshId = true,
  matId = true,
  instanceId = true, instanceID = true,
  parentId = true, parentID = true,
  newGroup = true,
  id = true,
}
local ID_KEYS_ARRAY = {
  objectIds = true, objectIDs = true,
  ids = true,
  arrayRoadIDs = true,
}

-- Recursively rewrite ids in \`data\`. outbound: sim→{__pid=...}. !outbound: reverse.
-- Returns \`data\` (same reference, mutated) or nil if a required pid was unresolvable.
local function rewriteIds(data, outbound, depth)
  depth = depth or 0
  if depth > 10 or type(data) ~= 'table' then return data end
  local unresolved = false
  for k, v in pairs(data) do
    if ID_KEYS_SCALAR[k] then
      if outbound then
        if type(v) == 'number' then
          local pid = simToPid(v)
          if pid then data[k] = { __pid = pid } end
          -- else leave numeric as-is; may be a group/local id
        end
      else
        if type(v) == 'table' and v.__pid then
          local sim = pidToSim(v.__pid)
          if sim then data[k] = sim else unresolved = true end
        end
      end
    elseif ID_KEYS_ARRAY[k] and type(v) == 'table' then
      for i, id in ipairs(v) do
        if outbound then
          if type(id) == 'number' then
            local pid = simToPid(id)
            if pid then v[i] = { __pid = pid } end
          end
        else
          if type(id) == 'table' and id.__pid then
            local sim = pidToSim(id.__pid)
            if sim then v[i] = sim else unresolved = true end
          end
        end
      end
    elseif type(v) == 'table' then
      local r = rewriteIds(v, outbound, depth + 1)
      if r == nil then unresolved = true end
    end
  end
  return unresolved and nil or data
end

-- ── Remote op apply path ──────────────────────────────────────────────────────
-- Given an op envelope from the wire, attempt to reproduce it locally without
-- re-capturing. Best-effort: unknown or unresolvable actions are logged and
-- skipped. Applied via editor.history:commitAction(name, data) which looks up
-- the registered action — BeamNG's built-in handler then performs do/undo.
function applyRemoteOp(env)
  if type(env) ~= 'table' or not env.kind then return end

  -- Never echo-capture while applying remote state.
  suppressCapture = true
  local ok, err = pcall(function()
    if env.kind == 'do' then
      if type(env.name) ~= 'string' then return end
      local data = env.data
      if type(data) == 'table' then
        local rewritten = rewriteIds(data, false)
        if rewritten == nil then
          log('W', 'beamcmEditorSync', 'remote op skipped (unresolved pid): ' .. tostring(env.name))
          return
        end
        data = rewritten
      end
      if editor and editor.history and editor.history.commitAction then
        editor.history:commitAction(env.name, data or {})
      else
        log('W', 'beamcmEditorSync', 'editor.history.commitAction unavailable; cannot apply')
      end
    elseif env.kind == 'undo' then
      if editor and editor.history and editor.history.undo then
        editor.history:undo()
      end
    elseif env.kind == 'redo' then
      if editor and editor.history and editor.history.redo then
        editor.history:redo()
      end
    end
  end)
  suppressCapture = false
  if not ok then
    log('E', 'beamcmEditorSync', 'remote op apply failed: ' .. tostring(err))
  end
end

-- ── helpers ───────────────────────────────────────────────────────────────────

local function nowMs()
  return math.floor((os.clock() - sessionStart) * 1000)
end

local function appendCaptureLine(entry)
  -- Forward every op over TCP when the bridge is connected (low-latency path
  -- for the multiplayer session). File logging is only done when the user
  -- explicitly started the local capture from the Sync page — otherwise the
  -- \`we_capture.log\` would grow unbounded on every collaborative edit.
  if cmClient then
    pcall(cmSendOp, entry)
  end
  if not capturing then return end
  local serialized = jsonEncode(entry)
  if not serialized then return end
  local f = io.open(logFile, "a")
  if not f then
    log('E', 'beamcmEditorSync', 'Failed to open capture log for write: ' .. tostring(logFile))
    return
  end
  f:write(serialized)
  f:write("\\n")
  f:close()
end

local function writeStatus()
  local levelName = nil
  if editor and editor.getLevelName then
    local ok, ln = pcall(function() return editor.getLevelName() end)
    if ok and ln and ln ~= "" then levelName = ln end
  end
  jsonWriteFile(statusFile, {
    capturing = capturing,
    captureCount = captureCount,
    replayActive = replayQueue ~= nil,
    replayIndex = replayIndex,
    replayTotal = replayQueue and #replayQueue or 0,
    hooked = hooked,
    editorPresent = (editor ~= nil and editor.history ~= nil),
    levelName = levelName,
  })
end

local function readCaptureLog()
  local f = io.open(logFile, "r")
  if not f then return nil end
  local entries = {}
  for line in f:lines() do
    if line and #line > 0 then
      local ok, decoded = pcall(jsonDecode, line)
      if ok and decoded then
        table.insert(entries, decoded)
      end
    end
  end
  f:close()
  return entries
end

-- Strip non-serialisable content from \`data\` so jsonEncode can succeed.
-- Returns the cleaned table plus a list of stripped field names for logging.
local function sanitise(data, depth)
  depth = depth or 0
  if depth > 8 then return nil end
  local t = type(data)
  if t == "nil" or t == "boolean" or t == "number" or t == "string" then
    return data
  end
  if t == "table" then
    local out = {}
    for k, v in pairs(data) do
      local kt = type(k)
      if kt == "string" or kt == "number" then
        local cleaned = sanitise(v, depth + 1)
        if cleaned ~= nil then out[k] = cleaned end
      end
    end
    return out
  end
  -- function, userdata, thread → drop silently
  return nil
end

-- ── hooks ─────────────────────────────────────────────────────────────────────

-- Summarise a single action's data for human-readable display on the CM side.
-- Returns: detail (string or nil), targets (array of numeric ids or nil)
--
-- Coverage based on a full audit of BeamNG editor commitAction call-sites:
-- objects (createObjectTool, assetBrowser drag-drop, sceneTree, inspector),
-- forest, terrain, decals, decal-roads, mesh-roads, rivers, splines, materials,
-- groups. Any unrecognised action falls through to a generic key dump so
-- nothing ever shows blank in the CM UI.
local function describeAction(name, data)
  if type(data) ~= "table" then
    return nil, nil
  end

  -- Look up an object by id and produce "#id Class 'name'" — works even when
  -- the action data only carried an objectId (e.g. asset-browser CreateObject).
  local function objInfo(id)
    if not id then return nil end
    local obj = scenetree and scenetree.findObjectById and scenetree.findObjectById(id)
    if not obj then return "#" .. tostring(id) end
    local cls = (obj.getClassName and obj:getClassName()) or "?"
    local nm  = (obj.getName and obj:getName()) or ""
    if nm ~= "" then
      return "#" .. tostring(id) .. " " .. tostring(cls) .. " '" .. tostring(nm) .. "'"
    end
    return "#" .. tostring(id) .. " " .. tostring(cls)
  end

  -- Compact "x,y,z" from a vec3-ish table or MatrixF.getColumn4F result.
  local function vecStr(v)
    if not v then return nil end
    if type(v) == "table" then
      local x = v.x or v[1]
      local y = v.y or v[2]
      local z = v.z or v[3]
      if x and y and z then
        return string.format("%.2f,%.2f,%.2f", x, y, z)
      end
    end
    -- Try MatrixF: it may have :getColumn4F() for translation
    if type(v) == "userdata" or (type(v) == "table" and v.getColumn4F) then
      local ok, col = pcall(function() return v:getColumn4F(3) end)
      if ok and col then
        return string.format("%.2f,%.2f,%.2f", col.x or 0, col.y or 0, col.z or 0)
      end
    end
    return nil
  end

  local function shorten(s, n)
    s = tostring(s)
    if #s <= n then return s end
    return s:sub(1, n - 1) .. "…"
  end

  -- ─── Selection ──────────────────────────────────────────────────────────
  if name == "SelectObjects" then
    -- newSelection may be a flat array of ids OR a class-bucketed table
    local sel = data.newSelection or {}
    local ids = {}
    if sel[1] then
      for _, v in ipairs(sel) do table.insert(ids, v) end
    elseif type(sel) == "table" then
      for _, bucket in pairs(sel) do
        if type(bucket) == "table" then
          for _, v in ipairs(bucket) do table.insert(ids, v) end
        end
      end
    end
    local n = #ids
    if n == 0 then return "cleared selection", {} end
    if n == 1 then return "sel " .. (objInfo(ids[1]) or "?"), { ids[1] } end
    return "sel " .. tostring(n) .. " objs (" .. (objInfo(ids[1]) or "?") .. ", …)", ids
  end

  -- ─── Transforms ─────────────────────────────────────────────────────────
  if name == "SetObjectTransform" or name == "SetObjectScale" then
    local id = data.objectId
    local label = objInfo(id) or "?"
    local newPos = vecStr(data.newTransform) or vecStr(data.newPosition) or vecStr(data.newScale)
    if newPos then label = label .. " → " .. newPos end
    return label, id and { id } or nil
  end

  if name == "PositionRoadNode" or name == "PositionMeshNode" then
    local roadCount, nodeCount = 0, 0
    local ids = {}
    for roadID, nodes in pairs(data.roadAndNodeIDs or {}) do
      roadCount = roadCount + 1
      table.insert(ids, tonumber(roadID) or roadID)
      if type(nodes) == "table" then nodeCount = nodeCount + #nodes end
    end
    if data.meshID then
      table.insert(ids, data.meshID)
      roadCount = 1
      nodeCount = #(data.nodeIDs or {})
    end
    return string.format("moved %d node(s) on %d road(s)", nodeCount, roadCount), ids
  end

  -- ─── Field changes ──────────────────────────────────────────────────────
  if name == "ChangeField" or name == "ChangeDynField" or name == "ChangeFieldMultipleValues" then
    local ids = data.objectIds or {}
    local field = data.fieldName or "?"
    local preview = data.newFieldValue or data.newValue
    if preview == nil then
      local nv = data.newFieldValues or data.newValues
      if type(nv) == "table" then preview = nv[1] end
    end
    local previewStr = preview ~= nil and " = " .. shorten(preview, 40) or ""
    if #ids == 1 then
      return field .. previewStr .. " on " .. (objInfo(ids[1]) or "?"), ids
    end
    return field .. previewStr .. " on " .. tostring(#ids) .. " objs", ids
  end

  -- Material editor: "SetMaterialProperty_<prop>_layer<N>"
  local prop, layer = name:match("^SetMaterialProperty_(.+)_layer(%d+)$")
  if prop then
    local label = "mat." .. prop .. "[L" .. layer .. "]"
    if data.newValue ~= nil then label = label .. " = " .. shorten(data.newValue, 40) end
    if data.objectId then label = label .. " on " .. (objInfo(data.objectId) or "?") end
    return label, data.objectId and { data.objectId } or nil
  end

  if name == "SwapMaterialLayers" then
    local id = data.matId
    return string.format("swap layers %s↔%s on %s", tostring(data.layer1), tostring(data.layer2),
      objInfo(id) or "?"), id and { id } or nil
  end

  -- ─── Object lifecycle ───────────────────────────────────────────────────
  if name == "CreateObject" then
    -- Two payload shapes: createObjectTool {classname,name,objectID,transform}
    -- and assetBrowser drop {objectId} (look up the object that was created).
    local id = data.objectId or data.objectID
    -- Prefer scenetree lookup (most accurate, includes prefab/group class)
    local lookup = objInfo(id)
    if lookup then
      local pos = vecStr(data.transform)
      return lookup .. (pos and " @ " .. pos or ""), id and { id } or nil
    end
    -- Fall back to data fields if scenetree miss (e.g. mid-undo)
    local cls = data.classname or data.className or "?"
    local nm  = data.name or ""
    local label = (id and ("#" .. tostring(id) .. " ") or "") .. cls
    if nm ~= "" then label = label .. " '" .. nm .. "'" end
    return label, id and { id } or nil
  end

  if name == "DeleteObject" then
    local id = data.objectId
    return "del " .. (objInfo(id) or ("#" .. tostring(id))), id and { id } or nil
  end

  if name == "DeleteSelectedObjects" then
    local ids = {}
    for _, e in ipairs(data.objects or {}) do
      if e.objectId then table.insert(ids, e.objectId) end
    end
    return "del " .. tostring(#ids) .. " objs", ids
  end

  if name == "CreateGroup" then
    local n = #(data.objects or {})
    return string.format("group %d obj(s) → parent #%s", n, tostring(data.parentId or "?")),
      data.newGroup and { data.newGroup } or nil
  end

  if name == "ChangeOrder" then
    return string.format("reparent %d obj(s) → #%s",
      #(data.objects or {}), tostring(data.newGroup or "?")), data.objects
  end

  -- ─── Forest editor ──────────────────────────────────────────────────────
  if name == "AddForestItems" then
    return "add " .. tostring(#(data.items or {})) .. " forest item(s)", data.itemIds
  end
  if name == "RemoveForestItems" then
    return "remove " .. tostring(#(data.items or {})) .. " forest item(s)", nil
  end
  if name == "SetForestItemTransform" or name == "MoveForestItem"
    or name == "RotateForestItem" or name == "ScaleForestItem" then
    return string.format("%s × %d", name:gsub("ForestItem", "Forest"), #(data.items or {})), nil
  end

  -- ─── Decal editor ───────────────────────────────────────────────────────
  if name == "CreateDecalInstance" then
    local d = data.instanceData or {}
    local pos = vecStr(d.position)
    local label = "decal" .. (d.id and " #" .. tostring(d.id) or "")
    if pos then label = label .. " @ " .. pos end
    return label, d.id and { d.id } or nil
  end
  if name == "DeleteDecalInstance" or name == "DuplicateDecalInstances" then
    local n = type(data.instancesData) == "table"
      and (data.instancesData[1] and #data.instancesData or 0) or 0
    if n == 0 and type(data.instancesData) == "table" then
      for _ in pairs(data.instancesData) do n = n + 1 end
    end
    return name:lower():gsub("decalinstances?", "decal") .. " × " .. tostring(n), nil
  end
  if name == "PositionDecalInstances" or name == "RotateDecalInstances"
    or name == "ChangeDecalInstancesSize" then
    local n = 0
    for _ in pairs(data.newPositions or data.newSizes or {}) do n = n + 1 end
    return name .. " × " .. tostring(n), nil
  end

  -- ─── Decal-road editor ──────────────────────────────────────────────────
  if name == "CreateRoad" then
    return "road #" .. tostring(data.roadID) .. " (" .. tostring(#(data.nodes or {})) .. " nodes)",
      data.roadID and { data.roadID } or nil
  end
  if name == "InsertRoadNode" then
    local n = 0
    for _ in pairs(data.roadInfos or {}) do n = n + 1 end
    return "insert " .. tostring(n) .. " node(s)", nil
  end
  if name == "FlipRoadDirection" then
    local ids = {}
    for _, r in ipairs(data.roads or {}) do
      if r.id then table.insert(ids, r.id) end
    end
    return "flip " .. tostring(#ids) .. " road(s)", ids
  end
  if name == "PasteRoad" then
    return "paste fields → #" .. tostring(data.roadId), data.roadId and { data.roadId } or nil
  end
  if name == "SetRoadNodesWidth" then
    local n = 0
    for _ in pairs(data.newWidths or {}) do n = n + 1 end
    return "set width on " .. tostring(n) .. " road(s)", nil
  end
  if name == "DeleteSelection" then
    local n = 0
    for _ in pairs(data.roadInfos or {}) do n = n + 1 end
    return "delete " .. tostring(n) .. " road(s)", nil
  end
  if name == "DuplicateRoad" then
    return "dup × " .. tostring(#(data.arrayRoadIDs or {})), data.arrayRoadIDs
  end
  if name == "SplitRoad" or name == "FuseRoads" then
    return name, nil
  end

  -- ─── MeshRoad / River ───────────────────────────────────────────────────
  if name == "CreateMesh" then
    return "mesh #" .. tostring(data.meshID) .. " (" .. tostring(#(data.nodes or {})) .. " nodes)",
      data.meshID and { data.meshID } or nil
  end
  if name == "DeleteMesh" then
    return "del mesh #" .. tostring(data.meshID), data.meshID and { data.meshID } or nil
  end
  if name == "InsertMeshNode" or name == "DeleteMeshNode" then
    return name .. " × " .. tostring(#(data.nodeInfos or {})) .. " on #" .. tostring(data.meshID),
      data.meshID and { data.meshID } or nil
  end
  if name == "SetAllMeshNodesWidth" or name == "SetAllMeshNodesDepth" or name == "SetMeshNodeWidthDepth" then
    return name .. " #" .. tostring(data.meshID), data.meshID and { data.meshID } or nil
  end

  -- ─── Terrain ────────────────────────────────────────────────────────────
  if name == "TerrainEditor" or name == "Terrain_AutoPaint" then
    return name .. " (delegated to EUndoManager)", nil
  end

  -- ─── Generic fallback: show top-level data keys so nothing is silent ───
  local id = data.objectId or data.objectID or data.roadId or data.roadID or data.meshID or data.matId
  if id then
    return objInfo(id) or ("#" .. tostring(id)), { id }
  end
  local keys = {}
  for k in pairs(data) do
    table.insert(keys, tostring(k))
    if #keys >= 5 then break end
  end
  if #keys > 0 then
    return "data: {" .. table.concat(keys, ",") .. "}", nil
  end
  return nil, nil
end

local function installHooks()
  if hooked then return true end
  if not editor or not editor.history then
    log('W', 'beamcmEditorSync', 'editor.history not available yet; will retry on editor activation')
    return false
  end

  origCommitAction = editor.history.commitAction
  origUndo = editor.history.undo
  origRedo = editor.history.redo

  if type(origCommitAction) ~= "function" then
    log('E', 'beamcmEditorSync', 'editor.history.commitAction is not a function — incompatible BeamNG build?')
    return false
  end

  editor.history.commitAction = function(self, name, data, undoFn, redoFn, ...)
    local result = origCommitAction(self, name, data, undoFn, redoFn, ...)
    if not suppressCapture then
      local cleaned = sanitise(data)
      -- Translate any sim ids → persistentIds so the op is portable.
      if type(cleaned) == 'table' then
        rewriteIds(cleaned, true)
      end
      local detail, targets = describeAction(name, data)
      local entry = {
        kind = "do",
        name = tostring(name),
        data = cleaned,
        detail = detail,
        targets = targets,
        ts = nowMs(),
        seq = captureCount + 1,
      }
      local ok, err = pcall(appendCaptureLine, entry)
      if ok then
        captureCount = captureCount + 1
      else
        log('E', 'beamcmEditorSync', 'capture write failed: ' .. tostring(err))
      end
    end
    return result
  end

  if type(origUndo) == "function" then
    editor.history.undo = function(self, ...)
      local result = origUndo(self, ...)
      if not suppressCapture then
        pcall(appendCaptureLine, { kind = "undo", ts = nowMs(), seq = captureCount + 1 })
        captureCount = captureCount + 1
      end
      return result
    end
  end

  if type(origRedo) == "function" then
    editor.history.redo = function(self, ...)
      local result = origRedo(self, ...)
      if not suppressCapture then
        pcall(appendCaptureLine, { kind = "redo", ts = nowMs(), seq = captureCount + 1 })
        captureCount = captureCount + 1
      end
      return result
    end
  end

  -- Transaction boundaries (multi-step operations group their commits inside
  -- a beginTransaction/endTransaction pair, e.g. inspector field edits or
  -- the asset-browser drop sequence). Logging the boundaries makes it
  -- obvious in the CM UI which actions belong together.
  if type(editor.history.beginTransaction) == "function" then
    origBeginTx = editor.history.beginTransaction
    editor.history.beginTransaction = function(self, txName, ...)
      local result = origBeginTx(self, txName, ...)
      if not suppressCapture then
        pcall(appendCaptureLine, {
          kind = "tx-begin",
          name = tostring(txName),
          ts = nowMs(),
          seq = captureCount + 1,
        })
        captureCount = captureCount + 1
      end
      return result
    end
  end
  if type(editor.history.endTransaction) == "function" then
    origEndTx = editor.history.endTransaction
    editor.history.endTransaction = function(self, ...)
      local result = origEndTx(self, ...)
      if not suppressCapture then
        pcall(appendCaptureLine, { kind = "tx-end", ts = nowMs(), seq = captureCount + 1 })
        captureCount = captureCount + 1
      end
      return result
    end
  end

  hooked = true
  log('I', 'beamcmEditorSync', 'Installed editor.history hooks')
  writeStatus()
  return true
end

local function uninstallHooks()
  if not hooked then return end
  if origCommitAction then editor.history.commitAction = origCommitAction end
  if origUndo then editor.history.undo = origUndo end
  if origRedo then editor.history.redo = origRedo end
  if origBeginTx then editor.history.beginTransaction = origBeginTx end
  if origEndTx then editor.history.endTransaction = origEndTx end
  origCommitAction = nil
  origUndo = nil
  origRedo = nil
  origBeginTx = nil
  origEndTx = nil
  hooked = false
  log('I', 'beamcmEditorSync', 'Uninstalled editor.history hooks')
  writeStatus()
end

-- ── capture lifecycle ─────────────────────────────────────────────────────────

local function startCapture()
  if not hooked and not installHooks() then
    log('W', 'beamcmEditorSync', 'Cannot start capture — hooks not installed')
    return false
  end
  -- Truncate log
  local f = io.open(logFile, "w")
  if f then f:close() end
  capturing = true
  captureCount = 0
  sessionStart = os.clock()
  log('I', 'beamcmEditorSync', 'Capture started → ' .. logFile)
  writeStatus()
  return true
end

local function stopCapture()
  capturing = false
  log('I', 'beamcmEditorSync', 'Capture stopped (' .. tostring(captureCount) .. ' actions)')
  writeStatus()
end

-- ── replay ────────────────────────────────────────────────────────────────────

local function startReplay()
  if not hooked and not installHooks() then
    log('W', 'beamcmEditorSync', 'Cannot start replay — hooks not installed')
    return false
  end
  local entries = readCaptureLog()
  if not entries or #entries == 0 then
    log('W', 'beamcmEditorSync', 'No capture log to replay')
    return false
  end
  replayQueue = entries
  replayIndex = 0
  replayTimer = 0
  log('I', 'beamcmEditorSync', 'Replay started: ' .. tostring(#entries) .. ' actions')
  writeStatus()
  return true
end

local function stepReplay()
  if not replayQueue then return end
  replayIndex = replayIndex + 1
  if replayIndex > #replayQueue then
    log('I', 'beamcmEditorSync', 'Replay complete (' .. tostring(replayIndex - 1) .. ' actions)')
    replayQueue = nil
    replayIndex = 0
    writeStatus()
    return
  end
  local entry = replayQueue[replayIndex]
  if not entry or not entry.kind then return end

  suppressCapture = true
  if entry.kind == "do" then
    -- For Phase 0 we don't try to reconstruct undo/redo functions for the
    -- replayed entries; we just log what we *would* commit. This is enough
    -- to prove the loop is healthy. Phase 1+ wires real apply via adapters.
    log('D', 'beamcmEditorSync', 'replay step ' .. tostring(replayIndex) .. ': do ' .. tostring(entry.name))
  elseif entry.kind == "undo" then
    if origUndo then pcall(origUndo, editor.history) end
    log('D', 'beamcmEditorSync', 'replay step ' .. tostring(replayIndex) .. ': undo')
  elseif entry.kind == "redo" then
    if origRedo then pcall(origRedo, editor.history) end
    log('D', 'beamcmEditorSync', 'replay step ' .. tostring(replayIndex) .. ': redo')
  end
  suppressCapture = false
  writeStatus()
end

-- ── signal polling ────────────────────────────────────────────────────────────

local function pollSignal(dt)
  pollTimer = pollTimer + dt
  if pollTimer < pollInterval then return end
  pollTimer = 0
  -- Refresh the status file on every poll tick so captureCount/levelName
  -- stay live in the CM UI without needing per-action writes.
  writeStatus()
  local sig = jsonReadFile(signalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(signalFile, { action = sig.action, processed = true })
  if sig.action == "start" then
    startCapture()
  elseif sig.action == "stop" then
    stopCapture()
  elseif sig.action == "replay" then
    startReplay()
  elseif sig.action == "uninstall" then
    uninstallHooks()
  elseif sig.action == "install" then
    installHooks()
  elseif sig.action == "undo" then
    if editor and editor.history and editor.history.undo then
      pcall(function() editor.history:undo(1) end)
      log('I', 'beamcmEditorSync', 'Triggered editor.history:undo')
    else
      log('W', 'beamcmEditorSync', 'undo requested but editor.history unavailable')
    end
  elseif sig.action == "redo" then
    if editor and editor.history and editor.history.redo then
      pcall(function() editor.history:redo(1) end)
      log('I', 'beamcmEditorSync', 'Triggered editor.history:redo')
    else
      log('W', 'beamcmEditorSync', 'redo requested but editor.history unavailable')
    end
  elseif sig.action == "save" then
    if editor and editor.doSaveLevel then
      local ok, err = pcall(function() editor.doSaveLevel() end)
      if ok then
        log('I', 'beamcmEditorSync', 'editor.doSaveLevel() invoked')
      else
        log('E', 'beamcmEditorSync', 'save failed: ' .. tostring(err))
      end
    else
      log('W', 'beamcmEditorSync', 'save requested but editor.doSaveLevel unavailable')
    end
  elseif sig.action == "saveAs" then
    local targetPath = sig.path
    if not targetPath or targetPath == "" then
      log('E', 'beamcmEditorSync', 'saveAs requested without path')
    elseif editor and editor.saveLevelAs then
      local ok, err = pcall(function() editor.saveLevelAs(targetPath) end)
      if ok then
        log('I', 'beamcmEditorSync', 'editor.saveLevelAs(' .. tostring(targetPath) .. ') invoked')
      else
        log('E', 'beamcmEditorSync', 'saveAs failed: ' .. tostring(err))
      end
    else
      log('W', 'beamcmEditorSync', 'saveAs requested but editor.saveLevelAs unavailable')
    end
  elseif sig.action == "saveProject" then
    -- Same mechanism as saveAs, but CM pre-computes the project directory so
    -- we just need to call saveLevelAs. CM will drop info.json afterwards.
    local targetPath = sig.path
    if not targetPath or targetPath == "" then
      log('E', 'beamcmEditorSync', 'saveProject requested without path')
    elseif editor and editor.saveLevelAs then
      local ok, err = pcall(function() editor.saveLevelAs(targetPath) end)
      if ok then
        log('I', 'beamcmEditorSync', 'saveProject → editor.saveLevelAs(' .. tostring(targetPath) .. ')')
      else
        log('E', 'beamcmEditorSync', 'saveProject failed: ' .. tostring(err))
      end
    else
      log('W', 'beamcmEditorSync', 'saveProject requested but editor.saveLevelAs unavailable')
    end
  elseif sig.action == "loadProject" then
    -- Shuts down the editor, reloads the mission at sig.path, and reactivates
    -- the editor on the new level via the onClientStartMission hook.
    local targetPath = sig.path
    if not targetPath or targetPath == "" then
      log('E', 'beamcmEditorSync', 'loadProject requested without path')
    elseif editor and editor.openLevel then
      local ok, err = pcall(function() editor.openLevel(targetPath) end)
      if ok then
        log('I', 'beamcmEditorSync', 'loadProject → editor.openLevel(' .. tostring(targetPath) .. ')')
      else
        log('E', 'beamcmEditorSync', 'loadProject failed: ' .. tostring(err))
      end
    else
      log('W', 'beamcmEditorSync', 'loadProject requested but editor.openLevel unavailable')
    end
  else
    log('W', 'beamcmEditorSync', 'Unknown capture signal: ' .. tostring(sig.action))
  end
end

-- ── extension lifecycle ───────────────────────────────────────────────────────

-- Called once a level finishes loading. We use it to (a) open the World Editor
-- automatically when CM has armed the autostart signal, and (b) reset
-- per-mission state.
local function onClientStartMission(missionFile)
  -- Editor autostart: CM wrote {open=true} into editor_autostart.json before
  -- launch. Open the World Editor and mark the signal processed so we don't
  -- re-trigger on subsequent mission loads in the same game session.
  if editorAutostartArmed and not editorAutostartHandled then
    editorAutostartHandled = true
    if editor and editor.setEditorActive then
      local ok, err = pcall(function() editor.setEditorActive(true) end)
      if ok then
        log('I', 'beamcmEditorSync', 'World Editor auto-opened on mission load')
      else
        log('W', 'beamcmEditorSync', 'editor.setEditorActive failed: ' .. tostring(err))
      end
    elseif editor and editor.toggleEditor then
      pcall(function() editor.toggleEditor(true) end)
      log('I', 'beamcmEditorSync', 'World Editor toggled on mission load')
    else
      log('W', 'beamcmEditorSync', 'editor API unavailable, cannot autostart')
    end
    -- Delete the autostart file outright now that we've acted on it. Leaving
    -- the file behind (even with processed=true) means a future cold launch
    -- has to read+parse stale state. Falls back to overwriting if delete
    -- fails (read-only FS, virus scanner lock, etc.).
    if not pcall(function() os.remove(editorAutostartFile) end) then
      pcall(function()
        jsonWriteFile(editorAutostartFile, { open = true, processed = true })
      end)
    end
  end
  -- Clear stale ghost markers from the previous mission, plus any queued
  -- remote ops that targeted it (they would fail to resolve after a level
  -- swap and just spam the log).
  cmPeerPoses = {}
  applyQueue = {}
  cmInflight = {}
end

-- Poll for the editor_autostart signal. Done once shortly after the extension
-- loads (signal is one-shot per launch).
local function pollEditorAutostartOnce()
  if editorAutostartArmed then return end
  local sig = jsonReadFile(editorAutostartFile)
  if sig and sig.open and not sig.processed then
    editorAutostartArmed = true
    log('I', 'beamcmEditorSync', 'Editor autostart armed - will open editor at mission start')
  end
end

-- ── In-world ghost markers ────────────────────────────────────────────────────
-- Drawn every render frame. We use the global 'debugDrawer' (BeamNG GE-side
-- debug helper). All draw calls are pcalled so an API-shape change in a
-- BeamNG update never breaks the editor sync extension.
local function cmDrawGhosts()
  if not debugDrawer then return end
  local nowMs = math.floor((socket and socket.gettime and socket.gettime() or os.time()) * 1000)
  for authorId, p in pairs(cmPeerPoses) do
    if (nowMs - (p.ts or 0)) <= CM_GHOST_TTL_MS then
      pcall(function()
        local pos = vec3(p.x, p.y, p.z)
        local color = ColorF(0.2, 0.9, 1.0, 0.7)
        local headColor = ColorF(0.1, 0.6, 1.0, 0.9)
        local textBg = ColorI(0, 0, 0, 180)
        local textFg = ColorF(1, 1, 1, 1)
        -- Body sphere at ground level + a smaller "head" sphere ~1.7m up so
        -- the marker reads as a person from any angle.
        debugDrawer:drawSphere(pos, 0.7, color)
        debugDrawer:drawSphere(vec3(p.x, p.y, p.z + 1.7), 0.35, headColor)
        -- Heading line if we have one.
        if p.heading then
          local hx = math.cos(p.heading) * 2
          local hy = math.sin(p.heading) * 2
          debugDrawer:drawLine(
            vec3(p.x, p.y, p.z + 1.0),
            vec3(p.x + hx, p.y + hy, p.z + 1.0),
            color
          )
        end
        -- Floating name label above the head. Older BeamNG builds required
        -- the engine String() wrapper for drawTextAdvanced; modern (>=0.30)
        -- builds accept a plain Lua string. Use whichever is available so
        -- the label renders on every supported version.
        local label = p.name or string.sub(authorId, 1, 8)
        if p.inVehicle then label = label .. " (driving)" end
        local labelArg = (type(String) == 'function') and String(label) or label
        debugDrawer:drawTextAdvanced(
          vec3(p.x, p.y, p.z + 2.4),
          labelArg,
          textFg, true, false, textBg
        )
      end)
    end
  end
end

local function onPreRender(dtReal, dtSim, dtRaw)
  cmDrawGhosts()
end

local function onExtensionLoaded()
  log('I', 'beamcmEditorSync', 'BeamCM World Editor Sync (Phase 0 spike) loaded')
  -- Try to install hooks immediately. If editor not ready, pollSignal /
  -- onEditorActivated will retry.
  installHooks()
  writeStatus()
  -- Pick up the editor autostart signal once at load time.
  pollEditorAutostartOnce()
  -- Attempt initial CM bridge connect; onUpdate will retry every ~2s if this fails.
  cmTryConnect()
end

local function onExtensionUnloaded()
  if capturing then stopCapture() end
  uninstallHooks()
  cmDisconnect("extension unloaded")
  log('I', 'beamcmEditorSync', 'BeamCM World Editor Sync unloaded')
end

local function onEditorActivated()
  if not hooked then installHooks() end
end

local function onUpdate(dt)
  pollSignal(dt)
  -- TCP bridge: reconnect if dropped, pump frames, drain apply queue, ping.
  if not cmClient then
    cmReconnectTimer = cmReconnectTimer + dt
    if cmReconnectTimer >= cmReconnectInterval then
      cmReconnectTimer = 0
      cmTryConnect()
    end
  else
    cmPump()
    cmDrainApplyQueue()
    cmPingTimer = cmPingTimer + dt
    if cmPingTimer >= cmPingInterval then
      cmPingTimer = 0
      cmSendLine("P|\\n")
    end
    cmPoseTimer = cmPoseTimer + dt
    if cmPoseTimer >= cmPoseInterval then
      cmPoseTimer = 0
      cmSendPose()
    end
  end
  if replayQueue then
    replayTimer = replayTimer + dt
    if replayTimer >= replayDelay then
      replayTimer = 0
      stepReplay()
    end
  end
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onEditorActivated = onEditorActivated
M.onUpdate = onUpdate
M.onClientStartMission = onClientStartMission
M.onPreRender = onPreRender
return M
`

// CRC-32 lookup table (standard polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  }
  CRC32_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export class GameLauncherService {
  private gameProcess: ChildProcess | null = null
  private coreServer: net.Server | null = null
  private coreSocket: net.Socket | null = null
  private httpProxy: HttpServer | null = null
  private httpProxyPort: number = 0
  private corePort: number = 4444
  private statusListeners: Array<(status: GameStatus) => void> = []
  /** Subscribers notified when the game process exits (either multiplayer or vanilla). */
  private exitListeners: Array<(userDir: string) => void> = []

  // Proton/Steam Deck: the `steam` CLI exits immediately while the game
  // is still launching.  Track this so we don't tear down servers prematurely.
  private isProtonLaunch: boolean = false
  private protonShutdownTimer: ReturnType<typeof setTimeout> | null = null
  private readonly protonConnectTimeout = 120_000 // 2 min for Proton to start the game

  // Auth state
  private loginAuth: boolean = false
  private username: string = ''
  private userRole: string = ''
  private userId: number = -1
  publicKey: string = ''
  private privateKey: string = ''

  // Server connection state
  private connectedServerAddress: string | null = null
  private serverSocket: net.Socket | null = null
  private gameProxyServer: net.Server | null = null
  private gameProxySocket: net.Socket | null = null
  private ulStatus: string = 'Ulstart'
  private mStatus: string = ' '
  private cachedModList: string = ''
  private preSyncActive: boolean = false
  private ping: number = -1
  private terminate: boolean = false
  private terminateReason: string = ''
  private kickPending: boolean = false
  private confList: Set<string> = new Set()
  private clientId: number = -1
  private magic: Buffer | null = null

  // Game paths
  private gameUserDir: string = ''
  private cachingDirectory: string = ''

  // Buffer for TCP framing on core socket
  private coreRecvBuffer: Buffer = Buffer.alloc(0)

  // Server TCP handshake state
  private serverBuffer: Buffer = Buffer.alloc(0)
  private serverMsgResolve: ((msg: string) => void) | null = null
  private serverRawResolve: ((data: Buffer) => void) | null = null
  private serverRawSize: number = 0
  private serverRawBuffer: Buffer | null = null
  private serverRawOffset: number = 0
  private serverRawProgressCallback: ((received: number) => void) | null = null
  private serverInRelay: boolean = false

  // UDP
  private udpSocket: dgram.Socket | null = null
  private udpTarget: { ip: string; port: number } | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private pingStart: number = 0

  // Pending server address for delayed H / UDP start (sent when game connects to proxy)
  private pendingRelayServer: { ip: string; port: number } | null = null

  // Game readiness tracking
  private gameInitialized: boolean = false
  private gameReadyResolve: (() => void) | null = null
  private pendingServerJoin: { ip: string; port: number } | null = null

  // Log buffer for UI
  private logBuffer: string[] = []
  private readonly maxLogLines: number = 2000
  private backendUrlResolver: (() => string) | null = null
  private authUrlResolver: (() => string) | null = null

  // GPS tracker
  private gpsFilePoller: ReturnType<typeof setInterval> | null = null
  private gpsTrackerDeployed: boolean = false
  private latestGpsTelemetry: import('../../shared/types').GPSTelemetry | null = null

  // World Editor Sync (Phase 0 spike)
  private editorSyncDeployed: boolean = false
  private editorSyncStatusPoller: ReturnType<typeof setInterval> | null = null
  private latestEditorSyncStatus: import('../../shared/types').EditorSyncStatus | null = null

  // World Editor Sync (Phase 1+: TCP loopback bridge to Lua)
  private editorBridge: EditorSyncBridgeSocket | null = null
  private editorBridgeReady: boolean = false
  private editorOpSeq: number = 0
  /** Optional listener for ops arriving from Lua (Phase 2 relay will set this). */
  private onLuaOp: ((seq: number, env: LuaOpEnvelope) => void) | null = null
  /** Optional listener for pose ticks arriving from Lua (presence awareness). */
  private onLuaPose: ((pose: LuaPose) => void) | null = null

  // Callback fired when serverInRelay state changes (true = joined server, false = disconnected)
  private onRelayStateChangeCallback: ((inRelay: boolean) => void) | null = null

  /** Register a callback for when the server relay state changes */
  setOnRelayStateChange(cb: (inRelay: boolean) => void): void {
    this.onRelayStateChangeCallback = cb
  }

  /** Set a callback that returns the configured backend URL */
  setBackendUrlResolver(resolver: () => string): void {
    this.backendUrlResolver = resolver
  }

  /** Set a callback that returns the configured auth URL */
  setAuthUrlResolver(resolver: () => string): void {
    this.authUrlResolver = resolver
  }

  /** Resolve the backend base URL (without trailing slash) */
  private get backendUrl(): string {
    const url = this.backendUrlResolver?.() || 'https://backend.beammp.com'
    return url.replace(/\/+$/, '')
  }

  /** Resolve the auth base URL (without trailing slash) */
  private get authUrl(): string {
    const url = this.authUrlResolver?.() || 'https://auth.beammp.com'
    return url.replace(/\/+$/, '')
  }

  /** Set terminate flag with a specific human-readable reason */
  private terminateWith(reason: string): void {
    this.terminate = true
    if (!this.terminateReason) this.terminateReason = reason
    this.log(`Terminate: ${reason}`)
  }

  /** Parse a BeamMP server E/K error message into a human-readable string */
  private parseServerError(raw: string, fallback: string): string {
    if (!raw || raw.length < 2) return fallback
    const code = raw[0]
    const msg = raw.substring(1).trim()
    if (code === 'K') {
      return msg ? `Kicked by server: ${msg}` : 'Kicked by server'
    }
    // E prefix — various server errors
    const lower = msg.toLowerCase()
    if (lower.includes('full')) return 'Server is full'
    if (lower.includes('ban')) return `Banned from server: ${msg}`
    if (lower.includes('auth') || lower.includes('invalid key') || lower.includes('not authenticated')) {
      return `Authentication failed: ${msg}`
    }
    if (lower.includes('version') || lower.includes('outdated') || lower.includes('update')) {
      return `Version mismatch: ${msg}`
    }
    if (lower.includes('whitelist')) return `Not on server whitelist: ${msg}`
    if (lower.includes('timeout')) return 'Connection timed out'
    return msg || fallback
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`
    console.log(`[BeamMP] ${message}`)
    this.logBuffer.push(line)
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.splice(0, this.logBuffer.length - this.maxLogLines)
    }
    this.emitLauncherLog(line)
  }

  private emitLauncherLog(line: string): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('launcher:log', line)
    }
  }

  private emitModSyncProgress(progress: {
    phase: 'downloading' | 'loading' | 'done'
    modIndex: number
    modCount: number
    fileName: string
    received: number
    total: number
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('game:modSyncProgress', progress)
    }
  }

  getLogs(): string[] {
    return [...this.logBuffer]
  }

  getLauncherVersion(): string {
    return LAUNCHER_VERSION
  }

  constructor() {
    this.cachingDirectory = join(app.getPath('userData'), 'Resources')
    this.loadSavedKey()
  }

  getStatus(): GameStatus {
    // On Proton/Steam Deck, the steam CLI exits immediately but the game
    // is still starting.  Report as running if Core server is up or socket connected.
    const processAlive = this.gameProcess !== null && !this.gameProcess.killed
    const protonWaiting = this.isProtonLaunch && (this.coreServer !== null || this.coreSocket !== null)
    return {
      running: processAlive || protonWaiting,
      pid: this.gameProcess?.pid ?? null,
      connectedServer: this.connectedServerAddress
    }
  }

  onStatusChange(listener: (status: GameStatus) => void): void {
    this.statusListeners.push(listener)
  }

  private notifyStatusChange(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  /**
   * Subscribe to game-process exit. Called once per teardown regardless of
   * launch mode (multiplayer or vanilla). Listeners should synchronously
   * undeploy any Lua extensions / bridges they own so nothing stale is left
   * in the BeamNG userDir.
   */
  onGameExit(listener: (userDir: string) => void): void {
    this.exitListeners.push(listener)
  }

  private notifyGameExit(): void {
    if (!this.gameUserDir) return
    for (const listener of this.exitListeners) {
      try {
        listener(this.gameUserDir)
      } catch (err) {
        this.log(`WARNING: game-exit listener threw: ${err}`)
      }
    }
  }

  // ── Key persistence ──

  private getKeyPath(): string {
    return join(app.getPath('userData'), 'key')
  }

  private loadSavedKey(): void {
    try {
      const keyPath = this.getKeyPath()
      if (!existsSync(keyPath)) return
      const raw = readFileSync(keyPath)

      // Try decrypting (encrypted keys are binary, not valid UTF-8 starting with plain alphanum)
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(raw)
          if (decrypted && /^[a-zA-Z0-9-]+$/.test(decrypted)) {
            this.privateKey = decrypted
            return
          }
        } catch {
          // Not encrypted — fall through to plaintext migration
        }
      }

      // Fallback: read as plaintext (legacy) and re-encrypt
      const plain = raw.toString('utf-8').trim()
      if (plain && /^[a-zA-Z0-9-]+$/.test(plain)) {
        this.privateKey = plain
        // Migrate: re-save encrypted
        this.saveKey(plain)
      }
    } catch {
      // ignore
    }
  }

  private saveKey(key: string | null): void {
    const keyPath = this.getKeyPath()
    if (key && /^[a-zA-Z0-9]/.test(key)) {
      this.privateKey = key
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        writeFileSync(keyPath, encrypted)
      } else {
        // Fallback if OS encryption unavailable
        writeFileSync(keyPath, key, 'utf-8')
      }
    } else {
      this.privateKey = ''
      try {
        if (existsSync(keyPath)) {
          unlinkSync(keyPath)
        }
      } catch {
        // ignore
      }
    }
  }

  // ── TCP Framing helpers ──

  private prependHeader(data: string): Buffer {
    const payload = Buffer.from(data, 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    return Buffer.concat([header, payload])
  }

  private coreSend(data: string): void {
    if (this.coreSocket && !this.coreSocket.destroyed) {
      const buf = this.prependHeader(data)
      this.coreSocket.write(buf)
    }
  }

  // ── Compression helpers ──

  private decompressBuf(rawPayload: Buffer): string {
    if (
      rawPayload.length >= 4 &&
      rawPayload[0] === 0x41 &&
      rawPayload[1] === 0x42 &&
      rawPayload[2] === 0x47 &&
      rawPayload[3] === 0x3a
    ) {
      try {
        const decompressed = zlib.inflateSync(rawPayload.subarray(4))
        return decompressed.toString('utf-8')
      } catch (err) {
        this.log(`ERROR: Decompression failed: ${err}`)
        return rawPayload.toString('utf-8')
      }
    }
    return rawPayload.toString('utf-8')
  }

  // ── SHA-256 hash ──

  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  // ── Core TCP Server (port 4444) ──

  private startCoreServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.coreServer) {
        resolve()
        return
      }

      this.coreServer = net.createServer((socket) => {
        this.log('Game Connected!')
        this.coreSocket = socket
        this.coreRecvBuffer = Buffer.alloc(0)
        this.localReset()

        // Proton: game connected — cancel the connect timeout
        if (this.protonShutdownTimer) {
          clearTimeout(this.protonShutdownTimer)
          this.protonShutdownTimer = null
          this.log('Proton: Game connected to Core — cancelled shutdown timer')
          this.notifyStatusChange()
        }

        socket.on('data', (chunk) => {
          this.coreRecvBuffer = Buffer.concat([this.coreRecvBuffer, chunk])
          this.processCoreBuffer()
        })

        socket.on('close', () => {
          this.log('Game disconnected from Core')
          this.coreSocket = null
          this.netReset()

          // Proton: the Core socket closing is the real "game exited" signal,
          // since the steam CLI process has already exited long ago.
          if (this.isProtonLaunch && !this.gameProcess) {
            this.log('Proton: Game closed (Core socket disconnected) — shutting down servers')
            this.isProtonLaunch = false
            this.shutdown()
            this.notifyStatusChange()
          }
        })

        socket.on('error', (err) => {
          this.log(`ERROR: Core socket error: ${err.message}`)
          this.coreSocket = null
        })
      })

      this.coreServer.on('error', (err) => {
        this.log(`ERROR: Core server error: ${err}`)
        reject(err)
      })

      this.coreServer.listen(this.corePort, '127.0.0.1', () => {
        this.log(`Core Network on port: ${this.corePort}`)
        resolve()
      })
    })
  }

  private processCoreBuffer(): void {
    while (this.coreRecvBuffer.length >= 4) {
      const msgLen = this.coreRecvBuffer.readUInt32LE(0)
      if (this.coreRecvBuffer.length < 4 + msgLen) break

      const data = this.coreRecvBuffer.subarray(4, 4 + msgLen).toString('utf-8')
      this.coreRecvBuffer = this.coreRecvBuffer.subarray(4 + msgLen)

      this.parseCoreMessage(data)
    }
  }

  private parseCoreMessage(data: string): void {
    if (!data.length) return

    const code = data[0]
    const subCode = data.length > 1 ? data[1] : ''

    // Log core messages from game (skip A heartbeats, Ul polling, and frequent relay traffic)
    if (code !== 'A' && code !== 'E' && code !== 'O' && code !== 'V' && code !== 'W'
      && !(code === 'U' && subCode === 'l') && !(code === 'U' && subCode === 'p')) {
      this.log(`Core ← Game: ${code}${subCode} (${data.length} bytes)${data.length < 80 ? ' → ' + data : ''}`)
    }

    switch (code) {
      case 'A':
        // Ack — respond with just 'A'
        this.coreSend('A')
        break

      case 'B':
        // Server list request — fetch and send
        // Don't reset if we're actively connecting to or connected to a server
        if (this.pendingServerJoin || this.connectedServerAddress) {
          this.log('Skipping netReset on B — active connection/pending join')
        } else {
          this.netReset()
          this.terminate = true
        }
        this.fetchAndSendServerList()
        break

      case 'C':
        // Connect to server: C<ip:port>
        // If we're already connected/connecting (joinServerImpl pre-connected),
        // skip — the game just needs to connect to the proxy.
        if (this.preSyncActive && this.serverInRelay) {
          this.preSyncActive = false
          this.log('Pre-synced connection active, sending L to game and staging Uldone')
          // NOW send L to trigger the game's loading state machine.
          // We withheld it during pre-sync so the game wouldn't try to
          // mount/load the map before connectToServer was called.
          this.ulStatus = 'UlLoading...'
          this.coreSend('L' + this.cachedModList)
          // Delay Uldone to give the game time to mount mods via loadServerMods()
          // before it requests the map. Without this delay, expandMissionFileName()
          // fails for mod maps (e.g. freedom) because the zip hasn't been indexed yet.
          setTimeout(() => {
            this.ulStatus = 'Uldone'
          }, 3000)
        } else if (this.serverInRelay || (this.serverSocket && !this.serverSocket.destroyed)) {
          this.log('Already connected/connecting, re-sending L to game')
          this.coreSend('L' + this.cachedModList)
        } else {
          this.startServerSync(data)
        }
        break

      case 'I':
        // Server info query: I<ip:port>
        this.getServerInfo(data)
        break

      case 'N':
        // Auth
        if (subCode === 'c') {
          // Return cached auth info
          const authInfo: Record<string, unknown> = {
            Auth: this.loginAuth ? 1 : 0
          }
          if (this.username) authInfo.username = this.username
          if (this.userRole) authInfo.role = this.userRole
          if (this.userId !== -1) authInfo.id = this.userId
          this.coreSend('N' + JSON.stringify(authInfo))

          // Mark game as initialized after auth exchange
          if (!this.gameInitialized) {
            this.gameInitialized = true
            this.log('Game mod initialized (Nc auth completed)')
            if (this.gameReadyResolve) {
              this.gameReadyResolve()
              this.gameReadyResolve = null
            }
          }
        } else {
          // Login request: N<fields_after_colon>
          const colonIdx = data.indexOf(':')
          const fields = colonIdx >= 0 ? data.substring(colonIdx + 1) : ''
          this.handleLogin(fields)
        }
        break

      case 'O':
        // Open URL in browser — we just ignore or could use shell.openExternal
        break

      case 'P':
        // Game asks for HTTP proxy port — respond with P<httpProxyPort>
        // (official launcher does the same in Core.cpp Parse 'P' handler).
        if (this.httpProxyPort > 0) {
          this.coreSend('P' + this.httpProxyPort.toString())
        }
        break

      case 'Q':
        // Quit commands
        if (subCode === 'S') {
          // If we're in pre-sync, the game may send QS because it tried to process
          // a stale state. Ignore it to preserve the relay.
          if (this.preSyncActive && this.serverInRelay) {
            this.log('QS received during pre-sync — ignoring (relay preserved)')
          } else {
            this.netReset()
            this.terminate = true
            this.ping = -1
            // If a kick/disconnect was initiated by the server (K message or
            // broken relay), the game detects the dead proxy and sends QS.
            // Kill the game now so the user doesn't get stranded at the menu.
            if (this.kickPending) {
              this.log('QS after server kick — killing game')
              this.kickPending = false
              this.killGame()
            }
          }
        } else if (subCode === 'G') {
          // Game wants launcher to close — we stay open
        }
        break

      case 'R':
        // Mod loaded confirmation
        if (!this.confList.has(data)) {
          this.confList.add(data)
        }
        break

      case 'U':
        // Status query
        if (subCode === 'l') {
          this.coreSend(this.ulStatus)
        } else if (subCode === 'p') {
          const pingStr = this.ping > 800 ? '-2' : this.ping.toString()
          this.coreSend('Up' + pingStr)
        } else {
          const pingStr = this.ping > 800 ? '-2' : this.ping.toString()
          this.coreSend('Up' + pingStr)
        }
        break

      case 'M':
        // Map request from game — respond if we have the map
        if (this.mStatus !== ' ') {
          this.log('Game requested map, responding with cached map')
          this.coreSend(this.mStatus)
        } else {
          this.log('Game requested map but not received from server yet')
        }
        break

      case 'W':
        // Security warning confirmation (game auto-sends WY when skipModSecurityWarning is on)
        // We don't send WMODS_FOUND anymore, but handle WY/WN gracefully if received
        break

      case 'Z':
        // Version query
        this.coreSend('Z' + LAUNCHER_VERSION)
        break

      default:
        break
    }
  }

  // ── Server list fetch ──

  private async fetchAndSendServerList(): Promise<void> {
    try {
      const resp = await fetch(`${this.backendUrl}/servers-info`)
      const body = await resp.text()
      this.coreSend('B' + body)
    } catch (err) {
      this.log(`ERROR: Failed to fetch server list: ${err}`)
      this.coreSend('B[]')
    }
  }

  // ── Server info query ──

  private getServerInfo(data: string): void {
    // data = "I<ip:port>"
    const hostPort = data.substring(1)
    const colonIdx = hostPort.lastIndexOf(':')
    if (colonIdx < 0) {
      this.coreSend('I' + hostPort + ';')
      return
    }
    const ip = hostPort.substring(0, colonIdx)
    const port = parseInt(hostPort.substring(colonIdx + 1), 10)

    if (!port || port < 1 || port > 65535) {
      this.coreSend('I' + hostPort + ';')
      return
    }

    const sock = new net.Socket()
    sock.setTimeout(5000)
    sock.connect(port, ip, () => {
      // Send raw 'I' byte (no length prefix) per protocol
      sock.write(Buffer.from('I'))
    })

    let recvBuf = Buffer.alloc(0)
    sock.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk])
      if (recvBuf.length >= 4) {
        const len = recvBuf.readUInt32LE(0)
        if (recvBuf.length >= 4 + len) {
          const info = recvBuf.subarray(4, 4 + len).toString('utf-8')
          this.coreSend('I' + hostPort + ';' + info)
          sock.destroy()
        }
      }
    })

    sock.on('timeout', () => {
      this.coreSend('I' + hostPort + ';')
      sock.destroy()
    })

    sock.on('error', () => {
      this.coreSend('I' + hostPort + ';')
      sock.destroy()
    })
  }

  // ── Authentication ──

  private async handleLogin(fields: string): Promise<void> {
    if (fields === 'LO') {
      // Logout
      this.username = ''
      this.userRole = ''
      this.userId = -1
      this.loginAuth = false
      this.saveKey(null)
      this.coreSend('N')
      return
    }

    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: fields
      })
      const body = await resp.text()

      if (!body || body[0] !== '{') {
        this.coreSend('N' + JSON.stringify({ success: false, message: 'Invalid auth response' }))
        return
      }

      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        this.log('Authentication successful!')
      } else {
        this.log('Authentication failed')
      }

      // Strip sensitive keys before sending to game
      const result = { ...d }
      delete result.private_key
      delete result.public_key
      this.coreSend('N' + JSON.stringify(result))
    } catch (err) {
      this.log(`ERROR: Auth error: ${err}`)
      this.coreSend('N' + JSON.stringify({ success: false, message: String(err) }))
    }
  }

  async checkLocalKey(): Promise<void> {
    if (!this.privateKey) return
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk: this.privateKey })
      })
      const body = await resp.text()
      if (!body || body[0] !== '{') {
        this.saveKey(null)
        return
      }
      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        this.log('Auto-authentication successful')
      } else {
        this.saveKey(null)
      }
    } catch {
      this.saveKey(null)
    }
  }

  // ── Server Connection (C command) ──

  private async startServerSync(data: string): Promise<void> {
    const hostPort = data.substring(1)
    const colonIdx = hostPort.lastIndexOf(':')
    if (colonIdx < 0) {
      this.ulStatus = 'UlConnection Failed!'
      this.coreSend('L')
      return
    }
    const ip = hostPort.substring(0, colonIdx)
    const port = parseInt(hostPort.substring(colonIdx + 1), 10)

    await this.checkLocalKey()
    this.ulStatus = 'UlLoading...'
    this.terminate = false
    this.terminateReason = ''
    this.confList.clear()
    this.ping = -1
    this.clientId = -1
    this.serverInRelay = false
    this.connectedServerAddress = `${ip}:${port}`
    this.notifyStatusChange()

    this.log(`Connecting to server ${ip}:${port}`)
    this.startGameProxyServer()
    this.connectToServer(ip, port)
  }

  private connectToServer(ip: string, port: number): void {
    const serverSock = new net.Socket()
    this.serverSocket = serverSock
    this.serverBuffer = Buffer.alloc(0)

    serverSock.on('data', (chunk) => {
      this.serverBuffer = Buffer.concat([this.serverBuffer, chunk])
      this.processServerBuffer()
    })

    serverSock.on('error', (err) => {
      this.log(`ERROR: Server connection error: ${err.message}`)
      this.ulStatus = 'UlConnection Failed!'
      this.terminateWith(`Connection failed: ${err.message}`)
      this.coreSend('L')
      // Reject any pending server recv promises so awaits don't hang
      if (this.serverMsgResolve) {
        const r = this.serverMsgResolve
        this.serverMsgResolve = null
        r('')
      }
      if (this.serverRawResolve) {
        const r = this.serverRawResolve
        this.serverRawResolve = null
        r(Buffer.alloc(0))
      }

    })

    serverSock.on('end', () => {
      this.log('Server connection ended (remote closed)')
      this.terminateWith('Server closed the connection')
    })

    serverSock.on('close', () => {
      this.log('Server connection closed')
      const wasInRelay = this.serverInRelay
      this.connectedServerAddress = null
      this.serverInRelay = false
      if (wasInRelay) this.onRelayStateChangeCallback?.(false)
      this.notifyStatusChange()
      // If we were in relay (game was actively connected to server), kill the game
      // so the user doesn't get stranded at the main menu
      if (wasInRelay) {
        this.log('Connection lost while in relay — killing game')
        this.kickPending = true
        this.killGame()
      }
    })

    serverSock.connect(port, ip, () => {
      this.log('Connected to server!')
      serverSock.write(Buffer.from('C'))
      this.doServerHandshake(ip, port).catch((err) => {
        this.log(`ERROR: Handshake failed: ${err.message || err}`)
        this.ulStatus = 'UlConnection Failed!'
        this.terminateWith((err as Error).message || String(err))
        this.coreSend('L')
        serverSock.destroy()
      })
    })
  }

  private serverRecvMsg(timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.terminate) { reject(new Error('Terminated')); return }
      const timer = setTimeout(() => {
        if (this.serverMsgResolve === wrappedResolve) {
          this.serverMsgResolve = null
          this.log('ERROR: serverRecvMsg timed out')
          this.terminateWith('Server response timed out')
          resolve('')
        }
      }, timeoutMs)
      const wrappedResolve = (val: string): void => {
        clearTimeout(timer)
        resolve(val)
      }
      this.serverMsgResolve = wrappedResolve
      this.processServerBuffer()
    })
  }

  private serverRecvRaw(size: number, timeoutMs?: number): Promise<Buffer> {
    // Scale timeout: at least 60s, or allow ~10 KB/s minimum throughput, whichever is larger
    const effectiveTimeout = timeoutMs ?? Math.max(60000, Math.ceil(size / 10240) * 1000 + 30000)
    return new Promise((resolve, reject) => {
      if (this.terminate) { reject(new Error('Terminated')); return }
      const timer = setTimeout(() => {
        if (this.serverRawResolve === wrappedResolve) {
          this.serverRawResolve = null
          this.log(`ERROR: serverRecvRaw timed out waiting for ${size} bytes`)
          this.terminateWith('Mod download timed out')
          resolve(Buffer.alloc(0))
        }
      }, effectiveTimeout)
      const wrappedResolve = (val: Buffer): void => {
        clearTimeout(timer)
        resolve(val)
      }
      this.serverRawResolve = wrappedResolve
      this.serverRawSize = size
      // Pre-allocate the target buffer and track write offset for streaming receives
      this.serverRawBuffer = Buffer.allocUnsafe(size)
      this.serverRawOffset = 0
      this.processServerBuffer()
    })
  }

  private processServerBuffer(): void {
    if (this.serverInRelay) {
      while (this.serverBuffer.length >= 4) {
        const len = this.serverBuffer.readUInt32LE(0)
        if (this.serverBuffer.length < 4 + len) break
        const raw = this.serverBuffer.subarray(4, 4 + len)
        this.serverBuffer = this.serverBuffer.subarray(4 + len)
        // Handle U (magic) at raw buffer level to avoid UTF-8 corruption of binary data
        if (raw.length > 0 && raw[0] === 0x55) { // 'U'
          this.magic = Buffer.from(raw.subarray(1))
          this.log(`UDP auth: received magic (${this.magic.length} bytes), sending auth`)
          for (let i = 0; i < 10; i++) this.udpSendBuf(this.magic)
          // Forward raw U message to game without UTF-8 conversion
          this.gameSendBuf(raw)
          continue
        }
        this.handleRelayMessage(this.decompressBuf(raw))
      }
      return
    }
    if (this.serverRawResolve && this.serverRawSize > 0 && this.serverRawBuffer) {
      // Stream incoming data into pre-allocated buffer instead of accumulating
      const remaining = this.serverRawSize - this.serverRawOffset
      if (this.serverBuffer.length > 0 && remaining > 0) {
        const toCopy = Math.min(this.serverBuffer.length, remaining)
        this.serverBuffer.copy(this.serverRawBuffer, this.serverRawOffset, 0, toCopy)
        this.serverRawOffset += toCopy
        this.serverBuffer = this.serverBuffer.subarray(toCopy)
        if (this.serverRawProgressCallback) {
          this.serverRawProgressCallback(this.serverRawOffset)
        }
      }
      if (this.serverRawOffset >= this.serverRawSize) {
        const data = this.serverRawBuffer
        const resolve = this.serverRawResolve
        this.serverRawResolve = null
        this.serverRawSize = 0
        this.serverRawBuffer = null
        this.serverRawOffset = 0
        this.serverRawProgressCallback = null
        resolve(data)
      }
      return
    }
    if (this.serverMsgResolve && this.serverBuffer.length >= 4) {
      const len = this.serverBuffer.readUInt32LE(0)
      if (this.serverBuffer.length >= 4 + len) {
        const raw = this.serverBuffer.subarray(4, 4 + len)
        this.serverBuffer = this.serverBuffer.subarray(4 + len)
        const resolve = this.serverMsgResolve
        this.serverMsgResolve = null
        resolve(this.decompressBuf(raw))
      }
    }
  }

  private serverSendFramed(data: string): void {
    if (this.serverSocket && !this.serverSocket.destroyed) {
      this.serverSocket.write(this.prependHeader(data))
    }
  }

  private async doServerHandshake(ip: string, port: number): Promise<void> {
    this.log(`Handshake: sending version VC${LAUNCHER_VERSION}`)
    this.serverSendFramed('VC' + LAUNCHER_VERSION)
    const vResp = await this.serverRecvMsg()
    this.log(`Handshake: version response: ${vResp?.substring(0, 50)}`)
    if (!vResp) {
      throw new Error('Server did not respond to version check (may be offline or unreachable)')
    }
    if (vResp[0] === 'E' || vResp[0] === 'K') {
      throw new Error(this.parseServerError(vResp, 'Server rejected connection'))
    }

    this.log(`Handshake: sending publicKey (${(this.publicKey || '').length} chars)`)
    this.serverSendFramed(this.publicKey || '')
    if (this.terminate) throw new Error(this.terminateReason || 'Connection lost during authentication')

    const pResp = await this.serverRecvMsg()
    if (!pResp) {
      throw new Error('Server did not respond to authentication (connection may have been dropped)')
    }
    if (pResp[0] === 'E' || pResp[0] === 'K') {
      throw new Error(this.parseServerError(pResp, 'Authentication rejected'))
    }
    if (pResp[0] !== 'P') throw new Error('Unexpected server response during auth: ' + pResp.substring(0, 80))
    const idStr = pResp.substring(1)
    if (!/^\d+$/.test(idStr)) throw new Error('Server returned invalid client ID: ' + idStr)
    this.clientId = parseInt(idStr, 10)
    this.log(`Client ID: ${this.clientId}`)

    this.serverSendFramed('SR')
    this.log('Handshake: sent SR, waiting for mod list')
    if (this.terminate) throw new Error(this.terminateReason || 'Connection lost')
    const modResp = await this.serverRecvMsg()
    if (modResp[0] === 'E' || modResp[0] === 'K') {
      throw new Error(this.parseServerError(modResp, 'Server rejected during mod sync'))
    }

    this.log(`Mod info received (${modResp.length} bytes)`)

    if (!modResp || modResp === '-') {
      this.log('No mods required')
      this.cachedModList = ''
      if (!this.preSyncActive) {
        this.coreSend('L')
      }
      this.serverSendFramed('Done')
    } else {
      await this.syncMods(modResp)
    }
    if (this.terminate) throw new Error(this.terminateReason || 'Mod sync failed')

    this.log('Handshake complete, entering relay mode')
    this.serverInRelay = true
    this.onRelayStateChangeCallback?.(true)
    this.pendingRelayServer = { ip, port }

    // If the game is already connected to the proxy (early join signal flow),
    // start relay immediately instead of waiting for the proxy callback.
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      const { ip: rIp, port: rPort } = this.pendingRelayServer
      this.pendingRelayServer = null
      this.log('Game already on proxy — sending P, H and starting UDP')
      if (this.clientId >= 0) {
        this.gameSend('P' + this.clientId.toString())
      }
      this.serverSendFramed('H')
      this.startUdp(rIp, rPort)
    }
    this.processServerBuffer()
  }

  private async syncMods(modListJson: string): Promise<void> {
    let modInfos: ModInfo[] = []
    try { modInfos = JSON.parse(modListJson) } catch {
      this.coreSend('L')
      this.serverSendFramed('Done')
      return
    }
    if (!Array.isArray(modInfos) || modInfos.length === 0) {
      this.coreSend('L')
      this.serverSendFramed('Done')
      return
    }

    // Skip sending WMODS_FOUND to game - the game's Lua handler would crash
    // because currentServer is nil (we bypassed the in-game connect flow).
    // We auto-confirm the security warning ourselves.

    if (!existsSync(this.cachingDirectory)) mkdirSync(this.cachingDirectory, { recursive: true })

    const modNames = modInfos.map((m) => m.file_name).filter(Boolean).join(';')
    this.cachedModList = modNames
    // During pre-sync, DON'T send L yet — it would trigger the game's loading
    // state machine before connectToServer is called, causing mod map loads to
    // fail (expandMissionFileName returns false for unindexed mod levels).
    // L will be sent when the game sends C.
    if (!this.preSyncActive) {
      this.coreSend('L' + modNames)
    }

    const modsDir = join(this.gameUserDir, 'mods', 'multiplayer')
    if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

    // Clean up stale mods from previous sessions that aren't needed by this server.
    // The game's MPModManager iterates ALL zips in mods/multiplayer and calls
    // isModAllowed(modName) for each — if a leftover zip has no valid info.json
    // (nil modName), the Lua crashes with "bad argument #1 to 'lower'".
    const requiredFiles = new Set(modInfos.map((m) => m.file_name.toLowerCase()))
    try {
      for (const file of readdirSync(modsDir)) {
        if (!file.toLowerCase().endsWith('.zip')) continue
        // Never remove BeamMP.zip — it's the core multiplayer mod
        if (file.toLowerCase() === 'beammp.zip') continue
        if (!requiredFiles.has(file.toLowerCase())) {
          try {
            unlinkSync(join(modsDir, file))
            this.log(`Removed stale mod: ${file}`)
          } catch { /* ignore removal errors */ }
        }
      }
    } catch { /* ignore if directory read fails */ }

    this.log(`Syncing ${modInfos.length} mods...`)

    for (let i = 0; i < modInfos.length && !this.terminate; i++) {
      const mod = modInfos[i]
      if (mod.hash_algorithm !== 'sha256' || mod.hash.length < 8) {
        this.log(`ERROR: Bad hash for ${mod.file_name}`)
        this.terminateWith(`Mod "${mod.file_name}" has an invalid hash — server may be misconfigured`)
        return
      }

      const stem = basename(mod.file_name, extname(mod.file_name))
      const ext = extname(mod.file_name)
      const cachedName = `${stem}-${mod.hash.substring(0, 8)}${ext}`
      const cachedPath = join(this.cachingDirectory, cachedName)
      const destPath = join(modsDir, mod.file_name)

      let needDownload = true
      if (existsSync(cachedPath)) {
        try {
          if (await this.hashFile(cachedPath) === mod.hash) needDownload = false
        } catch { /* redownload */ }
      }

      if (needDownload) {
        if (mod.protected) { this.terminateWith(`Mod "${mod.file_name}" is protected and cannot be downloaded`); return }
        this.ulStatus = `UlDownloading Resource ${i + 1}/${modInfos.length}: ${mod.file_name}`
        this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: 0, total: mod.file_size })
        this.log(`Downloading ${mod.file_name} (${mod.file_size} bytes)`)
        this.serverSendFramed('f' + mod.file_name)
        const dlResp = await this.serverRecvMsg()
        if (dlResp === 'CO' || this.terminate) { this.terminateWith(`Server refused to send mod "${mod.file_name}"`); return }
        if (dlResp !== 'AG') { this.terminateWith(`Unexpected response downloading mod "${mod.file_name}": ${dlResp?.substring(0, 40)}`); return }
        // Stream progress updates to the overlay as data arrives
        this.serverRawProgressCallback = (received: number): void => {
          this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received, total: mod.file_size })
        }
        const fileData = await this.serverRecvRaw(mod.file_size)
        if (this.terminate || fileData.length !== mod.file_size) { this.terminateWith(`Download of "${mod.file_name}" was incomplete (got ${fileData.length} of ${mod.file_size} bytes)`); return }
        this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: mod.file_size, total: mod.file_size })
        writeFileSync(cachedPath, fileData)
        const hash = await this.hashFile(cachedPath)
        if (hash !== mod.hash) {
          try { unlinkSync(cachedPath) } catch { /* */ }
          this.terminateWith(`Hash mismatch for "${mod.file_name}" — downloaded file is corrupted`)
          return
        }
        this.log(`Downloaded ${mod.file_name}`)
      }

      this.ulStatus = `UlLoading Resource ${i + 1}/${modInfos.length}: ${mod.file_name}`
      this.emitModSyncProgress({ phase: 'loading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: 0, total: mod.file_size })
      try {
        const tmpPath = destPath + '.tmp'
        copyFileSync(cachedPath, tmpPath)
        renameSync(tmpPath, destPath)
      } catch (err) {
        this.log(`ERROR: Failed to copy mod: ${err}`)
        this.terminateWith(`Failed to install mod "${mod.file_name}": ${err}`)
        return
      }
      this.log(`Mod ${mod.file_name} placed (${i + 1}/${modInfos.length})`)
    }

    if (!this.terminate) {
      this.serverSendFramed('Done')
      this.log('Mod sync complete!')
    } else {
      this.log('Mod sync aborted due to error or timeout')
    }
    // Always emit done so the overlay dismisses itself
    this.emitModSyncProgress({ phase: 'done', modIndex: modInfos.length, modCount: modInfos.length, fileName: '', received: 0, total: 0 })
  }

  private handleRelayMessage(data: string): void {
    if (!data.length) return
    const code = data[0]

    // Only log state-significant relay codes — M (map cached), K (kick), U (magic auth).
    // Everything else (p ping, E/O/V/W/N/C/T/Y/Z position sync, chat, server-side mod
    // events, etc.) is per-packet traffic that would flood the launcher log.
    if (code === 'M' || code === 'K' || code === 'U') {
      this.log(`Relay ← Server: ${code} (${data.length} bytes)${data.length < 120 ? ' → ' + data.substring(0, 120) : ''}`)
    }

    switch (code) {
      case 'p':
        if (this.pingStart > 0) this.ping = Date.now() - this.pingStart
        return
      case 'M':
        this.mStatus = data
        // During pre-sync, don't set Uldone yet — it will be staged when the
        // game sends C. Otherwise the game's state machine runs too early.
        if (!this.preSyncActive) {
          this.ulStatus = 'Uldone'
        }
        this.log(`Map received from server, cached map: ${data.substring(0, 80)}`)
        // Official launcher caches M and does NOT forward it to game.
        // The game requests map data via core socket 'M' message instead.
        return
      case 'U':
        // U (magic) is handled at raw buffer level in processServerBuffer
        // to avoid UTF-8 corruption. This case only triggers for non-binary U messages.
        break
      case 'E':
        // During relay, 'E' is the prefix for TriggerClientEvent — server-side Lua mods
        // sending event messages to the client (e.g. E:rxFuelTechHandshake:...,
        // E:rxInputUpdate:...).  These must be forwarded to the game, NOT treated as
        // errors.  Only 'K' (kick) is a real disconnect during relay.
        break
      case 'K': {
        const reason = this.parseServerError(data, 'Disconnected by server')
        this.ulStatus = 'UlDisconnected: ' + data.substring(1)
        this.log(`Server sent ${code} — killing game: ${reason}`)
        this.terminateWith(reason)
        this.kickPending = true
        this.netReset()
        this.killGame()
        return // don't forward to game — it's being killed
      }
    }
    this.gameSend(data)
  }

  private gameSend(data: string): void {
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      this.gameProxySocket.write(this.prependHeader(data))
    }
  }

  private gameSendBuf(data: Buffer): void {
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(data.length, 0)
      this.gameProxySocket.write(Buffer.concat([header, data]))
    }
  }

  /**
   * Route a game→server message with the same logic as the official launcher's
   * ServerSend (GlobalHandler.cpp).
   *
   * Routing rules (matching official C++ exactly):
   *   • Code extracted only when len > 3 (otherwise C = 0 → goes UDP)
   *   • O, T → "Ack" → TCP, compressed (SendLarge) if > 400 bytes
   *   • N, W, Y, V, E, C → "Rel" (reliable) → TCP (plain if ≤ 1000, compressed if > 1000)
   *   • compressBound > 1024 (~≈ len > 1024) → forced reliable
   *   • Everything else → UDP (compressed if > 400 bytes)
   */
  private serverSend(data: string): void {
    if (!this.serverSocket || this.serverSocket.destroyed || this.terminate) return
    if (!data.length) return

    const len = data.length
    const code = len > 3 ? data[0] : '\0'
    const isAck = code === 'O' || code === 'T'
    let isRel = 'NWYVEC'.includes(code) && code !== '\0'
    if (len > 1024) isRel = true                   // compressBound heuristic

    if (isAck || isRel) {
      if (isAck || len > 1000) {
        this.serverSendLarge(data)                   // TCP + compression
      } else {
        this.serverSendFramed(data)                  // TCP, no compression
      }
    } else {
      this.udpSend(data)                             // UDP (compresses if > 400)
    }
  }

  /** TCP send with ABG: compression for payloads > 400 bytes (matches SendLarge) */
  private serverSendLarge(data: string): void {
    if (!this.serverSocket || this.serverSocket.destroyed) return
    const buf = Buffer.from(data, 'utf-8')
    if (buf.length > 400) {
      const compressed = zlib.deflateSync(buf)
      const payload = Buffer.concat([Buffer.from('ABG:'), compressed])
      const header = Buffer.alloc(4)
      header.writeUInt32LE(payload.length, 0)
      this.serverSocket.write(Buffer.concat([header, payload]))
    } else {
      this.serverSendFramed(data)
    }
  }

  private startUdp(ip: string, port: number): void {
    this.udpTarget = { ip, port }
    this.udpSocket = dgram.createSocket('udp4')
    this.udpSocket.on('message', (msg) => {
      const str = msg.toString('utf-8')
      if (str === 'p') {
        // UDP ping response — update ping measurement
        if (this.pingStart > 0) this.ping = Date.now() - this.pingStart
        return
      }
      if (str.startsWith('ABG:')) {
        try { this.gameSend(zlib.inflateSync(msg.subarray(4)).toString('utf-8')) } catch { /**/ }
      } else {
        this.gameSend(str)
      }
    })
    this.udpSocket.on('error', (err) => this.log(`ERROR: UDP error: ${err.message}`))

    // If magic was already received via TCP relay before UDP was ready,
    // authenticate now (official launcher does this in UDPClientMain).
    if (this.magic) {
      this.log(`UDP socket ready, sending stored magic auth (${this.magic.length} bytes)`)
      for (let i = 0; i < 10; i++) this.udpSendBuf(this.magic)
    }

    // Send initial ping immediately (matches official launcher)
    this.udpSend('p')
    this.pingStart = Date.now()

    this.pingInterval = setInterval(() => {
      if (this.terminate) { if (this.pingInterval) clearInterval(this.pingInterval); return }
      this.pingStart = Date.now()
      this.udpSend('p')
    }, 1000)
  }

  private udpSend(data: string): void {
    if (!this.udpSocket || !this.udpTarget || this.clientId < 0) return
    // Compress payloads > 400 bytes with ABG: prefix (matches official UDPSend)
    let payload: string | Buffer = data
    if (data.length > 400) {
      const compressed = zlib.deflateSync(Buffer.from(data, 'utf-8'))
      payload = Buffer.concat([Buffer.from('ABG:'), compressed])
    }
    const prefix = Buffer.from(String.fromCharCode(this.clientId + 1) + ':')
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload
    this.udpSocket.send(Buffer.concat([prefix, body]), this.udpTarget.port, this.udpTarget.ip)
  }

  private udpSendBuf(data: Buffer): void {
    if (!this.udpSocket || !this.udpTarget || this.clientId < 0) return
    const prefix = Buffer.from([this.clientId + 1, 0x3A]) // <id+1>:
    this.udpSocket.send(Buffer.concat([prefix, data]), this.udpTarget.port, this.udpTarget.ip)
  }

  private startGameProxyServer(): void {
    if (this.gameProxyServer) { this.gameProxyServer.close(); this.gameProxyServer = null }
    const proxyPort = this.corePort + 1
    this.gameProxyServer = net.createServer((socket) => {
      this.log('(Proxy) Game Connected!')
      this.gameProxySocket = socket

      // Only initiate relay handshake (P + H + UDP) if we're already in relay mode.
      // If the game connects DURING mod sync (early join signal), just store the
      // socket — doServerHandshake will detect it later and start relay then.
      if (this.serverInRelay && this.pendingRelayServer) {
        const { ip, port } = this.pendingRelayServer
        this.pendingRelayServer = null
        if (this.clientId >= 0) {
          this.log(`Sending P${this.clientId} to game via proxy`)
          this.gameSend('P' + this.clientId.toString())
        }
        this.log('Sending H to server (relay start) and starting UDP')
        this.serverSendFramed('H')
        this.startUdp(ip, port)
        this.processServerBuffer()
      } else if (this.serverInRelay && this.clientId >= 0) {
        // Relay already active (H already sent) — just send P
        this.log(`Sending P${this.clientId} to game via proxy (relay already active)`)
        this.gameSend('P' + this.clientId.toString())
      } else {
        this.log('Game connected to proxy before relay — deferring P/H until relay starts')
      }

      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 4) {
          const len = buf.readUInt32LE(0)
          if (buf.length < 4 + len) break
          const msg = buf.subarray(4, 4 + len).toString('utf-8')
          buf = buf.subarray(4 + len)
          // CRITICAL: Only forward game data to server when in relay mode.
          // During mod sync, game data would corrupt the server protocol.
          if (this.serverInRelay) {
            this.serverSend(msg)
          }
        }
      })
      socket.on('close', () => { this.gameProxySocket = null })
      socket.on('error', (err) => { this.log(`ERROR: Proxy error: ${err.message}`); this.gameProxySocket = null })
    })
    this.gameProxyServer.listen(proxyPort, '127.0.0.1', () => this.log(`Game proxy listening on port ${proxyPort}`))
    this.gameProxyServer.on('error', (err) => this.log(`ERROR: Game proxy server error: ${err}`))
  }


  // ── HTTP Proxy ──

  private startHttpProxy(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpProxy) {
        resolve()
        return
      }

      this.httpProxy = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleHttpProxyRequest(req, res)
      })

      this.httpProxy.on('error', (err) => {
        this.log(`ERROR: HTTP proxy error: ${err}`)
        reject(err)
      })

      // Bind to any available port
      this.httpProxy.listen(0, '127.0.0.1', () => {
        const addr = this.httpProxy!.address()
        this.httpProxyPort = typeof addr === 'object' && addr ? addr.port : 0
        this.log(`HTTP Proxy listening on port ${this.httpProxyPort}`)
        resolve()
      })
    })
  }

  private handleHttpProxyRequest(req: IncomingMessage, res: ServerResponse): void {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Request-Method', 'POST, OPTIONS, GET')
    res.setHeader('Access-Control-Request-Headers', 'X-API-Version')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const path = req.url || '/'
    const parts = path.split('/').filter(Boolean)
    const host = parts[0] || ''

    if (host === 'backend') {
      const remainingPath = path.substring('/backend'.length)
      this.proxyToBackend(req, res, remainingPath)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Host not found')
    }
  }

  private proxyToBackend(req: IncomingMessage, res: ServerResponse, path: string): void {
    const url = `${this.backendUrl}${path}`
    const headers: Record<string, string> = {
      'User-Agent': `BeamMP-Launcher/${LAUNCHER_VERSION}`
    }

    // Forward auth header
    if (req.headers['x-bmp-authentication'] && this.privateKey) {
      headers['X-BMP-Authentication'] = this.privateKey
    }
    if (req.headers['x-api-version']) {
      headers['X-API-Version'] = req.headers['x-api-version'] as string
    }

    const isPost = req.method === 'POST'
    const bodyChunks: Buffer[] = []

    const doRequest = (): void => {
      const proxyReq = httpsRequest(
        url,
        {
          method: req.method,
          headers,
          timeout: 30000
        },
        (proxyRes) => {
          const responseChunks: Buffer[] = []
          proxyRes.on('data', (chunk) => responseChunks.push(chunk))
          proxyRes.on('end', () => {
            const body = Buffer.concat(responseChunks)
            const contentType = proxyRes.headers['content-type'] || 'application/octet-stream'
            res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': contentType })
            res.end(body)
          })
        }
      )

      proxyReq.on('error', (err) => {
        this.log(`ERROR: HTTP proxy upstream error: ${err.message}`)
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Proxy error: ' + err.message)
      })

      if (isPost && bodyChunks.length > 0) {
        proxyReq.write(Buffer.concat(bodyChunks))
      }
      proxyReq.end()
    }

    if (isPost) {
      req.on('data', (chunk) => bodyChunks.push(chunk))
      req.on('end', doRequest)
    } else {
      doRequest()
    }
  }

  // ── State management ──

  private localReset(): void {
    this.mStatus = ' '
    this.ulStatus = 'Ulstart'
    this.confList.clear()
    this.gameInitialized = false
  }

  private netReset(): void {
    this.serverInRelay = false
    this.clientId = -1
    this.pendingRelayServer = null
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null }
    if (this.udpSocket) { try { this.udpSocket.close() } catch { /* */ } this.udpSocket = null }
    this.udpTarget = null
    this.serverMsgResolve = null
    this.serverRawResolve = null
    this.terminate = false
    this.ulStatus = 'Ulstart'
    this.cachedModList = ''
    this.preSyncActive = false
    this.mStatus = ' '
    this.connectedServerAddress = null

    if (this.serverSocket) {
      this.serverSocket.destroy()
      this.serverSocket = null
    }
    if (this.gameProxySocket) {
      this.gameProxySocket.destroy()
      this.gameProxySocket = null
    }
    if (this.gameProxyServer) {
      this.gameProxyServer.close()
      this.gameProxyServer = null
    }

    // Clean up server mods from mods/multiplayer so stale zips aren't loaded
    // on the next join. Fresh copies are always placed from the hash-verified
    // cache by syncMods(), so this is safe.
    this.cleanupMultiplayerMods()
  }

  /**
   * Remove all non-BeamMP.zip files from mods/multiplayer.
   * Called on disconnect / game exit so the next server join always starts
   * with a clean directory and never loads stale (hash-mismatched) mod zips.
   */
  private cleanupMultiplayerMods(): void {
    if (!this.gameUserDir) return
    const modsDir = join(this.gameUserDir, 'mods', 'multiplayer')
    try {
      for (const file of readdirSync(modsDir)) {
        if (file.toLowerCase() === 'beammp.zip') continue
        if (!file.toLowerCase().endsWith('.zip')) continue
        try {
          unlinkSync(join(modsDir, file))
          this.log(`Cleaned up multiplayer mod: ${file}`)
        } catch { /* ignore removal errors */ }
      }
    } catch { /* directory may not exist yet */ }
  }

  // ── Public API ──

  async launchGame(
    paths: GamePaths,
    options?: { args?: string[] }
  ): Promise<{ success: boolean; error?: string }> {
    if (this.gameProcess && !this.gameProcess.killed) {
      return { success: false, error: 'Game is already running' }
    }

    if (!paths.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }

    if (!paths.userDir) {
      return { success: false, error: 'User data folder not found' }
    }

    this.gameUserDir = paths.userDir

    // Clean up old bridge artifacts and stale signal files
    this.cleanupBridgeArtifacts()

    // Ensure BeamMP.zip exists — download from backend if missing
    const beammpZipPath = join(paths.userDir, 'mods', 'multiplayer', 'BeamMP.zip')
    if (!existsSync(beammpZipPath)) {
      this.log('BeamMP.zip not found — downloading from backend...')
      try {
        const modDir = join(paths.userDir, 'mods', 'multiplayer')
        mkdirSync(modDir, { recursive: true })
        const response = await fetch(`${this.backendUrl}/builds/client`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const buf = Buffer.from(await response.arrayBuffer())
        writeFileSync(beammpZipPath, buf)
        this.log(`BeamMP.zip downloaded successfully (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
      } catch (err) {
        this.log(`WARNING: Failed to download BeamMP.zip: ${err}`)
      }
    }

    // Patch BeamMP.zip in-place to inject bridge extension
    if (existsSync(beammpZipPath)) {
      try {
        const sourceZip = readFileSync(beammpZipPath)
        const patchedZip = this.patchBeamMPZip(sourceZip)
        if (patchedZip.length !== sourceZip.length || !patchedZip.equals(sourceZip)) {
          writeFileSync(beammpZipPath, patchedZip)
        }
      } catch (err) {
        this.log(`WARNING: Failed to patch BeamMP.zip: ${err}`)
      }
    }

    // Start HTTP proxy (random port)
    try {
      await this.startHttpProxy()
    } catch (err) {
      return { success: false, error: `Failed to start HTTP proxy: ${err}` }
    }

    // Start Core TCP server (port 4444)
    try {
      await this.startCoreServer()
    } catch (err) {
      return { success: false, error: `Failed to start Core Network: ${err}` }
    }

    // Auto-authenticate with saved key
    await this.checkLocalKey()

    // Launch the game
    const args = options?.args ?? []
    try {
      if (paths.isProton) {
        // Proton: launch through Steam with the BeamNG app ID
        const steamBin = this.findSteamBinary()
        if (!steamBin) {
          return { success: false, error: 'Steam not found — required to launch BeamNG.drive via Proton' }
        }
        const steamArgs = ['-applaunch', '284160', ...args]
        this.log(`Launching via Steam/Proton: ${steamBin} ${steamArgs.join(' ')}`)
        this.gameProcess = spawn(steamBin, steamArgs, {
          detached: process.platform === 'linux',
          stdio: 'ignore'
        })
      } else {
        this.gameProcess = spawn(paths.executable, args, {
          cwd: paths.installDir ?? undefined,
          detached: process.platform === 'linux',
          stdio: 'ignore'
        })
      }

      this.isProtonLaunch = !!paths.isProton

      this.gameProcess.on('exit', (code) => {
        this.log(`BeamNG.drive exited with code ${code}`)
        this.gameProcess = null

        if (this.isProtonLaunch) {
          // On Steam Deck / Proton, the `steam` CLI exits immediately after
          // sending the launch request to the running Steam daemon.  The actual
          // game hasn't started yet — don't tear down servers.  Start a timeout
          // so we clean up if the game never connects.
          if (!this.coreSocket) {
            this.log('Proton: Steam CLI exited — waiting for game to connect to Core...')
            this.protonShutdownTimer = setTimeout(() => {
              if (!this.coreSocket) {
                this.log('Proton: Timed out waiting for game to connect — shutting down servers')
                this.isProtonLaunch = false
                this.shutdown()
                this.notifyStatusChange()
              }
            }, this.protonConnectTimeout)
          } else {
            // Core socket is still connected — game is running, real exit
            this.log('Proton: Game disconnected normally')
            this.isProtonLaunch = false
            this.shutdown()
            this.notifyStatusChange()
          }
        } else {
          this.shutdown()
          this.notifyStatusChange()
        }
      })

      this.gameProcess.on('error', (err) => {
        this.log(`ERROR: Failed to launch BeamNG.drive: ${err}`)
        this.gameProcess = null
        this.isProtonLaunch = false
        this.shutdown()
        this.notifyStatusChange()
      })

      this.log('Game Launched!')
      this.notifyStatusChange()
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to launch game: ${err}` }
    }
  }

  // ── Singleplayer bridge deployment ──

  private deployVanillaBridge(userDir: string): void {
    // Deploy to <userDir>/lua/ge/extensions/ — BeamNG auto-discovers extensions here
    const bridgeDir = join(userDir, 'lua', 'ge', 'extensions')
    mkdirSync(bridgeDir, { recursive: true })
    writeFileSync(join(bridgeDir, 'beamcmBridge.lua'), VANILLA_BRIDGE_LUA.trim())
    this.log('Vanilla bridge deployed to ' + join(bridgeDir, 'beamcmBridge.lua'))
  }

  private writeVanillaSignal(userDir: string, config: { mode: string; level?: string; vehicle?: string }): void {
    const signalDir = join(userDir, 'settings', 'BeamCM')
    mkdirSync(signalDir, { recursive: true })
    writeFileSync(join(signalDir, 'launch_signal.json'), JSON.stringify({
      mode: config.mode,
      level: config.level || null,
      vehicle: config.vehicle || null,
      processed: false
    }))
    this.log('Vanilla signal: ' + JSON.stringify(config))
  }

  /**
   * Launch BeamNG.drive in vanilla (single-player) mode — no BeamMP proxy/bridge.
   * Deploys a lightweight Lua bridge mod that can auto-load a level and spawn a vehicle.
   */
  async launchVanilla(
    paths: GamePaths,
    config?: { mode?: string; level?: string; vehicle?: string },
    options?: { args?: string[] }
  ): Promise<{ success: boolean; error?: string }> {
    if (this.gameProcess && !this.gameProcess.killed) {
      return { success: false, error: 'Game is already running' }
    }
    if (!paths.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }
    if (!paths.userDir) {
      return { success: false, error: 'User data folder not found' }
    }

    // Remember where the game lives so shutdown() can clean up after exit.
    this.gameUserDir = paths.userDir

    // Deploy the singleplayer bridge mod
    try {
      this.deployVanillaBridge(paths.userDir)
    } catch (err) {
      this.log(`WARNING: Failed to deploy vanilla bridge: ${err}`)
    }

    // If BeamMP.zip is present, re-patch it so the MP bridge (which is what
    // BeamNG actually auto-loads from the mod zip) has the latest signal
    // polling code — including hot-load for GPS, Lua console, and World
    // Editor Sync. Without this, stale zips from an earlier CM version will
    // silently ignore new signal files.
    try {
      const beammpZipPath = join(paths.userDir, 'mods', 'multiplayer', 'BeamMP.zip')
      if (existsSync(beammpZipPath)) {
        const sourceZip = readFileSync(beammpZipPath)
        const patchedZip = this.patchBeamMPZip(sourceZip)
        if (patchedZip.length !== sourceZip.length || !patchedZip.equals(sourceZip)) {
          writeFileSync(beammpZipPath, patchedZip)
          this.log('Re-patched BeamMP.zip on vanilla launch (bridge updated)')
        }
      }
    } catch (err) {
      this.log(`WARNING: Failed to re-patch BeamMP.zip for vanilla launch: ${err}`)
    }

    // Write launch signal so the bridge knows what to load
    if (config?.mode) {
      this.writeVanillaSignal(paths.userDir, {
        mode: config.mode,
        level: config.level ? `${config.level}/info.json` : undefined,
        vehicle: config.vehicle
      })
    }

    // Build command-line args — use -level for direct level loading
    const args: string[] = [...(options?.args ?? [])]
    if (config?.mode === 'freeroam' && config.level) {
      // BeamNG prepends "levels/" internally, so just pass the folder name
      args.push('-level', `${config.level}/info.json`)
    }

    try {
      if (paths.isProton) {
        const steamBin = this.findSteamBinary()
        if (!steamBin) {
          return { success: false, error: 'Steam not found — required to launch BeamNG.drive via Proton' }
        }
        const steamArgs = ['-applaunch', '284160', ...args]
        this.log(`Launching vanilla via Steam/Proton: ${steamBin} ${steamArgs.join(' ')}`)
        this.gameProcess = spawn(steamBin, steamArgs, {
          detached: process.platform === 'linux',
          stdio: 'ignore'
        })
      } else {
        this.gameProcess = spawn(paths.executable, args, {
          cwd: paths.installDir ?? undefined,
          detached: process.platform === 'linux',
          stdio: 'ignore'
        })
      }

      this.gameProcess.on('exit', (code) => {
        this.log(`BeamNG.drive (vanilla) exited with code ${code}`)
        this.gameProcess = null
        this.shutdown()
        this.notifyStatusChange()
      })

      this.gameProcess.on('error', (err) => {
        this.log(`ERROR: Failed to launch BeamNG.drive (vanilla): ${err}`)
        this.gameProcess = null
        this.shutdown()
        this.notifyStatusChange()
      })

      this.log(`Game Launched (vanilla) args=[${args.join(' ')}]`)
      this.notifyStatusChange()
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to launch game: ${err}` }
    }
  }

  /** Public wrapper for findSteamBinary — used by IPC handlers for safe mode launches */
  findSteamBinaryPublic(): string | null {
    return this.findSteamBinary()
  }

  /** Locate the Steam binary on Linux/Mac for Proton launches */
  private findSteamBinary(): string | null {
    // Try `which steam` first
    try {
      const result = execSync('which steam', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      const steamPath = result.trim()
      if (steamPath && existsSync(steamPath)) return steamPath
    } catch { /* not in PATH */ }

    // Common locations on Linux
    const candidates = [
      '/usr/bin/steam',
      '/usr/local/bin/steam',
      '/usr/games/steam',
      join(homedir(), '.local', 'share', 'Steam', 'ubuntu12_32', 'steam'),
      // Flatpak
      '/var/lib/flatpak/exports/bin/com.valvesoftware.Steam',
      join(homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', 'com.valvesoftware.Steam'),
      // Snap
      '/snap/bin/steam'
    ]

    for (const p of candidates) {
      if (existsSync(p)) return p
    }

    return null
  }

  killGame(): void {
    // Cancel any pending Proton shutdown timer
    if (this.protonShutdownTimer) {
      clearTimeout(this.protonShutdownTimer)
      this.protonShutdownTimer = null
    }

    if (this.gameProcess && !this.gameProcess.killed) {
      const pid = this.gameProcess.pid
      // On Windows, use taskkill to kill the entire process tree.
      // process.kill() only kills the spawned process — if BeamNG.drive
      // spawns child processes they would survive and leave the game running.
      if (pid && process.platform === 'win32') {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' })
          this.log(`Killed process tree for PID ${pid}`)
        } catch {
          // Fallback to normal kill if taskkill fails
          this.gameProcess.kill()
        }
      } else if (pid && process.platform === 'linux') {
        // On Linux, kill the entire process group so Proton/Wine child
        // processes (the actual game) are also terminated.
        try {
          process.kill(-pid, 'SIGKILL')
          this.log(`Killed process group for PID ${pid}`)
        } catch {
          // Fallback: try normal kill if process group kill fails
          // (e.g. process is not a group leader)
          try { this.gameProcess.kill('SIGKILL') } catch { /* already dead */ }
        }
      } else {
        this.gameProcess.kill()
      }
      this.gameProcess = null
      this.kickPending = false
      this.isProtonLaunch = false
      this.shutdown()
      this.notifyStatusChange()
    } else if (this.isProtonLaunch && process.platform === 'linux') {
      // Steam CLI already exited but game may be running under Proton.
      // Try to find and kill the actual BeamNG process.
      this.log('Proton: Steam CLI already exited — looking for BeamNG.drive process...')
      try {
        execSync('pkill -f "BeamNG.drive.x64"', { stdio: 'ignore' })
        this.log('Proton: Killed BeamNG.drive process via pkill')
      } catch {
        // Process may not exist or pkill failed — not critical
        this.log('Proton: pkill did not find a BeamNG.drive process')
      }
      this.gameProcess = null
      this.kickPending = false
      this.isProtonLaunch = false
      this.shutdown()
      this.notifyStatusChange()
    }
  }

  joinServer(ip: string, port: number, paths: GamePaths, options?: { args?: string[] }): Promise<{ success: boolean; error?: string }> {
    return this.joinServerImpl(ip, port, paths, options)
  }

  private async joinServerImpl(ip: string, port: number, paths: GamePaths, options?: { args?: string[] }): Promise<{ success: boolean; error?: string }> {
    // Auto-login as guest if not authenticated
    if (!this.loginAuth) {
      await this.loginAsGuest()
    }

    // Disconnect from current server if needed
    if (this.serverSocket && !this.serverSocket.destroyed) {
      this.netReset()
      this.terminate = true
    }

    // Launch game if not running
    if (!this.gameProcess || this.gameProcess.killed) {
      this.gameInitialized = false
      const result = await this.launchGame(paths, options)
      if (!result.success) {
        return result
      }
    }

    // Wait for game mod to be ready (Nc auth handshake) if not already
    if (!this.gameInitialized || !this.coreSocket || this.coreSocket.destroyed) {
      try {
        await this.waitForGameReady()
      } catch {
        return { success: false, error: 'Game did not initialize in time' }
      }
    }

    // Set up server connection state
    this.log(`Pre-syncing server ${ip}:${port} before game connect`)
    this.preSyncActive = true
    await this.checkLocalKey()
    this.ulStatus = 'UlLoading...'
    this.terminate = false
    this.terminateReason = ''
    this.confList.clear()
    this.ping = -1
    this.clientId = -1
    this.serverInRelay = false
    this.connectedServerAddress = `${ip}:${port}`
    this.notifyStatusChange()
    this.startGameProxyServer()

    // Connect to server — do the handshake + mod sync BEFORE telling
    // the game to connect.  This way, if the server rejects us (full,
    // banned, version mismatch, etc.) we never send the join signal
    // and can kill the game cleanly instead of it landing on the menu.
    this.connectToServer(ip, port)

    // Wait for handshake + mod sync to complete (relay mode entered)
    try {
      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (this.serverInRelay) { clearInterval(check); resolve() }
          else if (this.terminate) { clearInterval(check); reject(new Error(this.terminateReason || 'Server sync failed')) }
        }, 100)
        setTimeout(() => { clearInterval(check); reject(new Error('Server connection timed out after 30 minutes')) }, 1800000)
      })
    } catch (err) {
      const errorMsg = (err as Error).message
      this.log(`Server join failed, killing game: ${errorMsg}`)
      this.preSyncActive = false
      this.killGame()
      return { success: false, error: errorMsg }
    }

    // Handshake succeeded — NOW tell the game to connect
    this.writeJoinSignal(ip, port)
    this.log('Server sync complete and relay active — join signal sent to game')
    return { success: true }
  }

  private writeJoinSignal(ip: string, port: number): void {
    const signalDir = join(this.gameUserDir, 'settings', 'BeamMP')
    if (!existsSync(signalDir)) mkdirSync(signalDir, { recursive: true })
    const signalPath = join(signalDir, 'cm_join.json')
    writeFileSync(signalPath, JSON.stringify({ ip, port }))
    this.log(`Join signal written: ${signalPath}`)
  }

  private cleanupBridgeArtifacts(): void {
    // Clean up old files from previous approaches
    const oldLoose = join(this.gameUserDir, 'lua', 'ge', 'extensions', 'beammpCMBridge.lua')
    if (existsSync(oldLoose)) {
      try { unlinkSync(oldLoose) } catch { /* ignore */ }
    }
    const oldZipRoot = join(this.gameUserDir, 'mods', 'beammpCMBridge.zip')
    if (existsSync(oldZipRoot)) {
      try { unlinkSync(oldZipRoot) } catch { /* ignore */ }
    }
    const oldZipRepo = join(this.gameUserDir, 'mods', 'repo', 'beammpCMBridge.zip')
    if (existsSync(oldZipRepo)) {
      try { unlinkSync(oldZipRepo) } catch { /* ignore */ }
    }
    const oldZipMp = join(this.gameUserDir, 'mods', 'multiplayer', 'beammpCMBridge.zip')
    if (existsSync(oldZipMp)) {
      try { unlinkSync(oldZipMp) } catch { /* ignore */ }
    }

    // Clean up stale signal file from previous run
    const staleSignal = join(this.gameUserDir, 'settings', 'BeamMP', 'cm_join.json')
    if (existsSync(staleSignal)) {
      try { unlinkSync(staleSignal) } catch { /* ignore */ }
    }
  }

  private patchBeamMPZip(source: Buffer): Buffer {
    // Find EOCD (End of Central Directory)
    let eocdOff = -1
    for (let i = source.length - 22; i >= Math.max(0, source.length - 65557); i--) {
      if (source.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break }
    }
    if (eocdOff < 0) throw new Error('Invalid ZIP: EOCD not found')

    const numEntries = source.readUInt16LE(eocdOff + 10)
    const cdOffset = source.readUInt32LE(eocdOff + 16)

    // Parse central directory entries
    const entries: Array<{
      cdPos: number; cdLen: number; localOff: number; name: string
      compression: number; compSize: number; uncompSize: number; fileCrc: number
    }> = []
    let pos = cdOffset
    for (let i = 0; i < numEntries; i++) {
      if (source.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid CD entry')
      const nameLen = source.readUInt16LE(pos + 28)
      const extraLen = source.readUInt16LE(pos + 30)
      const commentLen = source.readUInt16LE(pos + 32)
      const cdLen = 46 + nameLen + extraLen + commentLen
      entries.push({
        cdPos: pos, cdLen,
        localOff: source.readUInt32LE(pos + 42),
        name: source.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8'),
        compression: source.readUInt16LE(pos + 10),
        compSize: source.readUInt32LE(pos + 20),
        uncompSize: source.readUInt32LE(pos + 24),
        fileCrc: source.readUInt32LE(pos + 16)
      })
      pos += cdLen
    }

    // Check if bridge already present and current
    let bridgeAlreadyCurrent = false
    const bridgeEntry = entries.find(e => e.name === 'lua/ge/extensions/beammpCMBridge.lua')
    if (bridgeEntry) {
      const bridgeBuf = Buffer.from(BRIDGE_LUA, 'utf-8')
      const expectedCrc = crc32(bridgeBuf)
      if (bridgeEntry.fileCrc === expectedCrc) {
        bridgeAlreadyCurrent = true
      } else {
        this.log('BeamMP.zip contains outdated bridge, re-patching')
        // Remove old bridge entry so it gets replaced
        const idx = entries.indexOf(bridgeEntry)
        entries.splice(idx, 1)
      }
    }

    // Check if MPModManager.lua already has nil guard
    const modManagerEntry = entries.find(e => e.name === 'lua/ge/extensions/MPModManager.lua')
    let modManagerAlreadyPatched = false
    if (modManagerEntry) {
      const mmLocalNameLen = source.readUInt16LE(modManagerEntry.localOff + 26)
      const mmLocalExtraLen = source.readUInt16LE(modManagerEntry.localOff + 28)
      const mmStart = modManagerEntry.localOff + 30 + mmLocalNameLen + mmLocalExtraLen
      const mmComp = source.subarray(mmStart, mmStart + modManagerEntry.compSize)
      let mmRaw: Buffer
      if (modManagerEntry.compression === 8) {
        mmRaw = zlib.inflateRawSync(mmComp)
      } else {
        mmRaw = Buffer.from(mmComp)
      }
      modManagerAlreadyPatched = mmRaw.toString('utf-8').includes('if not modName then return false end')
    }

    // Skip rebuild entirely if everything is already patched
    if (bridgeAlreadyCurrent && modManagerAlreadyPatched) {
      this.log('BeamMP.zip already fully patched, skipping')
      return source
    }

    // Build output local file entries
    const locals: Buffer[] = []
    const offsets: number[] = []
    const modScriptIdx = entries.findIndex(e => e.name === 'scripts/BeamMP/modScript.lua')
    let outOff = 0

    // Track modified entries for CD rebuild
    const modified = new Map<number, { content: Buffer; newCrc: number }>()

    // Patch modScript.lua to load our bridge extension
    if (modScriptIdx >= 0) {
      const ms = entries[modScriptIdx]
      const localNameLen = source.readUInt16LE(ms.localOff + 26)
      const localExtraLen = source.readUInt16LE(ms.localOff + 28)
      const dataStart = ms.localOff + 30 + localNameLen + localExtraLen
      const compData = source.subarray(dataStart, dataStart + ms.compSize)

      let content: Buffer
      if (ms.compression === 8) {
        content = zlib.inflateRawSync(compData)
      } else {
        content = Buffer.from(compData)
      }

      const patch = '\nload("beammpCMBridge")\nsetExtensionUnloadMode("beammpCMBridge", "manual")\n'
      // Only append the patch if modScript doesn't already load the bridge
      if (!content.toString('utf-8').includes('load("beammpCMBridge")')) {
        const patched = Buffer.concat([content, Buffer.from(patch, 'utf-8')])
        modified.set(modScriptIdx, { content: patched, newCrc: crc32(patched) })
      }
    }

    // Patch MPModManager.lua to add nil guards (prevents crash when mods in db.json lack modname)
    const modManagerIdx = entries.findIndex(e => e.name === 'lua/ge/extensions/MPModManager.lua')
    if (modManagerIdx >= 0) {
      const mm = entries[modManagerIdx]
      const mmNameLen = source.readUInt16LE(mm.localOff + 26)
      const mmExtraLen = source.readUInt16LE(mm.localOff + 28)
      const mmDataStart = mm.localOff + 30 + mmNameLen + mmExtraLen
      const mmCompData = source.subarray(mmDataStart, mmDataStart + mm.compSize)

      let mmContent: Buffer
      if (mm.compression === 8) {
        mmContent = zlib.inflateRawSync(mmCompData)
      } else {
        mmContent = Buffer.from(mmCompData)
      }

      let luaStr = mmContent.toString('utf-8')
      let mmPatched = false

      // Guard isModAllowed against nil modName
      const isModAllowedSig = 'local function isModAllowed(modName)\n\tfor'
      if (luaStr.includes(isModAllowedSig) && !luaStr.includes('if not modName then return false end')) {
        luaStr = luaStr.replace(
          isModAllowedSig,
          'local function isModAllowed(modName)\n\tif not modName then return false end\n\tfor'
        )
        mmPatched = true
      }

      // Guard isModWhitelisted against nil modName
      const isWhitelistedSig = 'local function isModWhitelisted(modName)\n\tfor'
      if (luaStr.includes(isWhitelistedSig) && !luaStr.includes('if not modName then return true end')) {
        luaStr = luaStr.replace(
          isWhitelistedSig,
          'local function isModWhitelisted(modName)\n\tif not modName then return true end\n\tfor'
        )
        mmPatched = true
      }

      // Guard checkMod against nil mod.modname
      const checkModSig = 'local function checkMod(mod)'
      if (luaStr.includes(checkModSig) && !luaStr.includes('if not mod.modname then return end')) {
        luaStr = luaStr.replace(
          checkModSig,
          'local function checkMod(mod)\n\tif not mod.modname then return end'
        )
        mmPatched = true
      }

      if (mmPatched) {
        const patchedBuf = Buffer.from(luaStr, 'utf-8')
        modified.set(modManagerIdx, { content: patchedBuf, newCrc: crc32(patchedBuf) })
        this.log('Patched MPModManager.lua with nil modName guards')
      }
    }

    // Write local file entries
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      offsets.push(outOff)

      const mod = modified.get(i)
      if (mod) {
        // Rebuilt entry using STORE compression
        const nameBytes = Buffer.from(e.name, 'utf-8')
        const hdr = Buffer.alloc(30 + nameBytes.length)
        hdr.writeUInt32LE(0x04034b50, 0)
        hdr.writeUInt16LE(20, 4)
        hdr.writeUInt16LE(0, 8)  // STORE
        hdr.writeUInt32LE(mod.newCrc, 14)
        hdr.writeUInt32LE(mod.content.length, 18)
        hdr.writeUInt32LE(mod.content.length, 22)
        hdr.writeUInt16LE(nameBytes.length, 26)
        nameBytes.copy(hdr, 30)
        locals.push(Buffer.concat([hdr, mod.content]))
        outOff += hdr.length + mod.content.length
      } else {
        // Copy original local file header + data as-is
        const localNameLen = source.readUInt16LE(e.localOff + 26)
        const localExtraLen = source.readUInt16LE(e.localOff + 28)
        const totalSize = 30 + localNameLen + localExtraLen + e.compSize
        locals.push(Buffer.from(source.subarray(e.localOff, e.localOff + totalSize)))
        outOff += totalSize
      }
    }

    // Append bridge extension file (only if not already present and current)
    const bridgeContent = Buffer.from(BRIDGE_LUA, 'utf-8')
    const bridgePath = 'lua/ge/extensions/beammpCMBridge.lua'
    const bridgeNameBytes = Buffer.from(bridgePath, 'utf-8')
    const bridgeCrc = crc32(bridgeContent)
    let bridgeOffset = 0
    if (!bridgeAlreadyCurrent) {
      const bridgeHdr = Buffer.alloc(30 + bridgeNameBytes.length)
      bridgeHdr.writeUInt32LE(0x04034b50, 0)
      bridgeHdr.writeUInt16LE(20, 4)
      bridgeHdr.writeUInt32LE(bridgeCrc, 14)
      bridgeHdr.writeUInt32LE(bridgeContent.length, 18)
      bridgeHdr.writeUInt32LE(bridgeContent.length, 22)
      bridgeHdr.writeUInt16LE(bridgeNameBytes.length, 26)
      bridgeNameBytes.copy(bridgeHdr, 30)
      bridgeOffset = outOff
      locals.push(Buffer.concat([bridgeHdr, bridgeContent]))
      outOff += bridgeHdr.length + bridgeContent.length
    }

    // Rebuild central directory
    const cdStart = outOff
    const cdParts: Buffer[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const mod = modified.get(i)
      if (mod) {
        // New CD entry for modified file
        const nameBytes = Buffer.from(e.name, 'utf-8')
        const cd = Buffer.alloc(46 + nameBytes.length)
        cd.writeUInt32LE(0x02014b50, 0)
        cd.writeUInt16LE(20, 4)
        cd.writeUInt16LE(20, 6)
        cd.writeUInt32LE(mod.newCrc, 16)
        cd.writeUInt32LE(mod.content.length, 20)
        cd.writeUInt32LE(mod.content.length, 24)
        cd.writeUInt16LE(nameBytes.length, 28)
        cd.writeUInt32LE(offsets[i], 42)
        nameBytes.copy(cd, 46)
        cdParts.push(cd)
      } else {
        // Copy original CD entry with updated offset
        const cdBuf = Buffer.from(source.subarray(e.cdPos, e.cdPos + e.cdLen))
        cdBuf.writeUInt32LE(offsets[i], 42)
        cdParts.push(cdBuf)
      }
    }

    // CD entry for bridge (only if newly added)
    if (!bridgeAlreadyCurrent) {
      const bridgeCD = Buffer.alloc(46 + bridgeNameBytes.length)
      bridgeCD.writeUInt32LE(0x02014b50, 0)
      bridgeCD.writeUInt16LE(20, 4)
      bridgeCD.writeUInt16LE(20, 6)
      bridgeCD.writeUInt32LE(bridgeCrc, 16)
      bridgeCD.writeUInt32LE(bridgeContent.length, 20)
      bridgeCD.writeUInt32LE(bridgeContent.length, 24)
      bridgeCD.writeUInt16LE(bridgeNameBytes.length, 28)
      bridgeCD.writeUInt32LE(bridgeOffset, 42)
      bridgeNameBytes.copy(bridgeCD, 46)
      cdParts.push(bridgeCD)
    }

    const cdSize = cdParts.reduce((s, b) => s + b.length, 0)
    const totalEntries = entries.length + (bridgeAlreadyCurrent ? 0 : 1)

    // EOCD
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(totalEntries, 8)
    eocd.writeUInt16LE(totalEntries, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)

    this.log(`Patched BeamMP.zip: injected bridge extension (${totalEntries} entries)`)
    return Buffer.concat([...locals, ...cdParts, eocd])
  }

  private waitForGameReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.gameInitialized && this.coreSocket && !this.coreSocket.destroyed) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        this.gameReadyResolve = null
        reject(new Error('Timeout waiting for game mod init'))
      }, 120000)
      this.gameReadyResolve = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
  }

  async loginAsGuest(): Promise<void> {
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Guest: 'Name' })
      })
      const body = await resp.text()
      if (body && body[0] === '{') {
        const d = JSON.parse(body)
        if (d.success) {
          this.loginAuth = true
          if (d.username) this.username = d.username
          if (d.role) this.userRole = d.role
          if (d.id !== undefined) this.userId = d.id
          if (d.public_key) this.publicKey = d.public_key
          if (d.private_key) this.saveKey(d.private_key)
          this.log(`Logged in as ${this.username}`)
          return
        }
      }
    } catch (err) {
      this.log(`ERROR: Guest auth failed: ${err}`)
    }
    // Fallback if auth fails
    this.loginAuth = true
    this.username = 'Guest'
    this.userRole = ''
    this.userId = -1
    this.publicKey = ''
    this.log('Guest auth fallback (no server assigned name)')
  }

  async loginToBeamMP(username: string, password: string): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const body = await resp.text()
      if (!body || body[0] !== '{') {
        return { success: false, error: 'Invalid auth response' }
      }
      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        this.log(`Logged in as ${d.username}`)
        return { success: true, username: d.username }
      }
      return { success: false, error: d.message || 'Authentication failed' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  getAuthInfo(): { authenticated: boolean; username: string; guest: boolean } {
    return {
      authenticated: this.loginAuth,
      username: this.username,
      guest: this.loginAuth && !this.publicKey
    }
  }

  logoutBeamMP(): void {
    this.loginAuth = false
    this.username = ''
    this.userRole = ''
    this.userId = -1
    this.publicKey = ''
    this.privateKey = ''
    this.saveKey(null)
    this.log('Logged out')
  }

  setCorePort(port: number): void {
    this.corePort = port
  }

  // ── GPS Tracker ──

  deployGPSTracker(userDir: string): { success: boolean; error?: string } {
    try {
      const extDir = join(userDir, 'lua', 'ge', 'extensions')
      mkdirSync(extDir, { recursive: true })
      writeFileSync(join(extDir, 'beamcmGPS.lua'), GPS_TRACKER_GE_LUA.trim())
      // Write signal so the running bridge can hot-load it mid-game
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(join(signalDir, 'gps_signal.json'), JSON.stringify({ action: 'load', processed: false }))
      // Clear stale telemetry from previous session so the UI doesn't show old data
      const staleTelemetry = join(signalDir, 'gps_telemetry.json')
      if (existsSync(staleTelemetry)) unlinkSync(staleTelemetry)
      this.latestGpsTelemetry = null
      this.gpsTrackerDeployed = true
      this.log('GPS tracker deployed to ' + join(extDir, 'beamcmGPS.lua'))
      this.startGpsFilePoller(userDir)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy GPS tracker: ${err}` }
    }
  }

  undeployGPSTracker(userDir: string): { success: boolean; error?: string } {
    try {
      // Write unload signal so the running bridge can hot-unload it mid-game
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(join(signalDir, 'gps_signal.json'), JSON.stringify({ action: 'unload', processed: false }))
      const extPath = join(userDir, 'lua', 'ge', 'extensions', 'beamcmGPS.lua')
      if (existsSync(extPath)) unlinkSync(extPath)
      // Clean up telemetry file
      const telemetryPath = join(userDir, 'settings', 'BeamCM', 'gps_telemetry.json')
      if (existsSync(telemetryPath)) unlinkSync(telemetryPath)
      this.gpsTrackerDeployed = false
      this.latestGpsTelemetry = null
      this.stopGpsFilePoller()
      this.log('GPS tracker undeployed')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to undeploy GPS tracker: ${err}` }
    }
  }

  isGPSTrackerDeployed(): boolean {
    return this.gpsTrackerDeployed
  }

  getGPSTelemetry(): import('../../shared/types').GPSTelemetry | null {
    return this.latestGpsTelemetry
  }

  // ── World Editor Sync (Phase 0 spike) ──
  //
  // Deploys the capture-only beamcmEditorSync.lua extension and exposes
  // capture/replay control via signal files. No networking yet.

  deployEditorSync(userDir: string): { success: boolean; error?: string } {
    try {
      const extDir = join(userDir, 'lua', 'ge', 'extensions')
      mkdirSync(extDir, { recursive: true })
      writeFileSync(join(extDir, 'beamcmEditorSync.lua'), EDITOR_SYNC_GE_LUA.trim())
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      // Hot-load: tell the running bridge to load the extension
      writeFileSync(
        join(signalDir, 'editorsync_signal.json'),
        JSON.stringify({ action: 'load', processed: false })
      )
      // Clear stale capture log + status from any previous spike run
      const stale = ['we_capture.log', 'we_capture_status.json', 'we_capture_signal.json']
      for (const name of stale) {
        const p = join(signalDir, name)
        if (existsSync(p)) {
          try { unlinkSync(p) } catch { /* ignore */ }
        }
      }
      this.latestEditorSyncStatus = null
      this.editorSyncDeployed = true
      this.startEditorSyncStatusPoller(userDir)
      // Bring up the Phase 1+ TCP loopback bridge (writes we_port.txt).
      // Failure here is non-fatal — the file-IPC capture log still works.
      void this.startEditorBridge(signalDir)
      this.log('World Editor Sync extension deployed to ' + join(extDir, 'beamcmEditorSync.lua'))
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy World Editor Sync: ${err}` }
    }
  }

  undeployEditorSync(userDir: string): { success: boolean; error?: string } {
    try {
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(
        join(signalDir, 'editorsync_signal.json'),
        JSON.stringify({ action: 'unload', processed: false })
      )
      const extPath = join(userDir, 'lua', 'ge', 'extensions', 'beamcmEditorSync.lua')
      if (existsSync(extPath)) unlinkSync(extPath)
      // Leave we_capture.log on disk so it can be inspected after the spike;
      // status file goes since it's stale once the extension is gone.
      const statusPath = join(signalDir, 'we_capture_status.json')
      if (existsSync(statusPath)) {
        try { unlinkSync(statusPath) } catch { /* ignore */ }
      }
      this.editorSyncDeployed = false
      this.latestEditorSyncStatus = null
      this.stopEditorSyncStatusPoller()
      this.stopEditorBridge()
      this.log('World Editor Sync extension undeployed')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to undeploy World Editor Sync: ${err}` }
    }
  }

  isEditorSyncDeployed(): boolean {
    return this.editorSyncDeployed
  }

  /**
   * Send a one-shot control signal to the deployed extension.
   * Action is one of: "start", "stop", "replay", "install", "uninstall",
   * "undo", "redo", "save", "saveAs".
   * For "saveAs", `payload.path` must be the level path (e.g. "/levels/mymap/").
   */
  editorSyncSignal(
    userDir: string,
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
  ): { success: boolean; error?: string } {
    try {
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      const body: Record<string, unknown> = { action, processed: false }
      if (payload?.path) body.path = payload.path
      writeFileSync(
        join(signalDir, 'we_capture_signal.json'),
        JSON.stringify(body)
      )
      this.log(`World Editor Sync signal sent: ${action}${payload?.path ? ` path=${payload.path}` : ''}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to send editor-sync signal: ${err}` }
    }
  }

  // ── Editor Sync TCP Bridge (Phase 1+) ──
  //
  // Loopback TCP listener. The Lua extension reads `we_port.txt` and connects
  // back; ops then flow over the socket instead of the file polling loop. The
  // file path is still maintained as a fallback / capture log for the UI.

  private async startEditorBridge(signalDir: string): Promise<void> {
    if (this.editorBridge) return
    const bridge = new EditorSyncBridgeSocket()
    bridge.on('hello', (info: LuaHello) => {
      this.editorBridgeReady = true
      this.log(`[EditorBridge] Lua handshake: editor=${info.editorActive ?? '?'} level=${info.levelName ?? '?'} build=${info.beamngBuild ?? '?'}`)
      // Greet back. Phase 1 has no real session yet — Phase 2+ will fill this
      // in with sessionId/peerId/role/seq cursor.
      bridge.greet({ phase: 1, cmTs: Date.now() })
    })
    bridge.on('disconnect', () => {
      this.editorBridgeReady = false
      this.log('[EditorBridge] Lua disconnected')
    })
    bridge.on('luaError', (msg) => {
      console.warn('[EditorBridge] Lua error:', msg)
    })
    bridge.on('op', (env: LuaOpEnvelope) => {
      const seq = ++this.editorOpSeq
      // Phase 1 ack semantics: optimistic ack from the (single) host. Phase 2
      // will route through the relay and only ack after the seq is committed.
      bridge.ack(env.clientOpId, seq, 'ok')
      try {
        this.onLuaOp?.(seq, env)
      } catch (err) {
        console.error('[EditorBridge] onLuaOp listener threw:', err)
      }
    })
    bridge.on('pose', (pose: LuaPose) => {
      try {
        this.onLuaPose?.(pose)
      } catch (err) {
        console.error('[EditorBridge] onLuaPose listener threw:', err)
      }
    })
    try {
      const port = await bridge.start(signalDir)
      this.editorBridge = bridge
      this.log(`[EditorBridge] listening on 127.0.0.1:${port} (port file: ${join(signalDir, 'we_port.txt')})`)
    } catch (err) {
      this.log(`[EditorBridge] start failed: ${err}`)
    }
  }

  private stopEditorBridge(): void {
    if (this.editorBridge) {
      try { this.editorBridge.stop() } catch { /* ignore */ }
      this.editorBridge = null
    }
    this.editorBridgeReady = false
    this.editorOpSeq = 0
  }

  /** Phase 2 hook: relay registers here to receive every op the Lua sends. */
  setEditorOpListener(cb: ((seq: number, env: LuaOpEnvelope) => void) | null): void {
    this.onLuaOp = cb
  }

  /** Presence hook: controller registers here to receive pose ticks from Lua. */
  setEditorPoseListener(cb: ((pose: LuaPose) => void) | null): void {
    this.onLuaPose = cb
  }

  /** Push a remote op down to Lua for application. No-op if bridge not connected. */
  sendEditorRemoteOp(env: unknown): boolean {
    if (!this.editorBridge) return false
    this.editorBridge.sendRemoteOp(env)
    return true
  }

  /**
   * Push a peer's pose down to Lua so it can draw a ghost marker (sphere +
   * name label) at that position. Best-effort — silently no-ops if the bridge
   * isn't up yet (BeamNG not running, or editor extension not loaded).
   */
  sendEditorRemotePose(pose: unknown): boolean {
    if (!this.editorBridge) return false
    this.editorBridge.sendRemotePose(pose)
    return true
  }

  /**
   * Write a one-shot signal that tells the deployed editor-sync Lua extension
   * to open the World Editor automatically once `onClientStartMission` fires.
   * Used by the "Launch BeamNG into editor" button on the session page.
   *
   * Accepts an explicit userDir so it can be written *before* launch (when
   * `gameUserDir` may not yet be set), and falls back to the post-launch
   * value otherwise.
   */
  writeEditorAutostartSignal(userDirOverride?: string): void {
    const userDir = userDirOverride ?? this.gameUserDir
    if (!userDir) return
    try {
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(
        join(signalDir, 'editor_autostart.json'),
        JSON.stringify({ open: true, processed: false })
      )
      this.log('Editor autostart signal written')
    } catch (err) {
      this.log(`WARNING: failed to write editor_autostart signal: ${err}`)
    }
  }

  isEditorBridgeReady(): boolean {
    return this.editorBridgeReady
  }

  // ── Editor projects ──
  //
  // A "project" is a full snapshot of a level with user edits applied, saved
  // to <userDir>/levels/_beamcm_projects/<levelName>__<projectName>/. Under
  // the hood it uses editor.saveLevelAs + editor.openLevel, so loading is a
  // full mission reload (you come back into the editor with the saved state).

  private readonly PROJECTS_DIR_NAME = '_beamcm_projects'
  private readonly PROJECT_NAME_RE = /^[A-Za-z0-9._-]{1,48}$/

  private sanitiseLevelName(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]/g, '_')
  }

  private projectFolderName(levelName: string, projectName: string): string {
    return `${this.sanitiseLevelName(levelName)}__${projectName}`
  }

  /**
   * Save the current editor state as a CM-managed project. Scaffolds a
   * minimal info.json so BeamNG will recognise it as a level.
   * Requires the editor to be active (call after hooks installed).
   */
  saveEditorProject(
    userDir: string,
    levelName: string,
    projectName: string
  ): { success: boolean; error?: string; levelPath?: string } {
    if (!this.PROJECT_NAME_RE.test(projectName)) {
      return {
        success: false,
        error: 'Invalid project name. Use letters, digits, dot, dash, underscore (max 48 chars).',
      }
    }
    if (!levelName || levelName === '') {
      return { success: false, error: 'No level currently loaded' }
    }
    try {
      const folder = this.projectFolderName(levelName, projectName)
      const absDir = join(userDir, 'levels', this.PROJECTS_DIR_NAME, folder)
      mkdirSync(absDir, { recursive: true })
      // BeamNG path form (forward slashes, leading slash, trailing slash)
      const levelPath = `/levels/${this.PROJECTS_DIR_NAME}/${folder}/`

      // Drop a minimal info.json so BeamNG's level loader recognises the
      // project as a level. editor.saveLevelAs writes MissionGroup into
      // main/, but not the level-level metadata.
      const infoPath = join(absDir, 'info.json')
      if (!existsSync(infoPath)) {
        const info = {
          title: `${projectName} (CM project: ${levelName})`,
          description: `CM editor project saved from ${levelName}.`,
          authors: 'BeamMP Content Manager',
          roads: 'Unknown',
          size: [1024, 1024],
          country: 'UN',
          biome: 'Unknown',
          previews: [],
          levelName,
          cmProject: true,
          cmProjectName: projectName,
          cmSourceLevel: levelName,
          cmCreatedAt: Date.now(),
        }
        writeFileSync(infoPath, JSON.stringify(info, null, 2))
      }

      // Fire Lua signal to do the actual editor.saveLevelAs
      const sig = this.editorSyncSignal(userDir, 'saveProject', { path: levelPath })
      if (!sig.success) return { success: false, error: sig.error }
      return { success: true, levelPath }
    } catch (err) {
      return { success: false, error: `Failed to save project: ${err}` }
    }
  }

  /** Signal Lua to open a project as the active level (full mission reload). */
  loadEditorProject(
    userDir: string,
    projectLevelPath: string
  ): { success: boolean; error?: string } {
    if (!projectLevelPath.startsWith(`/levels/${this.PROJECTS_DIR_NAME}/`)) {
      return { success: false, error: 'Path is not inside the projects directory' }
    }
    return this.editorSyncSignal(userDir, 'loadProject', { path: projectLevelPath })
  }

  /** Enumerate all saved editor projects under <userDir>/levels/_beamcm_projects/. */
  listEditorProjects(userDir: string): import('../../shared/types').EditorProject[] {
    const base = join(userDir, 'levels', this.PROJECTS_DIR_NAME)
    if (!existsSync(base)) return []
    const out: import('../../shared/types').EditorProject[] = []
    let entries: string[] = []
    try { entries = readdirSync(base) } catch { return [] }
    for (const folder of entries) {
      const abs = join(base, folder)
      let stat: ReturnType<typeof statSync>
      try { stat = statSync(abs) } catch { continue }
      if (!stat.isDirectory()) continue

      // Parse "<levelName>__<projectName>" (levelName is sanitised so __ is a clean separator)
      const sep = folder.indexOf('__')
      if (sep <= 0) continue
      const levelName = folder.slice(0, sep)
      const projectName = folder.slice(sep + 2)

      let sizeBytes = 0
      try {
        for (const f of this.walkFiles(abs, 3)) sizeBytes += f.size
      } catch { /* ignore */ }

      out.push({
        name: projectName,
        levelName,
        path: abs,
        levelPath: `/levels/${this.PROJECTS_DIR_NAME}/${folder}/`,
        mtime: stat.mtimeMs,
        sizeBytes,
      })
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out
  }

  /**
   * Walk a directory up to `maxDepth`, yielding {size} for each file.
   * Used only for project size totals — bounded depth keeps it cheap.
   */
  private *walkFiles(dir: string, maxDepth: number): Generator<{ size: number }> {
    if (maxDepth < 0) return
    let entries: string[] = []
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const p = join(dir, name)
      let s: ReturnType<typeof statSync>
      try { s = statSync(p) } catch { continue }
      if (s.isDirectory()) {
        yield* this.walkFiles(p, maxDepth - 1)
      } else if (s.isFile()) {
        yield { size: s.size }
      }
    }
  }

  /** Delete a project folder. Guards against paths outside the projects root. */
  deleteEditorProject(
    userDir: string,
    projectPath: string
  ): { success: boolean; error?: string } {
    const base = join(userDir, 'levels', this.PROJECTS_DIR_NAME)
    const norm = projectPath.replace(/\\/g, '/')
    const baseNorm = base.replace(/\\/g, '/')
    if (!norm.startsWith(baseNorm + '/') || norm === baseNorm) {
      return { success: false, error: 'Refusing to delete path outside projects directory' }
    }
    try {
      rmSync(projectPath, { recursive: true, force: true })
      this.log(`Deleted editor project: ${projectPath}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to delete project: ${err}` }
    }
  }

  getEditorSyncStatus(): import('../../shared/types').EditorSyncStatus | null {
    return this.latestEditorSyncStatus
  }

  /**
   * Read the most recent N captured entries from we_capture.log.
   * Returns the last `tail` parsed entries (chronological order). Used by the
   * World Editor Sync UI to show a live capture preview.
   */
  readEditorSyncCapture(
    userDir: string,
    tail: number = 100
  ): { entries: import('../../shared/types').EditorSyncCaptureEntry[]; total: number } {
    const logPath = join(userDir, 'settings', 'BeamCM', 'we_capture.log')
    if (!existsSync(logPath)) return { entries: [], total: 0 }
    try {
      const raw = readFileSync(logPath, 'utf-8')
      const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
      const slice = tail > 0 ? lines.slice(-tail) : lines
      const entries: import('../../shared/types').EditorSyncCaptureEntry[] = []
      for (const line of slice) {
        try {
          entries.push(JSON.parse(line))
        } catch {
          // skip malformed line
        }
      }
      return { entries, total: lines.length }
    } catch {
      return { entries: [], total: 0 }
    }
  }

  private startEditorSyncStatusPoller(userDir: string): void {
    if (this.editorSyncStatusPoller) return
    const statusPath = join(userDir, 'settings', 'BeamCM', 'we_capture_status.json')
    this.editorSyncStatusPoller = setInterval(() => {
      try {
        if (!existsSync(statusPath)) {
          if (this.latestEditorSyncStatus) this.latestEditorSyncStatus = null
          return
        }
        const raw = readFileSync(statusPath, 'utf-8')
        const parsed = JSON.parse(raw) as import('../../shared/types').EditorSyncStatus
        this.latestEditorSyncStatus = parsed
      } catch {
        // Swallow — partial writes from Lua are expected occasionally.
      }
    }, 500)
  }

  private stopEditorSyncStatusPoller(): void {
    if (this.editorSyncStatusPoller) {
      clearInterval(this.editorSyncStatusPoller)
      this.editorSyncStatusPoller = null
    }
  }

  private startGpsFilePoller(userDir: string): void {
    if (this.gpsFilePoller) return
    const telemetryPath = join(userDir, 'settings', 'BeamCM', 'gps_telemetry.json')
    let lastT = 0
    let lastUpdateTime = Date.now()
    const STALE_TIMEOUT = 3000 // 3 seconds with no new data → game is loading/transitioning
    this.gpsFilePoller = setInterval(() => {
      try {
        if (!existsSync(telemetryPath)) {
          // File gone (deleted on deploy or undeploy) — clear telemetry
          if (this.latestGpsTelemetry) {
            this.latestGpsTelemetry = null
            lastT = 0
          }
          return
        }
        const raw = readFileSync(telemetryPath, 'utf-8')
        const data = JSON.parse(raw)
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return
        // Deduplicate: only update if the Lua-side timestamp changed
        if (data.t === lastT) {
          // Stale check: if the Lua side stopped writing (map change / no vehicle), clear telemetry
          if (this.latestGpsTelemetry && Date.now() - lastUpdateTime > STALE_TIMEOUT) {
            this.latestGpsTelemetry = null
          }
          return
        }
        lastT = data.t
        lastUpdateTime = Date.now()
        this.latestGpsTelemetry = {
          x: data.x,
          y: data.y,
          z: data.z ?? 0,
          heading: data.heading ?? 0,
          speed: data.speed ?? 0,
          timestamp: Date.now(),
          map: typeof data.map === 'string' && data.map ? data.map : undefined,
          vehicleId: typeof data.vehicle === 'string' && data.vehicle ? data.vehicle : undefined,
          otherPlayers: Array.isArray(data.others) ? data.others.map((o: Record<string, unknown>) => ({
            x: typeof o.x === 'number' ? o.x : 0,
            y: typeof o.y === 'number' ? o.y : 0,
            z: typeof o.z === 'number' ? o.z : 0,
            heading: typeof o.heading === 'number' ? o.heading : 0,
            speed: typeof o.speed === 'number' ? o.speed : 0,
            name: typeof o.name === 'string' ? o.name : ''
          })) : undefined,
          navRoute: Array.isArray(data.route) ? data.route.filter((pt: Record<string, unknown>) =>
            typeof pt.x === 'number' && typeof pt.y === 'number'
          ).map((pt: Record<string, unknown>) => ({ x: pt.x as number, y: pt.y as number })) : undefined
        }
      } catch { /* file may be mid-write, skip this tick */ }
    }, 100) // 10 Hz polling
    this.log('GPS file poller started on ' + telemetryPath)
  }

  private stopGpsFilePoller(): void {
    if (this.gpsFilePoller) {
      clearInterval(this.gpsFilePoller)
      this.gpsFilePoller = null
    }
  }

  private shutdown(): void {
    // Auto-undeploy our own extensions so nothing stale is left on disk.
    // Subscribed services (VoiceChatService, LuaConsoleService, ...) handle
    // their own cleanup via notifyGameExit() below.
    if (this.gameUserDir) {
      if (this.gpsTrackerDeployed) {
        try { this.undeployGPSTracker(this.gameUserDir) } catch (err) { this.log(`GPS undeploy on exit failed: ${err}`) }
      }
      if (this.editorSyncDeployed) {
        try { this.undeployEditorSync(this.gameUserDir) } catch (err) { this.log(`World Editor Sync undeploy on exit failed: ${err}`) }
      }
      // Also sweep the bridge extension(s) — they're harmless if left, but
      // they poll for signals and spam the BeamNG log when CM isn't running.
      try {
        const extDir = join(this.gameUserDir, 'lua', 'ge', 'extensions')
        for (const name of ['beamcmBridge.lua', 'beammpCMBridge.lua']) {
          const p = join(extDir, name)
          if (existsSync(p)) unlinkSync(p)
        }
      } catch (err) {
        this.log(`Bridge sweep on exit failed: ${err}`)
      }
    }
    this.notifyGameExit()
    this.stopGpsFilePoller()
    this.stopEditorSyncStatusPoller()
    this.netReset()
    if (this.protonShutdownTimer) {
      clearTimeout(this.protonShutdownTimer)
      this.protonShutdownTimer = null
    }
    this.isProtonLaunch = false
    if (this.coreSocket) {
      this.coreSocket.destroy()
      this.coreSocket = null
    }
    if (this.coreServer) {
      this.coreServer.close()
      this.coreServer = null
    }
    if (this.httpProxy) {
      this.httpProxy.close()
      this.httpProxy = null
    }
  }
}
