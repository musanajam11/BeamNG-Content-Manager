const FLAGS: Record<string, string> = {
  US: '\u{1F1FA}\u{1F1F8}', GB: '\u{1F1EC}\u{1F1E7}', DE: '\u{1F1E9}\u{1F1EA}', FR: '\u{1F1EB}\u{1F1F7}',
  CA: '\u{1F1E8}\u{1F1E6}', AU: '\u{1F1E6}\u{1F1FA}', BR: '\u{1F1E7}\u{1F1F7}', JP: '\u{1F1EF}\u{1F1F5}',
  RU: '\u{1F1F7}\u{1F1FA}', PL: '\u{1F1F5}\u{1F1F1}', NL: '\u{1F1F3}\u{1F1F1}', FI: '\u{1F1EB}\u{1F1EE}',
  SE: '\u{1F1F8}\u{1F1EA}', NO: '\u{1F1F3}\u{1F1F4}', DK: '\u{1F1E9}\u{1F1F0}', IT: '\u{1F1EE}\u{1F1F9}',
  ES: '\u{1F1EA}\u{1F1F8}', PT: '\u{1F1F5}\u{1F1F9}', TR: '\u{1F1F9}\u{1F1F7}', IN: '\u{1F1EE}\u{1F1F3}',
  KR: '\u{1F1F0}\u{1F1F7}', CN: '\u{1F1E8}\u{1F1F3}', MX: '\u{1F1F2}\u{1F1FD}', AR: '\u{1F1E6}\u{1F1F7}',
  CL: '\u{1F1E8}\u{1F1F1}', ZA: '\u{1F1FF}\u{1F1E6}', SG: '\u{1F1F8}\u{1F1EC}', HK: '\u{1F1ED}\u{1F1F0}',
  TW: '\u{1F1F9}\u{1F1FC}', AT: '\u{1F1E6}\u{1F1F9}', CH: '\u{1F1E8}\u{1F1ED}', BE: '\u{1F1E7}\u{1F1EA}',
  CZ: '\u{1F1E8}\u{1F1FF}', RO: '\u{1F1F7}\u{1F1F4}', HU: '\u{1F1ED}\u{1F1FA}', UA: '\u{1F1FA}\u{1F1E6}',
  GR: '\u{1F1EC}\u{1F1F7}', IE: '\u{1F1EE}\u{1F1EA}', NZ: '\u{1F1F3}\u{1F1FF}', PH: '\u{1F1F5}\u{1F1ED}',
  TH: '\u{1F1F9}\u{1F1ED}', MY: '\u{1F1F2}\u{1F1FE}', ID: '\u{1F1EE}\u{1F1E9}', VN: '\u{1F1FB}\u{1F1F3}',
  CO: '\u{1F1E8}\u{1F1F4}', PE: '\u{1F1F5}\u{1F1EA}', EG: '\u{1F1EA}\u{1F1EC}', IL: '\u{1F1EE}\u{1F1F1}',
  SA: '\u{1F1F8}\u{1F1E6}', AE: '\u{1F1E6}\u{1F1EA}', BG: '\u{1F1E7}\u{1F1EC}', HR: '\u{1F1ED}\u{1F1F7}',
  SK: '\u{1F1F8}\u{1F1F0}', SI: '\u{1F1F8}\u{1F1EE}', LT: '\u{1F1F1}\u{1F1F9}', LV: '\u{1F1F1}\u{1F1FB}',
  EE: '\u{1F1EA}\u{1F1EA}', RS: '\u{1F1F7}\u{1F1F8}'
}

export function countryFlag(code: string): string {
  if (!code) return '\u{1F310}'
  return FLAGS[code.toUpperCase()] || '\u{1F310}'
}

/** Returns a CDN URL for a high-quality flag image (40px wide PNG) */
export function flagImageUrl(code: string): string | null {
  if (!code) return null
  const lower = code.toLowerCase()
  // flagcdn.com serves free flag images — widely used, reliable
  return `https://flagcdn.com/w40/${lower}.png`
}

/** Known BeamNG.drive map display names (keys must be lowercase) */
const MAP_NAMES: Record<string, string> = {
  gridmap_v2: 'Grid Map',
  gridmap: 'Grid Map (legacy)',
  west_coast_usa: 'West Coast USA',
  east_coast_usa: 'East Coast USA',
  utah: 'Utah',
  italy: 'Italy',
  industrial: 'Industrial',
  jungle_rock_island: 'Jungle Rock Island',
  small_island: 'Small Island',
  hirochi_raceway: 'Hirochi Raceway',
  derby: 'Derby Arena',
  driver_training: 'Driver Training',
  automation_test_track: 'Automation Test Track',
  johnson_valley: 'Johnson Valley',
  east_coast_usa_v2: 'East Coast USA v2',
  cliff: 'Cliff',
  autotest: 'Auto Test',
  glow_city: 'Glow City',
  garage_v2: 'Garage',
  showroom_v2: 'Showroom',
  smallgrid: 'Small Grid',
  template: 'Template',
  port: 'Port',
  garage: 'Garage',
}

export function cleanMapName(map: string): string {
  const id = map.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
  return MAP_NAMES[id.toLowerCase()] || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Extracts the level directory name from a server map path */
export function mapLevelId(map: string): string {
  return map.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
}
