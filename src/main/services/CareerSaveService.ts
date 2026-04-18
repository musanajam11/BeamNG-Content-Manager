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
  value: number | null              // from insurance.json
  power: number | null              // kW from certifications
  torque: number | null             // Nm from certifications
  weight: number | null             // kg from certifications
  odometer: number | null           // metres from gameplay_stat.json
  insuranceClass: string | null     // e.g. "Daily driver"
  licensePlate: string | null       // from vehicle config
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
  totalMissions: number
  skills: SkillCategory[]
  reputations: BusinessReputation[]
  stamina: number | null
  vouchers: number | null
  discoveredLocations: number
  unlockedBranches: number
  totalBranches: number
  discoveredBusinesses: string[]
  logbookEntries: number
  favoriteVehicleId: string | null
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

export interface ServerAssociation {
  serverIdent: string       // "ip:port"
  serverName: string | null // resolved display name
  lastPlayed: string        // ISO timestamp
}

/** Lightweight summary for profile cards in the list view */
export interface CareerProfileSummary {
  money: number | null
  beamXPLevel: number | null
  level: string | null
  vehicleCount: number
  lastSaved: string | null
  totalOdometer: number | null
  missionCount: number
  totalMissions: number
  bankBalance: number | null
  creditScore: number | null
  discoveredLocations: number
  unlockedBranches: number
  discoveredBusinesses: number
  insuranceCount: number
  logbookEntries: number
  lastServer: ServerAssociation | null
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
          isRLS: await this.detectIsRLS(entry.name, profilePath, slots),
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
          isRLS: await this.detectIsRLS(entry.name, profilePath, slots),
          path: profilePath,
          deployed: false,
          slots
        })
      }
    }

    return profiles
  }

  /**
   * Determine whether a profile is from an RLS (RLS Career Overhaul) save.
   * Uses multiple signals so we don't rely solely on the folder name suffix:
   *   1. Folder name ends with "_rls" (legacy/explicit naming)
   *   2. Any slot's career/ contains a `speedTrapLeaderboards/` directory (RLS feature)
   *   3. Any slot's career/vehicles/damage/ directory exists (RLS persistent damage)
   *   4. career/rls_career/ contains any of: globalEconomy.json, mortgages.json,
   *      credit.json, taxiRating.json, bank.json — these files are written by the
   *      RLS mod regardless of how empty the in-game state is
   *   5. career/playerAttributes.json contains per-brand "*DealershipReputation"
   *      keys (RLS-only economy)
   *   6. career/phoneLayout.json includes RLS-exclusive apps (real-estate,
   *      beam-eats, market-watch)
   *
   * Checks every non-corrupted slot (newest first) so an empty/recent slot
   * doesn't mask RLS data sitting in older slots.
   */
  private async detectIsRLS(
    profileName: string,
    profilePath: string,
    slots: CareerSaveSlot[]
  ): Promise<boolean> {
    if (profileName.toLowerCase().endsWith('_rls')) return true

    const ordered = [...slots]
      .filter(s => !s.corrupted)
      .sort((a, b) => (b.lastSaved ?? '').localeCompare(a.lastSaved ?? ''))

    const RLS_CAREER_FILES = [
      'globalEconomy.json',
      'mortgages.json',
      'credit.json',
      'taxiRating.json',
      'bank.json'
    ]

    for (const slot of ordered) {
      const careerPath = join(profilePath, slot.name, 'career')
      if (!existsSync(careerPath)) continue

      // Signal 2 & 3: RLS-only directories
      if (existsSync(join(careerPath, 'speedTrapLeaderboards'))) return true
      if (existsSync(join(careerPath, 'vehicles', 'damage'))) return true

      // Signal 4: any RLS-specific file inside rls_career/
      const rlsDir = join(careerPath, 'rls_career')
      if (existsSync(rlsDir)) {
        for (const f of RLS_CAREER_FILES) {
          if (existsSync(join(rlsDir, f))) return true
        }
      }

      // Signal 5: per-brand dealership reputations (RLS-only)
      try {
        const attrsRaw = await readFile(join(careerPath, 'playerAttributes.json'), 'utf-8')
        if (/"[A-Za-z]+DealershipReputation"\s*:/.test(attrsRaw)) return true
      } catch { /* missing */ }

      // Signal 6: RLS-only phone apps
      try {
        const phoneRaw = await readFile(join(careerPath, 'phoneLayout.json'), 'utf-8')
        if (/"(real-estate|beam-eats|market-watch)"/.test(phoneRaw)) return true
      } catch { /* missing */ }
    }

    return false
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
    const slots = await this.listSlots(location.path)
    const isRLS = await this.detectIsRLS(profileName, location.path, slots)

    // Read general.json
    let level: string | null = null
    let discoveredBusinesses: string[] = []
    try {
      const raw = await readFile(join(careerPath, 'general.json'), 'utf-8')
      const general = JSON.parse(raw)
      level = general.level ?? null
      if (general.organizationInteraction && typeof general.organizationInteraction === 'object') {
        discoveredBusinesses = Object.keys(general.organizationInteraction)
      }
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

    // Read insurance data (for vehicle values and classes)
    const insuranceMap = new Map<number, { value: number; className: string | null }>()
    let insuranceCount = 0
    try {
      const raw = await readFile(join(careerPath, 'insurance.json'), 'utf-8')
      const ins = JSON.parse(raw)
      const invVehs = Array.isArray(ins.invVehs) ? ins.invVehs : Array.isArray(ins) ? ins : []
      insuranceCount = invVehs.length
      for (const entry of invVehs) {
        if (typeof entry.id === 'number') {
          insuranceMap.set(entry.id, {
            value: typeof entry.initialValue === 'number' ? entry.initialValue : 0,
            className: entry.requiredInsuranceClass?.name ?? null
          })
        }
      }
    } catch { /* missing */ }

    // Read gameplay_stat.json - handle both formats
    let totalOdometer: number | null = null
    let totalDriftScore: number | null = null
    let totalCollisions: number | null = null
    const vehicleOdometers = new Map<string, number>()
    try {
      const raw = await readFile(join(careerPath, 'gameplay_stat.json'), 'utf-8')
      const stats = JSON.parse(raw)

      // Format 1: entries-based (confirmed in actual save files)
      if (stats.entries && typeof stats.entries === 'object') {
        const entries = stats.entries as Record<string, { value?: number }>
        let odoTotal = 0
        let driftTotal = 0
        let collisionTotal = 0
        let hasOdo = false, hasDrift = false, hasCollision = false

        for (const [key, entry] of Object.entries(entries)) {
          const val = entry?.value
          if (typeof val !== 'number') continue

          // vehicle/odometer/{model}.length
          if (key.startsWith('vehicle/odometer/') && key.endsWith('.length')) {
            hasOdo = true
            odoTotal += val
            const model = key.slice('vehicle/odometer/'.length, key.length - '.length'.length)
            vehicleOdometers.set(model, (vehicleOdometers.get(model) ?? 0) + val)
          }
          // drift scores
          else if (key.startsWith('drift/')) {
            if (key.includes('Score') || key === 'drift/totalScore') {
              hasDrift = true
              driftTotal += val
            }
          }
          // collisions
          else if (key.startsWith('collision') || key.includes('collision')) {
            hasCollision = true
            collisionTotal += val
          }
        }
        if (hasOdo) totalOdometer = odoTotal
        if (hasDrift) totalDriftScore = driftTotal
        if (hasCollision) totalCollisions = collisionTotal
      }
      // Format 2: legacy general.* format (fallback)
      else {
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
      }
    } catch { /* missing */ }

    // Count and read vehicles with rich data
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

          // Extract certifications (power, torque, weight)
          const cert = vData.certifications as Record<string, unknown> | undefined
          const power = typeof cert?.Power === 'number' ? cert.Power : null
          const torque = typeof cert?.Torque === 'number' ? cert.Torque : null
          const weight = typeof cert?.Weight === 'number' ? cert.Weight : null

          // Extract license plate
          const licensePlate = vData.config?.licensePlate ?? null

          // Match to insurance entry for value
          const insEntry = insuranceMap.get(Number(id))

          // Match odometer by model name (extract base model from path)
          let odometer: number | null = null
          if (model) {
            const modelBase = typeof model === 'string'
              ? model.replace(/^vehicles\//, '').split('/')[0]
              : null
            if (modelBase && vehicleOdometers.has(modelBase)) {
              odometer = vehicleOdometers.get(modelBase) ?? null
            }
          }

          vehicles.push({
            id,
            name: vData.name ?? null,
            model,
            thumbnailDataUrl,
            value: insEntry?.value ?? null,
            power,
            torque,
            weight,
            odometer,
            insuranceClass: insEntry?.className ?? null,
            licensePlate
          })
        } catch {
          vehicles.push({
            id, name: null, model: null, thumbnailDataUrl: null,
            value: null, power: null, torque: null, weight: null,
            odometer: null, insuranceClass: null, licensePlate: null
          })
        }
      }
    }

    // Mission count from playbook
    let missionCount = 0
    let totalMissions = 0
    try {
      const raw = await readFile(join(careerPath, 'playbook.json'), 'utf-8')
      const pb = JSON.parse(raw)
      if (Array.isArray(pb)) {
        totalMissions = pb.length
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

    // Discovered spawn points
    let discoveredLocations = 0
    try {
      const raw = await readFile(join(careerPath, 'spawnPoints.json'), 'utf-8')
      const sp = JSON.parse(raw)
      for (const mapSpawns of Object.values(sp)) {
        if (mapSpawns && typeof mapSpawns === 'object') {
          discoveredLocations += Object.values(mapSpawns as Record<string, boolean>).filter(Boolean).length
        }
      }
    } catch { /* missing */ }

    // Branch unlocks
    let unlockedBranches = 0
    let totalBranches = 0
    try {
      const raw = await readFile(join(careerPath, 'branchUnlocks.json'), 'utf-8')
      const branches = JSON.parse(raw) as Record<string, { unlocked?: boolean }>
      totalBranches = Object.keys(branches).length
      unlockedBranches = Object.values(branches).filter(b => b.unlocked).length
    } catch { /* missing */ }

    // Logbook entry count
    let logbookEntries = 0
    try {
      const raw = await readFile(join(careerPath, 'logbook.json'), 'utf-8')
      const lb = JSON.parse(raw)
      if (lb.logbook && Array.isArray(lb.logbook)) logbookEntries = lb.logbook.length
    } catch { /* missing */ }

    // Favorite vehicle from inventory
    let favoriteVehicleId: string | null = null
    try {
      const raw = await readFile(join(careerPath, 'inventory.json'), 'utf-8')
      const inv = JSON.parse(raw)
      if (typeof inv.favoriteVehicle === 'number') favoriteVehicleId = String(inv.favoriteVehicle)
    } catch { /* missing */ }

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
      totalMissions,
      skills,
      reputations,
      stamina,
      vouchers,
      discoveredLocations,
      unlockedBranches,
      totalBranches,
      discoveredBusinesses,
      logbookEntries,
      favoriteVehicleId
    }
  }

  /** Lightweight summary of the most recent save slot for profile list cards */
  async getProfileSummary(profileName: string): Promise<CareerProfileSummary | null> {
    const location = this.findProfilePath(profileName)
    if (!location) return null

    const slots = await this.listSlots(location.path)
    if (slots.length === 0) return null

    // Pick most recent non-corrupted slot
    const best = slots
      .filter(s => !s.corrupted && s.lastSaved && s.lastSaved !== '0')
      .sort((a, b) => (b.lastSaved ?? '').localeCompare(a.lastSaved ?? ''))[0]
      ?? slots[0]

    const slotPath = join(location.path, best.name)
    const careerPath = join(slotPath, 'career')
    const isRLS = await this.detectIsRLS(profileName, location.path, slots)

    let money: number | null = null
    let beamXPLevel: number | null = null
    let level: string | null = null
    let discoveredBusinesses = 0
    let discoveredLocations = 0
    let unlockedBranches = 0
    let logbookEntries = 0

    // general.json
    try {
      const raw = await readFile(join(careerPath, 'general.json'), 'utf-8')
      const general = JSON.parse(raw)
      level = general.level ?? null
      if (general.organizationInteraction && typeof general.organizationInteraction === 'object') {
        discoveredBusinesses = Object.keys(general.organizationInteraction).length
      }
    } catch { /* */ }

    // playerAttributes.json
    try {
      const raw = await readFile(join(careerPath, 'playerAttributes.json'), 'utf-8')
      const attrs = JSON.parse(raw) as Record<string, unknown>
      const moneyAttr = attrs.money as Record<string, unknown> | undefined
      money = typeof moneyAttr?.value === 'number' ? moneyAttr.value : null
      const xp = attrs.beamXP as Record<string, unknown> | undefined
      beamXPLevel = typeof xp?.level === 'number' ? xp.level : null
    } catch { /* */ }

    // Vehicle count
    let vehicleCount = 0
    const vehiclesDir = join(careerPath, 'vehicles')
    try {
      if (existsSync(vehiclesDir)) {
        const vEntries = await readdir(vehiclesDir)
        vehicleCount = vEntries.filter(f => f.endsWith('.json')).length
      }
    } catch { /* */ }

    // Gameplay stats - total odometer
    let totalOdometer: number | null = null
    try {
      const raw = await readFile(join(careerPath, 'gameplay_stat.json'), 'utf-8')
      const stats = JSON.parse(raw)
      if (stats.entries && typeof stats.entries === 'object') {
        let odoTotal = 0
        let hasOdo = false
        for (const [key, entry] of Object.entries(stats.entries as Record<string, { value?: number }>)) {
          if (key.startsWith('vehicle/odometer/') && key.endsWith('.length') && typeof entry?.value === 'number') {
            hasOdo = true
            odoTotal += entry.value
          }
        }
        if (hasOdo) totalOdometer = odoTotal
      } else if (stats.general?.odometer) {
        totalOdometer = Object.values(stats.general.odometer as Record<string, number>)
          .reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0)
      }
    } catch { /* */ }

    // Insurance count
    let insuranceCount = 0
    try {
      const raw = await readFile(join(careerPath, 'insurance.json'), 'utf-8')
      const ins = JSON.parse(raw)
      const invVehs = Array.isArray(ins.invVehs) ? ins.invVehs : Array.isArray(ins) ? ins : []
      insuranceCount = invVehs.length
    } catch { /* */ }

    // Mission count
    let missionCount = 0
    let totalMissions = 0
    try {
      const raw = await readFile(join(careerPath, 'playbook.json'), 'utf-8')
      const pb = JSON.parse(raw)
      if (Array.isArray(pb)) {
        totalMissions = pb.length
        missionCount = pb.filter((m: Record<string, unknown>) => m.completed).length
      }
    } catch { /* */ }

    // RLS-specific
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
      } catch { /* */ }
      try {
        const raw = await readFile(join(careerPath, 'rls_career', 'credit.json'), 'utf-8')
        const credit = JSON.parse(raw)
        creditScore = credit.score ?? credit.creditScore ?? null
      } catch { /* */ }
    }

    // Spawn points count
    try {
      const raw = await readFile(join(careerPath, 'spawnPoints.json'), 'utf-8')
      const sp = JSON.parse(raw)
      for (const mapSpawns of Object.values(sp)) {
        if (mapSpawns && typeof mapSpawns === 'object') {
          discoveredLocations += Object.values(mapSpawns as Record<string, boolean>).filter(Boolean).length
        }
      }
    } catch { /* */ }

    // Branch unlocks count
    try {
      const raw = await readFile(join(careerPath, 'branchUnlocks.json'), 'utf-8')
      const branches = JSON.parse(raw) as Record<string, { unlocked?: boolean }>
      unlockedBranches = Object.values(branches).filter(b => b.unlocked).length
    } catch { /* */ }

    // Logbook count
    try {
      const raw = await readFile(join(careerPath, 'logbook.json'), 'utf-8')
      const lb = JSON.parse(raw)
      if (lb.logbook && Array.isArray(lb.logbook)) logbookEntries = lb.logbook.length
    } catch { /* */ }

    const lastServer = await this.getServerAssociation(profileName)

    return {
      money,
      beamXPLevel,
      level,
      vehicleCount,
      lastSaved: best.lastSaved,
      totalOdometer,
      missionCount,
      totalMissions,
      bankBalance,
      creditScore,
      discoveredLocations,
      unlockedBranches,
      discoveredBusinesses,
      insuranceCount,
      logbookEntries,
      lastServer
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

  /**
   * Permanently delete an entire career profile (all slots).
   * If `backup` is true, a profile backup is created first so the user can restore.
   */
  async deleteProfile(
    profileName: string,
    options: { backup?: boolean } = {}
  ): Promise<{ success: boolean; backupName?: string; error?: string }> {
    const location = this.findProfilePath(profileName)
    if (!location) return { success: false, error: `Profile "${profileName}" not found` }

    let backupName: string | undefined
    if (options.backup) {
      const result = await this.backupProfile(profileName)
      if (!result.success) {
        return { success: false, error: `Pre-delete backup failed: ${result.error}` }
      }
      backupName = result.backupName
    }

    try {
      await rm(location.path, { recursive: true, force: true })
      return { success: true, backupName }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /**
   * Permanently delete a single save slot from a profile.
   * If `backup` is true, a slot backup is created first so the user can restore.
   */
  async deleteSlot(
    profileName: string,
    slotName: string,
    options: { backup?: boolean } = {}
  ): Promise<{ success: boolean; backupName?: string; error?: string }> {
    const location = this.findProfilePath(profileName)
    if (!location) return { success: false, error: `Profile "${profileName}" not found` }

    const slotPath = join(location.path, slotName)
    if (!existsSync(slotPath)) {
      return { success: false, error: `Slot "${slotName}" not found` }
    }

    let backupName: string | undefined
    if (options.backup) {
      const result = await this.backupSlot(profileName, slotName)
      if (!result.success) {
        return { success: false, error: `Pre-delete backup failed: ${result.error}` }
      }
      backupName = result.backupName
    }

    try {
      await rm(slotPath, { recursive: true, force: true })
      return { success: true, backupName }
    } catch (err) {
      return { success: false, error: String(err) }
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

  // ── Server association tracking ──

  private getServerAssociationsPath(): string {
    return join(app.getPath('userData'), 'career-server-map.json')
  }

  private async readServerAssociations(): Promise<Record<string, ServerAssociation>> {
    const filePath = this.getServerAssociationsPath()
    try {
      const raw = await readFile(filePath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  async recordServerAssociation(
    profileName: string,
    serverIdent: string,
    serverName: string | null
  ): Promise<void> {
    const map = await this.readServerAssociations()
    map[profileName] = {
      serverIdent,
      serverName,
      lastPlayed: new Date().toISOString()
    }
    await writeFile(this.getServerAssociationsPath(), JSON.stringify(map, null, 2))
  }

  async getServerAssociation(profileName: string): Promise<ServerAssociation | null> {
    const map = await this.readServerAssociations()
    return map[profileName] ?? null
  }

  async getAllServerAssociations(): Promise<Record<string, ServerAssociation>> {
    return this.readServerAssociations()
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
