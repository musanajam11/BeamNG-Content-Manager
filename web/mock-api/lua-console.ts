// Mock implementations for the live BeamNG.drive Lua console + the
// "BeamNG UI Files" staging editor that lives inside the same panel.

const noop = (): (() => void) => () => {}

// In-memory virtual filesystem so the BeamNG UI Files panel feels alive
// in the demo. Just enough structure to render directory listings and
// open one or two files — no persistence between reloads.
type VirtualEntry = { name: string; isDirectory: boolean; size: number; modifiedMs: number; content?: string }

const DEMO_VFS: Record<string, Record<string, VirtualEntry[]>> = {
  userUi: {
    '': [
      { name: 'modules', isDirectory: true, size: 0, modifiedMs: Date.now() - 86400000 },
      { name: 'themes', isDirectory: true, size: 0, modifiedMs: Date.now() - 86400000 * 2 },
      { name: 'README.md', isDirectory: false, size: 412, modifiedMs: Date.now() - 3600000, content: '# BeamNG UI Files (demo)\n\nThis is a sandboxed in-memory view used only for the live web demo.' }
    ],
    'modules': [
      { name: 'speedometer.html', isDirectory: false, size: 1842, modifiedMs: Date.now() - 7200000, content: '<!-- demo speedometer module -->\n<div ng-controller="SpeedometerController">\n  {{ speed | number: 0 }} km/h\n</div>' },
      { name: 'speedometer.js', isDirectory: false, size: 932, modifiedMs: Date.now() - 7200000, content: 'angular.module("beamng.apps").controller("SpeedometerController", function ($scope, StreamsManager) {\n  StreamsManager.add(["electrics"]);\n  $scope.$on("streamsUpdate", function (_e, streams) {\n    $scope.speed = (streams.electrics.airspeed || 0) * 3.6;\n  });\n});' }
    ],
    'themes': [
      { name: 'dark.css', isDirectory: false, size: 256, modifiedMs: Date.now() - 86400000, content: ':root {\n  --bg: #0d0d10;\n  --fg: #f5f5f5;\n  --accent: #f97316;\n}' }
    ]
  }
}

function resolveDir(rootId: string, subPath: string): VirtualEntry[] {
  const tree = DEMO_VFS[rootId]
  if (!tree) return []
  return tree[subPath] ?? []
}

function findFile(rootId: string, subPath: string): VirtualEntry | null {
  const tree = DEMO_VFS[rootId]
  if (!tree) return null
  // Split parent / file
  const parts = subPath.split('/').filter(Boolean)
  const fileName = parts.pop()
  const parent = parts.join('/')
  const entries = tree[parent]
  if (!entries) return null
  return entries.find((e) => e.name === fileName && !e.isDirectory) ?? null
}

export const luaConsoleMocks = {
  // Lua REPL
  luaConsoleDeploy: async () => ({ success: false, error: 'Demo mode — cannot deploy GE-Lua hook from browser' }),
  luaConsoleUndeploy: async () => ({ success: true }),
  luaConsoleIsDeployed: async () => false,
  luaConsoleIsConnected: async () => false,
  luaConsoleExecute: async () => ({ success: false }),
  luaConsoleInspect: async () => ({ success: false }),
  luaConsoleSetScope: async () => ({ success: true }),
  luaConsoleClear: async () => ({ success: true }),
  luaConsoleComplete: async () => ({ success: false }),
  luaConsoleTree: async () => ({ success: false }),
  luaConsoleQuery: async () => ({ success: false }),
  luaConsoleReload: async () => ({ success: false }),
  onLuaConsoleResult: noop,
  onLuaConsoleLog: noop,
  onLuaConsoleConnection: noop,

  // BeamNG UI Files — sandboxed in-memory virtual filesystem for the demo
  beamUIListRoots: async () => ({
    roots: [
      { id: 'userUi', label: 'User UI (demo sandbox)', path: '~/AppData/Local/BeamNG.drive/0.32/ui', kind: 'userUi' as const, writable: true }
    ],
    resolvedUserDir: '~/AppData/Local/BeamNG.drive/0.32',
    resolvedInstallDir: 'C:/Program Files (x86)/Steam/steamapps/common/BeamNG.drive'
  }),
  beamUIListDir: async (payload: { rootId: string; subPath: string }) =>
    resolveDir(payload.rootId, payload.subPath).map((e) => ({
      name: e.name, isDirectory: e.isDirectory, size: e.size, modifiedMs: e.modifiedMs
    })),
  beamUIReadFile: async (payload: { rootId: string; subPath: string }) => {
    const file = findFile(payload.rootId, payload.subPath)
    return file?.content ?? `// Demo file: ${payload.subPath}\n// Edits are session-only and not persisted.`
  },
  beamUIReadFileSmart: async (payload: { rootId: string; subPath: string }) => {
    const file = findFile(payload.rootId, payload.subPath)
    const content = file?.content ?? `// Demo file: ${payload.subPath}`
    return { kind: 'text' as const, content, size: content.length, truncated: false }
  },
  beamUIReadBinaryDataUrl: async () => ({ dataUrl: '', size: 0, truncated: false }),
  beamUIWriteFile: async () => ({ success: true }),
  beamUICreateFolder: async () => ({ success: true }),
  beamUIDelete: async () => ({ success: true }),
  beamUIRename: async (payload: { newName: string }) => payload.newName,
  beamUIRevealInExplorer: async () => ({ success: false }),
  beamUIListStaged: async () => [],
  beamUICommit: async () => ({ success: true }),
  beamUICommitAll: async () => ({ committed: 0 }),
  beamUIRevert: async () => ({ success: true }),
  beamUIRevertAll: async () => ({ reverted: 0 }),
  beamUIGetAutoRevert: async () => false,
  beamUISetAutoRevert: async () => ({ success: true }),
  beamUIListProjects: async () => [
    { name: 'demo-ui-mod', savedAt: Date.now() - 86400000, fileCount: 5 }
  ],
  beamUISaveProject: async () => ({ savedAt: Date.now(), fileCount: 0 }),
  beamUILoadProject: async () => ({ applied: 0, skipped: [] as string[] }),
  beamUIDeleteProject: async () => ({ success: true }),
  onBeamUIStagingChanged: noop
}
