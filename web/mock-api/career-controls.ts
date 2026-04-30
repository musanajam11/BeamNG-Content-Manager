// Career mode mock — placeholder data so the Career page renders. All
// mutations return demo-mode failures.

const fail = (msg = 'Demo mode — career features require the desktop app.'):
  { success: false; error: string } => ({ success: false, error: msg })

export const careerMocks = {
  careerListProfiles: async () => [],
  careerGetSlotMetadata: async (): Promise<null> => null,
  careerGetProfileSummary: async (): Promise<null> => null,
  careerDeployProfile: async () => fail(),
  careerUndeployProfile: async () => fail(),

  careerBackupSlot: async () => fail(),
  careerBackupProfile: async () => fail(),
  careerListProfileBackups: async () => [],
  careerRestoreProfileBackup: async () => fail(),
  careerDeleteProfileBackup: async () => fail(),

  careerInstallCareerMP: async () => fail(),
  careerInstallRLS: async () => fail(),
  careerInstallBetterCareerCompat: async () => fail(),
  careerInstallRLSGreatRebalance: async () => fail(),
  careerUninstallCareerMP: async () => fail(),
  careerUninstallRLS: async () => fail(),
  careerCheckInstalled: async () => ({ careerMP: false, rls: false }),

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
