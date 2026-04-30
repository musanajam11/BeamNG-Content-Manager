// Assembles all mock API modules into a single window.api object
// This is imported by the web entry point before the React app boots.
//
// Any method NOT explicitly mocked here is auto-stubbed by createAutoStub
// (see ./auto-stub.ts) so the renderer can never crash on a missing API.

import { configMocks } from './config'
import { gameMocks } from './game'
import { serverMocks } from './servers'
import { modMocks } from './mods'
import { liveryMocks } from './livery'
import { luaConsoleMocks } from './lua-console'
import { voiceMocks } from './voice'
import { worldEditMocks } from './world-edit'
import { platformMocks } from './platform'
import { friendMocks } from './friends'
import { hostedServerMocks } from './hosted-server'
import { bmrMocks } from './bmr'
import { registryMocks, newsMocks } from './registry-news'
import { careerMocks, controlsMocks } from './career-controls'
import { createAutoStub } from './auto-stub'

const explicitMocks: Record<string, unknown> = {
  ...configMocks,
  ...gameMocks,
  ...serverMocks,
  ...modMocks,
  ...liveryMocks,
  ...luaConsoleMocks,
  ...voiceMocks,
  ...worldEditMocks,
  ...platformMocks,
  ...friendMocks,
  ...hostedServerMocks,
  ...bmrMocks,
  ...registryMocks,
  ...newsMocks,
  ...careerMocks,
  ...controlsMocks
}

const reportedMisses = new Set<string>()
const mockApi = createAutoStub(explicitMocks, {
  onMiss: (key) => {
    if (reportedMisses.has(key)) return
    reportedMisses.add(key)
    // eslint-disable-next-line no-console
    console.debug(`[web-demo] auto-stubbing window.api.${key}()`)
  }
})

// Install onto window so the renderer code's window.api.* calls work.
;(window as unknown as { api: unknown }).api = mockApi

// Provide a minimal window.electron stub so env checks don't crash.
;(window as unknown as { electron: unknown }).electron = {
  process: { platform: 'browser' },
  ipcRenderer: { on: () => {}, send: () => {}, invoke: async () => {} }
}

// eslint-disable-next-line no-console
console.log(
  '%c🎮 BeamMP Content Manager — Web Demo Mode',
  'color: #f97316; font-size: 14px; font-weight: bold;'
)
// eslint-disable-next-line no-console
console.log(
  '%cAll local data is simulated. Server list comes from backend.beammp.com when CORS permits.',
  'color: #64748b; font-size: 12px;'
)

export { mockApi }
