/**
 * BeamCM Voice Overlay — in-game UI app.
 *
 * Packaged as a BeamMP "Client" mod (zip dropped in `<server>/Resources/Client/`).
 * BeamMP auto-distributes Resources/Client/*.zip to every joining player, so the
 * overlay lights up for everyone on a server with zero per-user install.
 *
 * The overlay reads its state and pushes commands through `_G.BeamCMVoice`,
 * which is exposed by the BeamCM bridge extension (only present on machines
 * that also run the BeamCM Manager). For non-manager players the overlay
 * gracefully degrades to an "Install BeamCM" hint.
 */

import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs'
import { dirname } from 'path'
import archiver from 'archiver'

const APP_JSON = JSON.stringify(
  {
    // Matches BeamNG's real UI-app schema (see Tacho2, AIControl). The
    // original `directives`/`format` shape was invented — BeamNG silently
    // ignored it, so the app never registered and never appeared in the
    // App library. The fields below are what the engine actually parses:
    domElement: '<beamcm-voice></beamcm-voice>',
    name: 'BeamCM Voice',
    description: 'BeamCM voice chat status and controls',
    author: 'BeamCM',
    version: '1.0',
    directive: 'beamcmVoice',
    types: ['ui.apps.categories.multiplayer'],
    category: 'Gameplay',
    css: {
      position: 'absolute',
      top: '60px',
      right: '20px',
      width: '260px',
      height: '190px',
      'min-width': '200px',
      'min-height': '120px'
    },
    isAuxiliary: false,
    interactive: 'no'
  },
  null,
  2
)

const APP_HTML = `<div class="beamcm-voice-app" ng-class="{'no-mgr': state.noManager, 'speaking': state.speaking, 'self-muted': state.muted}">
  <div class="bcv-header">
    <span class="bcv-mic" ng-class="{
      'on': state.enabled && !state.muted,
      'muted': state.muted,
      'off': !state.enabled
    }"></span>
    <span class="bcv-title">Voice</span>
    <span class="bcv-tier" ng-show="state.enabled && state.tier && state.tier !== 'unknown'"
          ng-class="'tier-' + state.tier"
          title="Mesh tier">{{state.tier === 'p2p' ? 'P2P' : state.tier === 'relay' ? 'RLY' : state.tier === 'server' ? 'SRV' : ''}}</span>
    <button class="bcv-iconbtn"
            ng-show="state.enabled"
            ng-click="toggleSelfMute()"
            ng-class="{'on': !state.muted}"
            title="{{state.muted ? 'Unmute mic' : 'Mute mic'}}">{{state.muted ? '×' : '•'}}</button>
    <button class="bcv-toggle"
            ng-click="toggle()"
            ng-disabled="state.noManager"
            ng-class="{'on': state.enabled}"
            title="{{state.enabled ? 'Disable voice' : 'Enable voice'}}">
      <span ng-show="state.enabled">ON</span>
      <span ng-show="!state.enabled">OFF</span>
    </button>
  </div>

  <div class="bcv-body" ng-show="!state.noManager">
    <div class="bcv-status" ng-show="state.enabled">
      <span class="bcv-dot" ng-class="{'live': state.connected, 'pending': !state.connected}"></span>
      <span ng-show="state.connected">Connected ({{peers.length}} peer<span ng-show="peers.length !== 1">s</span>)</span>
      <span ng-show="!state.connected">Connecting&hellip;</span>
    </div>
    <div class="bcv-status" ng-show="!state.enabled">
      <span class="bcv-dot off"></span>
      <span ng-show="!state.gameReady">Voice off (not in game)</span>
      <span ng-show="state.gameReady">Voice off</span>
    </div>

    <ul class="bcv-peers" ng-show="state.enabled && peers.length > 0">
      <li ng-repeat="p in peers track by p.id"
          ng-class="{'speaking': p.speaking, 'muted': p.muted}"
          ng-click="togglePeerMute(p)"
          title="{{p.muted ? 'Unmute ' + p.name : 'Mute ' + p.name}}">
        <span class="bcv-peer-dot"></span>
        <span class="bcv-peer-name">{{p.name}}</span>
        <span class="bcv-peer-flag" ng-show="p.muted">muted</span>
      </li>
    </ul>
  </div>

  <div class="bcv-body bcv-hint" ng-show="state.noManager">
    <div>BeamCM Manager not detected.</div>
    <div class="bcv-link">Install to join voice chat.</div>
  </div>
</div>
`

const APP_CSS = `.beamcm-voice-app {
  font-family: 'Roboto', 'Segoe UI', sans-serif;
  font-size: 12px;
  color: #e6e6e6;
  background: rgba(18, 18, 22, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  min-width: 180px;
  user-select: none;
  -webkit-user-select: none;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.beamcm-voice-app.no-mgr {
  background: rgba(40, 30, 20, 0.78);
  border-color: rgba(255, 180, 80, 0.25);
}
.beamcm-voice-app.speaking {
  border-color: rgba(80, 200, 120, 0.55);
  box-shadow: 0 0 8px rgba(80, 200, 120, 0.25);
}

.bcv-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bcv-title {
  flex: 1;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  font-size: 11px;
  opacity: 0.85;
}
.bcv-mic {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #555;
}
.bcv-mic.on { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
.bcv-mic.muted { background: #c0392b; }
.bcv-mic.off { background: #444; }

.bcv-toggle {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #ccc;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  letter-spacing: 0.5px;
}
.bcv-toggle.on {
  background: rgba(80, 200, 120, 0.25);
  border-color: rgba(80, 200, 120, 0.5);
  color: #b5f3c4;
}
.bcv-toggle:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bcv-iconbtn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #ccc;
  font-size: 12px;
  line-height: 1;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.bcv-iconbtn.on { color: #b5f3c4; border-color: rgba(80, 200, 120, 0.5); }

.bcv-tier {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 4px;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
}
.bcv-tier.tier-p2p { color: #b5f3c4; border-color: rgba(80, 200, 120, 0.4); }
.bcv-tier.tier-relay { color: #ffd180; border-color: rgba(255, 200, 100, 0.4); }
.bcv-tier.tier-server { color: #ff8a80; border-color: rgba(255, 130, 130, 0.4); }

.bcv-body {
  margin-top: 6px;
}
.bcv-status {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.85;
}
.bcv-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #666;
}
.bcv-dot.live { background: #4caf50; }
.bcv-dot.pending { background: #f5a623; animation: bcv-pulse 1.2s ease-in-out infinite; }
.bcv-dot.off { background: #555; }

@keyframes bcv-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.bcv-peers {
  list-style: none;
  margin: 6px 0 0 0;
  padding: 0;
  max-height: 160px;
  overflow-y: auto;
}
.bcv-peers li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  opacity: 0.85;
  cursor: pointer;
  border-radius: 3px;
}
.bcv-peers li:hover {
  background: rgba(255, 255, 255, 0.05);
}
.bcv-peers li.speaking {
  opacity: 1;
  color: #b5f3c4;
}
.bcv-peers li.muted {
  opacity: 0.5;
}
.bcv-peers li.muted .bcv-peer-name {
  text-decoration: line-through;
}
.bcv-peer-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #555;
  transition: background 0.15s, box-shadow 0.15s;
}
.bcv-peers li.speaking .bcv-peer-dot {
  background: #4caf50;
  box-shadow: 0 0 5px #4caf50;
}
.bcv-peer-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bcv-peer-flag {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.6;
}

.bcv-hint {
  font-size: 11px;
  opacity: 0.85;
}
.bcv-hint .bcv-link {
  margin-top: 2px;
  color: #ffb74d;
  font-size: 10px;
}
`

const APP_JS = `'use strict';
angular.module('beamng.apps').directive('beamcmVoice', [function () {
  return {
    templateUrl: '/ui/modules/apps/BeamCMVoice/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    link: function (scope) {
      scope.state = { connecting: true, enabled: false, connected: false, noManager: false };
      scope.peers = [];

      var pollInterval = 1000;
      var pollTimer = null;
      var destroyed = false;

      function safeApply(fn) {
        if (destroyed) return;
        if (scope.$$phase || (scope.$root && scope.$root.$$phase)) {
          fn();
        } else {
          scope.$apply(fn);
        }
      }

      function refresh() {
        if (destroyed) return;
        if (typeof bngApi === 'undefined' || !bngApi.engineLua) {
          safeApply(function () {
            scope.state = { noManager: true };
            scope.peers = [];
          });
          return;
        }
        bngApi.engineLua(
          "if _G.BeamCMVoice and _G.BeamCMVoice.getStatus then return _G.BeamCMVoice.getStatus() else return '__NOMGR__' end",
          function (res) {
            if (destroyed) return;
            if (!res || res === '__NOMGR__') {
              safeApply(function () {
                scope.state = { noManager: true, enabled: false, connected: false };
                scope.peers = [];
              });
              return;
            }
            var parsed = null;
            try { parsed = JSON.parse(res); } catch (e) { parsed = null; }
            if (!parsed || typeof parsed !== 'object') {
              safeApply(function () {
                scope.state = { error: true, enabled: false, connected: false };
                scope.peers = [];
              });
              return;
            }
            safeApply(function () {
              scope.state = {
                noManager: false,
                available: !!parsed.available,
                enabled: !!parsed.enabled,
                connected: !!parsed.connected,
                muted: !!parsed.muted,
                speaking: !!parsed.speaking,
                gameReady: parsed.gameReady !== false,
                selfId: parsed.selfId || null
              };
              scope.peers = Array.isArray(parsed.peers) ? parsed.peers : [];
            });
          }
        );
      }

      scope.toggle = function () {
        if (scope.state.noManager) return;
        var action = scope.state.enabled ? 'disable' : 'enable';
        if (typeof bngApi !== 'undefined' && bngApi.engineLua) {
          bngApi.engineLua(
            "if _G.BeamCMVoice and _G.BeamCMVoice.sendCommand then _G.BeamCMVoice.sendCommand('" + action + "') end"
          );
        }
        // Optimistic UI nudge then re-poll quickly.
        scope.state.enabled = !scope.state.enabled;
        setTimeout(refresh, 250);
      };

      scope.toggleSelfMute = function () {
        if (scope.state.noManager || !scope.state.enabled) return;
        var action = scope.state.muted ? 'unmute' : 'mute';
        if (typeof bngApi !== 'undefined' && bngApi.engineLua) {
          bngApi.engineLua(
            "if _G.BeamCMVoice and _G.BeamCMVoice.sendCommand then _G.BeamCMVoice.sendCommand('" + action + "') end"
          );
        }
        scope.state.muted = !scope.state.muted;
        setTimeout(refresh, 250);
      };

      scope.togglePeerMute = function (p) {
        if (!p || scope.state.noManager) return;
        var prefix = p.muted ? 'unmute_peer:' : 'mute_peer:';
        if (typeof bngApi !== 'undefined' && bngApi.engineLua) {
          bngApi.engineLua(
            "if _G.BeamCMVoice and _G.BeamCMVoice.sendCommand then _G.BeamCMVoice.sendCommand('" + prefix + p.id + "') end"
          );
        }
        p.muted = !p.muted;
        setTimeout(refresh, 250);
      };

      refresh();
      pollTimer = setInterval(refresh, pollInterval);

      scope.$on('$destroy', function () {
        destroyed = true;
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      });
    }
  };
}]);
`

interface OverlayFile {
  path: string
  content: string
}

// modScript.lua — BeamNG auto-executes any `/scripts/**/modScript.lua` file
// inside a mod archive on load (see `core/modmanager.lua` `initDB`). We use
// it to load a tiny GE extension which pins the BeamCMVoice app onto the
// user's multiplayer/freeroam UI layout on first UI-ready.
const MOD_SCRIPT_LUA = `-- BeamCM Voice Overlay: entry point. Loads the pin extension with manual
-- unload mode so BeamNG keeps it alive once the mod is active.
setExtensionUnloadMode('beamcmVoicePin', 'manual')
extensions.load('beamcmVoicePin')
log('I', 'beamcmVoiceOverlay', 'modScript.lua: queued beamcmVoicePin extension')
`

// The pin extension itself. Runs on every UI-ready hook and idempotently
// injects the BeamCMVoice app into multiplayer+freeroam layouts using the
// real ui_apps API (getAvailableLayouts / saveLayout).
const PIN_EXT_LUA = `local M = {}
local pinned = false

local function tryPin()
  if pinned then return end
  local ui_apps = extensions.ui_apps
  if not ui_apps or type(ui_apps.getAvailableLayouts) ~= 'function' then
    return
  end
  local ok, layouts = pcall(ui_apps.getAvailableLayouts)
  if not ok or type(layouts) ~= 'table' then return end

  local descriptor = {
    appName = 'BeamCMVoice',
    placement = {
      position = 'absolute',
      top = '60px',
      right = '20px',
      width = '260px',
      height = '190px'
    }
  }

  local anyChange = false
  for _, layout in ipairs(layouts) do
    if type(layout) == 'table'
       and (layout.type == 'multiplayer' or layout.type == 'freeroam')
       and layout.filename then
      layout.apps = layout.apps or {}
      local already = false
      for _, app in ipairs(layout.apps) do
        if type(app) == 'table' and app.appName == 'BeamCMVoice' then
          already = true
          break
        end
      end
      if not already then
        table.insert(layout.apps, descriptor)
        local ok2, err = pcall(ui_apps.saveLayout, layout)
        if ok2 then
          log('I', 'beamcmVoicePin', 'Pinned BeamCMVoice to ' .. tostring(layout.type) .. ' layout')
          anyChange = true
        else
          log('E', 'beamcmVoicePin', 'saveLayout failed: ' .. tostring(err))
        end
      end
    end
  end
  if anyChange then pinned = true end
end

M.onExtensionLoaded = function()
  log('I', 'beamcmVoicePin', 'extension loaded')
  tryPin()
end
M.onUiReady = tryPin
M.onClientStartMission = tryPin

return M
`

const MOD_INFO_JSON = JSON.stringify(
  {
    title: 'BeamCM Voice Overlay',
    description: 'In-game voice chat status overlay for BeamCM. Auto-distributed by the server.',
    tag_line: 'BeamCM voice overlay',
    authors: 'BeamCM',
    version: '1'
  },
  null,
  2
)

const OVERLAY_FILES: OverlayFile[] = [
  { path: 'ui/modules/apps/BeamCMVoice/app.json', content: APP_JSON },
  { path: 'ui/modules/apps/BeamCMVoice/app.html', content: APP_HTML },
  { path: 'ui/modules/apps/BeamCMVoice/app.css', content: APP_CSS },
  { path: 'ui/modules/apps/BeamCMVoice/app.js', content: APP_JS },
  { path: 'scripts/beamcm-voice-overlay/modScript.lua', content: MOD_SCRIPT_LUA },
  { path: 'lua/ge/extensions/beamcmVoicePin.lua', content: PIN_EXT_LUA },
  { path: 'mod_info.json', content: MOD_INFO_JSON }
]

/** Build the BeamMP-distributed Client mod zip at the given absolute path. */
export async function buildVoiceOverlayZip(destZipPath: string): Promise<void> {
  const dir = dirname(destZipPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Always rewrite so embedded asset updates propagate.
  if (existsSync(destZipPath)) {
    try { unlinkSync(destZipPath) } catch { /* noop */ }
  }

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destZipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    for (const f of OVERLAY_FILES) {
      archive.append(f.content, { name: f.path })
    }
    archive.finalize().catch(reject)
  })
}
