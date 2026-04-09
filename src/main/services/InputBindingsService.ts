import { readFile, writeFile, mkdir, readdir, unlink, rename as fsRename } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { parseBeamNGJson } from '../utils/parseBeamNGJson'
import type {
  InputDevice,
  InputDeviceType,
  InputBinding,
  FFBConfig,
  InputAction,
  ActionCategory,
  MergedDeviceBindings,
  SteeringFilterSettings,
  ControlsPreset
} from '../../shared/types'

/* ──────────────────────────────────────────────────────────────
   Raw file-level shapes (what the JSON/diff files look like)
   ────────────────────────────────────────────────────────────── */

interface RawBindingEntry {
  control: string
  action: string
  linearity?: number
  deadzone?: number
  deadzoneResting?: number
  deadzoneEnd?: number
  isInverted?: boolean
  angle?: number
  isForceEnabled?: boolean
  ffb?: FFBConfig
}

interface RawInputMapFile {
  name?: string
  vendorName?: string
  devicetype?: string
  vidpid?: string
  guid?: string
  displayName?: string
  imagePack?: string
  version?: number
  bindings?: RawBindingEntry[]
  removed?: Array<{ action: string; control: string }>
}

interface RawActionDef {
  cat: string
  order: number
  title?: string
  desc?: string
  isCentered?: boolean
  ctx?: string
  [key: string]: unknown
}

/* ──────────────────────────────────────────────────────────────
   InputBindingsService
   ────────────────────────────────────────────────────────────── */

export class InputBindingsService {
  private presetsDir: string

  constructor() {
    this.presetsDir = join(app.getPath('appData'), 'BeamMP-ContentManager', 'controls-presets')
  }

  /* ── Device Discovery ─────────────────────────────────────── */

  async listDevices(installDir: string, userDir: string): Promise<InputDevice[]> {
    const defaultDir = join(installDir, 'settings', 'inputmaps')
    const userDiffDir = join(userDir, 'settings', 'inputmaps')

    if (!existsSync(defaultDir)) return []

    // Collect user .diff filenames — these are devices the user actually uses
    const userDiffFiles = new Set<string>()
    if (existsSync(userDiffDir)) {
      const diffFiles = await readdir(userDiffDir)
      for (const f of diffFiles) {
        if (extname(f).toLowerCase() === '.diff') {
          userDiffFiles.add(basename(f, '.diff'))
        }
      }
    }

    // Essential default devices always shown even without a .diff
    const ESSENTIAL_DEVICES = new Set(['keyboard', 'mouse', 'xinput'])

    const files = await readdir(defaultDir)
    const jsonFiles = files.filter((f) => extname(f).toLowerCase() === '.json')

    const devices: InputDevice[] = []

    for (const file of jsonFiles) {
      try {
        const fileBase = basename(file, '.json')
        const hasOverrides = userDiffFiles.has(fileBase)

        // Only include devices the user has customized, or essential defaults
        if (!hasOverrides && !ESSENTIAL_DEVICES.has(fileBase)) continue

        const raw = await readFile(join(defaultDir, file), 'utf-8')
        const parsed = parseBeamNGJson<RawInputMapFile>(raw)

        // Infer device type: use explicit field, else detect from content
        let dtype: InputDeviceType = 'keyboard'
        if (parsed.devicetype) {
          dtype = parsed.devicetype as InputDeviceType
        } else if (!ESSENTIAL_DEVICES.has(fileBase)) {
          // Non-essential device without explicit type — infer from bindings
          const hasAxisBindings = parsed.bindings?.some(
            (b: { control?: string; angle?: number; ffb?: unknown; isForceEnabled?: boolean }) =>
              b.angle !== undefined ||
              b.ffb !== undefined ||
              b.isForceEnabled ||
              (b.control && /^axis\d|^slider|^rotaxis/i.test(b.control))
          )
          if (hasAxisBindings) {
            dtype = 'joystick'
          } else if (
            parsed.bindings?.some(
              (b: { control?: string }) =>
                b.control && /^button\d/i.test(b.control)
            )
          ) {
            dtype = parsed.vidpid?.toLowerCase().includes('xinput') ? 'xinput' : 'joystick'
          }
        }

        devices.push({
          fileName: fileBase,
          name: parsed.name || fileBase,
          vendorName: parsed.vendorName,
          devicetype: dtype,
          vidpid: parsed.vidpid || fileBase,
          guid: parsed.guid,
          displayName: parsed.displayName,
          imagePack: parsed.imagePack,
          hasUserOverrides: hasOverrides
        })
      } catch {
        // Skip files that fail to parse
      }
    }

    return devices.sort((a, b) => {
      const typeOrder: Record<InputDeviceType, number> = {
        keyboard: 0,
        mouse: 1,
        xinput: 2,
        joystick: 3
      }
      const typeDiff = (typeOrder[a.devicetype] ?? 9) - (typeOrder[b.devicetype] ?? 9)
      if (typeDiff !== 0) return typeDiff
      // Devices with user overrides first within same type
      if (a.hasUserOverrides !== b.hasUserOverrides) return a.hasUserOverrides ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  /* ── Action Definitions ───────────────────────────────────── */

  async getActions(installDir: string): Promise<InputAction[]> {
    const actionsDir = join(installDir, 'lua', 'ge', 'extensions', 'core', 'input', 'actions')
    if (!existsSync(actionsDir)) return []

    const files = await readdir(actionsDir)
    const jsonFiles = files.filter((f) => extname(f).toLowerCase() === '.json')

    const actions: InputAction[] = []

    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(actionsDir, file), 'utf-8')
        const parsed = parseBeamNGJson<Record<string, RawActionDef>>(raw)

        for (const [id, def] of Object.entries(parsed)) {
          if (!def || typeof def !== 'object' || !def.cat) continue
          actions.push({
            id,
            cat: def.cat,
            order: def.order ?? 999,
            title: def.title || id,
            desc: def.desc,
            isCentered: def.isCentered,
            ctx: def.ctx
          })
        }
      } catch {
        // Skip unparseable files
      }
    }

    return actions.sort((a, b) => a.order - b.order)
  }

  async getCategories(installDir: string): Promise<ActionCategory[]> {
    const actions = await this.getActions(installDir)
    const catMap = new Map<string, number>()

    for (const action of actions) {
      if (!catMap.has(action.cat)) {
        catMap.set(action.cat, action.order)
      } else {
        const existing = catMap.get(action.cat)!
        if (action.order < existing) catMap.set(action.cat, action.order)
      }
    }

    return Array.from(catMap.entries())
      .map(([id, order]) => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        order
      }))
      .sort((a, b) => a.order - b.order)
  }

  /* ── Binding Merge Logic ──────────────────────────────────── */

  async getMergedBindings(
    installDir: string,
    userDir: string,
    deviceFileName: string
  ): Promise<MergedDeviceBindings> {
    const defaultPath = join(installDir, 'settings', 'inputmaps', `${deviceFileName}.json`)
    const diffPath = join(userDir, 'settings', 'inputmaps', `${deviceFileName}.diff`)

    // Parse default file
    const defaultRaw = await readFile(defaultPath, 'utf-8')
    const defaultData = parseBeamNGJson<RawInputMapFile>(defaultRaw)

    // Build device metadata
    const device: InputDevice = {
      fileName: deviceFileName,
      name: defaultData.name || deviceFileName,
      vendorName: defaultData.vendorName,
      devicetype: (defaultData.devicetype as InputDeviceType) || 'keyboard',
      vidpid: defaultData.vidpid || deviceFileName,
      guid: defaultData.guid,
      displayName: defaultData.displayName,
      imagePack: defaultData.imagePack,
      hasUserOverrides: existsSync(diffPath)
    }

    // Start with default bindings
    const bindingMap = new Map<string, InputBinding>()
    for (const b of defaultData.bindings || []) {
      const key = `${b.control}::${b.action}`
      bindingMap.set(key, {
        ...b,
        isUserOverride: false,
        isRemoved: false
      })
    }

    // Apply user diff overlay if it exists
    if (existsSync(diffPath)) {
      try {
        const diffRaw = await readFile(diffPath, 'utf-8')
        const diffData = parseBeamNGJson<RawInputMapFile>(diffRaw)

        // Apply user bindings (overwrite or add)
        for (const b of diffData.bindings || []) {
          const key = `${b.control}::${b.action}`
          bindingMap.set(key, {
            ...b,
            isUserOverride: true,
            isRemoved: false
          })
        }

        // Apply removals
        for (const r of diffData.removed || []) {
          const key = `${r.control}::${r.action}`
          const existing = bindingMap.get(key)
          if (existing) {
            existing.isRemoved = true
          } else {
            bindingMap.set(key, {
              control: r.control,
              action: r.action,
              isRemoved: true,
              isUserOverride: true
            })
          }
        }
      } catch {
        // Diff is corrupt — fall back to defaults only
      }
    }

    const bindings = Array.from(bindingMap.values())

    return { device, bindings }
  }

  /* ── Write Operations ─────────────────────────────────────── */

  async setBinding(
    installDir: string,
    userDir: string,
    deviceFileName: string,
    binding: InputBinding
  ): Promise<MergedDeviceBindings> {
    const diffPath = join(userDir, 'settings', 'inputmaps', `${deviceFileName}.diff`)
    const diffData = await this.readDiffFile(diffPath)

    // Remove from the removed list if present
    diffData.removed = (diffData.removed || []).filter(
      (r) => !(r.control === binding.control && r.action === binding.action)
    )

    // Upsert in bindings
    const idx = (diffData.bindings || []).findIndex(
      (b) => b.control === binding.control && b.action === binding.action
    )
    const entry: RawBindingEntry = {
      control: binding.control,
      action: binding.action
    }
    if (binding.linearity !== undefined) entry.linearity = binding.linearity
    if (binding.deadzone !== undefined) entry.deadzone = binding.deadzone
    if (binding.deadzoneResting !== undefined) entry.deadzoneResting = binding.deadzoneResting
    if (binding.deadzoneEnd !== undefined) entry.deadzoneEnd = binding.deadzoneEnd
    if (binding.isInverted !== undefined) entry.isInverted = binding.isInverted
    if (binding.angle !== undefined) entry.angle = binding.angle
    if (binding.isForceEnabled !== undefined) entry.isForceEnabled = binding.isForceEnabled
    if (binding.ffb !== undefined) entry.ffb = binding.ffb

    if (!diffData.bindings) diffData.bindings = []
    if (idx >= 0) {
      diffData.bindings[idx] = entry
    } else {
      diffData.bindings.push(entry)
    }

    await this.writeDiffFile(diffPath, diffData)
    return this.getMergedBindings(installDir, userDir, deviceFileName)
  }

  async removeBinding(
    installDir: string,
    userDir: string,
    deviceFileName: string,
    control: string,
    action: string
  ): Promise<MergedDeviceBindings> {
    const diffPath = join(userDir, 'settings', 'inputmaps', `${deviceFileName}.diff`)
    const defaultPath = join(installDir, 'settings', 'inputmaps', `${deviceFileName}.json`)
    const diffData = await this.readDiffFile(diffPath)

    // Remove from diff bindings if present
    diffData.bindings = (diffData.bindings || []).filter(
      (b) => !(b.control === control && b.action === action)
    )

    // Check if this binding exists in defaults — if so, add to removed[]
    try {
      const defaultRaw = await readFile(defaultPath, 'utf-8')
      const defaultData = parseBeamNGJson<RawInputMapFile>(defaultRaw)
      const existsInDefault = (defaultData.bindings || []).some(
        (b) => b.control === control && b.action === action
      )
      if (existsInDefault) {
        if (!diffData.removed) diffData.removed = []
        const alreadyRemoved = diffData.removed.some(
          (r) => r.control === control && r.action === action
        )
        if (!alreadyRemoved) {
          diffData.removed.push({ control, action })
        }
      }
    } catch {
      // Default file missing — just remove from diff
    }

    await this.writeDiffFile(diffPath, diffData)
    return this.getMergedBindings(installDir, userDir, deviceFileName)
  }

  async resetDevice(userDir: string, deviceFileName: string): Promise<void> {
    const diffPath = join(userDir, 'settings', 'inputmaps', `${deviceFileName}.diff`)
    if (existsSync(diffPath)) {
      await unlink(diffPath)
    }
  }

  /* ── FFB Config ───────────────────────────────────────────── */

  async setFFBConfig(
    installDir: string,
    userDir: string,
    deviceFileName: string,
    control: string,
    ffb: FFBConfig
  ): Promise<MergedDeviceBindings> {
    const diffPath = join(userDir, 'settings', 'inputmaps', `${deviceFileName}.diff`)
    const diffData = await this.readDiffFile(diffPath)

    if (!diffData.bindings) diffData.bindings = []
    const existing = diffData.bindings.find((b) => b.control === control)
    if (existing) {
      existing.ffb = ffb
      existing.isForceEnabled = true
    } else {
      // Read the default to get the action for this control
      const defaultPath = join(installDir, 'settings', 'inputmaps', `${deviceFileName}.json`)
      try {
        const defaultRaw = await readFile(defaultPath, 'utf-8')
        const defaultData = parseBeamNGJson<RawInputMapFile>(defaultRaw)
        const defaultBinding = (defaultData.bindings || []).find((b) => b.control === control)
        if (defaultBinding) {
          diffData.bindings.push({
            control,
            action: defaultBinding.action,
            ffb,
            isForceEnabled: true
          })
        }
      } catch {
        // Can't find the action — skip
      }
    }

    await this.writeDiffFile(diffPath, diffData)
    return this.getMergedBindings(installDir, userDir, deviceFileName)
  }

  /* ── Steering Filter Settings ─────────────────────────────── */

  async getSteeringSettings(userDir: string): Promise<SteeringFilterSettings> {
    const settingsPath = join(userDir, 'settings', 'settings.json')
    const defaults: SteeringFilterSettings = {
      steeringAutocenterEnabled: true,
      steeringSlowdownEnabled: true,
      steeringSlowdownStartSpeed: 10,
      steeringSlowdownEndSpeed: 40,
      steeringSlowdownMultiplier: 0.3,
      steeringLimitEnabled: false,
      steeringLimitMultiplier: 1,
      steeringStabilizationEnabled: false,
      steeringStabilizationMultiplier: 0.5,
      steeringUndersteerReductionEnabled: false,
      steeringUndersteerReductionMultiplier: 0.5,
      steeringAutocenterEnabledDirect: false,
      steeringSlowdownEnabledDirect: false,
      steeringSlowdownStartSpeedDirect: 10,
      steeringSlowdownEndSpeedDirect: 40,
      steeringSlowdownMultiplierDirect: 0.3,
      steeringLimitEnabledDirect: false,
      steeringLimitMultiplierDirect: 1,
      steeringStabilizationEnabledDirect: false,
      steeringStabilizationMultiplierDirect: 0.5,
      steeringUndersteerReductionEnabledDirect: false,
      steeringUndersteerReductionMultiplierDirect: 0.5
    }

    if (!existsSync(settingsPath)) return defaults

    try {
      const raw = await readFile(settingsPath, 'utf-8')
      const parsed = parseBeamNGJson<Record<string, unknown>>(raw)
      const result = { ...defaults }

      for (const key of Object.keys(defaults) as (keyof SteeringFilterSettings)[]) {
        if (key in parsed && typeof parsed[key] === typeof defaults[key]) {
          ;(result as Record<string, unknown>)[key] = parsed[key]
        }
      }

      return result
    } catch {
      return defaults
    }
  }

  async setSteeringSettings(
    userDir: string,
    settings: Partial<SteeringFilterSettings>
  ): Promise<SteeringFilterSettings> {
    const settingsPath = join(userDir, 'settings', 'settings.json')
    let existing: Record<string, unknown> = {}

    if (existsSync(settingsPath)) {
      try {
        const raw = await readFile(settingsPath, 'utf-8')
        existing = parseBeamNGJson<Record<string, unknown>>(raw)
      } catch {
        existing = {}
      }
    }

    // Merge only the steering keys into the full settings file
    const merged = { ...existing, ...settings }
    await this.atomicWrite(settingsPath, JSON.stringify(merged, null, 2))

    return this.getSteeringSettings(userDir)
  }

  /* ── Preset Management ────────────────────────────────────── */

  async listPresets(): Promise<ControlsPreset[]> {
    if (!existsSync(this.presetsDir)) return []

    const files = await readdir(this.presetsDir)
    const jsonFiles = files.filter((f) => extname(f).toLowerCase() === '.json')

    const presets: ControlsPreset[] = []
    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(this.presetsDir, file), 'utf-8')
        const parsed = JSON.parse(raw) as ControlsPreset
        if (parsed.id && parsed.name && parsed.diffs) {
          presets.push(parsed)
        }
      } catch {
        // Skip corrupt presets
      }
    }

    return presets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }

  async savePreset(
    name: string,
    deviceFileName: string,
    userDir: string,
    device: InputDevice
  ): Promise<ControlsPreset> {
    await mkdir(this.presetsDir, { recursive: true })

    // Snapshot all .diff files in the user's inputmaps directory for this device
    const userDiffDir = join(userDir, 'settings', 'inputmaps')
    const diffs: Record<string, string> = {}

    const diffPath = join(userDiffDir, `${deviceFileName}.diff`)
    if (existsSync(diffPath)) {
      diffs[`${deviceFileName}.diff`] = await readFile(diffPath, 'utf-8')
    }

    const preset: ControlsPreset = {
      id: randomUUID(),
      name,
      createdAt: Date.now(),
      deviceVidpid: device.vidpid,
      deviceName: device.name,
      devicetype: device.devicetype,
      diffs
    }

    const presetPath = join(this.presetsDir, `${preset.id}.json`)
    await writeFile(presetPath, JSON.stringify(preset, null, 2), 'utf-8')

    return preset
  }

  async loadPreset(presetId: string, userDir: string): Promise<void> {
    const presetPath = join(this.presetsDir, `${presetId}.json`)
    const raw = await readFile(presetPath, 'utf-8')
    const preset = JSON.parse(raw) as ControlsPreset

    const userDiffDir = join(userDir, 'settings', 'inputmaps')
    await mkdir(userDiffDir, { recursive: true })

    for (const [filename, contents] of Object.entries(preset.diffs)) {
      await this.atomicWrite(join(userDiffDir, filename), contents)
    }
  }

  async deletePreset(presetId: string): Promise<void> {
    const presetPath = join(this.presetsDir, `${presetId}.json`)
    if (existsSync(presetPath)) {
      await unlink(presetPath)
    }
  }

  async exportPreset(presetId: string): Promise<ControlsPreset> {
    const presetPath = join(this.presetsDir, `${presetId}.json`)
    const raw = await readFile(presetPath, 'utf-8')
    return JSON.parse(raw) as ControlsPreset
  }

  async importPreset(jsonString: string): Promise<ControlsPreset> {
    const preset = JSON.parse(jsonString) as ControlsPreset

    // Validate shape
    if (!preset.name || !preset.diffs || typeof preset.diffs !== 'object') {
      throw new Error('Invalid preset format: missing name or diffs')
    }

    // Re-assign a new ID to avoid collisions
    preset.id = randomUUID()

    await mkdir(this.presetsDir, { recursive: true })
    const presetPath = join(this.presetsDir, `${preset.id}.json`)
    await writeFile(presetPath, JSON.stringify(preset, null, 2), 'utf-8')

    return preset
  }

  /* ── Conflict Detection ───────────────────────────────────── */

  getConflicts(
    bindings: InputBinding[],
    control: string,
    newAction: string
  ): string[] {
    return bindings
      .filter((b) => b.control === control && b.action !== newAction && !b.isRemoved)
      .map((b) => b.action)
  }

  /* ── Private Helpers ──────────────────────────────────────── */

  private async readDiffFile(diffPath: string): Promise<RawInputMapFile> {
    if (!existsSync(diffPath)) return { bindings: [], removed: [] }

    try {
      const raw = await readFile(diffPath, 'utf-8')
      return parseBeamNGJson<RawInputMapFile>(raw)
    } catch {
      return { bindings: [], removed: [] }
    }
  }

  private async writeDiffFile(diffPath: string, data: RawInputMapFile): Promise<void> {
    // Clean up empty arrays
    if (data.bindings && data.bindings.length === 0) delete data.bindings
    if (data.removed && data.removed.length === 0) delete data.removed

    // If nothing left, delete the diff file
    if (!data.bindings && !data.removed) {
      if (existsSync(diffPath)) {
        await unlink(diffPath)
      }
      return
    }

    await this.atomicWrite(diffPath, JSON.stringify(data, null, 2))
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const dir = join(filePath, '..')
    await mkdir(dir, { recursive: true })

    const tmpPath = `${filePath}.tmp`
    await writeFile(tmpPath, content, 'utf-8')
    await fsRename(tmpPath, filePath)
  }
}
