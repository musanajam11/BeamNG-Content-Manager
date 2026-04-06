/**
 * BeamNG level world-space bounding boxes.
 * Used to map (worldX, worldY) → normalised (0–1) coordinates on the map preview image.
 * Values are approximate centre ± half-extent (meters).
 */

export interface MapBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Known stock map extents — terrain grid centred at origin.
 * Each map's minimap covers exactly its terrain grid, so (minX,maxX) = (-size/2, size/2).
 * Terrain size comes from each level's .terrain.json `size` field.
 * Keys MUST be lowercase — getBounds() lowercases the lookup.
 */
const KNOWN_BOUNDS: Record<string, MapBounds> = {
  gridmap_v2:            { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  gridmap:               { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024 (legacy)
  east_coast_usa:        { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  west_coast_usa:        { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  italy:                 { minX: -2048, maxX: 2048, minY: -2048, maxY: 2048 },  // terrain 4096
  utah:                  { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  hirochi_raceway:       { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  johnson_valley:        { minX: -2048, maxX: 2048, minY: -2048, maxY: 2048 },  // terrain 4096
  jungle_rock_island:    { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  industrial:            { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024
  small_island:          { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024
  smallgrid:             { minX: -256,  maxX: 256,  minY: -256,  maxY: 256 },   // terrain 512
  automation_test_track: { minX: -2048, maxX: 2048, minY: -2048, maxY: 2048 },  // terrain 4096
  driver_training:       { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024
  derby:                 { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  cliff:                 { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 },  // terrain 2048
  autotest:              { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024
  template:              { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // terrain 1024
  glow_city:             { minX: -512,  maxX: 512,  minY: -512,  maxY: 512 },   // no terrain.json — estimate
  garage_v2:             { minX: -256,  maxX: 256,  minY: -256,  maxY: 256 },   // no terrain.json — estimate
  showroom_v2:           { minX: -256,  maxX: 256,  minY: -256,  maxY: 256 }    // no terrain.json — estimate
}

/** Default bounds for unknown maps */
const DEFAULT_BOUNDS: MapBounds = { minX: -1024, maxX: 1024, minY: -1024, maxY: 1024 }

/**
 * Extract level id from map path: "/levels/west_coast_usa/info.json" → "west_coast_usa"
 */
export function levelIdFromMap(mapPath: string): string {
  return mapPath.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\/$/, '')
}

/** Get bounds for a level (by id or full map path) — case-insensitive */
export function getBounds(mapPathOrId: string): MapBounds {
  const id = mapPathOrId.includes('/') ? levelIdFromMap(mapPathOrId) : mapPathOrId
  return KNOWN_BOUNDS[id.toLowerCase()] ?? DEFAULT_BOUNDS
}

/**
 * Convert BeamNG world position to normalised 0–1 coordinates on the map plane.
 * Returns { nx, ny } where (0,0) = bottom-left, (1,1) = top-right.
 */
export function worldToNorm(
  worldX: number,
  worldY: number,
  bounds: MapBounds
): { nx: number; ny: number } {
  const nx = (worldX - bounds.minX) / (bounds.maxX - bounds.minX)
  const ny = (worldY - bounds.minY) / (bounds.maxY - bounds.minY)
  return { nx, ny }
}

/**
 * Convert normalised (0–1) map coordinate back to world position.
 */
export function normToWorld(
  nx: number,
  ny: number,
  bounds: MapBounds
): { x: number; y: number } {
  const x = bounds.minX + nx * (bounds.maxX - bounds.minX)
  const y = bounds.minY + ny * (bounds.maxY - bounds.minY)
  return { x, y }
}
