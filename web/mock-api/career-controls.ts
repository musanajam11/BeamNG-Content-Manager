// Career mode mock — placeholder data so the Career page renders. All
// mutations return demo-mode failures.

const fail = (msg = 'Demo mode — career features require the desktop app.'):
  { success: false; error: string } => ({ success: false, error: msg })

export const careerMocks = {
  // Path & profile listing
  careerGetSavePath: async (): Promise<string> => '',
  careerBrowseSavePath: async (): Promise<string | null> => null,
  careerSetSavePath: async (): Promise<void> => {},
  careerListProfiles: async () => [],
  careerGetSlotMetadata: async (): Promise<null> => null,
  careerGetProfileSummary: async (): Promise<null> => null,
  careerDeployProfile: async () => fail(),
  careerUndeployProfile: async () => fail(),
  careerDeleteProfile: async () => fail(),
  careerDeleteSlot: async () => fail(),
  careerGetLog: async (): Promise<string[]> => [],

  // Backups
  careerBackupSlot: async () => fail(),
  careerBackupProfile: async () => fail(),
  careerListProfileBackups: async () => [],
  careerRestoreProfileBackup: async () => fail(),
  careerDeleteProfileBackup: async () => fail(),

  // CareerMP / RLS / BetterCareer install — return [] for fetches so the
  // page's `releases.length` checks work; mutations all fail in demo mode.
  careerFetchCareerMPReleases: async () => [],
  careerFetchRLSReleases: async () => [],
  careerFetchBetterCareerCompatReleases: async () => [],
  careerFetchPluginReleases: async () => [],
  careerFetchGreatRebalanceRlsReleases: async () => [],
  careerFetchGreatRebalancePatchReleases: async () => [],
  careerInstallCareerMP: async () => fail(),
  careerInstallRLS: async () => fail(),
  careerInstallBetterCareerCompat: async () => fail(),
  careerInstallRLSGreatRebalance: async () => fail(),
  careerUninstallCareerMP: async () => fail(),
  careerUninstallRLS: async () => fail(),
  careerUninstallBetterCareer: async () => fail(),
  careerUninstallRLSGreatRebalance: async () => fail(),
  careerCheckInstalled: async () => ({ careerMP: false, rls: false }),

  // Per-server install state — must match InstalledCareerMods shape from
  // CareerPage.tsx (careerMP / rls / betterCareer keys, all nullable).
  careerGetServerDir: async (): Promise<string> => '',
  careerBrowseServerDir: async (): Promise<string | null> => null,
  careerGetInstalledMods: async (): Promise<{
    careerMP: null
    rls: null
    betterCareer: null
  }> => ({ careerMP: null, rls: null, betterCareer: null }),
  careerGetInstalledPlugins: async (): Promise<Record<string, never>> => ({}),

  // Python runtime status — must match the renderer's PythonRuntimeStatus
  // shape (CareerPage.tsx): { available, canAutoInstall, command?, version?, message? }.
  careerGetPythonRuntimeStatus: async (): Promise<{
    available: boolean
    canAutoInstall: boolean
    command?: 'python' | 'py'
    version?: string
    message?: string
  }> => ({
    available: false,
    canAutoInstall: false,
    message: 'Python runtime detection is unavailable in the web demo.'
  }),
  careerInstallPythonRuntime: async () => fail('Demo mode — Python runtime install requires the desktop app.'),

  careerMPGetServerConfig: async (): Promise<null> => null,
  careerMPSaveServerConfig: async () => fail(),
  careerListPluginCatalog: async () => [],
  careerInstallPlugin: async () => fail(),
  careerUninstallPlugin: async () => fail(),
  careerListInstalledPlugins: async () => [],

  dynamicTrafficGetConfig: async () => ({
    aisPerPlayer: 5,
    maxServerTraffic: 30,
    trafficGhosting: false,
    trafficSpawnWarnings: true
  }),
  dynamicTrafficSaveConfig: async () => fail()
}

export const controlsMocks = {
  controlsGetDevices: async () => [],
  controlsGetActions: async () => [],
  controlsGetCategories: async () => [],
  controlsGetBindings: async () => ({}),
  controlsSaveBindings: async () => fail(),
  controlsResetBindings: async () => fail(),
  controlsExportBindings: async () => fail(),
  controlsImportBindings: async () => fail(),
  controlsListPresets: async () => [],
  controlsLoadPreset: async () => fail(),
  controlsSavePreset: async () => fail(),
  controlsDeletePreset: async () => fail(),
  controlsRecordBinding: async (): Promise<null> => null,
  controlsCancelRecording: async (): Promise<void> => {}
}
