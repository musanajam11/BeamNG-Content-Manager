// Mock implementations for World Editor Sync (deploy / status / session / save).

const noop = (): (() => void) => () => {}

const DEMO_SESSION_STATUS = {
  active: false,
  role: null as 'host' | 'joiner' | null,
  host: null as string | null,
  port: null as number | null,
  level: null as string | null,
  authMode: 'open' as const,
  selfId: null as string | null,
  selfDisplayName: null as string | null,
  peers: [] as Array<{
    authorId: string
    displayName: string
    beamUsername: string | null
    role: 'host' | 'joiner'
    state: 'connected' | 'pending' | 'rejected'
  }>,
  pendingApprovals: [] as Array<{ authorId: string; displayName: string; remote: string }>,
  capabilities: { tier4: { reflectiveFields: false, fullSnapshot: false, modInventory: false, terrainForest: false } }
}

export const worldEditMocks = {
  // Deploy / runtime
  worldEditDeploy: async () => ({ success: false, error: 'Demo mode — extension files not deployable in browser' }),
  worldEditUndeploy: async () => ({ success: true }),
  worldEditIsDeployed: async () => false,
  worldEditSignal: async () => ({ success: false, error: 'Demo mode' }),
  worldEditGetStatus: async () => null,
  worldEditReadCapture: async () => ({ entries: [], total: 0 }),
  worldEditListProjects: async () => [
    { name: 'demo-project', path: '/demo/world-edit/demo-project.zip', levelPath: '/levels/west_coast_usa', savedAt: Date.now() - 86400000, fileCount: 12 }
  ],
  worldEditSaveProject: async () => ({ success: false, error: 'Demo mode' }),
  worldEditLoadProject: async () => ({ success: false, error: 'Demo mode' }),
  worldEditDeleteProject: async () => ({ success: false, error: 'Demo mode' }),

  // Sessions
  worldEditSessionGetStatus: async () => ({ ...DEMO_SESSION_STATUS }),
  worldEditSessionHost: async () => ({ success: false, error: 'Demo mode — cannot host from browser' }),
  worldEditSessionJoin: async () => ({ success: false, error: 'Demo mode' }),
  worldEditSessionDecodeCode: async (code: string) => ({ ok: false, error: `Demo mode — cannot decode "${code}"` }),
  worldEditSessionHostAndLaunch: async () => ({ success: false, error: 'Demo mode' }),
  worldEditSessionJoinCodeAndLaunch: async () => ({ success: false, error: 'Demo mode' }),
  worldEditSessionApprovePeer: async () => ({ success: true }),
  worldEditSessionRejectPeer: async () => ({ success: true }),
  worldEditSessionSetAuthMode: async () => ({ success: true }),
  worldEditSessionSetFriendsWhitelist: async () => ({ success: true }),
  worldEditSessionSetAdvertiseHost: async () => ({ success: true }),
  worldEditSessionGetHostAddresses: async () => [
    { kind: 'lan' as const, address: '192.168.1.42', label: 'LAN — Wi-Fi', recommended: true },
    { kind: 'loopback' as const, address: '127.0.0.1', label: 'Loopback (same PC)', recommended: false }
  ],
  worldEditSessionLeave: async () => ({ success: true }),
  worldEditSessionUndo: async () => ({ ok: false, reason: 'no-session' as const }),
  worldEditSessionRedo: async () => ({ ok: false, reason: 'no-session' as const }),
  worldEditSessionUndoDepths: async () => ({ undo: 0, redo: 0 }),
  worldEditSessionLaunchIntoEditor: async () => ({ success: false, error: 'Demo mode' }),
  worldEditSessionGetLanIps: async (): Promise<string[]> => ['192.168.1.42'],
  worldEditSessionGetPublicIp: async () => ({ ip: '203.0.113.10' }),
  worldEditSessionCheckFirewallHole: async () => ({ supported: false }),
  worldEditSessionOpenFirewallHole: async () => ({ success: false, error: 'Demo mode' }),
  worldEditSessionTestReachability: async () => ({ success: false, error: 'Demo mode' }),

  // World save (.world container)
  worldSaveSave: async () => ({ success: false as const, error: 'Demo mode' }),
  worldSaveInspect: async () => ({ success: false as const, error: 'Demo mode' }),
  worldSaveLoad: async () => ({ success: false as const, error: 'Demo mode' }),
  worldSaveConvertProjectToWorld: async () => ({ success: false as const, error: 'Demo mode' }),
  worldSaveConvertWorldToProject: async () => ({ success: false as const, error: 'Demo mode' }),

  // Coop project handoff
  worldEditSessionSetActiveProject: async () => ({ success: true, project: null }),
  worldEditSessionClearActiveProject: async () => ({ success: true }),
  worldEditSessionDownloadOfferedProject: async () => ({ success: false, error: 'Demo mode' }),

  // Listeners (all noop unsubscribers)
  onWorldEditSessionStatus: noop,
  onWorldEditSessionOp: noop,
  onWorldEditSessionLog: noop,
  onWorldEditSessionPeerPose: noop,
  onWorldEditSessionPeerActivity: noop,
  onWorldEditSessionPeerPendingApproval: noop,
  onWorldEditSessionLevelRequired: noop,
  onWorldEditSessionProjectOffered: noop
}
