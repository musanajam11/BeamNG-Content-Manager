// Mock implementations for game discovery, launcher, vehicle, and map API methods

import { DEMO_VEHICLES, DEMO_MAPS } from './demo-data'

const noop = (): (() => void) => () => {}

export const gameMocks = {
  // Game Discovery
  discoverPaths: async () => ({
    installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BeamNG.drive',
    userDir: 'C:\\Users\\Demo\\AppData\\Local\\BeamNG.drive\\0.32',
    executable: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BeamNG.drive\\Bin64\\BeamNG.drive.x64.exe',
    gameVersion: '0.32.5.0',
    isProton: false
  }),
  validatePaths: async () => ({ valid: true, errors: [] }),
  setCustomPaths: async (installDir: string, userDir: string) => ({
    installDir,
    userDir,
    executable: installDir + '/Bin64/BeamNG.drive.x64.exe',
    gameVersion: '0.32.5.0',
    isProton: false
  }),

  // Game Launcher
  launchGame: async () => ({ success: false, error: 'Demo mode — game launch not available' }),
  launchVanilla: async () => ({ success: false, error: 'Demo mode — game launch not available' }),
  listMaps: async () => DEMO_MAPS,
  listVehicles: async () => DEMO_VEHICLES,
  getVehiclePreview: async (): Promise<string | null> => null,
  getVehicleDetail: async (vehicleName: string) => {
    const v = DEMO_VEHICLES.find((x) => x.name === vehicleName)
    if (!v) return null
    return {
      id: v.name,
      name: v.displayName,
      brand: v.brand,
      subModel: '',
      type: v.type,
      bodyStyle: v.bodyStyle,
      country: v.country,
      description: `The ${v.displayName} — a versatile ${v.bodyStyle.toLowerCase()} from ${v.brand}.`,
      author: 'BeamNG',
      years: { min: 2005, max: 2020 },
      source: v.source,
      defaultConfig: 'base',
      configCount: v.configCount
    }
  },
  getVehicleConfigs: async () => [
    { name: 'base', displayName: 'Base', source: 'stock' as const, power: 200, torque: 280, weight: 1450, drivetrain: 'FWD', transmission: '6-Speed Manual', topSpeed: 220, zeroToSixty: 7.2 },
    { name: 'sport', displayName: 'Sport', source: 'stock' as const, power: 310, torque: 380, weight: 1380, drivetrain: 'RWD', transmission: '6-Speed Manual', topSpeed: 265, zeroToSixty: 5.1 },
    { name: 'drift', displayName: 'Drift', source: 'user' as const, power: 420, torque: 450, weight: 1320, drivetrain: 'RWD', transmission: '6-Speed Sequential', topSpeed: 240, zeroToSixty: 4.5 }
  ],
  getVehicleConfigPreview: async (): Promise<string | null> => null,
  getVehicleConfigData: async () => ({ format: 2, model: 'sunburst', parts: {}, vars: {} }),
  saveVehicleConfig: async () => ({ success: true }),
  deleteVehicleConfig: async () => ({ success: true }),
  renameVehicleConfig: async () => ({ success: true }),
  getVehicle3DModel: async (): Promise<string[]> => [],
  getActiveVehicleMeshes: async () => ({ meshes: [], meshOwnership: {} }),
  getWheelPlacements: async () => [],
  getVehicleEditorData: async () => ({ slots: {}, variables: {} }),
  getVehicleMaterials: async () => ({}),
  getActiveGlobalSkin: async () => null,
  getVehicleDefaultPaints: async () => [],
  killGame: async (): Promise<void> => {},
  getGameStatus: async () => ({ running: false, pid: null, connectedServer: null }),
  onGameStatusChange: noop,
  joinServer: async () => ({ success: false, error: 'Demo mode' }),
  probeServer: async () => ({ online: false }),
  beammpLogin: async () => ({ success: false, error: 'Demo mode' }),
  beammpLoginAsGuest: async (): Promise<void> => {},
  beammpLogout: async (): Promise<void> => {},
  getAuthInfo: async () => ({ authenticated: false, username: 'DemoUser', guest: true }),
  getLauncherLogs: async (): Promise<string[]> => ['[Demo] Launcher not running in web demo mode'],

  // Map Preview
  getMapPreview: async (): Promise<string | null> => null,
  getMapMinimap: async () => null,
  getMapTerrainBase: async (): Promise<string | null> => null,
  getMapHeightmap: async (): Promise<string | null> => null,
  getMapTerrainInfo: async () => null,
  getMapMetadata: async () => ({
    title: 'Demo Map',
    description: 'A sample map for the web demo.',
    terrainSize: 2048
  }),
  findMapRoute: async () => []
}
