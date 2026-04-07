import { readFile, readdir, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ConfigService } from './ConfigService'

export interface CareerSaveSlot {
  name: string               // e.g. "autosave1"
  creationDate: string | null
  lastSaved: string | null
  version: number | null
  corrupted: boolean
}

export interface CareerVehicleSummary {
  id: string
  name: string | null
  model: string | null
  thumbnailDataUrl: string | null
}

export interface SkillCategory {
  key: string
  value: number
  subcategories: Array<{ key: string; value: number }>
}

export interface BusinessReputation {
  name: string
  value: number
  max: number
}

export interface CareerSaveMetadata {
  slot: CareerSaveSlot
  level: string | null
  money: number | null
  beamXP: { level: number; value: number; curLvlProgress: number; neededForNext: number } | null
  vehicleCount: number
  vehicles: CareerVehicleSummary[]
  isRLS: boolean
  bankBalance: number | null
  creditScore: number | null
  gameplayStats: {
    totalOdometer: number | null
    totalDriftScore: number | null
    totalCollisions: number | null
  }
  insuranceCount: number
  missionCount: number
  skills: SkillCategory[]
  reputations: BusinessReputation[]
  stamina: number | null
  vouchers: number | null
}

export interface ProfileBackupInfo {
  name: string
  profileName: string
  slotName: string | null     // null for profile backups, slot name for slot backups
  timestamp: string
  path: string
}

export interface CareerProfile {
  name: string                // e.g. "Justmusa"
  isRLS: boolean
  path: string
  deployed: boolean           // true = in cloud saves, false = in CM storage
  slots: CareerSaveSlot[]
}

export class CareerSaveService {
  constructor(private configService: ConfigService) {}

  private getSavesDir(): string | null {
    const config = this.configService.get()

    // 1. Manual override takes priority
    const manual = (config as unknown as Record<string, unknown>).careerSavePath as string | null | undefined
    if (manual && existsSync(manual)) return manual

    // 2. Auto-detect from game paths
    const userDir = config.gamePaths?.userDir
    if (!userDir) return null

    // Try multiple known locations
    const candidates = [
      join(userDir, 'settings', 'cloud', 'saves'),          // inside version dir (e.g. .../current/settings/cloud/saves)
      join(userDir, '..', 'settings', 'cloud', 'saves'),    // one level up from version dir
      join(userDir, '..', 'current', 'settings', 'cloud', 'saves'), // sibling "current" folder
    ]

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }

    return null
  }

  /** Expose the resolved saves directory for UI display */
  getResolvedSavesDir(): string | null {
    return this.getSavesDir()
  }

  private getUndeployedDir(): string {
    return join(app.getPath('appData'), 'BeamMP-ContentManager', 'career-undeployed')
  }

  /** Find where a profile lives (deployed in cloud saves or undeployed in CM storage) */
  private findProfilePath(profileName: string): { path: string; deployed: boolean } | null {
    const savesDir = this.getSavesDir()
    if (savesDir) {
      const deployedPath = join(savesDir, profileName)
      if (existsSync(deployedPath)) return { path: deployedPath, deployed: true }
    }
    const undeployedPath = join(this.getUndeployedDir(), profileName)
    if (existsSync(undeployedPath)) return { path: undeployedPath, deployed: false }
    return null
  }

  async listProfiles(): Promise<CareerProfile[]> {
    const profiles: CareerProfile[] = []

    // List deployed profiles (in cloud saves)
    const savesDir = this.getSavesDir()
    if (savesDir && existsSync(savesDir)) {
      const entries = await readdir(savesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const profilePath = join(savesDir, entry.name)
        const slots = await this.listSlots(profilePath)
        profiles.push({
          name: entry.name,
          isRLS: entry.name.toLowerCase().endsWith('_rls'),
          path: profilePath,
          deployed: true,
          slots
        })
      }
    }

    // List undeployed profiles (in CM storage)
    const undeployedDir = this.getUndeployedDir()
    if (existsSync(undeployedDir)) {
      const entries = await readdir(undeployedDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const profilePath = join(undeployedDir, entry.name)
        const slots = await this.listSlots(profilePath)
        profiles.push({
          name: entry.name,
          isRLS: entry.name.toLowerCase().endsWith('_rls'),
          path: profilePath,
          deployed: false,
          slots
        })
      }
    }

    return profiles
  }

  private async listSlots(profilePath: string): Promise<CareerSaveSlot[]> {
    const entries = await readdir(profilePath, { withFileTypes: true })
    const slots: CareerSaveSlot[] = []

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('autosave')) continue
      const slotPath = join(profilePath, entry.name)
      const info = await this.readInfoJson(slotPath)

      slots.push({
        name: entry.name,
        creationDate: (info?.creationDate as string) ?? null,
        lastSaved: (info?.date as string) ?? null,
        version: (info?.version as number) ?? null,
        corrupted: info?.corrupted === true
      })
    }

    // Sort by slot name (autosave1, autosave2, ...)
    slots.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return slots
  }

  private async readInfoJson(slotPath: string): Promise<Record<string, unknown> | null> {
    const infoPath = join(slotPath, 'info.json')
    if (!existsSync(infoPath)) return null
    try {
      const raw = await readFile(infoPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  // Known skill category parent keys and their subcategory prefixes
  private static readonly SKILL_PARENTS: Record<string, string> = {
    logistics: 'logistics-',
    bmra: 'bmra-',
    freestyle: 'freestyle-',
    careerSkills: 'careerSkills-',
    apm: 'apm-'
  }

  private extractSkillsAndReputations(attrs: Record<string, unknown>): {
    skills: SkillCategory[]
    reputations: BusinessReputation[]
    stamina: number | null
    vouchers: number | null
  } {
    const skills: SkillCategory[] = []
    const reputations: BusinessReputation[] = []
    let stamina: number | null = null
    let vouchers: number | null = null

    // Track which keys we've consumed as subcategories
    const consumed = new Set<string>()

    // Extract skill categories
    for (const [parentKey, prefix] of Object.entries(CareerSaveService.SKILL_PARENTS)) {
      const parent = attrs[parentKey] as Record<string, unknown> | undefined
      if (!parent) continue

      const subcategories: Array<{ key: string; value: number }> = []
      for (const key of Object.keys(attrs)) {
        if (key.startsWith(prefix) && key !== parentKey) {
          const sub = attrs[key] as Record<string, unknown> | undefined
          if (sub && typeof sub.value === 'number') {
            subcategories.push({ key: key.slice(prefix.length), value: sub.value })
            consumed.add(key)
          }
        }
      }
      consumed.add(parentKey)

      // Also handle fre- subcategories under freestyle
      if (parentKey === 'freestyle') {
        for (const key of Object.keys(attrs)) {
          if (key.startsWith('fre-')) {
            const sub = attrs[key] as Record<string, unknown> | undefined
            if (sub && typeof sub.value === 'number') {
              subcategories.push({ key: key.slice(4), value: sub.value })
              consumed.add(key)
            }
          }
        }
      }

      // Only include if parent has value or any subcategory has value
      const parentValue = typeof parent.value === 'number' ? parent.value : 0
      if (parentValue > 0 || subcategories.some(s => s.value > 0)) {
        subcategories.sort((a, b) => b.value - a.value)
        skills.push({ key: parentKey, value: parentValue, subcategories })
      }
    }

    // Extract standalone scalar stats
    const staminaAttr = attrs.stamina as Record<string, unknown> | undefined
    if (staminaAttr && typeof staminaAttr.value === 'number') stamina = staminaAttr.value
    const voucherAttr = attrs.vouchers as Record<string, unknown> | undefined
    if (voucherAttr && typeof voucherAttr.value === 'number') vouchers = voucherAttr.value

    // Extract business/dealership reputations (keys ending with Reputation or Dealership)
    for (const key of Object.keys(attrs)) {
      if (consumed.has(key)) continue
      if (key === 'money' || key === 'beamXP' || key === 'stamina' || key === 'vouchers') continue
      const entry = attrs[key] as Record<string, unknown> | undefined
      if (!entry || typeof entry.value !== 'number') continue
      if (typeof entry.max === 'number' && (key.endsWith('Reputation') || key.endsWith('Dealership'))) {
        if (entry.value !== 0) {
          reputations.push({
            name: key,
            value: entry.value,
            max: entry.max
          })
        }
      }
    }
    reputations.sort((a, b) => b.value - a.value)

    // Sort skills by total value descending
    skills.sort((a, b) => b.value - a.value)

    return { skills, reputations, stamina, vouchers }
  }

  async getSlotMetadata(profileName: string, slotName: string): Promise<CareerSaveMetadata | null> {
    const location = this.findProfilePath(profileName)
    if (!location) return null

    const slotPath = join(location.path, slotName)
    if (!existsSync(slotPath)) return null

    const careerPath = join(slotPath, 'career')
    const info = await this.readInfoJson(slotPath)
    const isRLS = profileName.toLowerCase().endsWith('_rls')

    // Read general.json
    let level: string | null = null
    try {
      const raw = await readFile(join(careerPath, 'general.json'), 'utf-8')
      const general = JSON.parse(raw)
      level = general.level ?? null
    } catch { /* not present in RLS */ }

    // Read playerAttributes.json
    let money: number | null = null
    let beamXP: { level: number; value: number; curLvlProgress: number; neededForNext: number } | null = null
    let skills: SkillCategory[] = []
    let reputations: BusinessReputation[] = []
    let stamina: number | null = null
    let vouchers: number | null = null
    try {
      const raw = await readFile(join(careerPath, 'playerAttributes.json'), 'utf-8')
      const attrs = JSON.parse(raw) as Record<string, unknown>
      const moneyAttr = attrs.money as Record<string, unknown> | undefined
      money = typeof moneyAttr?.value === 'number' ? moneyAttr.value : null
      const xp = attrs.beamXP as Record<string, unknown> | undefined
      if (xp) {
        beamXP = {
          level: typeof xp.level === 'number' ? xp.level : 0,
          value: typeof xp.value === 'number' ? xp.value : 0,
          curLvlProgress: typeof xp.curLvlProgress === 'number' ? xp.curLvlProgress : 0,
          neededForNext: typeof xp.neededForNext === 'number' ? xp.neededForNext : 0
        }
      }
      const extracted = this.extractSkillsAndReputations(attrs)
      skills = extracted.skills
      reputations = extracted.reputations
      stamina = extracted.stamina
      vouchers = extracted.vouchers
    } catch { /* not present in RLS */ }

    // Count and read vehicles
    const vehicles: CareerVehicleSummary[] = []
    const vehiclesDir = join(careerPath, 'vehicles')
    if (existsSync(vehiclesDir)) {
      const vEntries = await readdir(vehiclesDir)
      for (const f of vEntries) {
        if (!f.endsWith('.json')) continue
        const id = f.replace('.json', '')
        try {
          const raw = await readFile(join(vehiclesDir, f), 'utf-8')
          const vData = JSON.parse(raw)
          const model = vData.config?.partConfigFilename ?? vData.model ?? null
          let thumbnailDataUrl: string | null = null
          const pngPath = join(vehiclesDir, `${id}.png`)
          if (existsSync(pngPath)) {
            const buf = await readFile(pngPath)
            thumbnailDataUrl = `data:image/png;base64,${buf.toString('base64')}`
          }
          vehicles.push({ id, name: vData.name ?? null, model, thumbnailDataUrl })
        } catch {
          vehicles.push({ id, name: null, model: null, thumbnailDataUrl: null })
        }
      }
    }

    // Read gameplay_stat.json
    let totalOdometer: number | null = null
    let totalDriftScore: number | null = null
    let totalCollisions: number | null = null
    try {
      const raw = await readFile(join(careerPath, 'gameplay_stat.json'), 'utf-8')
      const stats = JSON.parse(raw)
      if (stats.general?.odometer) {
        totalOdometer = Object.values(stats.general.odometer as Record<string, number>)
          .reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0)
      }
      if (stats.general?.drift) {
        const drift = stats.general.drift as Record<string, unknown>
        totalDriftScore = (drift.totalScore as number) ?? null
      }
      if (stats.general?.collisions) {
        const col = stats.general.collisions as Record<string, number>
        totalCollisions = Object.values(col)
          .reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0)
      }
    } catch { /* missing */ }

    // Insurance count
    let insuranceCount = 0
    try {
      const raw = await readFile(join(careerPath, 'insurance.json'), 'utf-8')
      const ins = JSON.parse(raw)
      insuranceCount = Array.isArray(ins.invVehs) ? ins.invVehs.length : 0
    } catch { /* missing */ }

    // Mission count from playbook
    let missionCount = 0
    try {
      const raw = await readFile(join(careerPath, 'playbook.json'), 'utf-8')
      const pb = JSON.parse(raw)
      if (Array.isArray(pb)) {
        missionCount = pb.filter((m: Record<string, unknown>) => m.completed).length
      }
    } catch { /* missing */ }

    // RLS-specific: bank balance & credit score
    let bankBalance: number | null = null
    let creditScore: number | null = null
    if (isRLS) {
      try {
        const raw = await readFile(join(careerPath, 'rls_career', 'bank.json'), 'utf-8')
        const bank = JSON.parse(raw)
        if (bank.accounts && Array.isArray(bank.accounts)) {
          bankBalance = bank.accounts.reduce(
            (sum: number, acc: Record<string, unknown>) => sum + ((acc.balance as number) ?? 0), 0
          )
        }
      } catch { /* missing */ }
      try {
        const raw = await readFile(join(careerPath, 'rls_career', 'credit.json'), 'utf-8')
        const credit = JSON.parse(raw)
        creditScore = credit.score ?? credit.creditScore ?? null
      } catch { /* missing */ }
    }

    return {
      slot: {
        name: slotName,
        creationDate: (info?.creationDate as string) ?? null,
        lastSaved: (info?.date as string) ?? null,
        version: (info?.version as number) ?? null,
        corrupted: info?.corrupted === true
      },
      level,
      money,
      beamXP,
      vehicleCount: vehicles.length,
      vehicles,
      isRLS,
      bankBalance,
      creditScore,
      gameplayStats: { totalOdometer, totalDriftScore, totalCollisions },
      insuranceCount,
      missionCount,
      skills,
      reputations,
      stamina,
      vouchers
    }
  }

  async getCareerLog(profileName: string): Promise<string[]> {
    const location = this.findProfilePath(profileName)
    if (!location) return []
    const logPath = join(location.path, 'career.log')
    if (!existsSync(logPath)) return []
    try {
      const raw = await readFile(logPath, 'utf-8')
      return raw.split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  async deployProfile(profileName: string): Promise<{ success: boolean; error?: string }> {
    const savesDir = this.getSavesDir()
    if (!savesDir) return { success: false, error: 'Game user directory not configured' }

    const undeployedPath = join(this.getUndeployedDir(), profileName)
    if (!existsSync(undeployedPath)) {
      return { success: false, error: `Undeployed profile "${profileName}" not found` }
    }

    const targetPath = join(savesDir, profileName)
    if (existsSync(targetPath)) {
      return { success: false, error: `A profile named "${profileName}" already exists in saves` }
    }

    try {
      await this.copyDirRecursive(undeployedPath, targetPath)
      await rm(undeployedPath, { recursive: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async undeployProfile(profileName: string): Promise<{ success: boolean; error?: string }> {
    const savesDir = this.getSavesDir()
    if (!savesDir) return { success: false, error: 'Game user directory not configured' }

    const profilePath = join(savesDir, profileName)
    if (!existsSync(profilePath)) {
      return { success: false, error: `Profile "${profileName}" not found in saves` }
    }

    const undeployedDir = this.getUndeployedDir()
    const targetPath = join(undeployedDir, profileName)
    if (existsSync(targetPath)) {
      return { success: false, error: `Profile "${profileName}" already exists in undeployed storage` }
    }

    try {
      await mkdir(undeployedDir, { recursive: true })
      await this.copyDirRecursive(profilePath, targetPath)
      await rm(profilePath, { recursive: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async backupSlot(profileName: string, slotName: string): Promise<{ success: boolean; backupName?: string; error?: string }> {
    const location = this.findProfilePath(profileName)
    if (!location) return { success: false, error: 'Profile not found' }

    const sourcePath = join(location.path, slotName)
    if (!existsSync(sourcePath)) {
      return { success: false, error: `Slot "${slotName}" not found` }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${profileName}__${slotName}__${timestamp}`
    const backupDir = this.getBackupsDir()
    const backupPath = join(backupDir, backupName)

    try {
      await mkdir(backupDir, { recursive: true })
      await this.copyDirRecursive(sourcePath, backupPath)
      await writeFile(join(backupPath, '_backup_meta.json'), JSON.stringify({
        type: 'slot',
        profileName,
        slotName,
        timestamp: new Date().toISOString(),
        createdAt: Date.now()
      }))
      return { success: true, backupName }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  private getBackupsDir(): string {
    return join(app.getPath('appData'), 'BeamMP-ContentManager', 'career-backups')
  }

  async backupProfile(profileName: string): Promise<{ success: boolean; backupName?: string; error?: string }> {
    const location = this.findProfilePath(profileName)
    if (!location) return { success: false, error: `Profile "${profileName}" not found` }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `${profileName}__profile__${timestamp}`
    const backupDir = this.getBackupsDir()
    const backupPath = join(backupDir, backupName)

    try {
      await mkdir(backupDir, { recursive: true })
      await this.copyDirRecursive(location.path, backupPath)
      await writeFile(join(backupPath, '_backup_meta.json'), JSON.stringify({
        type: 'profile',
        profileName,
        timestamp: new Date().toISOString(),
        createdAt: Date.now()
      }))
      return { success: true, backupName }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async listProfileBackups(profileName?: string): Promise<ProfileBackupInfo[]> {
    const backupDir = this.getBackupsDir()
    if (!existsSync(backupDir)) return []

    const entries = await readdir(backupDir, { withFileTypes: true })
    const backups: ProfileBackupInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metaPath = join(backupDir, entry.name, '_backup_meta.json')
      if (!existsSync(metaPath)) continue

      try {
        const raw = await readFile(metaPath, 'utf-8')
        const meta = JSON.parse(raw) as { profileName: string; slotName?: string; timestamp: string }
        if (profileName && meta.profileName !== profileName) continue
        backups.push({
          name: entry.name,
          profileName: meta.profileName,
          slotName: meta.slotName ?? null,
          timestamp: meta.timestamp,
          path: join(backupDir, entry.name)
        })
      } catch {
        continue
      }
    }

    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return backups
  }

  async restoreProfileBackup(backupName: string): Promise<{ success: boolean; error?: string }> {
    const backupDir = this.getBackupsDir()
    const backupPath = join(backupDir, backupName)
    if (!existsSync(backupPath)) {
      return { success: false, error: `Backup "${backupName}" not found` }
    }

    const metaPath = join(backupPath, '_backup_meta.json')
    if (!existsSync(metaPath)) {
      return { success: false, error: 'Backup metadata missing' }
    }

    let meta: { type?: string; profileName: string; slotName?: string }
    try {
      const raw = await readFile(metaPath, 'utf-8')
      meta = JSON.parse(raw)
    } catch {
      return { success: false, error: 'Failed to read backup metadata' }
    }

    if (meta.type === 'slot' && meta.slotName) {
      // Slot restore: put slot back into profile wherever it lives
      const location = this.findProfilePath(meta.profileName)
      if (!location) return { success: false, error: `Profile "${meta.profileName}" not found` }
      const targetPath = join(location.path, meta.slotName)
      try {
        if (existsSync(targetPath)) {
          await rm(targetPath, { recursive: true })
        }
        await this.copyDirRecursive(backupPath, targetPath, ['_backup_meta.json'])
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    } else {
      // Profile restore: replace entire profile at its current location
      const location = this.findProfilePath(meta.profileName)
      const savesDir = this.getSavesDir()
      if (!location && !savesDir) return { success: false, error: 'Game user directory not configured' }
      const targetPath = location ? location.path : join(savesDir!, meta.profileName)
      try {
        if (existsSync(targetPath)) {
          await rm(targetPath, { recursive: true })
        }
        await this.copyDirRecursive(backupPath, targetPath, ['_backup_meta.json'])
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  }

  async deleteProfileBackup(backupName: string): Promise<{ success: boolean; error?: string }> {
    const backupDir = this.getBackupsDir()
    const backupPath = join(backupDir, backupName)
    if (!existsSync(backupPath)) {
      return { success: false, error: `Backup "${backupName}" not found` }
    }
    try {
      await rm(backupPath, { recursive: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  private async copyDirRecursive(src: string, dest: string, exclude: string[] = []): Promise<void> {
    await mkdir(dest, { recursive: true })
    const entries = await readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue
      const srcEntry = join(src, entry.name)
      const destEntry = join(dest, entry.name)
      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcEntry, destEntry)
      } else {
        await copyFile(srcEntry, destEntry)
      }
    }
  }
}
