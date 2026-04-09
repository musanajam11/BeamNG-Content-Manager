import { join } from 'node:path'
import { extractByPath } from '../utils/archiveConverter'
import { ConfigService } from './ConfigService'

let configService: ConfigService | null = null

// Registry: vehicleName → absolute mod zip path
const modVehicleZips = new Map<string, string>()

export function registerModVehicle(vehicleName: string, zipPath: string): void {
  modVehicleZips.set(vehicleName, zipPath)
}

export function clearModVehicles(): void {
  modVehicleZips.clear()
}

export function getModVehicleZip(vehicleName: string): string | null {
  return modVehicleZips.get(vehicleName) || null
}

export function initVehicleAssetService(config: ConfigService): void {
  configService = config
}

/** Try to extract an entry from an archive, case-insensitive. Returns null if not found. */
function extractFromZip(archivePath: string, entryPath: string): Promise<Buffer | null> {
  return extractByPath(archivePath, entryPath)
}

/** Extract a file from a vehicle zip and return it as a Buffer */
export function extractVehicleAsset(vehicleName: string, filePath: string): Promise<Buffer | null> {
  if (!configService) return Promise.resolve(null)
  const installDir = configService.get().gamePaths?.installDir
  if (!installDir) return Promise.resolve(null)
  const modZip = modVehicleZips.get(vehicleName)
  const zipPath = modZip || join(installDir, 'content', 'vehicles', `${vehicleName}.zip`)
  const entryPath = `vehicles/${vehicleName}/${filePath}`
  return extractFromZip(zipPath, entryPath)
}

/**
 * Resolve a game-absolute texture/asset path.
 * Handles:
 *   - vehicles/common/... → look in common.zip
 *   - vehicles/<name>/... → look in <name>.zip
 *   - .png extension → fallback to .dds / .DDS
 */
export async function resolveGameAsset(gamePath: string): Promise<Buffer | null> {
  if (!configService) return null
  const installDir = configService.get().gamePaths?.installDir
  if (!installDir) return null

  // Normalize: strip leading /
  const normalized = gamePath.replace(/^\/+/, '')

  // Determine which zip to open
  let zipPath: string
  if (normalized.startsWith('vehicles/common/')) {
    zipPath = join(installDir, 'content', 'vehicles', 'common.zip')
  } else {
    // vehicles/<vehicleName>/... → <vehicleName>.zip
    const parts = normalized.split('/')
    if (parts.length >= 2 && parts[0] === 'vehicles') {
      const modZip = modVehicleZips.get(parts[1])
      zipPath = modZip || join(installDir, 'content', 'vehicles', `${parts[1]}.zip`)
    } else {
      return null
    }
  }

  // Try exact path first
  let buf = await extractFromZip(zipPath, normalized)
  if (buf) return buf

  // Fallback: .png → .dds
  if (normalized.endsWith('.png')) {
    const base = normalized.slice(0, -4)
    buf = await extractFromZip(zipPath, base + '.dds')
    if (buf) return buf
    buf = await extractFromZip(zipPath, base + '.DDS')
    if (buf) return buf
  }

  return null
}
