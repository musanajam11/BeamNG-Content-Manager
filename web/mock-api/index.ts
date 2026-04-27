// Assembles all mock API modules into a single window.api object
// This is imported by the web entry point before the React app boots.

import { configMocks } from './config'
import { gameMocks } from './game'
import { serverMocks } from './servers'
import { modMocks } from './mods'
import { liveryMocks } from './livery'
import { luaConsoleMocks } from './lua-console'
import { voiceMocks } from './voice'
import { worldEditMocks } from './world-edit'

const mockApi = {
  ...configMocks,
  ...gameMocks,
  ...serverMocks,
  ...modMocks,
  ...liveryMocks,
  ...luaConsoleMocks,
  ...voiceMocks,
  ...worldEditMocks
}

// Install onto window so the renderer code's window.api.* calls work
;(window as any).api = mockApi
// Provide a minimal window.electron stub so env checks don't crash
;(window as any).electron = { process: { platform: 'browser' }, ipcRenderer: { on: () => {}, send: () => {}, invoke: async () => {} } }

console.log(
  '%c🎮 BeamMP Content Manager — Web Demo Mode',
  'color: #f97316; font-size: 14px; font-weight: bold;'
)
console.log(
  '%cAll data is simulated. Download the real app for full functionality.',
  'color: #64748b; font-size: 12px;'
)

export { mockApi }
