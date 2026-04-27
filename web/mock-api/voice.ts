// Mock implementations for voice chat (WebRTC relay + mesh).
// All listeners return a no-op unsubscriber so the renderer's bootstrap
// in App.tsx does not crash when the page loads in demo mode.

const noop = (): (() => void) => () => {}

export const voiceMocks = {
  // High-level voice control
  voiceEnable: async () => ({ success: false, error: 'Demo mode — microphone capture disabled' }),
  voiceDisable: async () => ({ success: true }),
  voiceSendSignal: async (): Promise<void> => {},
  voiceSendAudio: async (): Promise<void> => {},
  voiceGetState: async () => ({
    enabled: false,
    inRelay: false,
    selfId: null,
    peers: [],
    bridgeDeployed: false
  }),
  voiceUpdateSettings: async (): Promise<void> => {},
  voiceDeployBridge: async () => ({ success: false, error: 'Demo mode' }),
  voiceUndeployBridge: async () => ({ success: true }),

  // BeamMP relay-tier listeners (the ones App.tsx subscribes to)
  onVoicePeerJoined: noop,
  onVoicePeerLeft: noop,
  onVoiceSignal: noop,
  onVoiceAudio: noop,
  onVoiceRelayState: noop,
  onVoiceSelfId: noop,

  // Mesh-tier (P2P fallback)
  voiceMeshListen: async () => ({ port: 0 }),
  voiceMeshStop: async () => ({ success: true }),
  voiceMeshConnect: async () => ({ success: false, error: 'Demo mode' }),
  voiceMeshDisconnect: async () => ({ success: true }),
  voiceMeshSend: async () => false,
  onVoiceMeshData: noop,
  onVoiceMeshState: noop
}
