// Hosted server mock — exposes a single read-only sample server that
// renders the management UI without exploding. Mutations are no-ops.

const DEMO_SERVER = {
  id: 'demo-srv-1',
  name: 'My Demo Server',
  description: 'Example hosted server visible only in the web demo.',
  port: 30814,
  map: '/levels/west_coast_usa/info.json',
  maxPlayers: 16,
  authKey: 'XXXX-DEMO-XXXX',
  privateMode: false,
  password: '',
  tags: 'Freeroam,Demo',
  createdAt: Date.now() - 86_400_000 * 3,
  updatedAt: Date.now() - 3_600_000,
  installDir: 'C:/Demo/BeamMPServer',
  version: '3.5.1',
  bind: '0.0.0.0',
  customImage: null as string | null
}

const DEMO_STATUS = {
  id: DEMO_SERVER.id,
  running: false,
  pid: null as number | null,
  uptime: 0,
  cpu: 0,
  memBytes: 0,
  playerCount: 0,
  lastStartedAt: null as number | null,
  lastError: null as string | null
}

const ok = <T,>(v: T): { success: true; data: T } => ({ success: true, data: v })
const fail = (msg = 'Demo mode'): { success: false; error: string } => ({ success: false, error: msg })

const noop = (): (() => void) => () => {}

export const hostedServerMocks = {
  hostedServerList: async () => ok([DEMO_SERVER]),
  hostedServerCreate: async () => fail('Creating hosted servers requires the desktop app.'),
  hostedServerUpdate: async () => fail(),
  hostedServerDelete: async () => fail(),
  hostedServerStart: async () => fail('Cannot launch a real server from the web demo.'),
  hostedServerStop: async () => fail(),
  hostedServerRestart: async () => fail(),

  hostedServerGetExeStatus: async () => ({ installed: false, path: null, version: null }),
  hostedServerDownloadExe: async () => fail(),
  hostedServerInstallExe: async () => fail(),
  hostedServerBrowseExe: async (): Promise<string | null> => null,

  hostedServerGetConsole: async (): Promise<string[]> => [
    '[INFO] BeamMP server starting (demo)…',
    '[INFO] Listening on 0.0.0.0:30814',
    '[INFO] Map: /levels/west_coast_usa/info.json',
    '[INFO] Server is in DEMO mode — no real players connected.'
  ],
  hostedServerSendCommand: async () => fail(),
  onHostedServerConsole: noop,
  onHostedServerStatusChange: noop,
  onHostedServerExeStatus: noop,

  hostedServerListFiles: async () => ok([
    { name: 'ServerConfig.toml', isDirectory: false, size: 1024, modifiedAt: Date.now() },
    { name: 'Resources', isDirectory: true, size: 0, modifiedAt: Date.now() },
    { name: 'logs', isDirectory: true, size: 0, modifiedAt: Date.now() }
  ]),
  hostedServerSearchFiles: async () => ok([]),
  hostedServerReadFile: async () => fail(),
  hostedServerWriteFile: async () => fail(),
  hostedServerExtractZip: async () => fail(),
  hostedServerDeleteFile: async () => fail(),
  hostedServerCreateFolder: async () => fail(),
  hostedServerCopyMod: async () => fail(),
  hostedServerAddFiles: async () => fail(),
  hostedServerRenameFile: async () => fail(),
  hostedServerDuplicateFile: async () => fail(),
  hostedServerZipEntry: async () => fail(),
  hostedServerRevealInExplorer: async () => fail(),
  hostedServerOpenEntry: async () => fail(),
  hostedServerDownloadEntry: async () => fail(),
  hostedServerUploadFiles: async () => fail(),
  hostedServerTestPort: async () => ({ available: true }),
  hostedServerSaveCustomImage: async () => fail(),
  hostedServerRemoveCustomImage: async () => fail(),
  hostedServerGetCustomImage: async (): Promise<string | null> => null,
  hostedServerGetRoutes: async () => ok([]),
  hostedServerSaveRoute: async () => fail(),
  hostedServerDeleteRoute: async () => fail(),
  hostedServerGetPlayerPositions: async () => ok([]),
  hostedServerDeployTracker: async () => fail(),
  hostedServerIsTrackerDeployed: async (): Promise<boolean> => false,
  hostedServerUndeployTracker: async () => fail(),
  hostedServerDeployVoicePlugin: async () => fail(),
  hostedServerIsVoicePluginDeployed: async (): Promise<boolean> => false,
  hostedServerUndeployVoicePlugin: async () => fail(),
  hostedServerGetModLoadOrder: async () => ok([]),
  hostedServerSetModLoadOrder: async () => fail(),
  hostedServerGetSchedule: async () => ok({ tasks: [] }),
  hostedServerSaveSchedule: async () => fail(),
  hostedServerDeployedMods: async () => ok([]),
  hostedServerUndeployMod: async () => fail(),
  hostedServerGetServersWithMod: async () => ok([]),

  hostedServerGetModGateConfig: async () => ({
    exists: false,
    config: null
  }),
  hostedServerSaveModGateConfig: async () => fail(),
  hostedServerGetModGateVehiclePreview: async (): Promise<string | null> => null,

  hostedServerListSupportTickets: async () => ok([]),
  hostedServerCreateSupportTicket: async () => fail(),
  hostedServerUpdateSupportTicket: async () => fail(),
  hostedServerDeleteSupportTicket: async () => fail(),
  hostedServerGetSupportIngestStatus: async () => ({
    running: false,
    config: { enabled: false, ingestPath: '', pollIntervalMs: 5000 }
  }),
  hostedServerUpdateSupportIngestConfig: async () => fail(),
  hostedServerStartSupportIngest: async () => fail(),
  hostedServerStopSupportIngest: async () => fail(),
  hostedServerGetSupportTicketUiConfig: async () => ({
    enabled: true,
    fields: []
  }),
  hostedServerUpdateSupportTicketUiConfig: async () => fail(),
  hostedServerExportSupportSenderMod: async () => fail(),
  hostedServerDeploySupportSenderMod: async () => fail(),
  hostedServerUndeploySupportSenderMod: async () => fail(),
  hostedServerSimulateSupportTicketSubmit: async () => fail(),

  hostedServerGetAnalytics: async () => ok({
    overview: { uniquePlayers: 0, totalPlayHours: 0, peakConcurrent: 0 },
    timeseries: []
  }),
  hostedServerSetIpMeta: async () => fail(),

  __DEMO_STATUS: DEMO_STATUS // not exposed; just keeps the constant referenced
}
