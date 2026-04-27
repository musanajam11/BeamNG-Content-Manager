// Demo data used by the mock API layer for the web demo build.
// Contains realistic sample data for servers, mods, vehicles, maps, etc.

import type { ServerInfo, ModInfo, AppConfig } from '../../src/shared/types'

export const DEMO_CONFIG: AppConfig = {
  gamePaths: {
    installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BeamNG.drive',
    userDir: 'C:\\Users\\Demo\\AppData\\Local\\BeamNG.drive\\0.32',
    executable: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\BeamNG.drive\\Bin64\\BeamNG.drive.x64.exe',
    gameVersion: '0.32.5.0',
    isProton: false
  },
  backendUrl: 'https://backend.beammp.com',
  authUrl: 'https://auth.beammp.com',
  useOfficialBackend: true,
  launcherPort: 23693,
  theme: 'dark',
  language: 'en',
  appearance: {
    accentColor: '#f97316',
    uiScale: 1.1,
    fontSize: 16,
    backgroundStyle: 'default',
    surfaceOpacity: 1.0,
    borderOpacity: 1.0,
    enableBlur: true,
    bgGradient1: null,
    bgGradient2: null,
    sidebarWidth: 200,
    bgImagePath: null,
    bgImageBlur: 0,
    bgImageOpacity: 0.3,
    bgImageList: [],
    bgCycleOnLaunch: false,
    sidebarOrder: ['home', 'servers', 'friends', 'vehicles', 'maps', 'mods', 'career', 'server-admin', 'launcher', 'controls', 'live-gps'],
    sidebarHidden: [],
    customCSS: '',
    customCSSEnabled: false
  },
  setupComplete: true,
  loadOrderEnforcement: false,
  defaultPorts: '30814',
  careerSavePath: null,
  customServerExe: null,
  renderer: 'dx11'
}

export const DEMO_SERVERS: ServerInfo[] = [
  {
    ident: '1.2.3.4:30814',
    sname: 'Freeroam | West Coast USA | No Rules',
    ip: '1.2.3.4',
    port: '30814',
    players: '18',
    maxplayers: '32',
    map: '/levels/west_coast_usa/info.json',
    sdesc: 'Free roam server on West Coast USA. All vehicles welcome!',
    version: '3.5.1',
    cversion: '0.32',
    tags: 'Freeroam,Casual',
    owner: 'ServerHost123',
    official: false,
    featured: true,
    partner: false,
    password: false,
    guests: true,
    location: 'US',
    modlist: '',
    modstotalsize: '0',
    modstotal: '0',
    playerslist: '',
    worldEditPort: null
  },
  {
    ident: '5.6.7.8:30814',
    sname: '[EU] Drift Paradise | Custom Map',
    ip: '5.6.7.8',
    port: '30814',
    players: '12',
    maxplayers: '24',
    map: '/levels/drift_playground/info.json',
    sdesc: 'Dedicated drift server with custom track!',
    version: '3.5.1',
    cversion: '0.32',
    tags: 'Drift,Racing',
    owner: 'DriftMaster',
    official: false,
    featured: false,
    partner: true,
    password: false,
    guests: true,
    location: 'DE',
    modlist: 'drift_playground.zip',
    modstotalsize: '52428800',
    modstotal: '1',
    playerslist: '',
    worldEditPort: null
  },
  {
    ident: '10.0.0.1:30814',
    sname: 'Official BeamMP Freeroam',
    ip: '10.0.0.1',
    port: '30814',
    players: '28',
    maxplayers: '50',
    map: '/levels/east_coast_usa/info.json',
    sdesc: 'Official BeamMP community server. Be respectful!',
    version: '3.5.1',
    cversion: '0.32',
    tags: 'Official,Freeroam',
    owner: 'BeamMP',
    official: true,
    featured: true,
    partner: false,
    password: false,
    guests: true,
    location: 'US',
    modlist: '',
    modstotalsize: '0',
    modstotal: '0',
    playerslist: '',
    worldEditPort: null
  },
  {
    ident: '192.168.1.1:30814',
    sname: '[AU] Outback Racing | Johnson Valley',
    ip: '192.168.1.1',
    port: '30814',
    players: '6',
    maxplayers: '16',
    map: '/levels/johnson_valley/info.json',
    sdesc: 'Off-road racing in the desert!',
    version: '3.5.1',
    cversion: '0.32',
    tags: 'Racing,Offroad',
    owner: 'OutbackRacer',
    official: false,
    featured: false,
    partner: false,
    password: false,
    guests: true,
    location: 'AU',
    modlist: '',
    modstotalsize: '0',
    modstotal: '0',
    playerslist: '',
    worldEditPort: null
  },
  {
    ident: '172.16.0.1:30815',
    sname: 'Private Track Day | Password Required',
    ip: '172.16.0.1',
    port: '30815',
    players: '4',
    maxplayers: '8',
    map: '/levels/smallgrid/info.json',
    sdesc: 'Private track day. Ask in Discord for password.',
    version: '3.5.1',
    cversion: '0.32',
    tags: 'Racing,Private',
    owner: 'TrackDayOrg',
    official: false,
    featured: false,
    partner: false,
    password: true,
    guests: false,
    location: 'GB',
    modlist: '',
    modstotalsize: '0',
    modstotal: '0',
    playerslist: '',
    worldEditPort: null
  }
]

export const DEMO_MODS: ModInfo[] = [
  {
    key: 'cherrier_vivace',
    fileName: 'cherrier_vivace.zip',
    filePath: '/mods/repo/cherrier_vivace.zip',
    sizeBytes: 45_000_000,
    modifiedDate: '2026-03-15T10:00:00Z',
    enabled: true,
    modType: 'vehicle',
    title: 'Cherrier Vivace Track Edition',
    tagLine: 'High-performance track variant of the Vivace',
    author: 'BeamNG',
    version: '1.2.0',
    previewImage: null,
    location: 'repo',
    resourceId: 12345,
    multiplayerScope: 'client',
    loadOrder: 0,
    levelDir: null
  },
  {
    key: 'pike_peak_map',
    fileName: 'pike_peak_map.zip',
    filePath: '/mods/repo/pike_peak_map.zip',
    sizeBytes: 128_000_000,
    modifiedDate: '2026-02-20T14:30:00Z',
    enabled: true,
    modType: 'terrain',
    title: 'Pikes Peak Hill Climb',
    tagLine: 'Full recreation of the famous hill climb course',
    author: 'MapMakerPro',
    version: '2.1.0',
    previewImage: null,
    location: 'repo',
    resourceId: 67890,
    multiplayerScope: 'both',
    loadOrder: 1,
    levelDir: 'pike_peak'
  },
  {
    key: 'drift_tires',
    fileName: 'drift_tires.zip',
    filePath: '/mods/repo/drift_tires.zip',
    sizeBytes: 2_500_000,
    modifiedDate: '2026-01-10T08:15:00Z',
    enabled: true,
    modType: 'vehicle',
    title: 'Ultimate Drift Tires Pack',
    tagLine: 'Low-grip tires for all vehicles',
    author: 'DriftMod',
    version: '3.0.1',
    previewImage: null,
    location: 'repo',
    resourceId: 11111,
    multiplayerScope: 'client',
    loadOrder: 2,
    levelDir: null
  },
  {
    key: 'nurburgring',
    fileName: 'nurburgring.zip',
    filePath: '/mods/repo/nurburgring.zip',
    sizeBytes: 256_000_000,
    modifiedDate: '2026-03-01T12:00:00Z',
    enabled: false,
    modType: 'terrain',
    title: 'Nürburgring Nordschleife',
    tagLine: 'Full Nordschleife with pit lane',
    author: 'TrackTeam',
    version: '1.8.5',
    previewImage: null,
    location: 'repo',
    resourceId: 22222,
    multiplayerScope: 'both',
    loadOrder: 3,
    levelDir: 'nurburgring'
  },
  {
    key: 'mp_server_mod',
    fileName: 'mp_server_mod.zip',
    filePath: '/mods/multiplayer/mp_server_mod.zip',
    sizeBytes: 15_000_000,
    modifiedDate: '2026-03-20T09:00:00Z',
    enabled: true,
    modType: 'vehicle',
    title: 'Server Required Mod Pack',
    tagLine: 'Required mod for Example Server',
    author: 'ServerOwner',
    version: '1.0.0',
    previewImage: null,
    location: 'multiplayer',
    resourceId: null,
    multiplayerScope: 'both',
    loadOrder: 4,
    levelDir: null
  }
]

export const DEMO_VEHICLES = [
  { name: 'sunburst', displayName: 'Hirochi Sunburst', brand: 'Hirochi', type: 'Car', bodyStyle: 'Sedan', country: 'JP', source: 'stock' as const, configCount: 12 },
  { name: 'etk800', displayName: 'ETK 800-Series', brand: 'ETK', type: 'Car', bodyStyle: 'Sedan', country: 'DE', source: 'stock' as const, configCount: 18 },
  { name: 'covet', displayName: 'Ibishu Covet', brand: 'Ibishu', type: 'Car', bodyStyle: 'Hatchback', country: 'JP', source: 'stock' as const, configCount: 15 },
  { name: 'pickup', displayName: 'Gavril D-Series', brand: 'Gavril', type: 'Truck', bodyStyle: 'Pickup', country: 'US', source: 'stock' as const, configCount: 24 },
  { name: 'van', displayName: 'Gavril H-Series', brand: 'Gavril', type: 'Truck', bodyStyle: 'Van', country: 'US', source: 'stock' as const, configCount: 8 },
  { name: 'bolide', displayName: 'Civetta Bolide', brand: 'Civetta', type: 'Car', bodyStyle: 'Sports', country: 'IT', source: 'stock' as const, configCount: 10 },
  { name: 'barstow', displayName: 'Gavril Barstow', brand: 'Gavril', type: 'Car', bodyStyle: 'Muscle', country: 'US', source: 'stock' as const, configCount: 14 },
  { name: 'moonhawk', displayName: 'Bruckell Moonhawk', brand: 'Bruckell', type: 'Car', bodyStyle: 'Muscle', country: 'US', source: 'stock' as const, configCount: 9 },
  { name: 'pessima', displayName: 'Ibishu Pessima', brand: 'Ibishu', type: 'Car', bodyStyle: 'Sedan', country: 'JP', source: 'stock' as const, configCount: 11 },
  { name: 'pigeon', displayName: 'Ibishu Pigeon', brand: 'Ibishu', type: 'Car', bodyStyle: 'Kei', country: 'JP', source: 'stock' as const, configCount: 6 },
  { name: 'wendover', displayName: 'Bruckell Wendover', brand: 'Bruckell', type: 'Car', bodyStyle: 'Sedan', country: 'US', source: 'stock' as const, configCount: 13 },
  { name: 'legran', displayName: 'Bruckell LeGran', brand: 'Bruckell', type: 'Car', bodyStyle: 'Sedan', country: 'US', source: 'stock' as const, configCount: 16 }
]

export const DEMO_MAPS = [
  { name: 'west_coast_usa', source: 'stock' as const },
  { name: 'east_coast_usa', source: 'stock' as const },
  { name: 'italy', source: 'stock' as const },
  { name: 'utah', source: 'stock' as const },
  { name: 'jungle_rock_island', source: 'stock' as const },
  { name: 'industrial', source: 'stock' as const },
  { name: 'gridmap_v2', source: 'stock' as const },
  { name: 'smallgrid', source: 'stock' as const },
  { name: 'johnson_valley', source: 'stock' as const },
  { name: 'driver_training', source: 'stock' as const },
  { name: 'pike_peak', source: 'mod' as const, modZipPath: '/mods/repo/pike_peak_map.zip' }
]

export const DEMO_HOSTED_SERVERS = [
  {
    config: {
      id: 'demo-server-1',
      name: 'My Drift Server',
      port: 30814,
      authKey: 'AUTH-XXXX-XXXX-XXXX-XXXX',
      maxPlayers: 16,
      maxCars: 1,
      map: '/levels/drift_playground/info.json',
      private: false,
      description: 'My personal drift server (demo)',
      resourceFolder: 'C:/BeamMP-Server/demo-server-1/Resources',
      tags: 'Drift,Casual',
      allowGuests: true,
      logChat: true,
      debug: false,
      clientContentGate: false
    },
    status: {
      id: 'demo-server-1',
      state: 'running' as const,
      pid: 1234,
      uptimeMs: 1000 * 60 * 47,
      startedAt: Date.now() - 1000 * 60 * 47,
      players: 4,
      error: null,
      memoryBytes: 384 * 1024 * 1024,
      cpuPercent: 6.4,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024
    }
  },
  {
    config: {
      id: 'demo-server-2',
      name: 'Track Day Practice',
      port: 30815,
      authKey: 'AUTH-XXXX-XXXX-XXXX-XXXX',
      maxPlayers: 8,
      maxCars: 2,
      map: '/levels/hirochi_raceway/info.json',
      private: true,
      description: 'Private track day server',
      resourceFolder: 'C:/BeamMP-Server/demo-server-2/Resources',
      tags: 'Racing,Private',
      allowGuests: false,
      logChat: true,
      debug: false,
      clientContentGate: true
    },
    status: {
      id: 'demo-server-2',
      state: 'stopped' as const,
      pid: null,
      uptimeMs: 0,
      startedAt: null,
      players: 0,
      error: null,
      memoryBytes: 0,
      cpuPercent: 0,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024
    }
  }
]

export const DEMO_GPS_TELEMETRY = {
  vehicleId: 'sunburst',
  pos: [123.4, 56.7, 12.3] as [number, number, number],
  rot: [0, 0, 0, 1] as [number, number, number, number],
  velocity: [12.0, 0.4, 0.0] as [number, number, number],
  speedKmh: 73,
  rpm: 4200,
  gear: 4,
  fuel: 0.62,
  damage: 0.04,
  serverIdent: '1.2.3.4:30814',
  timestamp: Date.now()
}

export const DEMO_REGISTRY_REPOS = [
  { id: 'official', name: 'Official BeamMP Registry', url: 'https://registry.beammp.com', enabled: true, priority: 100 },
  { id: 'community', name: 'Community Registry', url: 'https://community.beammp-mods.com', enabled: true, priority: 50 }
]

export const DEMO_REGISTRY_INSTALLED = {
  'demo:drift-tires': { identifier: 'demo:drift-tires', version: '3.0.1', installedAt: Date.now() - 86400000 * 7, installedFiles: ['mods/repo/drift_tires.zip'], source: 'community', autoInstalled: false },
  'demo:pikes-peak': { identifier: 'demo:pikes-peak', version: '2.1.0', installedAt: Date.now() - 86400000 * 14, installedFiles: ['mods/repo/pike_peak_map.zip'], source: 'official', autoInstalled: false }
}

export const DEMO_NEWS = [
  {
    id: 'steam-1',
    source: 'steam' as const,
    title: 'BeamNG.drive v0.32.5 — New Vehicle & Physics Improvements',
    url: 'https://store.steampowered.com/news/app/284160',
    date: Date.now() - 86400000 * 2,
    summary: 'This update brings a brand new vehicle, the Bruckell Bastion, along with significant improvements to tire physics and suspension simulation.'
  },
  {
    id: 'beammp-1',
    source: 'beammp' as const,
    title: 'BeamMP v3.5.1 Released — Stability Fixes',
    url: 'https://beammp.com/news',
    date: Date.now() - 86400000 * 5,
    summary: 'Hotfix release addressing connection stability issues and improving mod synchronization speed for large mod packs.'
  },
  {
    id: 'steam-2',
    source: 'steam' as const,
    title: 'Community Spotlight: Best Mods of March 2026',
    url: 'https://store.steampowered.com/news/app/284160',
    date: Date.now() - 86400000 * 10,
    summary: 'Check out the community\'s top rated mods this month, including incredible new maps, vehicles, and gameplay modifications.'
  },
  {
    id: 'beammp-2',
    source: 'beammp' as const,
    title: 'BeamMP Server Update: New Admin Tools',
    url: 'https://beammp.com/news',
    date: Date.now() - 86400000 * 14,
    summary: 'Server owners now have access to enhanced administration tools including player analytics, scheduled restarts, and improved mod management.'
  }
]
