import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import { homedir } from 'os'
import type { GamePaths } from '../../shared/types'

const IS_WINDOWS = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'
const IS_MAC = process.platform === 'darwin'

const GAME_EXECUTABLE = IS_WINDOWS ? 'BeamNG.drive.exe' : 'BeamNG.drive'

const STEAM_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Valve\\Steam',
  'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
  'HKCU\\SOFTWARE\\Valve\\Steam'
]

const COMMON_STEAM_PATHS_WIN = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\Steam',
  'E:\\SteamLibrary'
]

const COMMON_STEAM_PATHS_LINUX = [
  join(homedir(), '.steam', 'steam'),
  join(homedir(), '.steam', 'debian-installation'),
  join(homedir(), '.local', 'share', 'Steam'),
  '/usr/share/steam',
  '/usr/local/share/steam'
]

const COMMON_STEAM_PATHS_MAC = [
  join(homedir(), 'Library', 'Application Support', 'Steam')
]

function getCommonSteamPaths(): string[] {
  if (IS_WINDOWS) return COMMON_STEAM_PATHS_WIN
  if (IS_MAC) return COMMON_STEAM_PATHS_MAC
  return COMMON_STEAM_PATHS_LINUX
}

export class GameDiscoveryService {
  private cachedPaths: GamePaths | null = null

  async discoverPaths(): Promise<GamePaths> {
    if (this.cachedPaths) return this.cachedPaths

    const installDir = await this.findInstallDir()
    const userDir = this.findUserDir()

    // Determine executable — on Linux/Proton the actual binary is still .exe
    let executable = installDir ? join(installDir, GAME_EXECUTABLE) : null
    let isProton = false
    if (IS_LINUX && executable && !existsSync(executable) && installDir) {
      // Proton installs keep the Windows executable
      const protonExe = join(installDir, 'BeamNG.drive.exe')
      if (existsSync(protonExe)) {
        executable = protonExe
        isProton = true
      }
    } else if (IS_LINUX && executable && existsSync(executable)) {
      // Check if this is inside a Steam/Proton path
      isProton = installDir?.includes('steamapps') ?? false
    }

    const gameVersion = userDir ? await this.readGameVersion(userDir) : null

    this.cachedPaths = {
      installDir,
      userDir,
      executable: executable && existsSync(executable) ? executable : null,
      gameVersion,
      isProton
    }

    return this.cachedPaths
  }

  clearCache(): void {
    this.cachedPaths = null
  }

  private async findInstallDir(): Promise<string | null> {
    // 1. Try reading BeamNG.Drive.ini (used by official launcher — Windows only)
    if (IS_WINDOWS) {
      const iniPath = this.findBeamNGIni()
      if (iniPath) {
        const dir = this.parseBeamNGIni(iniPath)
        if (dir && existsSync(dir)) return dir
      }
    }

    // 2. Try Steam registry to find Steam install path (Windows only)
    if (IS_WINDOWS) {
      const steamPath = this.findSteamPathFromRegistry()
      if (steamPath) {
        const gameDir = this.findGameInSteamLibraries(steamPath)
        if (gameDir) return gameDir
      }
    }

    // 3. Try common Steam paths (platform-aware)
    for (const steamDir of getCommonSteamPaths()) {
      if (!existsSync(steamDir)) continue

      const gameDir = this.findGameInSteamLibraries(steamDir)
      if (gameDir) return gameDir

      // Direct check in common location
      const directDir = join(steamDir, 'steamapps', 'common', 'BeamNG.drive')
      if (existsSync(join(directDir, GAME_EXECUTABLE))) {
        return directDir
      }
    }

    // 4. Linux: check Proton/compatdata prefix
    if (IS_LINUX) {
      const protonDir = this.findGameInProtonPrefix()
      if (protonDir) return protonDir
    }

    return null
  }

  private findBeamNGIni(): string | null {
    // Windows only — the official BeamNG launcher writes this file
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const iniPath = join(localAppData, 'BeamNG.Drive', 'BeamNG.Drive.ini')
    return existsSync(iniPath) ? iniPath : null
  }

  private parseBeamNGIni(iniPath: string): string | null {
    try {
      const content = readFileSync(iniPath, 'utf-8')
      // Look for GameDir or game directory path
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('GameDir') || trimmed.startsWith('RootFolder')) {
          const match = trimmed.match(/=\s*(.+)/)
          if (match) {
            const dir = match[1].trim().replace(/"/g, '')
            if (existsSync(dir)) return dir
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null
  }

  private findSteamPathFromRegistry(): string | null {
    // Windows only — query the Windows registry for Steam install path
    for (const key of STEAM_REGISTRY_KEYS) {
      try {
        const result = execSync(`reg query "${key}" /v InstallPath`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        })
        const match = result.match(/InstallPath\s+REG_SZ\s+(.+)/)
        if (match) {
          const path = match[1].trim()
          if (existsSync(path)) return path
        }
      } catch {
        // Key not found, try next
      }
    }
    return null
  }

  private findGameInSteamLibraries(steamPath: string): string | null {
    // Check default steamapps
    const defaultGameDir = join(steamPath, 'steamapps', 'common', 'BeamNG.drive')
    if (existsSync(join(defaultGameDir, GAME_EXECUTABLE))) {
      return defaultGameDir
    }

    // Check libraryfolders.vdf for additional library paths
    const libraryVdf = join(steamPath, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(libraryVdf)) {
      try {
        const content = readFileSync(libraryVdf, 'utf-8')
        const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/g)
        for (const match of pathMatches) {
          const libPath = match[1].replace(/\\\\/g, IS_WINDOWS ? '\\' : '/')
          const gameDir = join(libPath, 'steamapps', 'common', 'BeamNG.drive')
          if (existsSync(join(gameDir, GAME_EXECUTABLE))) {
            return gameDir
          }
        }
      } catch {
        // Ignore VDF parse errors
      }
    }

    return null
  }

  /** Linux: search Proton compatdata for BeamNG.drive (app ID 284160) */
  private findGameInProtonPrefix(): string | null {
    for (const steamDir of COMMON_STEAM_PATHS_LINUX) {
      // Proton stores the Windows executable in the regular steamapps/common path,
      // but user data goes into the compatdata prefix
      const protonGameDir = join(steamDir, 'steamapps', 'common', 'BeamNG.drive')
      if (existsSync(join(protonGameDir, 'BeamNG.drive.exe'))) {
        return protonGameDir
      }

      // Also check via compatdata symlinks
      const compatDir = join(steamDir, 'steamapps', 'compatdata', '284160', 'pfx', 'drive_c')
      if (existsSync(compatDir)) {
        // Find game dir via Program Files
        const progFiles = join(compatDir, 'Program Files (x86)', 'Steam', 'steamapps', 'common', 'BeamNG.drive')
        if (existsSync(join(progFiles, 'BeamNG.drive.exe'))) {
          return progFiles
        }
      }
    }
    return null
  }

  findUserDir(): string | null {
    if (IS_WINDOWS) {
      return this.findUserDirWindows()
    }
    if (IS_LINUX) {
      return this.findUserDirLinux() ?? this.findUserDirProton()
    }
    if (IS_MAC) {
      return this.findUserDirMac()
    }
    return null
  }

  private findUserDirWindows(): string | null {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return this.findLatestVersionDir(join(localAppData, 'BeamNG', 'BeamNG.drive'))
      ?? this.findLatestVersionDir(join(localAppData, 'BeamNG.drive'))
  }

  private findUserDirLinux(): string | null {
    // Native Linux paths (XDG)
    const xdgData = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')

    const candidates = [
      join(xdgData, 'BeamNG', 'BeamNG.drive'),
      join(xdgConfig, 'BeamNG', 'BeamNG.drive'),
      join(homedir(), '.BeamNG', 'BeamNG.drive'),
      join(homedir(), '.beamng', 'BeamNG.drive')
    ]

    for (const dir of candidates) {
      const found = this.findLatestVersionDir(dir)
      if (found) return found
    }
    return null
  }

  private findUserDirProton(): string | null {
    // Proton stores user data in the compatdata prefix under the fake Windows filesystem
    for (const steamDir of COMMON_STEAM_PATHS_LINUX) {
      const prefixAppData = join(
        steamDir, 'steamapps', 'compatdata', '284160', 'pfx', 'drive_c',
        'users', 'steamuser', 'AppData', 'Local'
      )
      const found = this.findLatestVersionDir(join(prefixAppData, 'BeamNG', 'BeamNG.drive'))
        ?? this.findLatestVersionDir(join(prefixAppData, 'BeamNG.drive'))
      if (found) return found
    }
    return null
  }

  private findUserDirMac(): string | null {
    const appSupport = join(homedir(), 'Library', 'Application Support')
    return this.findLatestVersionDir(join(appSupport, 'BeamNG', 'BeamNG.drive'))
      ?? this.findLatestVersionDir(join(appSupport, 'BeamNG.drive'))
  }

  /** Find the latest versioned subdirectory (e.g. "0.33") or "current" symlink */
  private findLatestVersionDir(beamngDir: string): string | null {
    if (!existsSync(beamngDir)) return null

    // Try the "current" symlink first (modern BeamNG)
    const currentDir = join(beamngDir, 'current')
    if (existsSync(currentDir)) return currentDir

    // Find latest versioned folder
    try {
      const entries = readdirSync(beamngDir)
      const versionDirs = entries
        .filter((entry: string) => {
          const fullPath = join(beamngDir, entry)
          return statSync(fullPath).isDirectory() && /^\d+\.\d+/.test(entry)
        })
        .sort()
        .reverse()
      if (versionDirs.length > 0) {
        return join(beamngDir, versionDirs[0])
      }
    } catch {
      // Ignore
    }
    return null
  }

  async readGameVersion(userDir: string): Promise<string | null> {
    // Try reading version from BeamNG.drive.ini (sibling of the userDir parent)
    // Path: e.g. C:\Users\...\BeamNG\BeamNG.drive.ini (next to the BeamNG.drive folder)
    const driveIni = join(userDir, '..', '..', 'BeamNG.drive.ini')
    if (existsSync(driveIni)) {
      try {
        const content = await readFile(driveIni, 'utf-8')
        const match = content.match(/version\s*=\s*(.+)/i)
        if (match) return match[1].trim()
      } catch {
        // Ignore
      }
    }

    // Fallback: extract from versioned folder name (e.g. "0.33")
    const folderName = basename(userDir)
    if (/^\d+\.\d+/.test(folderName)) {
      return folderName
    }

    // Fallback: parse first line of beamng.log
    const logFile = join(userDir, 'beamng.log')
    if (existsSync(logFile)) {
      try {
        const content = await readFile(logFile, 'utf-8')
        const match = content.match(/v\s+(\d+\.\d+[\d.]*)/)
        if (match) return match[1]
      } catch {
        // Ignore
      }
    }

    return null
  }

  async validatePaths(paths: GamePaths): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    if (!paths.installDir || !existsSync(paths.installDir)) {
      errors.push('BeamNG.drive installation directory not found')
    }
    if (!paths.executable || !existsSync(paths.executable)) {
      errors.push('BeamNG.drive executable not found')
    }
    if (!paths.userDir || !existsSync(paths.userDir)) {
      errors.push('BeamNG.drive user data folder not found')
    }

    return { valid: errors.length === 0, errors }
  }
}
