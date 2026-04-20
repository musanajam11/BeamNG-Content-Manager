/**
 * Embedded Lua source for the BeamCM Lua Console bridge extension.
 * Deployed by LuaConsoleService into <userDir>/lua/ge/extensions/beamcmConsole.lua
 *
 * Kept in its own TypeScript module so the service file stays small and
 * the Lua source is editable without scrolling past hundreds of lines of
 * TS plumbing.
 *
 * Wire protocol (see LuaConsoleService.ts for the matching CM side).
 */

export const LUA_CONSOLE_EXTENSION = `
-- BeamCM Lua Console Bridge
-- Auto-deployed by BeamMP Content Manager
-- Provides a live REPL into BeamNG.drive's GE-Lua VM, plus capture of
-- the game's log() output and print() so the CM-side console window can
-- mirror everything the in-game F11 console would show.

local M = {}

local socket = require("socket")
local portFile = "settings/BeamCM/lc_port.txt"
local cmHost = "127.0.0.1"
local cmPort = nil
local client = nil
local clientBuf = ""
local reconnectTimer = 0
local reconnectInterval = 1.0
local startupElapsed = 0
local statsTimer = 0
-- Execution scope and target vehicle id (nil = player vehicle).
-- 'ge'  → run in GE-Lua VM (default).
-- 'veh' → forward to vehicle VM via obj:queueLuaCommand and bounce result back.
local currentScope = "ge"
local currentVehId = nil

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
  -- Always re-read the port file. CM picks a fresh port on each launch, so
  -- caching the first value would permanently dial a dead socket whenever
  -- the user restarts the Content Manager while the game is running.
  local fresh = readPort()
  if fresh then cmPort = fresh end
  if not cmPort then return end
  local sock = socket.tcp()
  sock:settimeout(0.05)
  local ok, err = sock:connect(cmHost, cmPort)
  if not ok and err ~= "already connected" then
    sock:close()
    return
  end
  sock:settimeout(0)
  sock:setoption("tcp-nodelay", true)
  client = sock
  clientBuf = ""
  log('I', 'beamcmConsole', 'Connected to CM lua console bridge on port ' .. tostring(cmPort))
end

local function disconnectClient(reason)
  if not client then return end
  pcall(function() client:close() end)
  client = nil
  clientBuf = ""
  log('W', 'beamcmConsole', 'Disconnected from CM bridge: ' .. tostring(reason))
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

-- Stringify a value for transport. Avoids huge dumps but keeps tables
-- inspectable. Uses jsonEncode for tables when possible (BeamNG provides
-- it), falls back to a manual one-level dump.
local function reprValue(v)
  local t = type(v)
  if t == "nil" then return "nil" end
  if t == "string" then return string.format("%q", v) end
  if t == "number" or t == "boolean" then return tostring(v) end
  if t == "function" then return "<function>" end
  if t == "userdata" then return "<userdata>" end
  if t == "table" then
    if type(jsonEncode) == "function" then
      local ok, s = pcall(jsonEncode, v)
      if ok and s then
        if #s > 8192 then return string.sub(s, 1, 8192) .. "...<truncated>" end
        return s
      end
    end
    local parts = {}
    local n = 0
    for k, val in pairs(v) do
      n = n + 1
      if n > 64 then table.insert(parts, "...") break end
      table.insert(parts, tostring(k) .. "=" .. tostring(val))
    end
    return "{" .. table.concat(parts, ", ") .. "}"
  end
  return tostring(v)
end

-- Resolve a dotted path like "core_vehicles.spawnVehicle" against _G.
local function resolvePath(path)
  local cur = _G
  for part in string.gmatch(path, "[^%.]+") do
    if type(cur) ~= "table" then return nil, "not a table at '" .. part .. "'" end
    cur = cur[part]
    if cur == nil then return nil, "nil at '" .. part .. "'" end
  end
  return cur
end

-- Strip control / non-printable bytes so the resulting string is always safe
-- to embed in a JSON string literal (BeamNG's jsonEncode does not always escape
-- raw bytes < 0x20, which then breaks JSON.parse on the CM side).
local function sanitizeStr(s)
  s = string.gsub(s, "[%z\\1-\\31\\127]", "?")
  return s
end

-- Short, single-line preview of a value for tree-inspector rows.
local function shortRepr(v)
  local t = type(v)
  if t == "nil" then return "nil" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then return tostring(v) end
  if t == "string" then
    local s = v
    if #s > 80 then s = string.sub(s, 1, 80) .. "..." end
    return '"' .. sanitizeStr(s) .. '"'
  end
  if t == "function" then return "<function>" end
  if t == "userdata" then
    local ok, mt = pcall(getmetatable, v)
    if ok and type(mt) == "table" and type(mt.__tostring) == "function" then
      local ok2, s = pcall(tostring, v)
      if ok2 and type(s) == "string" then return "<userdata " .. sanitizeStr(string.sub(s, 1, 60)) .. ">" end
    end
    return "<userdata>"
  end
  if t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 if n > 99 then break end end
    return "<table " .. tostring(n) .. (n >= 100 and "+" or "") .. " items>"
  end
  if t == "thread" then return "<thread>" end
  local ok, s = pcall(tostring, v)
  if ok and type(s) == "string" then return sanitizeStr(s) end
  return "<" .. t .. ">"
end

-- Safe key stringification (some keys may be userdata or contain weird bytes).
local function safeKey(k)
  if type(k) == "string" then return sanitizeStr(k) end
  local ok, s = pcall(tostring, k)
  if ok and type(s) == "string" then return sanitizeStr(s) end
  return "?"
end

-- Minimal, dependency-free JSON string escaper. We only ever encode strings
-- that have already been run through sanitizeStr (so no control bytes), but
-- we still need to escape the JSON-special characters " and \\.
local function jsonStr(s)
  s = string.gsub(s, "\\\\", "\\\\\\\\")
  s = string.gsub(s, '"', '\\\\"')
  return '"' .. s .. '"'
end

-- ── target vehicle ──
local function getTargetVehicle()
  if not be then return nil end
  if currentVehId then
    if be.getObjectByID then return be:getObjectByID(currentVehId) end
  end
  return be:getPlayerVehicle(0)
end

-- ── list vehicles ──
local function listVehicles()
  local out = {}
  if not be then return out end
  local count = (be.getObjectCount and be:getObjectCount()) or 0
  local playerVeh = be:getPlayerVehicle(0)
  for i = 0, count - 1 do
    local v = be:getObject(i)
    if v then
      local id = v.getId and v:getId() or i
      local jbeam = (v.getJBeamFilename and v:getJBeamFilename()) or "?"
      table.insert(out, {
        id = id,
        jbeam = jbeam,
        player = (v == playerVeh),
      })
    end
  end
  return out
end

-- ── completion ──
-- Returns a list of {key, kind, inherited?} for keys at parent that match the
-- last segment prefix. Splits the prefix on the final '.', resolves the
-- parent path, then filters its keys (and one level of __index inheritance).
local function complete(prefix)
  local lastDot = nil
  for i = #prefix, 1, -1 do
    if string.sub(prefix, i, i) == "." then lastDot = i; break end
  end
  local parent, leaf
  if lastDot then
    local p, err = resolvePath(string.sub(prefix, 1, lastDot - 1))
    if not p then return {} end
    parent = p
    leaf = string.sub(prefix, lastDot + 1)
  else
    parent = _G
    leaf = prefix
  end
  if type(parent) ~= "table" then return {} end
  local seen = {}
  local out = {}
  for k, v in pairs(parent) do
    if type(k) == "string" and (leaf == "" or string.sub(k, 1, #leaf) == leaf) then
      seen[k] = true
      table.insert(out, { key = k, kind = type(v) })
      if #out >= 200 then return out end
    end
  end
  local mt = getmetatable(parent)
  if type(mt) == "table" and type(mt.__index) == "table" then
    for k, v in pairs(mt.__index) do
      if type(k) == "string" and not seen[k] and (leaf == "" or string.sub(k, 1, #leaf) == leaf) then
        table.insert(out, { key = k, kind = type(v), inherited = true })
        if #out >= 200 then return out end
      end
    end
  end
  return out
end

-- ── tree inspect ──
-- Returns one level of children under a path with type + short preview.
local function treeInspect(path)
  local v
  if path == "" or path == "_G" then
    v = _G
  else
    local err
    v, err = resolvePath(path)
    if v == nil then return nil, err end
  end
  if type(v) ~= "table" then
    return { kind = type(v), preview = shortRepr(v), items = {} }
  end
  local items = {}
  local count = 0
  for k, val in pairs(v) do
    count = count + 1
    if count > 500 then
      table.insert(items, { key = "...", kind = "ellipsis", preview = "(more keys truncated)" })
      break
    end
    table.insert(items, { key = safeKey(k), kind = type(val), preview = shortRepr(val) })
  end
  table.sort(items, function(a, b) return tostring(a.key) < tostring(b.key) end)
  return { kind = "table", preview = "<table " .. tostring(count) .. " items>", items = items }
end

-- ── reload ──
local function doReload(action)
  if action == "ge" then
    if Lua and Lua.requestReload then Lua:requestReload(); return true, "GE Lua reload requested" end
    if extensions and extensions.reload then extensions.reload(); return true, "extensions reloaded" end
    return false, "no reload entry point"
  elseif action == "veh" then
    local v = getTargetVehicle()
    if not v then return false, "no target vehicle" end
    if core_vehicle_manager and core_vehicle_manager.reloadVehicle then
      core_vehicle_manager.reloadVehicle(v:getId())
      return true, "vehicle " .. tostring(v:getId()) .. " reload requested"
    end
    if v.reset then v:reset(); return true, "vehicle reset" end
    return false, "no reload entry point on vehicle"
  elseif action == "env" then
    if extensions and extensions.reload then extensions.reload(); return true, "extensions reloaded" end
    return false, "extensions framework not available"
  end
  return false, "unknown action: " .. tostring(action)
end

-- Replace newlines in payloads to keep frame-on-one-line invariant.
local function escapeFrame(s)
  s = string.gsub(s, "\\\\", "\\\\\\\\")
  s = string.gsub(s, "\\n", "\\\\n")
  s = string.gsub(s, "\\r", "\\\\r")
  return s
end

-- Decode the framing escape from CM (E|reqId|<lua with \\n for newlines>).
local function decodeFrame(s)
  -- order matters: \\\\n must NOT become a newline.
  local out = {}
  local i = 1
  local len = #s
  while i <= len do
    local c = string.sub(s, i, i)
    if c == "\\\\" and i < len then
      local nxt = string.sub(s, i + 1, i + 1)
      if nxt == "n" then table.insert(out, "\\n"); i = i + 2
      elseif nxt == "r" then table.insert(out, "\\r"); i = i + 2
      elseif nxt == "\\\\" then table.insert(out, "\\\\"); i = i + 2
      else table.insert(out, c); i = i + 1
      end
    else
      table.insert(out, c)
      i = i + 1
    end
  end
  return table.concat(out)
end

-- Execute Lua source. If it parses as an expression we wrap it with
-- 'return ...' so the user can type \`be:getPlayerVehicle(0)\` and see the
-- result instead of an empty string.
local function executeLuaGE(src)
  local chunk, err = loadstring("return " .. src)
  if not chunk then
    chunk, err = loadstring(src)
  end
  if not chunk then
    return "err", "compile error: " .. tostring(err)
  end
  local results = { pcall(chunk) }
  local ok = table.remove(results, 1)
  if not ok then
    return "err", tostring(results[1])
  end
  if #results == 0 then return "ok", "nil" end
  if #results == 1 then return "ok", reprValue(results[1]) end
  local parts = {}
  for _, v in ipairs(results) do table.insert(parts, reprValue(v)) end
  return "ok", table.concat(parts, ", ")
end

-- Execute Lua inside the target vehicle's VM.
-- Uses obj:queueLuaCommand (vehicle-side) and bounces the result back to
-- GE-Lua via obj:queueGameEngineLua, which then calls our relay function
-- to ship the R| frame back to CM. Returns nil to mean "async — no reply yet".
local function executeLuaVeh(reqId, src)
  local v = getTargetVehicle()
  if not v then return "err", "no target vehicle (id=" .. tostring(currentVehId) .. ")" end
  local srcLit = string.format("%q", src)
  local idStr = tostring(reqId)
  local wrapper = table.concat({
    "do",
    "local _src = " .. srcLit,
    "local _id = " .. idStr,
    "local _chunk, _err = loadstring('return ' .. _src)",
    "if not _chunk then _chunk, _err = loadstring(_src) end",
    "local _status, _repr",
    "if not _chunk then",
    "  _status = 'err'; _repr = 'compile error: ' .. tostring(_err)",
    "else",
    "  local _results = { pcall(_chunk) }",
    "  local _ok = table.remove(_results, 1)",
    "  if not _ok then",
    "    _status = 'err'; _repr = tostring(_results[1])",
    "  else",
    "    local function _r(x)",
    "      local t = type(x)",
    "      if t == 'nil' then return 'nil' end",
    "      if t == 'string' then return string.format('%q', x) end",
    "      if t == 'number' or t == 'boolean' then return tostring(x) end",
    "      if t == 'table' then",
    "        if jsonEncode then local ok, s = pcall(jsonEncode, x) if ok and s then if #s > 8192 then return string.sub(s, 1, 8192) .. '...<truncated>' end return s end end",
    "        return tostring(x)",
    "      end",
    "      return tostring(x)",
    "    end",
    "    if #_results == 0 then _status = 'ok'; _repr = 'nil'",
    "    elseif #_results == 1 then _status = 'ok'; _repr = _r(_results[1])",
    "    else local p = {} for _, rv in ipairs(_results) do table.insert(p, _r(rv)) end _status = 'ok'; _repr = table.concat(p, ', ') end",
    "  end",
    "end",
    "obj:queueGameEngineLua('if beamcmConsole and beamcmConsole.relayVehResult then beamcmConsole.relayVehResult(' .. _id .. ', ' .. string.format('%q', _status) .. ', ' .. string.format('%q', _repr) .. ') end')",
    "end",
  }, "\\n")
  v:queueLuaCommand(wrapper)
  return nil  -- async; relayVehResult will send the R| frame later
end

-- Called by the vehicle wrapper above (via obj:queueGameEngineLua).
-- Re-exposed below as M.relayVehResult so vehicle-bounced results land here.
local function relayVehResult(reqId, status, repr)
  if not client then return end
  sendLine("R|" .. tostring(reqId) .. "|" .. tostring(status) .. "|" .. escapeFrame(tostring(repr)) .. "\\n")
end

local function inspectPathGE(path)
  local v, err = resolvePath(path)
  if v == nil then
    return "err", "could not resolve: " .. tostring(err)
  end
  return "ok", reprValue(v)
end

-- Dispatch helpers — pick the right VM for the current scope.
local function dispatchExecute(reqId, src)
  if currentScope == "veh" then
    local s, r = executeLuaVeh(reqId, src)
    if s == nil then return end  -- async, no immediate reply
    sendLine("R|" .. reqId .. "|" .. s .. "|" .. escapeFrame(r) .. "\\n")
  else
    local s, r = executeLuaGE(src)
    sendLine("R|" .. reqId .. "|" .. s .. "|" .. escapeFrame(r) .. "\\n")
  end
end

local function dispatchInspect(reqId, path)
  -- Inspect always runs in GE for consistency — vehicle-side inspect would
  -- complicate every path lookup with async bouncing for marginal value.
  local s, r = inspectPathGE(path)
  sendLine("R|" .. reqId .. "|" .. s .. "|" .. escapeFrame(r) .. "\\n")
end

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
    while true do
      local nl = string.find(clientBuf, "\\n", 1, true)
      if not nl then break end
      local line = string.sub(clientBuf, 1, nl - 1)
      clientBuf = string.sub(clientBuf, nl + 1)
      if #line > 0 then
        local kind = string.sub(line, 1, 1)
        if kind == "E" then
          -- E|reqId|escapedSource
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local reqId = string.sub(line, 3, p1 - 1)
            local src = decodeFrame(string.sub(line, p1 + 1))
            dispatchExecute(reqId, src)
          end
        elseif kind == "V" then
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local reqId = string.sub(line, 3, p1 - 1)
            local path = string.sub(line, p1 + 1)
            dispatchInspect(reqId, path)
          end
        elseif kind == "M" then
          -- M|reqId|prefix → completion list
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local reqId = string.sub(line, 3, p1 - 1)
            local prefix = string.sub(line, p1 + 1)
            local items = complete(prefix)
            local parts = {}
            for _, it in ipairs(items) do
              local row = '{"key":' .. jsonStr(tostring(it.key)) ..
                ',"kind":' .. jsonStr(tostring(it.kind))
              if it.inherited then row = row .. ',"inherited":true' end
              row = row .. '}'
              table.insert(parts, row)
            end
            local s = "[" .. table.concat(parts, ",") .. "]"
            sendLine("R|" .. reqId .. "|ok|" .. escapeFrame(s) .. "\\n")
          end
        elseif kind == "T" then
          -- T|reqId|path → tree-inspect (one level)
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local reqId = string.sub(line, 3, p1 - 1)
            local path = string.sub(line, p1 + 1)
            local data, err = treeInspect(path)
            if data == nil then
              sendLine("R|" .. reqId .. "|err|" .. escapeFrame(jsonStr(tostring(err))) .. "\\n")
            else
              local parts = {}
              if data.items then
                for _, it in ipairs(data.items) do
                  local row = '{"key":' .. jsonStr(tostring(it.key)) ..
                    ',"kind":' .. jsonStr(tostring(it.kind)) ..
                    ',"preview":' .. jsonStr(tostring(it.preview)) .. '}'
                  table.insert(parts, row)
                end
              end
              local s = '{"kind":' .. jsonStr(tostring(data.kind)) ..
                ',"preview":' .. jsonStr(tostring(data.preview)) ..
                ',"items":[' .. table.concat(parts, ",") .. ']}'
              sendLine("R|" .. reqId .. "|ok|" .. escapeFrame(s) .. "\\n")
            end
          end
        elseif kind == "Q" then
          -- Q|reqId|query → meta queries (currently: "vehicles")
          local p1 = string.find(line, "|", 3, true)
          if p1 then
            local reqId = string.sub(line, 3, p1 - 1)
            local q = string.sub(line, p1 + 1)
            local s
            if q == "vehicles" then
              local list = listVehicles()
              local parts = {}
              for _, v in ipairs(list) do
                local row = '{"id":' .. tostring(v.id) ..
                  ',"jbeam":' .. jsonStr(sanitizeStr(tostring(v.jbeam))) ..
                  ',"player":' .. (v.player and 'true' or 'false') .. '}'
                table.insert(parts, row)
              end
              s = "[" .. table.concat(parts, ",") .. "]"
            else
              s = "[]"
            end
            sendLine("R|" .. reqId .. "|ok|" .. escapeFrame(s) .. "\\n")
          end
        elseif kind == "X" then
          -- X|action  → reload (ge|veh|env). Optionally X|reqId|action for ack.
          local rest = string.sub(line, 3)
          local p1 = string.find(rest, "|", 1, true)
          local reqId = nil
          local action = rest
          if p1 then
            reqId = string.sub(rest, 1, p1 - 1)
            action = string.sub(rest, p1 + 1)
          end
          local ok, msg = doReload(action)
          if reqId then
            local payload = jsonStr(sanitizeStr(tostring(msg)))
            sendLine("R|" .. reqId .. "|" .. (ok and "ok" or "err") .. "|" .. escapeFrame(payload) .. "\\n")
          end
          log(ok and 'I' or 'W', 'beamcmConsole', 'Reload(' .. tostring(action) .. '): ' .. tostring(msg))
        elseif kind == "S" then
          -- S|<scope>[|<vehId>]  switch GE/Vehicle scope and optional veh target.
          local rest = string.sub(line, 3)
          local p1 = string.find(rest, "|", 1, true)
          if p1 then
            currentScope = string.sub(rest, 1, p1 - 1)
            local vid = tonumber(string.sub(rest, p1 + 1))
            currentVehId = vid  -- nil if blank/non-numeric → player vehicle
          else
            currentScope = rest
            currentVehId = nil
          end
          log('I', 'beamcmConsole', 'Scope set: ' .. tostring(currentScope) .. (currentVehId and (' veh#' .. tostring(currentVehId)) or ''))
        elseif kind == "C" then
          -- Clear remote buffer — no-op on Lua side; CM clears its own.
        end
      end
    end
    if err == "timeout" or not data then break end
  end
end

-- ── Capture print() output ────────────────────────────────────────────
-- The vanilla _G.print writes to stdout/the in-game console. We wrap it
-- so the same line ALSO ships up the bridge. Existing extensions keep
-- working unchanged — they still see their output appear normally.
local originalPrint = _G.print
_G.print = function(...)
  local args = { ... }
  local parts = {}
  for i = 1, select('#', ...) do
    parts[i] = tostring(args[i])
  end
  local text = table.concat(parts, "\\t")
  if client then
    pcall(function() sendLine("P|" .. escapeFrame(text) .. "\\n") end)
  end
  return originalPrint(...)
end

-- ── Capture log() output ──────────────────────────────────────────────
-- BeamNG's global \`log(level, source, msg)\` is the canonical logger.
-- We wrap it so console UI mirrors warnings/errors with proper colouring.
local originalLog = _G.log
if type(originalLog) == "function" then
  _G.log = function(level, source, msg, ...)
    if client then
      pcall(function()
        sendLine("L|" .. tostring(level) .. "|" .. tostring(source) .. "|" .. escapeFrame(tostring(msg)) .. "\\n")
      end)
    end
    return originalLog(level, source, msg, ...)
  end
end

local function onExtensionLoaded()
  if setExtensionUnloadMode then
    setExtensionUnloadMode('beamcmConsole', 'manual')
  end
  log('I', 'beamcmConsole', 'BeamCM Lua Console bridge loaded')
end

local function onExtensionUnloaded()
  -- Restore globals so reloading doesn't stack wrappers.
  _G.print = originalPrint
  if originalLog then _G.log = originalLog end
  disconnectClient("extension unload")
end

local function onUpdate(dt)
  startupElapsed = startupElapsed + dt
  if not client then
    reconnectTimer = reconnectTimer + dt
    if reconnectTimer >= reconnectInterval then
      reconnectTimer = 0
      tryConnect()
    end
  else
    pumpClient()
  end
  statsTimer = statsTimer + dt
  if statsTimer >= 30 then
    statsTimer = 0
    if client then sendLine("H|\\n") end
  end
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate
M.relayVehResult = relayVehResult
return M
`
