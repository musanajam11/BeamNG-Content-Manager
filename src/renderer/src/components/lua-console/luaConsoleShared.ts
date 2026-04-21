export type LuaScope = 'ge' | 'veh'

export type OutputKind = 'query' | 'result' | 'err' | 'log' | 'print' | 'system'

export interface OutputEntry {
  id: string
  at: number
  kind: OutputKind
  source?: string
  text: string
  level?: 'I' | 'W' | 'E' | 'D'
  scope: LuaScope
}

export interface HistoryEntry {
  id: string
  at: number
  source: string
  scope: LuaScope
}

export interface LuaSnippet {
  id: string
  label: string
  description: string
  code: string
}

export const STORAGE_KEYS = {
  draft: 'luaConsole.draft.v1',
  history: 'luaConsole.history.v1',
  scope: 'luaConsole.scope.v1',
  outputHeight: 'luaConsole.outputHeight.v1',
  editorHeight: 'luaConsole.editorHeight.v1',
  outputCollapsed: 'luaConsole.outputCollapsed.v1',
  inspectorOpen: 'luaConsole.inspectorOpen.v1',
  inspectorWidth: 'luaConsole.inspectorWidth.v1',
  tabMode: 'luaConsole.tabMode.v1',
  uiFilesAllowInstall: 'luaConsole.uiFilesAllowInstall.v1',
  uiFilesInstallWritable: 'luaConsole.uiFilesInstallWritable.v1',
  uiFilesLastRoot: 'luaConsole.uiFilesLastRoot.v1',
  uiFilesLastPath: 'luaConsole.uiFilesLastPath.v1',
  uiFilesTreeWidth: 'luaConsole.uiFilesTreeWidth.v1',
  uiFilesDirty: 'luaConsole.uiFilesDirty.v1',
  uiFilesActiveProject: 'luaConsole.uiFilesActiveProject.v1',
  uiFilesWordWrap: 'luaConsole.uiFilesWordWrap.v1',
  uiFilesMinimap: 'luaConsole.uiFilesMinimap.v1',
  luaSplitPct: 'luaConsole.luaSplitPct.v1',
} as const

export function loadJSON<T>(key: string, fallback: T): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

export const LUA_SNIPPETS: LuaSnippet[] = [
  {
    id: 'hello',
    label: 'Hello world',
    description: 'Print a string to the BeamNG console',
    code: 'print("hello from BeamMP CM")',
  },
  {
    id: 'list-globals',
    label: 'List globals',
    description: 'Show all top-level Lua globals',
    code: 'local k = {} for n,_ in pairs(_G) do k[#k+1]=n end table.sort(k) return table.concat(k, ", ")',
  },
  {
    id: 'player-veh',
    label: 'Player vehicle id',
    description: 'Return the player\u2019s current vehicle id',
    code: 'return be:getPlayerVehicle(0) and be:getPlayerVehicle(0):getId() or "no vehicle"',
  },
  {
    id: 'player-pos',
    label: 'Player position',
    description: 'Return the player vehicle world position',
    code: 'local v = be:getPlayerVehicle(0); return v and tostring(v:getPosition()) or "no vehicle"',
  },
  {
    id: 'time-of-day',
    label: 'Time of day',
    description: 'Read or set the time-of-day',
    code: 'return core_environment.getTimeOfDay()',
  },
  {
    id: 'reload-lua-ge',
    label: 'Reload GE Lua',
    description: 'Reload all GameEngine Lua extensions',
    code: 'Lua:requestReload()',
  },
  {
    id: 'list-extensions',
    label: 'Loaded extensions',
    description: 'List currently loaded GE extensions',
    code: 'local k = {} for n,_ in pairs(extensions or {}) do k[#k+1]=n end table.sort(k) return table.concat(k, "\\n")',
  },
  {
    id: 'gravity',
    label: 'Get gravity',
    description: 'Read current world gravity',
    code: 'return core_environment.getGravity()',
  },
  {
    id: 'teleport',
    label: 'Teleport player',
    description: 'Teleport the player to spawn',
    code: 'spawn.safeTeleport(be:getPlayerVehicle(0), vec3(0,0,0))',
  },
  {
    id: 'mp-self',
    label: 'BeamMP — local player',
    description: 'Return the local BeamMP player name (if any)',
    code: 'return MPConfig and MPConfig.getNickname and MPConfig.getNickname() or "n/a"',
  },
]
