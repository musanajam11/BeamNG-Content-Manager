import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Briefcase,
  ChevronLeft,
  Loader2,
  DollarSign,
  Car,
  MapPin,
  Shield,
  Trophy,
  Star,
  Gauge,
  AlertTriangle,
  Upload,
  Save,
  FileText,
  CreditCard,
  Building2,
  RefreshCw,
  FolderOpen,
  X,
  Archive,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Truck,
  Swords,
  Heart,
  Download,
  ExternalLink,
  Server,
  Package,
  ToggleLeft,
  ToggleRight,
  Check,
  GitBranch,
  MapPinned,
  BookOpen,
  Unlock
} from 'lucide-react'

/* ── types mirrored from backend ── */
interface CareerSaveSlot {
  name: string
  creationDate: string | null
  lastSaved: string | null
  version: number | null
  corrupted: boolean
}

interface CareerProfile {
  name: string
  isRLS: boolean
  path: string
  deployed: boolean
  slots: CareerSaveSlot[]
}

interface CareerVehicleSummary {
  id: string
  name: string | null
  model: string | null
  thumbnailDataUrl: string | null
  value: number | null
  power: number | null
  torque: number | null
  weight: number | null
  odometer: number | null
  insuranceClass: string | null
  licensePlate: string | null
}

interface SkillCategory {
  key: string
  value: number
  subcategories: Array<{ key: string; value: number }>
}

interface BusinessReputation {
  name: string
  value: number
  max: number
}

interface ProfileBackupInfo {
  name: string
  profileName: string
  slotName: string | null
  timestamp: string
  path: string
}

interface CareerSaveMetadata {
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

interface CareerProfileSummary {
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
  lastServer: { serverIdent: string; serverName: string | null; lastPlayed: string } | null
}

/* ── mod release types ── */
interface CareerMPRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
  size: number
  downloads: number
}

interface RLSRelease {
  version: string
  rlsBaseVersion: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  trafficUrl: string | null
  noTrafficUrl: string | null
  trafficSize: number
  noTrafficSize: number
  downloads: number
}

interface ServerEntry {
  config: { id: string; name: string }
}

interface InstalledCareerMods {
  careerMP: { version: string; installedAt: string } | null
  rls: { version: string; traffic: boolean; installedAt: string } | null
}

/* ── helpers ── */
function formatMoney(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function formatOdometer(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
}
function formatPower(kw: number): string {
  const hp = Math.round(kw * 1.341)
  return `${hp} hp`
}
function formatWeight(kg: number): string {
  return `${Math.round(kg)} kg`
}
function formatModelName(model: string | null): string {
  if (!model) return 'Unknown'
  // Extract readable name from path like "vehicles/pessima/pessima_base.pc"
  const parts = model.replace(/^vehicles\//, '').split('/')
  const name = parts[0] || model
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}
function formatMapName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function formatSkillKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
function formatReputationName(name: string): string {
  return name
    .replace(/Reputation$/, '')
    .replace(/Dealership$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
const SKILL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  logistics: Truck,
  bmra: Swords,
  freestyle: Zap,
  careerSkills: Briefcase,
  apm: Gauge
}

export function CareerPage(): React.JSX.Element {
  const { t } = useTranslation()

  // Top-level tab: saves vs mod manager
  type TopTab = 'saves' | 'mods'
  const [topTab, setTopTab] = useState<TopTab>('saves')

  // Navigation: list → profile → slot
  type ViewMode = 'list' | 'profile' | 'slot'
  const [view, setView] = useState<ViewMode>('list')

  const [profiles, setProfiles] = useState<CareerProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Profile summaries for list view cards
  const [profileSummaries, setProfileSummaries] = useState<Record<string, CareerProfileSummary | null>>({})

  // Selected profile + slot for detail view
  const [selectedProfile, setSelectedProfile] = useState<CareerProfile | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<CareerSaveSlot | null>(null)
  const [metadata, setMetadata] = useState<CareerSaveMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  // Slot preview metadata for profile detail view
  const [slotPreviews, setSlotPreviews] = useState<Record<string, CareerSaveMetadata | null>>({})
  const [slotPreviewsLoading, setSlotPreviewsLoading] = useState(false)

  // Deploy / backup state
  const [deploying, setDeploying] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Profile backup state
  const [profileBackups, setProfileBackups] = useState<ProfileBackupInfo[]>([])
  const [showBackups, setShowBackups] = useState(false)
  const [profileBackingUp, setProfileBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Save path settings
  const [savePath, setSavePath] = useState<string | null>(null)
  const [showPathConfig, setShowPathConfig] = useState(false)

  // Expanded sections
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

  // ── Mod Manager state ──
  const [cmpReleases, setCmpReleases] = useState<CareerMPRelease[]>([])
  const [rlsReleases, setRlsReleases] = useState<RLSRelease[]>([])
  const [modLoading, setModLoading] = useState(false)
  const [modError, setModError] = useState<string | null>(null)

  // CareerMP install
  const [cmpSelectedVersion, setCmpSelectedVersion] = useState<string>('')
  const [cmpInstalling, setCmpInstalling] = useState(false)
  const [cmpMsg, setCmpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // RLS install
  const [rlsSelectedVersion, setRlsSelectedVersion] = useState<string>('')
  const [rlsCmpVersion, setRlsCmpVersion] = useState<string>('')
  const [rlsTraffic, setRlsTraffic] = useState(true)
  const [rlsInstalling, setRlsInstalling] = useState(false)
  const [rlsMsg, setRlsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Server target
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [customServerDir, setCustomServerDir] = useState<string | null>(null)
  const [installedMods, setInstalledMods] = useState<InstalledCareerMods | null>(null)

  const loadSavePath = useCallback(async () => {
    const path = await window.api.careerGetSavePath()
    setSavePath(path)
  }, [])

  useEffect(() => { loadSavePath() }, [loadSavePath])

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.careerListProfiles()
      setProfiles(result)
      // Load summaries for all profiles in parallel
      const summaryPromises = result.map(async (p) => {
        try {
          const summary = await window.api.careerGetProfileSummary(p.name)
          return [p.name, summary] as const
        } catch {
          return [p.name, null] as const
        }
      })
      const summaryResults = await Promise.all(summaryPromises)
      const summaries: Record<string, CareerProfileSummary | null> = {}
      for (const [name, summary] of summaryResults) {
        summaries[name] = summary
      }
      setProfileSummaries(summaries)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  // ── Mod manager data loading ──
  const loadModReleases = useCallback(async () => {
    setModLoading(true)
    setModError(null)
    try {
      const [cmp, rls] = await Promise.all([
        window.api.careerFetchCareerMPReleases(),
        window.api.careerFetchRLSReleases()
      ])
      setCmpReleases(cmp)
      setRlsReleases(rls)
      // Auto-select the latest release on first load AND whenever the
      // currently-selected version is no longer present in the fetched list
      // (e.g. it was a stale default or the cached selection points at a
      // version that's been yanked / superseded). This ensures users see
      // newly-published versions on refresh instead of being stuck on an
      // older pin.
      if (cmp.length > 0 && (!cmpSelectedVersion || !cmp.some((r) => r.version === cmpSelectedVersion))) {
        setCmpSelectedVersion(cmp[0].version)
      }
      if (rls.length > 0 && (!rlsSelectedVersion || !rls.some((r) => r.version === rlsSelectedVersion))) {
        setRlsSelectedVersion(rls[0].version)
      }
      if (cmp.length > 0 && (!rlsCmpVersion || !cmp.some((r) => r.version === rlsCmpVersion))) {
        setRlsCmpVersion(cmp[0].version)
      }
    } catch (err) {
      setModError(String(err))
    } finally {
      setModLoading(false)
    }
  }, [cmpSelectedVersion, rlsSelectedVersion, rlsCmpVersion])

  const loadServers = useCallback(async () => {
    try {
      const list = await window.api.hostedServerList()
      setServers(list.map((s: { config: { id: string; name: string } }) => ({
        config: { id: s.config.id, name: s.config.name }
      })))
    } catch { /* no servers configured */ }
  }, [])

  useEffect(() => {
    if (topTab === 'mods') {
      loadModReleases()
      loadServers()
    }
  }, [topTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const getActiveServerDir = useCallback(async (): Promise<string | null> => {
    if (customServerDir) return customServerDir
    if (selectedServerId) return window.api.careerGetServerDir(selectedServerId)
    return null
  }, [customServerDir, selectedServerId])

  const loadInstalledMods = useCallback(async () => {
    const dir = await getActiveServerDir()
    if (!dir) { setInstalledMods(null); return }
    try {
      const mods = await window.api.careerGetInstalledMods(dir)
      setInstalledMods(mods)
    } catch { setInstalledMods(null) }
  }, [getActiveServerDir])

  useEffect(() => { loadInstalledMods() }, [loadInstalledMods])

  const handleBrowseServerDir = useCallback(async () => {
    const dir = await window.api.careerBrowseServerDir()
    if (dir) {
      setSelectedServerId('')
      setCustomServerDir(dir)
    }
  }, [])

  const handleInstallCareerMP = useCallback(async () => {
    const dir = await getActiveServerDir()
    if (!dir) return
    const release = cmpReleases.find((r) => r.version === cmpSelectedVersion)
    if (!release) return
    setCmpInstalling(true)
    setCmpMsg(null)
    try {
      const result = await window.api.careerInstallCareerMP(release.downloadUrl, release.version, dir)
      if (result.success) {
        setCmpMsg({ type: 'success', text: t('career.mod.installSuccess', { name: `CareerMP ${release.version}` }) })
        await loadInstalledMods()
      } else {
        setCmpMsg({ type: 'error', text: result.error || t('career.mod.installFailed') })
      }
    } catch (err) {
      setCmpMsg({ type: 'error', text: String(err) })
    } finally {
      setCmpInstalling(false)
    }
  }, [getActiveServerDir, cmpReleases, cmpSelectedVersion, loadInstalledMods, t])

  const handleInstallRLS = useCallback(async () => {
    const dir = await getActiveServerDir()
    if (!dir) return
    const rlsRelease = rlsReleases.find((r) => r.version === rlsSelectedVersion)
    if (!rlsRelease) return
    const downloadUrl = rlsTraffic ? rlsRelease.trafficUrl : rlsRelease.noTrafficUrl
    if (!downloadUrl) return
    setRlsInstalling(true)
    setRlsMsg(null)
    try {
      // Install CareerMP dependency first
      const cmpRelease = cmpReleases.find((r) => r.version === rlsCmpVersion)
      if (cmpRelease) {
        const cmpResult = await window.api.careerInstallCareerMP(cmpRelease.downloadUrl, cmpRelease.version, dir)
        if (!cmpResult.success) {
          setRlsMsg({ type: 'error', text: `CareerMP install failed: ${cmpResult.error}` })
          setRlsInstalling(false)
          return
        }
      }
      // Install RLS
      const result = await window.api.careerInstallRLS(downloadUrl, rlsRelease.version, rlsTraffic, dir)
      if (result.success) {
        setRlsMsg({ type: 'success', text: t('career.mod.installSuccess', { name: `RLS ${rlsRelease.version}` }) })
        await loadInstalledMods()
      } else {
        setRlsMsg({ type: 'error', text: result.error || t('career.mod.installFailed') })
      }
    } catch (err) {
      setRlsMsg({ type: 'error', text: String(err) })
    } finally {
      setRlsInstalling(false)
    }
  }, [getActiveServerDir, rlsReleases, rlsSelectedVersion, rlsTraffic, cmpReleases, rlsCmpVersion, loadInstalledMods, t])

  const openProfile = useCallback((profile: CareerProfile) => {
    setSelectedProfile(profile)
    setSelectedSlot(null)
    setMetadata(null)
    setShowLog(false)
    setShowBackups(false)
    setActionMsg(null)
    setSlotPreviews({})
    setView('profile')
    // Load slot previews in parallel
    setSlotPreviewsLoading(true)
    Promise.all(
      profile.slots.map(async (slot) => {
        try {
          const meta = await window.api.careerGetSlotMetadata(profile.name, slot.name)
          return [slot.name, meta] as const
        } catch {
          return [slot.name, null] as const
        }
      })
    ).then((results) => {
      const previews: Record<string, CareerSaveMetadata | null> = {}
      for (const [name, meta] of results) previews[name] = meta
      setSlotPreviews(previews)
      setSlotPreviewsLoading(false)
    })
  }, [])

  const openSlot = useCallback(async (profile: CareerProfile, slot: CareerSaveSlot) => {
    setSelectedProfile(profile)
    setSelectedSlot(slot)
    setMetadata(null)
    setMetadataLoading(true)
    setActionMsg(null)
    setExpandedSkill(null)
    setView('slot')
    try {
      const meta = await window.api.careerGetSlotMetadata(profile.name, slot.name)
      setMetadata(meta)
    } catch (err) {
      console.error('Failed to load slot metadata', err)
    } finally {
      setMetadataLoading(false)
    }
  }, [])

  const loadLog = useCallback(async () => {
    if (!selectedProfile) return
    const lines = await window.api.careerGetLog(selectedProfile.name)
    setLogLines(lines)
    setShowLog(true)
  }, [selectedProfile])

  const handleDeployProfile = useCallback(async () => {
    if (!selectedProfile) return
    setDeploying(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerDeployProfile(selectedProfile.name)
      if (result.success) {
        setActionMsg({ type: 'success', text: t('career.deploySuccess') })
        await loadProfiles()
        setSelectedProfile(prev => prev ? { ...prev, deployed: true } : null)
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.deployFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setDeploying(false)
    }
  }, [selectedProfile, loadProfiles, t])

  const handleUndeployProfile = useCallback(async () => {
    if (!selectedProfile) return
    setDeploying(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerUndeployProfile(selectedProfile.name)
      if (result.success) {
        setActionMsg({ type: 'success', text: t('career.undeploySuccess') })
        await loadProfiles()
        setSelectedProfile(prev => prev ? { ...prev, deployed: false } : null)
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.undeployFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setDeploying(false)
    }
  }, [selectedProfile, loadProfiles, t])

  const handleBackupSlot = useCallback(async () => {
    if (!selectedProfile || !selectedSlot) return
    setBackingUp(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerBackupSlot(selectedProfile.name, selectedSlot.name)
      if (result.success) {
        setActionMsg({ type: 'success', text: t('career.backupSuccess', { name: result.backupName }) })
        await loadProfiles()
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.backupFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setBackingUp(false)
    }
  }, [selectedProfile, selectedSlot, loadProfiles, t])

  const goBack = useCallback(() => {
    if (view === 'slot') {
      setSelectedSlot(null)
      setMetadata(null)
      setActionMsg(null)
      setExpandedSkill(null)
      setView('profile')
    } else if (view === 'profile') {
      setSelectedProfile(null)
      setShowLog(false)
      setShowBackups(false)
      setActionMsg(null)
      setSlotPreviews({})
      setView('list')
    }
  }, [view])

  const loadProfileBackups = useCallback(async () => {
    if (!selectedProfile) return
    const backups = await window.api.careerListProfileBackups(selectedProfile.name)
    setProfileBackups(backups)
  }, [selectedProfile])

  const handleProfileBackup = useCallback(async () => {
    if (!selectedProfile) return
    setProfileBackingUp(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerBackupProfile(selectedProfile.name)
      if (result.success) {
        setActionMsg({ type: 'success', text: t('career.profileBackupSuccess', { name: result.backupName }) })
        await loadProfileBackups()
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.profileBackupFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setProfileBackingUp(false)
    }
  }, [selectedProfile, loadProfileBackups, t])

  const handleRestoreBackup = useCallback(async (backupName: string) => {
    setRestoring(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerRestoreProfileBackup(backupName)
      if (result.success) {
        setActionMsg({ type: 'success', text: t('career.restoreSuccess') })
        await loadProfiles()
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.restoreFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setRestoring(false)
    }
  }, [loadProfiles, t])

  const handleDeleteBackup = useCallback(async (backupName: string) => {
    const result = await window.api.careerDeleteProfileBackup(backupName)
    if (result.success) {
      setProfileBackups((prev) => prev.filter((b) => b.name !== backupName))
    }
  }, [])

  const handleDeleteProfile = useCallback(async () => {
    if (!selectedProfile) return
    const confirmed = window.confirm(
      t('career.deleteProfileConfirm', { name: selectedProfile.name })
    )
    if (!confirmed) return
    const withBackup = window.confirm(t('career.deleteBackupFirstPrompt'))
    setDeleting(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerDeleteProfile(selectedProfile.name, { backup: withBackup })
      if (result.success) {
        setActionMsg({
          type: 'success',
          text: result.backupName
            ? t('career.deleteProfileSuccessWithBackup', { name: result.backupName })
            : t('career.deleteProfileSuccess')
        })
        await loadProfiles()
        // return to list view since the profile no longer exists
        setSelectedProfile(null)
        setSelectedSlot(null)
        setMetadata(null)
        setShowBackups(false)
        setSlotPreviews({})
        setView('list')
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.deleteFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setDeleting(false)
    }
  }, [selectedProfile, loadProfiles, t])

  const handleDeleteSlot = useCallback(async (slotName?: string) => {
    if (!selectedProfile) return
    const targetSlot = slotName ?? selectedSlot?.name
    if (!targetSlot) return
    const confirmed = window.confirm(
      t('career.deleteSlotConfirm', { slot: targetSlot, profile: selectedProfile.name })
    )
    if (!confirmed) return
    const withBackup = window.confirm(t('career.deleteBackupFirstPrompt'))
    setDeleting(true)
    setActionMsg(null)
    try {
      const result = await window.api.careerDeleteSlot(selectedProfile.name, targetSlot, { backup: withBackup })
      if (result.success) {
        setActionMsg({
          type: 'success',
          text: result.backupName
            ? t('career.deleteSlotSuccessWithBackup', { name: result.backupName })
            : t('career.deleteSlotSuccess')
        })
        await loadProfiles()
        // refresh selected profile slot list and exit slot view if we deleted the open slot
        setSelectedProfile(prev => prev ? { ...prev, slots: prev.slots.filter(s => s.name !== targetSlot) } : null)
        setSlotPreviews(prev => {
          const next = { ...prev }
          delete next[targetSlot]
          return next
        })
        if (selectedSlot?.name === targetSlot) {
          setSelectedSlot(null)
          setMetadata(null)
          setView('profile')
        }
      } else {
        setActionMsg({ type: 'error', text: result.error || t('career.deleteFailed') })
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: String(err) })
    } finally {
      setDeleting(false)
    }
  }, [selectedProfile, selectedSlot, loadProfiles, t])

  const handleBrowseSavePath = useCallback(async () => {
    const path = await window.api.careerBrowseSavePath()
    if (path) {
      await window.api.careerSetSavePath(path)
      await loadSavePath()
      await loadProfiles()
    }
  }, [loadSavePath, loadProfiles])

  const handleClearSavePath = useCallback(async () => {
    await window.api.careerSetSavePath(null)
    await loadSavePath()
    await loadProfiles()
  }, [loadSavePath, loadProfiles])

  /* ── Slot Detail View ── */
  if (view === 'slot' && selectedProfile && selectedSlot) {
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 pb-4 border-b border-[var(--color-border)]">
          <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-active)] transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              {selectedProfile.name}
              <span className="text-sm font-normal text-[var(--text-muted)]">/ {selectedSlot.name}</span>
              {selectedProfile.isRLS && (
                <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">RLS</span>
              )}
              {selectedSlot.corrupted && (
                <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle size={12} /> {t('career.corrupted')}
                </span>
              )}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              {t('career.lastSaved')}: {formatDate(selectedSlot.lastSaved)}
              {selectedSlot.creationDate && (
                <> &middot; {t('career.created')}: {formatDate(selectedSlot.creationDate)}</>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBackupSlot}
              disabled={backingUp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors disabled:opacity-50"
            >
              {backingUp ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t('career.backupSlot')}
            </button>
            <button
              onClick={() => handleDeleteSlot()}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t('career.deleteSlot')}
            </button>
          </div>
        </div>

        {/* Action message */}
        {actionMsg && (
          <div className={`mx-6 mt-4 px-4 py-2 rounded-lg text-sm ${
            actionMsg.type === 'success' ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'
          }`}>
            {actionMsg.text}
          </div>
        )}

        {metadataLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
          </div>
        ) : metadata ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {metadata.level && (
                <StatCard icon={MapPin} label={t('career.currentMap')} value={formatMapName(metadata.level)} />
              )}
              {metadata.money !== null && (
                <StatCard icon={DollarSign} label={t('career.money')} value={formatMoney(metadata.money)} accent />
              )}
              {metadata.beamXP && (
                <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Star size={16} className="text-yellow-400" />
                    <span className="text-xs text-[var(--text-muted)]">{t('career.beamXP')}</span>
                  </div>
                  <p className="text-lg font-bold text-yellow-400">{t('career.level')} {metadata.beamXP.level}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{metadata.beamXP.value.toLocaleString()} XP</p>
                  {metadata.beamXP.neededForNext > 0 && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-[var(--color-surface-active)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-yellow-400/60 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (metadata.beamXP.curLvlProgress / metadata.beamXP.neededForNext) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {metadata.beamXP.curLvlProgress} / {metadata.beamXP.neededForNext}
                      </p>
                    </div>
                  )}
                </div>
              )}
              <StatCard icon={Car} label={t('career.vehicles')} value={String(metadata.vehicleCount)} />
              {metadata.insuranceCount > 0 && (
                <StatCard icon={Shield} label={t('career.insured')} value={`${metadata.insuranceCount} / ${metadata.vehicleCount}`} />
              )}
              {metadata.totalMissions > 0 && (
                <StatCard icon={Trophy} label={t('career.missionsCompleted')} value={`${metadata.missionCount} / ${metadata.totalMissions}`} />
              )}
              {metadata.gameplayStats.totalOdometer !== null && (
                <StatCard icon={Gauge} label={t('career.odometer')} value={formatOdometer(metadata.gameplayStats.totalOdometer)} />
              )}
              {metadata.gameplayStats.totalDriftScore !== null && (
                <StatCard icon={Star} label={t('career.driftScore')} value={metadata.gameplayStats.totalDriftScore.toLocaleString()} />
              )}
              {metadata.discoveredLocations > 0 && (
                <StatCard icon={MapPinned} label="Discovered Locations" value={String(metadata.discoveredLocations)} />
              )}
              {metadata.totalBranches > 0 && (
                <StatCard icon={Unlock} label="Branches Unlocked" value={`${metadata.unlockedBranches} / ${metadata.totalBranches}`} />
              )}
              {metadata.discoveredBusinesses.length > 0 && (
                <StatCard icon={Building2} label="Businesses Visited" value={String(metadata.discoveredBusinesses.length)} />
              )}
              {metadata.logbookEntries > 0 && (
                <StatCard icon={BookOpen} label="Logbook Entries" value={String(metadata.logbookEntries)} />
              )}
              {metadata.stamina !== null && metadata.stamina > 0 && (
                <StatCard icon={Heart} label={t('career.stamina')} value={String(metadata.stamina)} />
              )}
              {metadata.vouchers !== null && metadata.vouchers > 0 && (
                <StatCard icon={FileText} label={t('career.vouchers')} value={String(metadata.vouchers)} />
              )}
              {/* RLS-specific */}
              {metadata.isRLS && metadata.bankBalance !== null && (
                <StatCard icon={Building2} label={t('career.bankBalance')} value={formatMoney(metadata.bankBalance)} accent />
              )}
              {metadata.isRLS && metadata.creditScore !== null && (
                <StatCard icon={CreditCard} label={t('career.creditScore')} value={String(metadata.creditScore)} />
              )}
            </div>

            {/* Skills */}
            {metadata.skills.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <Zap size={18} /> {t('career.skills')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {metadata.skills.map((skill) => {
                    const Icon = SKILL_ICONS[skill.key] || Star
                    const isExpanded = expandedSkill === skill.key
                    return (
                      <div key={skill.key} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
                        <button
                          onClick={() => setExpandedSkill(isExpanded ? null : skill.key)}
                          className="w-full flex items-center justify-between p-3 hover:bg-[var(--color-surface)] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Icon size={16} className="text-[var(--color-accent)]" />
                            <span className="text-sm font-medium text-[var(--color-text-primary)]">{formatSkillKey(skill.key)}</span>
                            <span className="text-xs text-[var(--text-muted)]">{skill.value.toLocaleString()}</span>
                          </div>
                          {skill.subcategories.length > 0 && (
                            isExpanded ? <ChevronUp size={14} className="text-[var(--text-muted)]" /> : <ChevronDown size={14} className="text-[var(--text-muted)]" />
                          )}
                        </button>
                        {isExpanded && skill.subcategories.length > 0 && (
                          <div className="border-t border-[var(--color-border)] px-3 py-2 space-y-1.5">
                            {skill.subcategories.map((sub) => (
                              <div key={sub.key} className="flex items-center justify-between">
                                <span className="text-xs text-[var(--text-muted)]">{formatSkillKey(sub.key)}</span>
                                <span className="text-xs font-medium text-[var(--color-text-primary)]">{sub.value.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Reputations */}
            {metadata.reputations.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <Building2 size={18} /> {t('career.reputations')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {metadata.reputations.map((rep) => (
                    <div key={rep.name} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{formatReputationName(rep.name)}</span>
                        <span className="text-xs text-[var(--text-muted)]">{rep.value} / {rep.max}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--color-surface-active)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-accent)] rounded-full transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, (rep.value / rep.max) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vehicles */}
            {metadata.vehicles.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                  <Car size={18} /> {t('career.ownedVehicles')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {metadata.vehicles.map((v) => {
                    const isFavorite = metadata.favoriteVehicleId === v.id
                    return (
                      <div key={v.id} className={`bg-[var(--color-surface)] rounded-xl border overflow-hidden ${isFavorite ? 'border-yellow-500/40' : 'border-[var(--color-border)]'}`}>
                        {v.thumbnailDataUrl ? (
                          <img src={v.thumbnailDataUrl} alt={v.name || v.id} className="w-full h-28 object-cover bg-[var(--color-scrim-30)]" />
                        ) : (
                          <div className="w-full h-28 bg-[var(--color-scrim-20)] flex items-center justify-center">
                            <Car size={32} className="text-[var(--text-muted)]" />
                          </div>
                        )}
                        <div className="p-3 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            {isFavorite && <Star size={12} className="text-yellow-400 shrink-0" />}
                            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{v.name || formatModelName(v.model)}</p>
                          </div>
                          {v.model && v.name && (
                            <p className="text-[10px] text-[var(--text-muted)] truncate">{formatModelName(v.model)}</p>
                          )}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                            {v.value !== null && (
                              <span className="text-green-400 font-medium">{formatMoney(v.value)}</span>
                            )}
                            {v.power !== null && (
                              <span className="text-[var(--text-muted)]">{formatPower(v.power)}</span>
                            )}
                            {v.weight !== null && (
                              <span className="text-[var(--text-muted)]">{formatWeight(v.weight)}</span>
                            )}
                            {v.odometer !== null && (
                              <span className="text-[var(--text-muted)]">{formatOdometer(v.odometer)}</span>
                            )}
                          </div>
                          {(v.insuranceClass || v.licensePlate) && (
                            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                              {v.insuranceClass && (
                                <span className="flex items-center gap-0.5"><Shield size={9} /> {v.insuranceClass}</span>
                              )}
                              {v.licensePlate && (
                                <span className="bg-[var(--color-surface-active)] px-1.5 py-0.5 rounded font-mono">{v.licensePlate}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
            {t('career.noData')}
          </div>
        )}
      </div>
    )
  }

  /* ── Profile Detail View ── */
  if (view === 'profile' && selectedProfile) {
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 pb-4 border-b border-[var(--color-border)]">
          <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-active)] transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <Briefcase size={20} /> {selectedProfile.name}
              {selectedProfile.isRLS && (
                <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">RLS</span>
              )}
              {selectedProfile.deployed ? (
                <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">{t('career.deployed')}</span>
              ) : (
                <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">{t('career.undeployed')}</span>
              )}
            </h1>
            <p className="text-sm text-[var(--text-muted)]">
              {t('career.slotCount', { count: selectedProfile.slots.length })}
            </p>
          </div>
          <div className="flex gap-2">
            {selectedProfile.deployed ? (
              <button
                onClick={handleUndeployProfile}
                disabled={deploying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 transition-colors disabled:opacity-50"
              >
                {deploying ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                {t('career.undeploy')}
              </button>
            ) : (
              <button
                onClick={handleDeployProfile}
                disabled={deploying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30 transition-colors disabled:opacity-50"
              >
                {deploying ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {t('career.deploy')}
              </button>
            )}
            <button
              onClick={handleProfileBackup}
              disabled={profileBackingUp}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 transition-colors disabled:opacity-50"
            >
              {profileBackingUp ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t('career.backupProfile')}
            </button>
            <button
              onClick={() => { setShowBackups(!showBackups); if (!showBackups) loadProfileBackups() }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
            >
              <RotateCcw size={14} /> {t('career.manageBackups')}
            </button>
            <button
              onClick={loadLog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
            >
              <FileText size={14} /> {t('career.viewLog')}
            </button>
            <button
              onClick={handleDeleteProfile}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t('career.deleteProfile')}
            </button>
          </div>
        </div>

        {/* Action message */}
        {actionMsg && (
          <div className={`mx-6 mt-4 px-4 py-2 rounded-lg text-sm ${
            actionMsg.type === 'success' ? 'bg-green-500/15 text-green-300 border border-green-500/30' : 'bg-red-500/15 text-red-300 border border-red-500/30'
          }`}>
            {actionMsg.text}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Backups Panel */}
          {showBackups && (
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <Archive size={16} /> {t('career.profileBackups')}
              </h3>
              {profileBackups.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{t('career.noBackups')}</p>
              ) : (
                <div className="space-y-2">
                  {profileBackups.map((backup) => (
                    <div key={backup.name} className="flex items-center justify-between bg-[var(--color-scrim-20)] rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-[var(--color-text-primary)]">
                          {backup.slotName ? `${t('career.backupSlot')}: ${backup.slotName}` : t('career.backupProfile')}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">{formatDate(backup.timestamp)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRestoreBackup(backup.name)}
                          disabled={restoring}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50"
                        >
                          {restoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          {t('career.restore')}
                        </button>
                        <button
                          onClick={() => handleDeleteBackup(backup.name)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors"
                        >
                          <Trash2 size={12} /> {t('career.deleteBackup')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Save Slots */}
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
              <Save size={18} /> {t('career.saveSlots')}
              {slotPreviewsLoading && <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />}
            </h2>
            <div className="space-y-4">
              {selectedProfile.slots.map((slot) => {
                const preview = slotPreviews[slot.name]
                return (
                  <div
                    key={slot.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => openSlot(selectedProfile, slot)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSlot(selectedProfile, slot) } }}
                    className="w-full bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] hover:border-[var(--color-accent-25)] transition-colors text-left overflow-hidden cursor-pointer"
                  >
                    <div className="p-4">
                      {/* Slot header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Save size={16} className="text-[var(--color-accent)]" />
                          <div>
                            <p className="text-sm font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                              {slot.name}
                              {slot.corrupted && (
                                <span className="text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                  <AlertTriangle size={10} /> Corrupted
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {slot.lastSaved && slot.lastSaved !== '0'
                                ? `${t('career.lastSaved')}: ${formatDate(slot.lastSaved)}`
                                : 'No save data'}
                              {slot.creationDate && (
                                <> &middot; Created: {formatDate(slot.creationDate)}</>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeleteSlot(slot.name) }}
                            disabled={deleting}
                            title={t('career.deleteSlot')}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors disabled:opacity-50"
                          >
                            <Trash2 size={12} />
                          </button>
                          <ChevronLeft size={14} className="text-[var(--text-muted)] rotate-180" />
                        </div>
                      </div>

                      {/* Slot preview stats */}
                      {preview && !slot.corrupted && (
                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
                          {preview.level && (
                            <span className="flex items-center gap-1 text-[var(--text-muted)]">
                              <MapPin size={12} /> {formatMapName(preview.level)}
                            </span>
                          )}
                          {preview.money !== null && (
                            <span className="flex items-center gap-1 text-green-400">
                              <DollarSign size={12} /> {formatMoney(preview.money)}
                            </span>
                          )}
                          {preview.beamXP && (
                            <span className="flex items-center gap-1 text-yellow-400">
                              <Star size={12} /> Lvl {preview.beamXP.level}
                            </span>
                          )}
                          {preview.vehicleCount > 0 && (
                            <span className="flex items-center gap-1 text-[var(--text-muted)]">
                              <Car size={12} /> {preview.vehicleCount} vehicles
                            </span>
                          )}
                          {preview.gameplayStats.totalOdometer !== null && (
                            <span className="flex items-center gap-1 text-[var(--text-muted)]">
                              <Gauge size={12} /> {formatOdometer(preview.gameplayStats.totalOdometer)}
                            </span>
                          )}
                          {preview.totalMissions > 0 && (
                            <span className="flex items-center gap-1 text-[var(--text-muted)]">
                              <Trophy size={12} /> {preview.missionCount}/{preview.totalMissions} missions
                            </span>
                          )}
                          {preview.isRLS && preview.bankBalance !== null && (
                            <span className="flex items-center gap-1 text-green-400">
                              <Building2 size={12} /> {formatMoney(preview.bankBalance)}
                            </span>
                          )}
                          {preview.isRLS && preview.creditScore !== null && (
                            <span className="flex items-center gap-1 text-[var(--text-muted)]">
                              <CreditCard size={12} /> Score {preview.creditScore}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Vehicle thumbnails strip */}
                      {preview && preview.vehicles.length > 0 && !slot.corrupted && (
                        <div className="flex gap-2 mt-3 overflow-hidden">
                          {preview.vehicles.slice(0, 6).map((v) => (
                            <div key={v.id} className="shrink-0 w-16 h-10 rounded-lg overflow-hidden border border-[var(--color-border)]">
                              {v.thumbnailDataUrl ? (
                                <img src={v.thumbnailDataUrl} alt={v.name || v.id} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-[var(--color-scrim-20)] flex items-center justify-center">
                                  <Car size={12} className="text-[var(--text-muted)]" />
                                </div>
                              )}
                            </div>
                          ))}
                          {preview.vehicles.length > 6 && (
                            <div className="shrink-0 w-16 h-10 rounded-lg bg-[var(--color-scrim-20)] flex items-center justify-center text-[10px] text-[var(--text-muted)] border border-[var(--color-border)]">
                              +{preview.vehicles.length - 6}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Career Log */}
          {showLog && logLines.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
                <FileText size={18} /> {t('career.activityLog')}
              </h2>
              <div className="bg-[var(--color-scrim-30)] rounded-xl border border-[var(--color-border)] p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
                {logLines.slice(-100).reverse().map((line, i) => (
                  <div key={i} className="text-[var(--text-muted)] hover:text-[var(--color-text-primary)] transition-colors">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ── Profile List View ── */
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <Briefcase size={22} /> {t('career.title')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{t('career.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPathConfig(!showPathConfig)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
          >
            <FolderOpen size={14} /> {t('career.savePath')}
          </button>
          <button
            onClick={loadProfiles}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Top-level tabs */}
      <div className="flex gap-1 px-6 pt-4">
        <button
          onClick={() => setTopTab('saves')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${topTab === 'saves' ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] border border-b-0 border-[var(--color-border)]' : 'text-[var(--text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]'}`}
        >
          <Briefcase size={14} className="inline mr-1.5 -mt-0.5" />
          {t('career.mod.saves')}
        </button>
        <button
          onClick={() => setTopTab('mods')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${topTab === 'mods' ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] border border-b-0 border-[var(--color-border)]' : 'text-[var(--text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)]'}`}
        >
          <Package size={14} className="inline mr-1.5 -mt-0.5" />
          {t('career.mod.modManager')}
        </button>
      </div>

      {/* Save path configuration */}
      {topTab === 'saves' && showPathConfig && (
        <div className="mx-6 mt-4 p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">{t('career.savePathTitle')}</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">{t('career.savePathDescription')}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-1.5 text-xs bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--text-muted)] truncate">
              {savePath || t('career.autoDetected')}
            </div>
            <button
              onClick={handleBrowseSavePath}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent-subtle)] hover:bg-[var(--color-accent-25)] text-[var(--color-accent-text-muted)] border border-[var(--color-accent-25)] transition-colors"
            >
              <FolderOpen size={12} /> {t('career.browse')}
            </button>
            {savePath && (
              <button
                onClick={handleClearSavePath}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
              >
                <X size={12} /> {t('career.resetToAuto')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Saves Tab Content */}
      {topTab === 'saves' && (
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertTriangle size={40} className="mx-auto mb-3 text-red-400" />
              <p className="text-red-300">{error}</p>
            </div>
          ) : profiles.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{t('career.noProfiles')}</h2>
              <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">{t('career.noProfilesDescription')}</p>
            </div>
          ) : (
            <ProfileListGrouped profiles={profiles} openProfile={openProfile} summaries={profileSummaries} t={t} />
          )}
        </div>
      )}

      {/* Mod Manager Tab Content */}
      {topTab === 'mods' && (
        <ModManagerPanel
          modLoading={modLoading}
          modError={modError}
          cmpReleases={cmpReleases}
          rlsReleases={rlsReleases}
          cmpSelectedVersion={cmpSelectedVersion}
          setCmpSelectedVersion={setCmpSelectedVersion}
          rlsSelectedVersion={rlsSelectedVersion}
          setRlsSelectedVersion={setRlsSelectedVersion}
          rlsCmpVersion={rlsCmpVersion}
          setRlsCmpVersion={setRlsCmpVersion}
          rlsTraffic={rlsTraffic}
          setRlsTraffic={setRlsTraffic}
          cmpInstalling={cmpInstalling}
          rlsInstalling={rlsInstalling}
          cmpMsg={cmpMsg}
          rlsMsg={rlsMsg}
          servers={servers}
          selectedServerId={selectedServerId}
          setSelectedServerId={setSelectedServerId}
          customServerDir={customServerDir}
          installedMods={installedMods}
          handleBrowseServerDir={handleBrowseServerDir}
          handleInstallCareerMP={handleInstallCareerMP}
          handleInstallRLS={handleInstallRLS}
          loadModReleases={loadModReleases}
          getActiveServerDir={getActiveServerDir}
          t={t}
        />
      )}
    </div>
  )
}

/* ── Mod Manager Panel sub-component ── */
function ModManagerPanel({ modLoading, modError, cmpReleases, rlsReleases, cmpSelectedVersion, setCmpSelectedVersion, rlsSelectedVersion, setRlsSelectedVersion, rlsCmpVersion, setRlsCmpVersion, rlsTraffic, setRlsTraffic, cmpInstalling, rlsInstalling, cmpMsg, rlsMsg, servers, selectedServerId, setSelectedServerId, customServerDir, installedMods, handleBrowseServerDir, handleInstallCareerMP, handleInstallRLS, loadModReleases, getActiveServerDir, t }: {
  modLoading: boolean
  modError: string | null
  cmpReleases: CareerMPRelease[]
  rlsReleases: RLSRelease[]
  cmpSelectedVersion: string
  setCmpSelectedVersion: (v: string) => void
  rlsSelectedVersion: string
  setRlsSelectedVersion: (v: string) => void
  rlsCmpVersion: string
  setRlsCmpVersion: (v: string) => void
  rlsTraffic: boolean
  setRlsTraffic: (v: boolean) => void
  cmpInstalling: boolean
  rlsInstalling: boolean
  cmpMsg: { type: 'success' | 'error'; text: string } | null
  rlsMsg: { type: 'success' | 'error'; text: string } | null
  servers: ServerEntry[]
  selectedServerId: string
  setSelectedServerId: (v: string) => void
  customServerDir: string | null
  installedMods: InstalledCareerMods | null
  handleBrowseServerDir: () => void
  handleInstallCareerMP: () => void
  handleInstallRLS: () => void
  loadModReleases: () => void
  getActiveServerDir: () => Promise<string | null>
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Server target selector */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Server size={16} /> {t('career.mod.selectServer')}
          </h3>
          <button
            onClick={loadModReleases}
            disabled={modLoading}
            title={t('common.refresh')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={modLoading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedServerId}
            onChange={(e) => setSelectedServerId(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
          >
            <option value="">{customServerDir || t('career.mod.selectServer')}</option>
            {servers.map((s) => (
              <option key={s.config.id} value={s.config.id}>{s.config.name}</option>
            ))}
          </select>
          <button
            onClick={handleBrowseServerDir}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
          >
            <FolderOpen size={14} /> {t('career.mod.customDir')}
          </button>
        </div>
        {customServerDir && (
          <p className="text-xs text-[var(--text-muted)] mt-2 truncate">{customServerDir}</p>
        )}
      </div>

      {modLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 size={28} className="animate-spin text-[var(--color-accent)]" />
        </div>
      ) : modError ? (
        <div className="text-center py-8">
          <AlertTriangle size={32} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-300 text-sm">{modError}</p>
          <button onClick={loadModReleases} className="mt-3 text-xs text-[var(--color-accent)] hover:underline">{t('common.retry')}</button>
        </div>
      ) : (
        <>
          {/* CareerMP & RLS side-by-side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CareerMP section */}
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <Package size={16} className="text-[var(--color-accent)]" /> {t('career.mod.careerMP')}
              </h3>
              <a
                href="https://github.com/StanleyDudek/CareerMP"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1"
              >
                <ExternalLink size={12} /> GitHub
              </a>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">{t('career.mod.careerMPBlurb')}</p>

            {installedMods?.careerMP && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 rounded-lg border border-green-500/20">
                <Check size={14} className="text-green-400" />
                <span className="text-xs text-green-300">{t('career.mod.installed')}: v{installedMods.careerMP.version}</span>
              </div>
            )}

            <div className="space-y-2">
              <select
                value={cmpSelectedVersion}
                onChange={(e) => setCmpSelectedVersion(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                {cmpReleases.map((r) => (
                  <option key={r.version} value={r.version}>
                    {r.version} {r.prerelease ? '(pre-release)' : ''} — {(r.size / 1024).toFixed(0)} KB
                  </option>
                ))}
              </select>
              <button
                onClick={handleInstallCareerMP}
                disabled={cmpInstalling || !selectedServerId && !customServerDir}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-text-primary)] font-medium transition-colors disabled:opacity-50"
              >
                {cmpInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Install CareerMP Only
              </button>
            </div>
            {cmpMsg && (
              <p className={`text-xs mt-2 ${cmpMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{cmpMsg.text}</p>
            )}
          </div>

          {/* RLS section */}
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <Star size={16} className="text-purple-400" /> {t('career.mod.rls')}
              </h3>
              <a
                href="https://github.com/PapiCheesecake/rls_careermp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1"
              >
                <ExternalLink size={12} /> GitHub
              </a>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">{t('career.mod.rlsBlurb')}</p>

            {installedMods?.rls && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-green-500/10 rounded-lg border border-green-500/20">
                <Check size={14} className="text-green-400" />
                <span className="text-xs text-green-300">
                  {t('career.mod.installed')}: v{installedMods.rls.version}
                  {installedMods.rls.traffic ? ` (${t('career.mod.traffic')})` : ` (${t('career.mod.noTraffic')})`}
                </span>
              </div>
            )}

            {/* RLS version picker */}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">{t('career.mod.version')}</label>
                <select
                  value={rlsSelectedVersion}
                  onChange={(e) => setRlsSelectedVersion(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
                >
                  {rlsReleases.map((r) => (
                    <option key={r.version} value={r.version}>
                      {r.version} (RLS base {r.rlsBaseVersion}) — {(r.trafficSize / 1024 / 1024).toFixed(0)} MB
                    </option>
                  ))}
                </select>
              </div>

              {/* CareerMP dependency version for RLS */}
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block flex items-center gap-1">
                  <GitBranch size={12} /> {t('career.mod.cmpDependency')}
                </label>
                <select
                  value={rlsCmpVersion}
                  onChange={(e) => setRlsCmpVersion(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
                >
                  {cmpReleases.map((r) => (
                    <option key={r.version} value={r.version}>
                      CareerMP {r.version} {r.prerelease ? '(pre-release)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Traffic toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">{t('career.mod.traffic')}</span>
                <button
                  onClick={() => setRlsTraffic(!rlsTraffic)}
                  className="flex items-center gap-2 text-sm"
                >
                  {rlsTraffic ? (
                    <><ToggleRight size={24} className="text-green-400" /><span className="text-xs text-green-400">{t('career.mod.traffic')}</span></>
                  ) : (
                    <><ToggleLeft size={24} className="text-[var(--text-muted)]" /><span className="text-xs text-[var(--text-muted)]">{t('career.mod.noTraffic')}</span></>
                  )}
                </button>
              </div>

              <button
                onClick={handleInstallRLS}
                disabled={rlsInstalling || !selectedServerId && !customServerDir}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-500 text-[var(--color-text-primary)] font-medium transition-colors disabled:opacity-50"
              >
                {rlsInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Install CareerMP+RLS
              </button>
            </div>
            {rlsMsg && (
              <p className={`text-xs mt-2 ${rlsMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{rlsMsg.text}</p>
            )}
          </div>
          </div>

          {/* Plugin Browser */}
          <PluginBrowserPanel
            getActiveServerDir={getActiveServerDir}
            t={t}
          />
        </>
      )}
    </div>
  )
}

/* ── Plugin Browser sub-component ── */
type PluginCompat = 'careerMP' | 'rls' | 'both' | 'beamMP'
interface PluginCatalogEntry {
  id: string
  name: string
  description: string
  author: string
  repo: string
  homepage: string
  compat: PluginCompat
  installMethod: 'extract-to-root' | 'extract-to-server-plugin' | 'copy-client-zip'
  serverPluginFolder?: string
}
interface PluginRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
  size: number
  downloads: number
}
interface InstalledPlugin {
  pluginId: string
  version: string
  installedAt: string
  artifacts: string[]
}

function compatBadge(compat: PluginCompat, t: (k: string) => string): { label: string; className: string } {
  switch (compat) {
    case 'careerMP':
      return { label: t('career.plugin.compatCMP'), className: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-[var(--color-accent)]/30' }
    case 'rls':
      return { label: t('career.plugin.compatRLS'), className: 'bg-purple-500/15 text-purple-300 border-purple-500/30' }
    case 'both':
      return { label: t('career.plugin.compatBoth'), className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
    case 'beamMP':
    default:
      return { label: t('career.plugin.compatBeamMP'), className: 'bg-sky-500/15 text-sky-300 border-sky-500/30' }
  }
}

function PluginBrowserPanel({ getActiveServerDir, t }: {
  getActiveServerDir: () => Promise<string | null>
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([])
  const [releasesByPlugin, setReleasesByPlugin] = useState<Record<string, PluginRelease[]>>({})
  const [selectedVersionByPlugin, setSelectedVersionByPlugin] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<Record<string, InstalledPlugin>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({})
  const [filter, setFilter] = useState<'all' | PluginCompat>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.careerListPluginCatalog()
      setCatalog(list)
      // Fetch releases in parallel
      const results = await Promise.all(
        list.map(async (p) => {
          try {
            const r = await window.api.careerFetchPluginReleases(p.id)
            return [p.id, r] as const
          } catch {
            return [p.id, [] as PluginRelease[]] as const
          }
        })
      )
      const map: Record<string, PluginRelease[]> = {}
      const sel: Record<string, string> = {}
      for (const [id, rels] of results) {
        map[id] = rels
        if (rels.length > 0) sel[id] = rels[0].version
      }
      setReleasesByPlugin(map)
      setSelectedVersionByPlugin(sel)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshInstalled = useCallback(async () => {
    const dir = await getActiveServerDir()
    if (!dir) { setInstalled({}); return }
    try {
      const inst = await window.api.careerGetInstalledPlugins(dir)
      setInstalled(inst)
    } catch { setInstalled({}) }
  }, [getActiveServerDir])

  useEffect(() => { loadCatalog() }, [loadCatalog])
  useEffect(() => { refreshInstalled() }, [refreshInstalled])

  const handleInstall = useCallback(async (entry: PluginCatalogEntry) => {
    const dir = await getActiveServerDir()
    if (!dir) {
      setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: t('career.plugin.noServer') } }))
      return
    }
    const version = selectedVersionByPlugin[entry.id]
    const release = (releasesByPlugin[entry.id] || []).find((r) => r.version === version)
    if (!release) return
    setBusy((b) => ({ ...b, [entry.id]: true }))
    setMsg((m) => { const c = { ...m }; delete c[entry.id]; return c })
    try {
      const result = await window.api.careerInstallPlugin(entry.id, release.version, release.downloadUrl, dir)
      if (result.success) {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'success', text: t('career.plugin.installSuccess', { name: entry.name }) } }))
        await refreshInstalled()
      } else {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: result.error || t('career.plugin.installFailed') } }))
      }
    } catch (err) {
      setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: String(err) } }))
    } finally {
      setBusy((b) => ({ ...b, [entry.id]: false }))
    }
  }, [getActiveServerDir, selectedVersionByPlugin, releasesByPlugin, refreshInstalled, t])

  const handleUninstall = useCallback(async (entry: PluginCatalogEntry) => {
    const dir = await getActiveServerDir()
    if (!dir) return
    setBusy((b) => ({ ...b, [entry.id]: true }))
    try {
      const result = await window.api.careerUninstallPlugin(entry.id, dir)
      if (result.success) {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'success', text: t('career.plugin.uninstalled', { name: entry.name }) } }))
        await refreshInstalled()
      } else {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: result.error || t('career.plugin.uninstallFailed') } }))
      }
    } catch (err) {
      setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: String(err) } }))
    } finally {
      setBusy((b) => ({ ...b, [entry.id]: false }))
    }
  }, [getActiveServerDir, refreshInstalled, t])

  const filtered = catalog.filter((p) => {
    if (filter === 'all') return true
    return p.compat === filter
  })

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <Package size={16} className="text-[var(--color-accent)]" /> {t('career.plugin.title')}
        </h3>
        <button
          onClick={() => { loadCatalog(); refreshInstalled() }}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{t('career.plugin.blurb')}</p>

      {/* Compat filter */}
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'careerMP', 'rls', 'both'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filter === f
                ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-text-primary)]'
                : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t(`career.plugin.filter.${f}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
        </div>
      ) : error ? (
        <div className="text-center py-6">
          <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={loadCatalog} className="mt-2 text-xs text-[var(--color-accent)] hover:underline">{t('common.retry')}</button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">{t('career.plugin.noResults')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((entry) => {
            const releases = releasesByPlugin[entry.id] || []
            const isInstalled = !!installed[entry.id]
            const installedVer = installed[entry.id]?.version
            const isBusy = !!busy[entry.id]
            const m = msg[entry.id]
            const badge = compatBadge(entry.compat, t)
            return (
              <div key={entry.id} className="bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{entry.name}</h4>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.className}`}>{badge.label}</span>
                      {isInstalled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-green-500/15 text-green-300 border-green-500/30 flex items-center gap-1">
                          <Check size={10} /> v{installedVer}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{t('career.plugin.by', { author: entry.author })}</p>
                  </div>
                  <a href={entry.homepage} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1 shrink-0">
                    <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-xs text-[var(--text-muted)] line-clamp-2">{entry.description}</p>

                {releases.length > 0 ? (
                  <select
                    value={selectedVersionByPlugin[entry.id] || ''}
                    onChange={(e) => setSelectedVersionByPlugin((s) => ({ ...s, [entry.id]: e.target.value }))}
                    className="w-full px-2 py-1 text-xs bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
                  >
                    {releases.map((r) => (
                      <option key={r.version} value={r.version}>
                        {r.version} {r.prerelease ? '(pre)' : ''} — {(r.size / 1024).toFixed(0)} KB
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)] italic">{t('career.plugin.noReleases')}</p>
                )}

                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => handleInstall(entry)}
                    disabled={isBusy || releases.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-text-primary)] font-medium transition-colors disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    {isInstalled ? t('career.plugin.reinstall') : t('career.plugin.install')}
                  </button>
                  {isInstalled && (
                    <button
                      onClick={() => handleUninstall(entry)}
                      disabled={isBusy}
                      title={t('career.plugin.uninstall')}
                      className="px-2 py-1.5 text-xs rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {m && (
                  <p className={`text-[11px] ${m.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>{m.text}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Profile List Grouped sub-component ── */
function ProfileListGrouped({ profiles, openProfile, summaries, t }: {
  profiles: CareerProfile[]
  openProfile: (p: CareerProfile) => void
  summaries: Record<string, CareerProfileSummary | null>
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const careerMPProfiles = profiles.filter((p) => !p.isRLS)
  const rlsProfiles = profiles.filter((p) => p.isRLS)

  return (
    <div className="space-y-6">
      {/* CareerMP Saves */}
      {careerMPProfiles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
            <Briefcase size={16} className="text-[var(--color-accent)]" />
            {t('career.mod.careerMPSaves')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {careerMPProfiles.map((profile) => (
              <ProfileCard key={profile.name} profile={profile} summary={summaries[profile.name] ?? null} openProfile={openProfile} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* RLS Saves */}
      {rlsProfiles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2">
            <Star size={16} className="text-purple-400" />
            {t('career.mod.rlsSaves')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rlsProfiles.map((profile) => (
              <ProfileCard key={profile.name} profile={profile} summary={summaries[profile.name] ?? null} openProfile={openProfile} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Profile Card sub-component ── */
function ProfileCard({ profile, summary, openProfile, t }: {
  profile: CareerProfile
  summary: CareerProfileSummary | null
  openProfile: (p: CareerProfile) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  return (
    <button
      onClick={() => openProfile(profile)}
      className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden hover:border-[var(--color-accent-25)] transition-colors text-left"
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          <Briefcase size={18} className="text-[var(--color-accent)]" />
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{profile.name}</h3>
          {profile.isRLS && (
            <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">RLS</span>
          )}
          {profile.deployed ? (
            <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">{t('career.deployed')}</span>
          ) : (
            <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">{t('career.undeployed')}</span>
          )}
          <ChevronLeft size={14} className="text-[var(--text-muted)] rotate-180 ml-auto shrink-0" />
        </div>

        {/* Summary stats */}
        {summary ? (
          <div className="space-y-2">
            {/* Primary stats row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {summary.level && (
                <span className="flex items-center gap-1 text-[var(--text-muted)]">
                  <MapPin size={12} /> {formatMapName(summary.level)}
                </span>
              )}
              {summary.money !== null && (
                <span className="flex items-center gap-1 text-green-400 font-medium">
                  <DollarSign size={12} /> {formatMoney(summary.money)}
                </span>
              )}
              {summary.beamXPLevel !== null && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <Star size={12} /> Level {summary.beamXPLevel}
                </span>
              )}
              {summary.vehicleCount > 0 && (
                <span className="flex items-center gap-1 text-[var(--text-muted)]">
                  <Car size={12} /> {summary.vehicleCount} vehicles
                </span>
              )}
            </div>

            {/* Secondary stats row */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
              {summary.totalOdometer !== null && (
                <span className="flex items-center gap-1">
                  <Gauge size={11} /> {formatOdometer(summary.totalOdometer)}
                </span>
              )}
              {summary.totalMissions > 0 && (
                <span className="flex items-center gap-1">
                  <Trophy size={11} /> {summary.missionCount}/{summary.totalMissions} missions
                </span>
              )}
              {summary.discoveredBusinesses > 0 && (
                <span className="flex items-center gap-1">
                  <Building2 size={11} /> {summary.discoveredBusinesses} businesses
                </span>
              )}
              {summary.discoveredLocations > 0 && (
                <span className="flex items-center gap-1">
                  <MapPinned size={11} /> {summary.discoveredLocations} locations
                </span>
              )}
              {/* RLS-specific */}
              {profile.isRLS && summary.bankBalance !== null && (
                <span className="flex items-center gap-1 text-green-400">
                  <Building2 size={11} /> Bank: {formatMoney(summary.bankBalance)}
                </span>
              )}
              {profile.isRLS && summary.creditScore !== null && (
                <span className="flex items-center gap-1">
                  <CreditCard size={11} /> Credit: {summary.creditScore}
                </span>
              )}
            </div>

            {/* Server association */}
            {summary.lastServer && (
              <div className="flex items-center gap-1.5 text-[11px] text-blue-400">
                <Server size={11} />
                <span className="truncate" title={summary.lastServer.serverName ?? summary.lastServer.serverIdent}>
                  {summary.lastServer.serverName ?? summary.lastServer.serverIdent}
                </span>
              </div>
            )}

            {/* Bottom info row */}
            <div className="flex items-center justify-between pt-1 border-t border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--text-muted)]">
                {t('career.slotCount', { count: profile.slots.length })}
                {summary.lastSaved && <> &middot; Last saved: {formatDate(summary.lastSaved)}</>}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-[var(--text-muted)]">
              {t('career.slotCount', { count: profile.slots.length })}
            </p>
          </div>
        )}
      </div>
    </button>
  )
}

/* ── Stat Card sub-component ── */
function StatCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  sub?: string
  accent?: boolean
}): React.JSX.Element {
  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={accent ? 'text-green-400' : 'text-[var(--text-muted)]'} />
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <p className={`text-lg font-bold ${accent ? 'text-green-400' : 'text-[var(--color-text-primary)]'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
