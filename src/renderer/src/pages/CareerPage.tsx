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
  Heart
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
  skills: SkillCategory[]
  reputations: BusinessReputation[]
  stamina: number | null
  vouchers: number | null
}

/* ── helpers ── */
function formatMoney(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function formatOdometer(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
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

  // Navigation: list → profile → slot
  type ViewMode = 'list' | 'profile' | 'slot'
  const [view, setView] = useState<ViewMode>('list')

  const [profiles, setProfiles] = useState<CareerProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selected profile + slot for detail view
  const [selectedProfile, setSelectedProfile] = useState<CareerProfile | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<CareerSaveSlot | null>(null)
  const [metadata, setMetadata] = useState<CareerSaveMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const [showLog, setShowLog] = useState(false)

  // Deploy / backup state
  const [deploying, setDeploying] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Profile backup state
  const [profileBackups, setProfileBackups] = useState<ProfileBackupInfo[]>([])
  const [showBackups, setShowBackups] = useState(false)
  const [profileBackingUp, setProfileBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // Save path settings
  const [savePath, setSavePath] = useState<string | null>(null)
  const [showPathConfig, setShowPathConfig] = useState(false)

  // Expanded sections
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)

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
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const openProfile = useCallback((profile: CareerProfile) => {
    setSelectedProfile(profile)
    setSelectedSlot(null)
    setMetadata(null)
    setShowLog(false)
    setShowBackups(false)
    setActionMsg(null)
    setView('profile')
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
          <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors disabled:opacity-50"
            >
              {backingUp ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {t('career.backupSlot')}
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
                <div className="bg-white/5 rounded-xl border border-[var(--color-border)] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Star size={16} className="text-yellow-400" />
                    <span className="text-xs text-[var(--text-muted)]">{t('career.beamXP')}</span>
                  </div>
                  <p className="text-lg font-bold text-yellow-400">{t('career.level')} {metadata.beamXP.level}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{metadata.beamXP.value.toLocaleString()} XP</p>
                  {metadata.beamXP.neededForNext > 0 && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
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
                <StatCard icon={Shield} label={t('career.insured')} value={String(metadata.insuranceCount)} />
              )}
              {metadata.missionCount > 0 && (
                <StatCard icon={Trophy} label={t('career.missionsCompleted')} value={String(metadata.missionCount)} />
              )}
              {metadata.gameplayStats.totalOdometer !== null && (
                <StatCard icon={Gauge} label={t('career.odometer')} value={formatOdometer(metadata.gameplayStats.totalOdometer)} />
              )}
              {metadata.gameplayStats.totalDriftScore !== null && (
                <StatCard icon={Star} label={t('career.driftScore')} value={metadata.gameplayStats.totalDriftScore.toLocaleString()} />
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
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <Zap size={18} /> {t('career.skills')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {metadata.skills.map((skill) => {
                    const Icon = SKILL_ICONS[skill.key] || Star
                    const isExpanded = expandedSkill === skill.key
                    return (
                      <div key={skill.key} className="bg-white/5 rounded-xl border border-[var(--color-border)] overflow-hidden">
                        <button
                          onClick={() => setExpandedSkill(isExpanded ? null : skill.key)}
                          className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Icon size={16} className="text-[var(--color-accent)]" />
                            <span className="text-sm font-medium text-white">{formatSkillKey(skill.key)}</span>
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
                                <span className="text-xs font-medium text-white">{sub.value.toLocaleString()}</span>
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
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <Building2 size={18} /> {t('career.reputations')}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {metadata.reputations.map((rep) => (
                    <div key={rep.name} className="bg-white/5 rounded-xl border border-[var(--color-border)] p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-white truncate">{formatReputationName(rep.name)}</span>
                        <span className="text-xs text-[var(--text-muted)]">{rep.value} / {rep.max}</span>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
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
                <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <Car size={18} /> {t('career.ownedVehicles')}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {metadata.vehicles.map((v) => (
                    <div key={v.id} className="bg-white/5 rounded-xl border border-[var(--color-border)] overflow-hidden">
                      {v.thumbnailDataUrl ? (
                        <img src={v.thumbnailDataUrl} alt={v.name || v.id} className="w-full h-24 object-cover bg-black/30" />
                      ) : (
                        <div className="w-full h-24 bg-black/20 flex items-center justify-center">
                          <Car size={28} className="text-[var(--text-muted)]" />
                        </div>
                      )}
                      <div className="p-2">
                        <p className="text-xs font-medium text-white truncate">{v.name || v.model || `Vehicle ${v.id}`}</p>
                        {v.model && v.name && (
                          <p className="text-[10px] text-[var(--text-muted)] truncate">{v.model}</p>
                        )}
                      </div>
                    </div>
                  ))}
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
          <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors"
            >
              <RotateCcw size={14} /> {t('career.manageBackups')}
            </button>
            <button
              onClick={loadLog}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors"
            >
              <FileText size={14} /> {t('career.viewLog')}
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
            <div className="bg-white/5 rounded-xl border border-[var(--color-border)] p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Archive size={16} /> {t('career.profileBackups')}
              </h3>
              {profileBackups.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{t('career.noBackups')}</p>
              ) : (
                <div className="space-y-2">
                  {profileBackups.map((backup) => (
                    <div key={backup.name} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm text-white">
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
            <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Save size={18} /> {t('career.saveSlots')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selectedProfile.slots.map((slot) => (
                <button
                  key={slot.name}
                  onClick={() => openSlot(selectedProfile, slot)}
                  className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-accent-25)] transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <Save size={16} className="text-[var(--color-accent)]" />
                    <div>
                      <p className="text-sm font-medium text-white">{slot.name}</p>
                      {slot.lastSaved && (
                        <p className="text-xs text-[var(--text-muted)]">{t('career.lastSaved')}: {formatDate(slot.lastSaved)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {slot.corrupted && <AlertTriangle size={14} className="text-red-400" />}
                    <ChevronLeft size={14} className="text-[var(--text-muted)] rotate-180" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Career Log */}
          {showLog && logLines.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <FileText size={18} /> {t('career.activityLog')}
              </h2>
              <div className="bg-black/30 rounded-xl border border-[var(--color-border)] p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
                {logLines.slice(-100).reverse().map((line, i) => (
                  <div key={i} className="text-[var(--text-muted)] hover:text-white transition-colors">
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
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Briefcase size={22} /> {t('career.title')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">{t('career.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPathConfig(!showPathConfig)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors"
          >
            <FolderOpen size={14} /> {t('career.savePath')}
          </button>
          <button
            onClick={loadProfiles}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Save path configuration */}
      {showPathConfig && (
        <div className="mx-6 mt-4 p-4 bg-white/5 rounded-xl border border-[var(--color-border)]">
          <h3 className="text-sm font-medium text-white mb-2">{t('career.savePathTitle')}</h3>
          <p className="text-xs text-[var(--text-muted)] mb-3">{t('career.savePathDescription')}</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-3 py-1.5 text-xs bg-black/20 rounded-lg border border-[var(--color-border)] text-[var(--text-muted)] truncate">
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--color-border)] transition-colors"
              >
                <X size={12} /> {t('career.resetToAuto')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
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
            <h2 className="text-lg font-semibold text-white mb-2">{t('career.noProfiles')}</h2>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">{t('career.noProfilesDescription')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profiles.map((profile) => (
              <button
                key={profile.name}
                onClick={() => openProfile(profile)}
                className="bg-white/5 rounded-xl border border-[var(--color-border)] overflow-hidden hover:border-[var(--color-accent-25)] transition-colors text-left"
              >
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Briefcase size={18} className="text-[var(--color-accent)]" />
                    <h3 className="text-base font-semibold text-white">{profile.name}</h3>
                    {profile.isRLS && (
                      <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">RLS</span>
                    )}
                    {profile.deployed ? (
                      <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">{t('career.deployed')}</span>
                    ) : (
                      <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">{t('career.undeployed')}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-[var(--text-muted)]">
                      {t('career.slotCount', { count: profile.slots.length })}
                    </p>
                    <ChevronLeft size={14} className="text-[var(--text-muted)] rotate-180" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
    <div className="bg-white/5 rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={accent ? 'text-green-400' : 'text-[var(--text-muted)]'} />
        <span className="text-xs text-[var(--text-muted)]">{label}</span>
      </div>
      <p className={`text-lg font-bold ${accent ? 'text-green-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}
