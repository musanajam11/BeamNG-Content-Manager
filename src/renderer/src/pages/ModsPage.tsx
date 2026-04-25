import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Package,
  Search,
  FolderOpen,
  Plus,
  Trash2,
  ToggleRight,
  HardDrive,
  MapPin,
  Car,
  HelpCircle,
  RefreshCw,
  ExternalLink,
  Star,
  Download,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  LogIn,
  LogOut,
  User,
  CheckCircle,
  Database,
  ArrowUpCircle,
  AlertTriangle,
  Info,
  Shield,
  BadgeCheck,
  Volume2,
  Layout,
  Flag,
  Paintbrush,
  RectangleHorizontal,
  Cog,
  Monitor,
  Server,
  GripVertical,
  ShieldAlert,
  Scan
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ModInfo, RepoMod, RepoCategory, RepoSortOrder } from '../../../shared/types'
import type { AvailableMod, BeamModMetadata, RegistrySearchResult, ResolutionResult, InstalledRegistryMod } from '../../../shared/registry-types'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useBoundedCache } from '../hooks/useBoundedCache'
import { useTranslation } from 'react-i18next'
import { useModOrderStore } from '../stores/useModOrderStore'

type ModFilter = string
type ModsTab = 'installed' | 'browse' | 'registry'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const MOD_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'mods.allTypes' },
  { value: 'vehicle', label: 'mods.vehicleType' },
  { value: 'terrain', label: 'mods.mapType' },
  { value: 'skin', label: 'mods.skinType' },
  { value: 'ui_app', label: 'mods.uiApps' },
  { value: 'sound', label: 'mods.sounds' },
  { value: 'scenario', label: 'mods.scenarios' },
  { value: 'license_plate', label: 'mods.licensePlates' },
  { value: 'automation', label: 'mods.automation' },
  { value: 'other', label: 'mods.otherType' }
]

function modTypeIcon(modType: string): React.ReactNode {
  switch (modType) {
    case 'terrain':
    case 'map':
      return <MapPin size={13} className="text-emerald-400" />
    case 'vehicle':
      return <Car size={13} className="text-sky-400" />
    case 'sound':
      return <Volume2 size={13} className="text-purple-400" />
    case 'ui_app':
      return <Layout size={13} className="text-cyan-400" />
    case 'scenario':
      return <Flag size={13} className="text-amber-400" />
    case 'skin':
      return <Paintbrush size={13} className="text-pink-400" />
    case 'license_plate':
      return <RectangleHorizontal size={13} className="text-yellow-400" />
    case 'automation':
      return <Cog size={13} className="text-orange-400" />
    case 'other':
      return <Package size={13} className="text-[var(--color-text-secondary)]" />
    default:
      return <HelpCircle size={13} className="text-[var(--color-text-muted)]" />
  }
}

export function ModsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ModsTab>('installed')
  const [registryUpdates, setRegistryUpdates] = useState(0)
  const [deleteVersion, setDeleteVersion] = useState(0)
  const { t } = useTranslation()

  useEffect(() => {
    window.api.registryGetUpdatesAvailable().then((updates) => {
      setRegistryUpdates(updates.length)
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Top-level tab bar */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-4 pt-4 pb-0">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('mods.title')}</h1>
          <div className="flex gap-2 -mb-px">
            <button
              onClick={() => setActiveTab('installed')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'installed'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Package size={13} /> {t('mods.installed')}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'browse'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Globe size={13} /> {t('mods.browse')}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('registry')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'registry'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Database size={13} /> {t('mods.registry')}
                {registryUpdates > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-[var(--color-accent)] text-[var(--color-text-primary)] rounded-full leading-none">
                    {registryUpdates}
                  </span>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Tab content — both mounted, hidden via CSS to preserve state */}
      <div className={activeTab === 'installed' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
        <InstalledModsView onModDeleted={() => setDeleteVersion((v) => v + 1)} />
      </div>
      <div className={activeTab === 'browse' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
        <BrowseModsView />
      </div>
      <div className={activeTab === 'registry' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
        <RegistryBrowseView onUpdatesChange={setRegistryUpdates} deleteVersion={deleteVersion} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   Sortable table row for drag-and-drop
   ═══════════════════════════════════════════ */

function SortableModRow({
  mod,
  isSelected,
  toggleDisabled,
  isBusy,
  conflictCount,
  isOverridden,
  registrySource,
  onSelect,
  onToggle,
  onDelete,
  t
}: {
  mod: ModInfo
  isSelected: boolean
  toggleDisabled: boolean
  isBusy: boolean
  conflictCount: number
  isOverridden: boolean
  registrySource: 'registry' | 'manual' | null
  onSelect: (mod: ModInfo) => void
  onToggle: (mod: ModInfo) => void
  onDelete: (mod: ModInfo) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: mod.key })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect(mod)}
      className={`border-b border-[var(--color-border)] cursor-pointer transition ${
        isSelected
          ? 'bg-[var(--color-accent-8)]'
          : 'hover:bg-[var(--color-surface)]'
      }`}
    >
      {/* Drag handle */}
      <td className="px-2 py-3 w-8">
        {mod.enabled && (
          <button
            {...attributes}
            {...listeners}
            className="text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] cursor-grab active:cursor-grabbing touch-none"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </button>
        )}
      </td>

      {/* Load order # */}
      <td className="px-2 py-3 w-10 text-center">
        {mod.loadOrder !== null && mod.enabled && (
          <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
            {mod.loadOrder + 1}
          </span>
        )}
      </td>

      {/* Toggle */}
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={(e) => {
            e.stopPropagation()
            onToggle(mod)
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={toggleDisabled}
          className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          title={mod.enabled ? t('mods.disableMod') : t('mods.enableMod')}
        />
      </td>

      {/* Mod name + conflict indicator */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[var(--color-text-primary)] truncate max-w-[260px]">
              {mod.title || mod.fileName}
            </div>
            {mod.title && (
              <div className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[260px]">
                {mod.fileName}
              </div>
            )}
            {mod.author && (
              <div className="text-[11px] text-[var(--color-text-muted)]">{t('mods.byAuthor', { author: mod.author })}</div>
            )}
          </div>
          {registrySource === 'registry' && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 shrink-0 text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded"
              title={t('mods.registryVerified')}
            >
              <BadgeCheck size={10} />
              Registry
            </span>
          )}
          {registrySource === 'manual' && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 shrink-0 text-[var(--color-text-secondary)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded"
              title={t('mods.manualImport')}
            >
              <FolderOpen size={10} />
              Manual
            </span>
          )}
          {conflictCount > 0 && (
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 shrink-0 ${
                isOverridden
                  ? 'text-amber-400 bg-amber-400/10 border border-amber-400/20'
                  : 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20'
              }`}
              title={isOverridden
                ? t('mods.conflictsOverridden', { count: conflictCount })
                : t('mods.conflictsWins', { count: conflictCount })}
            >
              <ShieldAlert size={10} />
              {conflictCount}
            </span>
          )}
        </div>
      </td>

      {/* Type */}
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          {modTypeIcon(mod.modType)}
          {mod.modType || t('mods.otherType')}
        </div>
      </td>

      {/* Size */}
      <td className="px-4 py-3 text-right text-xs text-[var(--color-text-secondary)]">
        {formatBytes(mod.sizeBytes)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right">
        {mod.location !== 'multiplayer' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(mod)
            }}
            disabled={isBusy}
            className="text-[var(--color-text-muted)] transition hover:text-rose-400 disabled:opacity-40"
            title={t('mods.deleteMod')}
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

/* ═══════════════════════════════════════════
   Installed Mods View
   ═══════════════════════════════════════════ */

function InstalledModsView({ onModDeleted }: { onModDeleted: () => void }): React.JSX.Element {
  const [mods, setMods] = useState<ModInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<ModFilter>('')
  const [selectedMod, setSelectedMod] = useState<ModInfo | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  // Bounded LRU cache for mod preview images. Each preview is a base64 data URL
  // that can easily be 100-300 KB; without bounding, clicking through hundreds
  // of mods would retain all of them in renderer memory for the session.
  const previewCache = useBoundedCache<string | null>(20)
  const [registryInstalled, setRegistryInstalled] = useState<Record<string, InstalledRegistryMod>>({})
  const [scopeDialogMods, setScopeDialogMods] = useState<ModInfo[]>([])
  const [scopeDialogIndex, setScopeDialogIndex] = useState(0)
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()
  const { t } = useTranslation()

  // Load order store
  const {
    enforcement,
    conflictReport,
    scanningConflicts,
    fetchLoadOrder,
    setLoadOrder,
    setEnforcement,
    scanConflicts,
    getModConflictCount,
    isModOverridden
  } = useModOrderStore()

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const isModToggleable = useCallback((mod: ModInfo): boolean => {
    const key = mod.key.trim().toLowerCase()
    const fileName = mod.fileName.trim().toLowerCase()
    if (mod.location === 'multiplayer') return false
    // BeamMP is required for multiplayer and should never be bulk/row toggled.
    if (key === 'beammp' || fileName === 'beammp.zip') return false
    return true
  }, [])

  const fetchMods = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getMods()
      if (result.success && result.data) {
        setMods(result.data)
      } else {
        setError(result.error || t('mods.failedToLoadMods'))
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMods()
    fetchLoadOrder()
    window.api.registryGetInstalled().then(setRegistryInstalled).catch(() => {})
  }, [])

  // Fetch preview image when a mod is selected
  useEffect(() => {
    if (!selectedMod) return
    const key = selectedMod.filePath
    if (previewCache.has(key)) return // already fetched or fetching
    previewCache.set(key, null)
    window.api.getModPreview(selectedMod.filePath).then((result) => {
      if (result.success && result.data) {
        previewCache.set(key, result.data)
      }
    })
  }, [selectedMod])

  // Match a ModInfo to its registry entry by checking installed_files
  const findRegistryEntry = useCallback((mod: ModInfo): InstalledRegistryMod | undefined => {
    const modFile = mod.fileName.toLowerCase()
    for (const entry of Object.values(registryInstalled)) {
      if (entry.installed_files.some((f) => {
        const fname = f.replace(/\\/g, '/').split('/').pop() || f
        return fname.toLowerCase() === modFile
      })) {
        return entry
      }
    }
    // Also try matching by mod key as identifier
    return registryInstalled[mod.key]
  }, [registryInstalled])

  const selectedRegistryEntry = useMemo(() => {
    if (!selectedMod) return undefined
    return findRegistryEntry(selectedMod)
  }, [selectedMod, findRegistryEntry])

  const filteredMods = useMemo(() => {
    let result = mods

    // Type filter
    if (filter) {
      result = result.filter((m) => {
        if (filter === 'terrain') return m.modType === 'terrain' || m.modType === 'map'
        if (filter === 'other') return m.modType === 'unknown' || m.modType === 'other'
        return m.modType === filter
      })
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (m) =>
          (m.title || m.fileName).toLowerCase().includes(q) ||
          m.fileName.toLowerCase().includes(q) ||
          (m.author && m.author.toLowerCase().includes(q)) ||
          m.modType.toLowerCase().includes(q)
      )
    }

    // Sort: enabled first (by load order), then disabled alphabetically
    result = [...result].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      // Both enabled: sort by load order
      if (a.enabled && b.enabled) {
        const orderA = a.loadOrder ?? 999
        const orderB = b.loadOrder ?? 999
        if (orderA !== orderB) return orderA - orderB
      }
      const nameA = (a.title || a.fileName).toLowerCase()
      const nameB = (b.title || b.fileName).toLowerCase()
      return nameA.localeCompare(nameB)
    })

    return result
  }, [mods, filter, searchQuery])

  const summary = useMemo(() => {
    const total = mods.length
    const enabled = mods.filter((m) => m.enabled).length
    const totalSize = mods.reduce((sum, m) => sum + m.sizeBytes, 0)
    const terrain = mods.filter((m) => m.modType === 'terrain').length
    const vehicle = mods.filter((m) => m.modType === 'vehicle').length
    return { total, enabled, totalSize, terrain, vehicle }
  }, [mods])

  const handleToggle = async (mod: ModInfo): Promise<void> => {
    if (!isModToggleable(mod)) return
    setActionPending(mod.key)
    try {
      const newState = !mod.enabled
      const result = await window.api.toggleMod(mod.key, newState)
      if (result.success) {
        setMods((prev) =>
          prev.map((m) => (m.key === mod.key ? { ...m, enabled: newState } : m))
        )
        if (selectedMod?.key === mod.key) {
          setSelectedMod({ ...selectedMod, enabled: newState })
        }
      } else {
        // Keep UI in sync with on-disk state if backend rejected the toggle.
        await fetchMods()
      }
    } finally {
      setActionPending(null)
    }
  }

  const handleSetAllEnabled = async (enabled: boolean): Promise<void> => {
    const modsToUpdate = mods.filter((m) => isModToggleable(m) && m.enabled !== enabled)
    if (modsToUpdate.length === 0) return

    setBulkPending(true)
    try {
      // Apply sequentially: each IPC toggle rewrites db.json, so parallel writes
      // can race and drop updates.
      for (const mod of modsToUpdate) {
        const result = await window.api.toggleMod(mod.key, enabled)
        if (!result.success) {
          console.warn(`[ModsPage] Failed to bulk-toggle ${mod.key}: ${result.error || 'unknown error'}`)
        }
      }
      const refreshed = await window.api.getMods()
      if (refreshed.success && refreshed.data) {
        setMods(refreshed.data)
        setSelectedMod((prev) => {
          if (!prev) return prev
          const updated = refreshed.data?.find((m) => m.key === prev.key)
          return updated ?? prev
        })
      } else {
        await fetchMods()
      }
    } finally {
      setBulkPending(false)
    }
  }

  const handleDelete = async (mod: ModInfo): Promise<void> => {
    // Check if other mods depend on this one
    try {
      const reverseDeps = await window.api.registryCheckReverseDeps([mod.key])
      if (reverseDeps.length > 0) {
        const depList = reverseDeps.join(', ')
        const ok = await confirm({
          title: t('mods.dependencyWarning'),
          message: `${t('mods.dependsOn')}\n${depList}`,
          confirmLabel: t('mods.deleteAnyway'),
          variant: 'warning'
        })
        if (!ok) return
      }
    } catch { /* registry may not track this mod — proceed */ }

    // Check if this mod is deployed on any servers
    try {
      const servers = await window.api.hostedServerGetServersWithMod(mod.fileName)
      if (servers.length > 0) {
        const serverList = servers.map((s) => s.name).join(', ')
        const ok = await confirm({
          title: t('mods.deployedOnServers'),
          message: `"${mod.title || mod.fileName}" is deployed on ${servers.length} server(s): ${serverList}`,
          confirmLabel: t('mods.uninstallRemove'),
          variant: 'danger'
        })
        if (!ok) return
        // Undeploy from all servers
        for (const s of servers) {
          try {
            await window.api.hostedServerUndeployMod(s.id, mod.fileName)
          } catch { /* best effort */ }
        }
      }
    } catch { /* server check not critical */ }

    setActionPending(mod.key)
    const result = await window.api.deleteMod(mod.key)
    if (result.success) {
      setMods((prev) => prev.filter((m) => m.key !== mod.key))
      if (selectedMod?.key === mod.key) setSelectedMod(null)
      onModDeleted()
    }
    setActionPending(null)
  }

  const handleInstall = async (): Promise<void> => {
    const result = await window.api.installMod()
    if (result.success && result.data && result.data.length > 0) {
      setScopeDialogMods(result.data)
      setScopeDialogIndex(0)
      fetchMods()
    }
  }

  const handleScopeSelect = async (scope: 'client' | 'server' | 'both'): Promise<void> => {
    const mod = scopeDialogMods[scopeDialogIndex]
    if (mod) {
      await window.api.updateModScope(mod.key, scope)
    }
    const nextIndex = scopeDialogIndex + 1
    if (nextIndex < scopeDialogMods.length) {
      setScopeDialogIndex(nextIndex)
    } else {
      setScopeDialogMods([])
      setScopeDialogIndex(0)
      fetchMods()
    }
  }

  const handleOpenFolder = (): void => {
    window.api.openModsFolder()
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const enabledMods = filteredMods.filter((m) => m.enabled)
    const oldIndex = enabledMods.findIndex((m) => m.key === active.id)
    const newIndex = enabledMods.findIndex((m) => m.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(enabledMods, oldIndex, newIndex)
    const orderedKeys = reordered.map((m) => m.key)

    // Optimistically update local mod state
    setMods((prev) => {
      const updated = [...prev]
      for (const mod of updated) {
        const idx = orderedKeys.indexOf(mod.key)
        mod.loadOrder = idx >= 0 ? idx : null
      }
      return updated
    })

    setLoadOrder(orderedKeys)
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 pt-2 pb-3 space-y-3">
        {/* Action row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!loading && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                {t('mods.modCount', { count: summary.total })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSetAllEnabled(true)}
              disabled={bulkPending || loading || mods.every((m) => !isModToggleable(m) || m.enabled)}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-50"
              title={`${t('mods.enableMod')} (${t('common.all')})`}
            >
              <ToggleRight size={13} />
              {t('mods.enableMod')} ({t('common.all')})
            </button>
            <button
              onClick={() => handleSetAllEnabled(false)}
              disabled={bulkPending || loading || mods.every((m) => !isModToggleable(m) || !m.enabled)}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-50"
              title={`${t('mods.disableMod')} (${t('common.all')})`}
            >
              <ToggleRight size={13} className="rotate-180" />
              {t('mods.disableMod')} ({t('common.all')})
            </button>
            {/* Enforcement toggle */}
            <button
              onClick={() => setEnforcement(!enforcement)}
              className={`inline-flex items-center gap-1.5 border px-3 py-2 text-xs transition ${
                enforcement
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]'
              }`}
              title={t('mods.enforcementTooltip')}
            >
              <Shield size={13} />
              {t('mods.enforceOrder')}
            </button>
            {/* Scan conflicts */}
            <button
              onClick={scanConflicts}
              disabled={scanningConflicts}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-50"
              title={t('mods.scanConflictsTooltip')}
            >
              {scanningConflicts ? <Loader2 size={13} className="animate-spin" /> : <Scan size={13} />}
              {t('mods.scanConflicts')}
            </button>
            <button
              onClick={fetchMods}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)]"
              title={t('common.refresh')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)]"
            >
              <FolderOpen size={13} />
              {t('mods.openFolder')}
            </button>
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
            >
              <Plus size={13} />
              {t('mods.installMod')}
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <Package size={11} /> {t('mods.totalMods')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.total}</div>
          </div>
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <ToggleRight size={11} /> {t('mods.enabledCount')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{summary.enabled}</div>
          </div>
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <HardDrive size={11} /> {t('mods.diskUsage')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{formatBytes(summary.totalSize)}</div>
          </div>
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-secondary)] mb-1">
              <MapPin size={11} /> {t('mods.mapsVehicles')}
            </div>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">
              {summary.terrain} / {summary.vehicle}
            </div>
          </div>
        </div>

        {/* Search + filter tabs */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('mods.searchMods')}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] pr-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }}
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
          >
            {MOD_TYPE_FILTERS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[var(--color-base)] text-[var(--color-text-primary)]">
                {t(o.label)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error &&  (
        <div className="mx-4 mt-3 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {loading && mods.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm">
            {t('mods.loadingMods')}
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)]">
            <Package size={40} strokeWidth={1} />
            <p className="text-sm">
              {mods.length === 0 ? t('mods.noModsInstalled') : t('mods.noModsMatch')}
            </p>
            {mods.length === 0 && (
              <button
                onClick={handleInstall}
                className="mt-2 inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
              >
                <Plus size={13} />
                {t('mods.installFirstMod')}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mod list */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--color-base)] border-b border-[var(--color-border)]">
                    <tr className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                      <th className="w-8 px-2 py-2.5"></th>
                      <th className="w-10 px-2 py-2.5 font-medium text-center">#</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t('mods.tableStatus')}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t('mods.tableMod')}</th>
                      <th className="text-left px-4 py-2.5 font-medium">{t('mods.tableType')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('mods.tableSize')}</th>
                      <th className="text-right px-4 py-2.5 font-medium">{t('mods.tableActions')}</th>
                    </tr>
                  </thead>
                  <SortableContext
                    items={filteredMods.filter((m) => m.enabled).map((m) => m.key)}
                    strategy={verticalListSortingStrategy}
                  >
                    <tbody>
                      {filteredMods.map((mod) => (
                        <SortableModRow
                          key={mod.key}
                          mod={mod}
                          isSelected={selectedMod?.key === mod.key}
                          toggleDisabled={bulkPending || actionPending === mod.key || !isModToggleable(mod)}
                          isBusy={bulkPending || actionPending === mod.key}
                          conflictCount={getModConflictCount(mod.key)}
                          isOverridden={isModOverridden(mod.key)}
                          registrySource={
                            (() => {
                              const entry = findRegistryEntry(mod)
                              if (entry) return entry.install_source === 'registry' ? 'registry' : null
                              if (mod.location !== 'multiplayer') return 'manual'
                              return null
                            })()
                          }
                          onSelect={(m) => setSelectedMod(selectedMod?.key === m.key ? null : m)}
                          onToggle={handleToggle}
                          onDelete={handleDelete}
                          t={t}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </table>
              </DndContext>
            </div>

            {/* Detail panel */}
            {selectedMod && (
              <div className="w-[340px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                    {selectedRegistryEntry?.metadata.name || selectedMod.title || selectedMod.fileName}
                  </h2>
                  {(selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine) && (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      {selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine}
                    </p>
                  )}
                </div>

                {/* Preview image */}
                {previewCache.get(selectedMod.filePath) && (
                  <img
                    src={previewCache.get(selectedMod.filePath)!}
                    alt={selectedMod.title || selectedMod.fileName}
                    className="w-full object-cover border border-[var(--color-border)]"
                  />
                )}

                {/* Registry tags */}
                {selectedRegistryEntry?.metadata.tags && selectedRegistryEntry.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedRegistryEntry.metadata.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Description */}
                {selectedRegistryEntry?.metadata.description && (
                  <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border)] pt-3">
                    {selectedRegistryEntry.metadata.description}
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('common.file')}</span>
                    <span className="text-[var(--color-text-secondary)] truncate ml-4 max-w-[180px]">{selectedMod.fileName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('common.type')}</span>
                    {(selectedMod.modType === 'unknown' || selectedMod.modType === 'other') && !selectedRegistryEntry?.metadata.mod_type ? (
                      <select
                        value={selectedMod.modType}
                        onChange={async (e) => {
                          const newType = e.target.value
                          const result = await window.api.updateModType(selectedMod.key, newType)
                          if (result.success) {
                            setMods((prev) => prev.map((m) => m.key === selectedMod.key ? { ...m, modType: newType } : m))
                          }
                        }}
                        className="text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] rounded px-1 py-0.5 outline-none focus:border-[var(--color-border-accent)]"
                      >
                        <option value="unknown">{t('mods.otherType')}</option>
                        <option value="terrain">{t('mods.mapType')}</option>
                        <option value="vehicle">{t('mods.vehicleType')}</option>
                        <option value="sound">{t('mods.sounds')}</option>
                        <option value="ui_app">{t('mods.uiApps')}</option>
                      </select>
                    ) : (
                      <span className="text-[var(--color-text-secondary)] inline-flex items-center gap-1">
                        {modTypeIcon(selectedMod.modType)}
                        {selectedRegistryEntry?.metadata.mod_type || selectedMod.modType}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('common.size')}</span>
                    <span className="text-[var(--color-text-secondary)]">{formatBytes(selectedMod.sizeBytes)}</span>
                  </div>
                  {(selectedRegistryEntry?.metadata.author || selectedMod.author) && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.author')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {Array.isArray(selectedRegistryEntry?.metadata.author)
                          ? selectedRegistryEntry!.metadata.author.join(', ')
                          : selectedRegistryEntry?.metadata.author || selectedMod.author}
                      </span>
                    </div>
                  )}
                  {(selectedRegistryEntry?.metadata.version || selectedMod.version) && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.version')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {selectedRegistryEntry?.metadata.version || selectedMod.version}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.license && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.license')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {Array.isArray(selectedRegistryEntry.metadata.license)
                          ? selectedRegistryEntry.metadata.license.join(', ')
                          : selectedRegistryEntry.metadata.license}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.release_status && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.release')}</span>
                      <span className={`capitalize ${
                        selectedRegistryEntry.metadata.release_status === 'stable'
                          ? 'text-emerald-400'
                          : selectedRegistryEntry.metadata.release_status === 'testing'
                            ? 'text-amber-400'
                            : 'text-orange-400'
                      }`}>
                        {selectedRegistryEntry.metadata.release_status}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.release_date && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.released')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {new Date(selectedRegistryEntry.metadata.release_date).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.source')}</span>
                      <span className="text-[var(--color-text-secondary)] capitalize">{selectedRegistryEntry.install_source}</span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.installed')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {new Date(selectedRegistryEntry.install_time).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('mods.location')}</span>
                    <span className="text-[var(--color-text-secondary)]">{selectedMod.location}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('common.status')}</span>
                    <span className={selectedMod.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}>
                      {selectedMod.enabled ? t('common.enabled') : t('common.disabled')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-text-muted)]">{t('mods.modified')}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      {new Date(selectedMod.modifiedDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* External links */}
                {selectedRegistryEntry?.metadata.resources && (
                  <div className="border-t border-[var(--color-border)] pt-3 space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">{t('common.links')}</span>
                    {Object.entries(selectedRegistryEntry.metadata.resources).map(([key, url]) => (
                      <a
                        key={key}
                        href={url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-[var(--color-accent-text)] hover:underline"
                      >
                        <ExternalLink size={11} />
                        {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </a>
                    ))}
                  </div>
                )}

                {/* Dependencies */}
                {selectedRegistryEntry?.metadata.depends && selectedRegistryEntry.metadata.depends.length > 0 && (
                  <div className="border-t border-[var(--color-border)] pt-3 space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">{t('mods.dependencies')}</span>
                    {selectedRegistryEntry.metadata.depends.map((dep) => {
                      const depName = 'identifier' in dep ? dep.identifier : dep.any_of.map(r => r.identifier).join(' | ')
                      return (
                        <div key={depName} className="text-xs text-[var(--color-text-secondary)] flex items-center gap-1">
                          <Package size={10} className="text-[var(--color-text-muted)]" /> {depName}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* File Conflicts */}
                {(() => {
                  const conflicts = conflictReport
                    ? conflictReport.conflicts.filter((c) => c.mods.some((m) => m.modKey === selectedMod.key))
                    : []
                  if (conflicts.length === 0) return null
                  const overridden = conflicts.filter((c) => c.winner !== selectedMod.key)
                  const wins = conflicts.filter((c) => c.winner === selectedMod.key)
                  return (
                    <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                        {t('mods.fileConflicts')} ({conflicts.length})
                      </span>
                      {overridden.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] text-amber-400 font-medium">{t('mods.overriddenBy')} ({overridden.length})</div>
                          {overridden.slice(0, 10).map((c) => (
                            <div key={c.filePath} className="text-[11px] text-[var(--color-text-secondary)] truncate" title={c.filePath}>
                              <span className="text-amber-400/60">↓</span> {c.filePath.split('/').pop()} → {c.winner}
                            </div>
                          ))}
                          {overridden.length > 10 && (
                            <div className="text-[10px] text-[var(--color-text-muted)]">+{overridden.length - 10} {t('common.more')}</div>
                          )}
                        </div>
                      )}
                      {wins.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] text-emerald-400 font-medium">{t('mods.winsOver')} ({wins.length})</div>
                          {wins.slice(0, 10).map((c) => {
                            const losers = c.mods.filter((m) => m.modKey !== selectedMod.key).map((m) => m.modKey)
                            return (
                              <div key={c.filePath} className="text-[11px] text-[var(--color-text-secondary)] truncate" title={c.filePath}>
                                <span className="text-emerald-400/60">↑</span> {c.filePath.split('/').pop()} → {losers.join(', ')}
                              </div>
                            )
                          })}
                          {wins.length > 10 && (
                            <div className="text-[10px] text-[var(--color-text-muted)]">+{wins.length - 10} {t('common.more')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Actions */}
                {isModToggleable(selectedMod) && (
                  <div className="flex gap-2 pt-2">
                    <label
                      className="flex-1 inline-flex items-center justify-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMod.enabled}
                        onChange={() => handleToggle(selectedMod)}
                        disabled={actionPending === selectedMod.key}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {selectedMod.enabled ? t('common.enabled') : t('common.disabled')}
                    </label>
                    <button
                      onClick={() => handleDelete(selectedMod)}
                      disabled={actionPending === selectedMod.key}
                      className="inline-flex items-center justify-center gap-1.5 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 size={13} /> {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* Mod Scope Classification Dialog */}
      {scopeDialogMods.length > 0 && scopeDialogIndex < scopeDialogMods.length && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--color-scrim-60)]" />
          <div className="relative w-full max-w-sm bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('mods.classifyModScope')}
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t('mods.classifyModScopeDesc', { name: scopeDialogMods[scopeDialogIndex].title || scopeDialogMods[scopeDialogIndex].fileName })}
              </p>
              {scopeDialogMods.length > 1 && (
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  ({scopeDialogIndex + 1} / {scopeDialogMods.length})
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleScopeSelect('client')}
                className="flex items-center gap-3 px-4 py-3 text-left bg-[var(--color-surface)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Monitor size={18} className="text-blue-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('mods.scopeClientOnly')}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{t('mods.scopeClientOnlyDesc')}</div>
                </div>
              </button>
              <button
                onClick={() => handleScopeSelect('both')}
                className="flex items-center gap-3 px-4 py-3 text-left bg-[var(--color-surface)] border border-purple-400/30 hover:bg-purple-400/5 transition-colors"
              >
                <Server size={18} className="text-purple-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('mods.scopeClientServer')}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{t('mods.scopeClientServerDesc')}</div>
                </div>
              </button>
              <button
                onClick={() => handleScopeSelect('server')}
                className="flex items-center gap-3 px-4 py-3 text-left bg-[var(--color-surface)] border border-orange-400/30 hover:bg-orange-400/5 transition-colors"
              >
                <Server size={18} className="text-orange-400 shrink-0" />
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{t('mods.scopeServerOnly')}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{t('mods.scopeServerOnlyDesc')}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialogEl}
    </>
  )
}

/* ═══════════════════════════════════════════
   Browse Mods View (BeamNG.com Repository)
   ═══════════════════════════════════════════ */

const SORT_OPTIONS: { value: RepoSortOrder; label: string }[] = [
  { value: 'download_count', label: 'mods.mostDownloaded' },
  { value: 'rating_weighted', label: 'mods.bestRated' },
  { value: 'last_update', label: 'mods.recentlyUpdated' },
  { value: 'resource_date', label: 'mods.newest' },
  { value: 'title', label: 'mods.alphabetical' }
]

function StarRating({ rating }: { rating: number }): React.JSX.Element {
  const stars: React.ReactNode[] = []
  for (let i = 1; i <= 5; i++) {
    const fill = Math.min(1, Math.max(0, rating - (i - 1)))
    stars.push(
      <Star
        key={i}
        size={11}
        className={fill >= 0.5 ? 'text-[var(--color-accent)] fill-[var(--color-accent)]' : 'text-[var(--color-text-dim)]'}
      />
    )
  }
  return <span className="inline-flex items-center gap-px">{stars}</span>
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function BrowseModsView(): React.JSX.Element {
  const [categories, setCategories] = useState<RepoCategory[]>([])
  const [selectedCategory, setSelectedCategory] = useState(0)
  const [sort, setSort] = useState<RepoSortOrder>('download_count')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [mods, setMods] = useState<RepoMod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedMod, setSelectedMod] = useState<RepoMod | null>(null)
  // Bounded LRU cache for repo browse thumbnails. The user can paginate
  // through hundreds of pages of mods; without bounding, every thumb
  // (~10-100 KB base64) accumulates in renderer memory for the session.
  const thumbCache = useBoundedCache<string>(120)
  const [downloading, setDownloading] = useState<number | null>(null) // resourceId
  const [downloadProgress, setDownloadProgress] = useState<{
    received: number
    total: number
    fileName: string
  } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [beamngLoggedIn, setBeamngLoggedIn] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [installedResourceIds, setInstalledResourceIds] = useState<Set<number>>(new Set())
  const [installedTitles, setInstalledTitles] = useState<Set<string>>(new Set())
  const { t } = useTranslation()

  // Load categories
  useEffect(() => {
    window.api.getRepoCategories().then(setCategories)
  }, [])

  // Load installed resource IDs and titles from local mod list on mount
  useEffect(() => {
    window.api.getMods().then((result) => {
      if (result.success && result.data) {
        const ids = new Set<number>()
        const titles = new Set<string>()
        for (const mod of result.data) {
          if (mod.resourceId) ids.add(mod.resourceId)
          if (mod.title) titles.add(mod.title.toLowerCase().trim())
        }
        if (ids.size > 0) setInstalledResourceIds(ids)
        if (titles.size > 0) setInstalledTitles(titles)
      }
    })
  }, [])

  // Check BeamNG.com login status
  useEffect(() => {
    window.api.beamngWebLoggedIn().then((r) => setBeamngLoggedIn(r.loggedIn))
  }, [])

  const handleBeamngLogin = async (): Promise<void> => {
    setLoginLoading(true)
    try {
      const result = await window.api.beamngWebLogin()
      setBeamngLoggedIn(result.success)
    } finally {
      setLoginLoading(false)
    }
  }

  const handleBeamngLogout = async (): Promise<void> => {
    await window.api.beamngWebLogout()
    setBeamngLoggedIn(false)
  }

  // Fetch thumbnails when mods change — proxy through main process to avoid CSP
  useEffect(() => {
    const urls = mods.map((m) => m.thumbnailUrl).filter(Boolean)
    if (urls.length === 0) return
    // Only fetch URLs we don't already have cached
    const missing = urls.filter((u) => !thumbCache.has(u))
    if (missing.length === 0) return
    window.api.getRepoThumbnails(missing).then((result) => {
      for (const [url, dataUrl] of Object.entries(result)) {
        thumbCache.set(url, dataUrl as string)
      }
    })
  }, [mods])

  // Fetch mods when params change
  const fetchMods = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let result: { success: boolean; data?: { mods: RepoMod[]; currentPage: number; totalPages: number }; error?: string }
      if (searchQuery) {
        result = await window.api.searchRepoMods(searchQuery, page)
      } else {
        result = await window.api.browseRepoMods(selectedCategory, page, sort)
      }
      if (result.success && result.data) {
        setMods(result.data.mods)
        setTotalPages(result.data.totalPages)
      } else {
        setError(result.error || t('mods.failedToLoadMods'))
        setMods([])
      }
    } catch (err) {
      setError(String(err))
      setMods([])
    } finally {
      setLoading(false)
    }
  }, [selectedCategory, sort, page, searchQuery])

  useEffect(() => {
    fetchMods()
  }, [fetchMods])

  const handleSearch = (): void => {
    const trimmed = searchInput.trim()
    setSearchQuery(trimmed)
    setPage(1)
  }

  const handleClearSearch = (): void => {
    setSearchInput('')
    setSearchQuery('')
    setPage(1)
  }

  const handleCategoryChange = (catId: number): void => {
    setSelectedCategory(catId)
    setPage(1)
    setSearchQuery('')
    setSearchInput('')
  }

  const handleSortChange = (newSort: RepoSortOrder): void => {
    setSort(newSort)
    setPage(1)
  }

  // Listen for download progress
  useEffect(() => {
    const unsub = window.api.onRepoDownloadProgress((progress) => {
      setDownloadProgress(progress)
    })
    return unsub
  }, [])

  const isModInstalled = useCallback((mod: RepoMod): boolean => {
    return installedResourceIds.has(mod.resourceId) || installedTitles.has(mod.title.toLowerCase().trim())
  }, [installedResourceIds, installedTitles])

  const handleDownload = async (mod: RepoMod): Promise<void> => {
    setDownloading(mod.resourceId)
    setDownloadProgress(null)
    setDownloadError(null)
    try {
      const result = await window.api.downloadRepoMod(mod.resourceId, mod.slug)
      if (result.success) {
        setDownloadError(null)
        setInstalledResourceIds((prev) => new Set(prev).add(mod.resourceId))
        setInstalledTitles((prev) => new Set(prev).add(mod.title.toLowerCase().trim()))
      } else if (result.error !== 'Cancelled') {
        setDownloadError(result.error || t('mods.downloadFailed'))
      }
      // Recheck login status (user may have logged in via popup)
      window.api.beamngWebLoggedIn().then((r) => setBeamngLoggedIn(r.loggedIn))
    } catch (err) {
      setDownloadError(String(err))
    } finally {
      setDownloading(null)
      setDownloadProgress(null)
    }
  }

  return (
    <>
      {/* Controls */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 pt-2 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('mods.searchModsBrowse')}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] pr-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }}
            />
          </div>
          <button
            onClick={handleSearch}
            className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
          >
            <Search size={13} /> {t('common.search')}
          </button>
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)]"
            >
              {t('mods.clear')}
            </button>
          )}

          {/* BeamNG.com login */}
          <div className="ml-auto flex items-center gap-2">
            {beamngLoggedIn ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <User size={12} /> {t('mods.loggedIn')}
                </span>
                <button
                  onClick={handleBeamngLogout}
                  className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
                  title={t('mods.logOut')}
                >
                  <LogOut size={12} />
                </button>
              </>
            ) : (
              <button
                onClick={handleBeamngLogin}
                disabled={loginLoading}
                className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)] disabled:opacity-50"
                title={t('mods.logInToDownload')}
              >
                {loginLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <LogIn size={12} />
                )}
                {t('mods.beamngLogin')}
              </button>
            )}
          </div>
        </div>

        {/* Category + Sort */}
        {!searchQuery && (
          <div className="flex items-center gap-3">
            {/* Category */}
            <select
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(Number(e.target.value))}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id} className="bg-[var(--color-base)] text-[var(--color-text-primary)]">
                  {cat.label}
                </option>
              ))}
            </select>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => handleSortChange(e.target.value as RepoSortOrder)}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[var(--color-base)] text-[var(--color-text-primary)]">
                  {t(opt.label)}
                </option>
              ))}
            </select>

            <button
              onClick={fetchMods}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)]"
              title={t('common.refresh')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> {t('mods.loadingMods')}
          </div>
        ) : mods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)]">
            <Globe size={40} strokeWidth={1} />
            <p className="text-sm">
              {searchQuery ? t('mods.noModsMatch') : t('mods.noModsMatch')}
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Grid + optional detail panel */}
            <div className="flex-1 flex min-h-0">
              {/* Grid */}
              <div className="flex-1 min-w-0 overflow-y-auto p-6">
                <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {mods.map((mod) => (
                    <div
                      key={mod.resourceId}
                      onClick={() =>
                        setSelectedMod(selectedMod?.resourceId === mod.resourceId ? null : mod)
                      }
                      className={`border bg-[var(--color-surface)] transition cursor-pointer group ${
                        selectedMod?.resourceId === mod.resourceId
                          ? 'border-[var(--color-accent-40)] bg-[var(--color-accent-5)]'
                          : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface)]'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-[var(--color-scrim-30)] overflow-hidden">
                        {thumbCache.get(mod.thumbnailUrl) ? (
                          <img
                            src={thumbCache.get(mod.thumbnailUrl)}
                            alt={mod.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
                            {mod.thumbnailUrl ? (
                              <Loader2 size={20} className="animate-spin text-[var(--color-text-muted)]" />
                            ) : (
                              <Package size={32} strokeWidth={1} />
                            )}
                          </div>
                        )}
                        {mod.prefix && (
                          <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-accent)] text-black">
                            {mod.prefix}
                          </span>
                        )}
                      </div>

                      {/* Info */}
                      <div className="p-4 space-y-1.5">
                        <h3 className="text-sm font-medium text-[var(--color-text-primary)] truncate">{mod.title}</h3>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[var(--color-text-secondary)] truncate">
                            {t('mods.byAuthor', { author: mod.author })}
                          </span>
                        </div>
                        {mod.tagLine && (
                          <p className="text-[11px] text-[var(--color-text-muted)] truncate">{mod.tagLine}</p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            <StarRating rating={mod.rating} />
                            <span className="text-[10px] text-[var(--color-text-muted)]">({mod.ratingCount})</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                            <Download size={10} />
                            {formatCount(mod.downloads)}
                          </div>
                        </div>
                        <div className="text-[10px] text-[var(--color-text-dim)]">{mod.category}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail panel */}
              {selectedMod && (
                <div className="w-[320px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto p-5 space-y-4">
                  {/* Thumbnail */}
                  {thumbCache.get(selectedMod.thumbnailUrl) && (
                    <div className="aspect-video bg-[var(--color-scrim-30)] overflow-hidden">
                      <img
                        src={thumbCache.get(selectedMod.thumbnailUrl)}
                        alt={selectedMod.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div>
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{selectedMod.title}</h2>
                    {selectedMod.prefix && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-accent-20)] text-[var(--color-accent-text)] border border-[var(--color-border-accent)]">
                        {selectedMod.prefix}
                      </span>
                    )}
                    {selectedMod.tagLine && (
                      <p className="text-xs text-[var(--color-text-secondary)] mt-2">{selectedMod.tagLine}</p>
                    )}
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.author')}</span>
                      <span className="text-[var(--color-text-secondary)]">{selectedMod.author}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('common.version')}</span>
                      <span className="text-[var(--color-text-secondary)]">{selectedMod.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.tableType')}</span>
                      <span className="text-[var(--color-text-secondary)]">{selectedMod.category}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[var(--color-text-muted)]">{t('mods.rating')}</span>
                      <span className="inline-flex items-center gap-1.5">
                        <StarRating rating={selectedMod.rating} />
                        <span className="text-[var(--color-text-secondary)]">
                          {selectedMod.rating.toFixed(1)} ({selectedMod.ratingCount})
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.downloads')}</span>
                      <span className="text-[var(--color-text-secondary)]">{selectedMod.downloads.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-muted)]">{t('mods.subscriptions')}</span>
                      <span className="text-[var(--color-text-secondary)]">
                        {selectedMod.subscriptions.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDownload(selectedMod)}
                    disabled={downloading === selectedMod.resourceId || isModInstalled(selectedMod)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 border px-3 py-2.5 text-xs font-medium transition ${
                      isModInstalled(selectedMod)
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-default'
                        : 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)] disabled:opacity-50'
                    }`}
                  >
                    {downloading === selectedMod.resourceId ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        {downloadProgress
                          ? `${Math.round((downloadProgress.received / (downloadProgress.total || 1)) * 100)}%`
                          : t('mods.starting')}
                      </>
                    ) : isModInstalled(selectedMod) ? (
                      <>
                        <CheckCircle size={13} /> {t('mods.installed')}
                      </>
                    ) : (
                      <>
                        <Download size={13} /> {t('mods.installMod')}
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => window.api.openModPage(selectedMod.pageUrl)}
                    className="w-full inline-flex items-center justify-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)]"
                  >
                    <ExternalLink size={13} /> {t('mods.viewOnBeamng')}
                  </button>
                  {downloadError && downloading === null && (
                    <p className="text-[11px] text-rose-400">{downloadError}</p>
                  )}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="shrink-0 border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-between">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={13} /> {t('mods.previous')}
                </button>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {t('mods.pageOf', { page, totalPages })}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('mods.next')} <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════
   Registry Browse View (CKAN-style mod registry)
   ═══════════════════════════════════════════ */

const MOD_TYPE_OPTIONS = MOD_TYPE_FILTERS

function RegistryBrowseView({ onUpdatesChange, deleteVersion }: { onUpdatesChange: (n: number) => void; deleteVersion: number }): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [modType, setModType] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [mods, setMods] = useState<AvailableMod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMod, setSelectedMod] = useState<AvailableMod | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [resolution, setResolution] = useState<ResolutionResult | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<string[]>([])
  const [updates, setUpdates] = useState<Array<{ identifier: string; installed: string; latest: string; mod: BeamModMetadata }>>([])
  const [showUpdates, setShowUpdates] = useState(false)
  const [installed, setInstalled] = useState<Record<string, InstalledRegistryMod>>({})
  const [indexUpdating, setIndexUpdating] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ received: number; total: number } | null>(null)
  const { t } = useTranslation()
  useEffect(() => {
    const unsub = window.api.onRegistryDownloadProgress((progress) => {
      setDownloadProgress({ received: progress.received, total: progress.total })
    })
    return unsub
  }, [])

  const fetchMods = useCallback(async (): Promise<void> => {
    setLoading(true); setError(null)
    try {
      const result: RegistrySearchResult = await window.api.registrySearch({
        query: searchQuery || undefined, mod_type: modType || undefined, page, per_page: 25
      })
      setMods(result.mods); setTotalPages(result.total_pages)
    } catch (err) { setError(String(err)) } finally { setLoading(false) }
  }, [searchQuery, modType, page])

  const fetchInstalled = useCallback(async () => {
    try { setInstalled(await window.api.registryGetInstalled()) } catch { /* */ }
  }, [])

  const fetchUpdates = useCallback(async () => {
    try { const u = await window.api.registryGetUpdatesAvailable(); setUpdates(u); onUpdatesChange(u.length) } catch { /* */ }
  }, [onUpdatesChange])

  useEffect(() => { fetchMods() }, [fetchMods])
  useEffect(() => { fetchInstalled() }, [fetchInstalled])
  useEffect(() => { if (deleteVersion > 0) fetchInstalled() }, [deleteVersion])
  useEffect(() => { fetchUpdates() }, [fetchUpdates])
  useEffect(() => { setPage(1) }, [searchQuery, modType])

  const handleRefreshIndex = async (): Promise<void> => {
    setIndexUpdating(true)
    try { await window.api.registryUpdateIndex(); await fetchMods(); await fetchUpdates(); await fetchInstalled() } catch { /* */ }
    setIndexUpdating(false)
  }

  const handleInstallClick = async (identifier: string): Promise<void> => {
    setInstallError(null)
    try {
      const res = await window.api.registryResolve([identifier])
      setResolution(res)
      if (!res.success) { setInstallError(res.errors.join('; ')); return }
      const newMods = res.to_install.filter((m) => !installed[m.identifier])
      if (newMods.length > 1) { setPendingInstall([identifier]); setShowConfirm(true) }
      else { await doInstall([identifier]) }
    } catch (err) { setInstallError(String(err)) }
  }

  const doInstall = async (identifiers: string[]): Promise<void> => {
    setShowConfirm(false); setInstalling(identifiers[0] ?? null); setInstallError(null); setDownloadProgress(null)
    try {
      const result = await window.api.registryInstall(identifiers)
      if (!result.success) setInstallError(result.error || t('mods.installFailed'))
      await fetchInstalled(); await fetchUpdates()
    } catch (err) { setInstallError(String(err)) } finally { setInstalling(null); setDownloadProgress(null) }
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 pt-2 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-secondary)]">{mods.length > 0 ? t('mods.modCount', { count: mods.length }) : t('mods.registry')}</span>
            {updates.length > 0 && (
              <button onClick={() => setShowUpdates(!showUpdates)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[var(--color-accent-15)] text-[var(--color-accent-text)] border border-[var(--color-accent-20)] hover:bg-[var(--color-accent-25)]">
                <ArrowUpCircle size={12} /> {t('mods.updateCount', { count: updates.length })}
              </button>
            )}
          </div>
          <button onClick={handleRefreshIndex} disabled={indexUpdating}
            className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]">
            <RefreshCw size={13} className={indexUpdating ? 'animate-spin' : ''} />
            {indexUpdating ? t('mods.updating') : t('common.refresh')}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('mods.searchRegistry')} className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] pr-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }} />
          </div>
          <select value={modType} onChange={(e) => setModType(e.target.value)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-50)]">
            {MOD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
        </div>
      </div>

      {/* Updates panel */}
      {showUpdates && updates.length > 0 && (
        <RegistryUpdatesPanel updates={updates} onInstall={(ids) => doInstall(ids)} installing={installing} />
      )}

      {/* Confirm dialog */}
      {showConfirm && resolution && (
        <RegistryConfirmDialog resolution={resolution} installed={installed}
          onConfirm={() => doInstall(pendingInstall)} onCancel={() => { setShowConfirm(false); setResolution(null) }} />
      )}

      {(error || installError) && (
        <div className="mx-4 mt-3 p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">{error || installError}</div>
      )}

      {installing && downloadProgress && downloadProgress.total > 0 && (
        <div className="mx-4 mt-2">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mb-1">
            <span>{t('mods.downloading', { name: installing })}</span>
            <span>{Math.round(downloadProgress.received / 1024)}KB / {Math.round(downloadProgress.total / 1024)}KB</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-200"
              style={{ width: `${Math.min(100, (downloadProgress.received / downloadProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> {t('mods.loadingRegistry')}
          </div>
        ) : mods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)]">
            <Database size={40} strokeWidth={1} />
            <p className="text-sm">{searchQuery ? t('mods.noModsMatch') : t('mods.registryEmpty')}</p>
            <button onClick={handleRefreshIndex}
              className="mt-2 inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)]">
              <RefreshCw size={13} /> {t('mods.refreshIndex')}
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {mods.map((mod) => {
                  const latest = mod.versions[0]; if (!latest) return null
                  const authors = Array.isArray(latest.author) ? latest.author.join(', ') : latest.author
                  const isInst = mod.identifier in installed
                  return (
                    <button key={mod.identifier}
                      onClick={() => setSelectedMod(selectedMod?.identifier === mod.identifier ? null : mod)}
                      className={`text-left border p-4 transition space-y-2 ${selectedMod?.identifier === mod.identifier ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-8)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-hover)]'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">{latest.name}</span>
                            {latest.x_verified && <BadgeCheck size={12} className="text-blue-400 shrink-0" />}
                            {isInst && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
                          </div>
                          <p className="text-[10px] text-[var(--color-text-muted)] truncate mt-0.5">{authors}</p>
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">v{latest.version}</span>
                      </div>
                      <p className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2">{latest.abstract}</p>
                      <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                        {latest.mod_type && <span className="px-1.5 py-0.5 border border-[var(--color-border)] bg-[var(--color-surface)]">{latest.mod_type}</span>}
                        {latest.license && <span className="inline-flex items-center gap-0.5"><Shield size={9} /> {Array.isArray(latest.license) ? latest.license[0] : latest.license}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            {selectedMod && <RegistryDetailPanel mod={selectedMod} installed={installed} installing={installing} onInstall={handleInstallClick} />}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="shrink-0 border-t border-[var(--color-border)] px-5 py-3 flex items-center justify-between">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="inline-flex items-center gap-1 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] disabled:opacity-30">
            <ChevronLeft size={13} /> {t('mods.previous')}
          </button>
          <span className="text-xs text-[var(--color-text-secondary)]">{t('mods.pageOf', { page, totalPages })}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="inline-flex items-center gap-1 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] disabled:opacity-30">
            {t('mods.next')} <ChevronRight size={13} />
          </button>
        </div>
      )}
    </>
  )
}

/* ── Registry Detail Panel ── */

function RegistryDetailPanel({
  mod, installed, installing, onInstall
}: {
  mod: AvailableMod
  installed: Record<string, InstalledRegistryMod>
  installing: string | null
  onInstall: (id: string) => void
}): React.JSX.Element {
  const latest = mod.versions[0]!
  const authors = Array.isArray(latest.author) ? latest.author.join(', ') : latest.author
  const isInst = mod.identifier in installed
  const deps = latest.depends ?? []
  const { t } = useTranslation()

  return (
    <div className="w-[340px] shrink-0 border-l border-[var(--color-border)] overflow-y-auto p-5 space-y-4">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{latest.name}</h2>
          {latest.x_verified && <BadgeCheck size={14} className="text-blue-400 shrink-0" />}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">{latest.abstract}</p>
      </div>

      {latest.thumbnail && (
        <img src={latest.thumbnail} alt={latest.name} className="w-full object-cover border border-[var(--color-border)]" />
      )}

      <div className="space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('mods.identifier')}</span><span className="text-[var(--color-text-secondary)] font-mono text-[11px]">{mod.identifier}</span></div>
        <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('common.version')}</span><span className="text-[var(--color-text-secondary)]">{latest.version}</span></div>
        <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('common.author')}</span><span className="text-[var(--color-text-secondary)] truncate ml-4 max-w-[180px]">{authors}</span></div>
        {latest.mod_type && <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('common.type')}</span><span className="text-[var(--color-text-secondary)]">{latest.mod_type}</span></div>}
        {latest.license && <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('common.license')}</span><span className="text-[var(--color-text-secondary)]">{Array.isArray(latest.license) ? latest.license.join(', ') : latest.license}</span></div>}
        {latest.release_date && <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('mods.released')}</span><span className="text-[var(--color-text-secondary)]">{latest.release_date}</span></div>}
        {latest.release_status && <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('common.status')}</span><span className="text-[var(--color-text-secondary)]">{latest.release_status}</span></div>}
        {latest.beamng_version && <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">{t('mods.gameVer')}</span><span className="text-[var(--color-text-secondary)]">{latest.beamng_version}</span></div>}
        {latest.multiplayer_scope && latest.multiplayer_scope !== 'client' && (
          <div className="flex justify-between">
            <span className="text-[var(--color-text-muted)]">{t('mods.scope')}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${latest.multiplayer_scope === 'both' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
              {latest.multiplayer_scope === 'both' ? t('mods.clientServerPlugin') : t('mods.serverPlugin')}
            </span>
          </div>
        )}
      </div>

      {latest.description && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-[11px] text-[var(--color-text-secondary)] whitespace-pre-line">{latest.description}</p>
        </div>
      )}

      {deps.length > 0 && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">{t('mods.dependencies')}</h3>
          <div className="space-y-1">
            {deps.map((dep, i) => {
              if ('any_of' in dep) return <span key={i} className="text-[11px] text-[var(--color-text-secondary)]">{t('mods.oneOf')}: {dep.any_of.map((d) => d.identifier).join(', ')}</span>
              return <span key={i} className="block text-[11px] text-[var(--color-text-secondary)]">{dep.identifier}{dep.version ? ` = ${dep.version}` : ''}</span>
            })}
          </div>
        </div>
      )}

      {latest.supports && latest.supports.length > 0 && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">{t('mods.enhances')}</h3>
          <div className="space-y-1">
            {latest.supports.map((sup, i) => {
              if ('any_of' in sup) return <span key={i} className="text-[11px] text-emerald-400">{t('mods.anyOf')}: {sup.any_of.map((d) => d.identifier).join(', ')}</span>
              return <span key={i} className="block text-[11px] text-emerald-400">{sup.identifier}</span>
            })}
          </div>
        </div>
      )}

      {latest.resources && (
        <div className="border-t border-[var(--color-border)] pt-3 space-y-1">
          {latest.resources.homepage && <a href={latest.resources.homepage} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('mods.homepage')}</a>}
          {latest.resources.repository && <a href={latest.resources.repository} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('common.source')}</a>}
          {latest.resources.beamng_resource && <a href={latest.resources.beamng_resource} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('mods.beamngCom')}</a>}
        </div>
      )}

      {mod.versions.length > 1 && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-2">{t('mods.versions')}</h3>
          <div className="space-y-1">
            {mod.versions.slice(0, 5).map((v) => (
              <div key={v.version} className="text-[11px] text-[var(--color-text-secondary)] flex justify-between">
                <span>v{v.version}</span>
                <span>{v.release_date || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={() => onInstall(mod.identifier)}
          disabled={installing === mod.identifier || isInst}
          className={`w-full inline-flex items-center justify-center gap-1.5 border px-3 py-2.5 text-xs font-medium transition ${
            isInst
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-default'
              : installing === mod.identifier
                ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)]/60 cursor-wait'
                : 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)]'
          }`}
        >
          {installing === mod.identifier ? (
            <><Loader2 size={13} className="animate-spin" /> {t('mods.installing')}</>
          ) : isInst ? (
            <><CheckCircle size={13} /> {t('mods.installed')}</>
          ) : (
            <><Download size={13} /> {t('common.install')}</>
          )}
        </button>
      </div>
    </div>
  )
}

/* ── Registry Updates Panel ── */

function RegistryUpdatesPanel({
  updates, onInstall, installing
}: {
  updates: Array<{ identifier: string; installed: string; latest: string; mod: BeamModMetadata }>
  onInstall: (ids: string[]) => void
  installing: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mx-4 mt-3 border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[var(--color-accent-text)] flex items-center gap-1.5">
          <ArrowUpCircle size={14} /> {t('mods.updatesAvailable')}
        </h3>
        <button onClick={() => onInstall(updates.map((u) => u.identifier))} disabled={installing !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-25)] disabled:opacity-40">
          {installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} {t('mods.updateAll')}
        </button>
      </div>
      <div className="space-y-2">
        {updates.map((u) => (
          <div key={u.identifier} className="flex items-center justify-between text-xs">
            <div>
              <span className="text-[var(--color-text-primary)] font-medium">{u.mod.name}</span>
              <span className="text-[var(--color-text-muted)] ml-2">{u.installed} → {u.latest}</span>
            </div>
            <button onClick={() => onInstall([u.identifier])} disabled={installing === u.identifier}
              className="text-[11px] text-[var(--color-accent-text)] hover:text-[var(--color-accent-text-muted)] disabled:opacity-40">
              {installing === u.identifier ? <Loader2 size={11} className="animate-spin" /> : t('common.update')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Registry Confirm Dialog ── */

function RegistryConfirmDialog({
  resolution, installed, onConfirm, onCancel
}: {
  resolution: ResolutionResult
  installed: Record<string, InstalledRegistryMod>
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const newMods = resolution.to_install.filter((m) => !installed[m.identifier])
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)]">
      <div className="bg-[var(--color-base)] border border-[var(--color-border)] w-[420px] max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <Info size={16} className="text-[var(--color-accent)]" /> {t('mods.confirmInstallation')}
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {t('mods.modsWillBeInstalled', { count: newMods.length })}
        </p>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {newMods.map((m) => (
            <div key={m.identifier} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <Package size={11} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="truncate">{m.name}</span>
              <span className="text-[var(--color-text-muted)] ml-auto shrink-0">v{m.version}</span>
            </div>
          ))}
        </div>
        {resolution.warnings.length > 0 && (
          <div className="border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] p-3 space-y-1">
            {resolution.warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-[var(--color-accent-text)] flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {w}
              </p>
            ))}
          </div>
        )}
        {resolution.to_remove.length > 0 && (
          <div className="border border-rose-500/20 bg-rose-500/5 p-3">
            <p className="text-[11px] text-rose-300 mb-1">{t('mods.modsWillBeRemoved')}</p>
            {resolution.to_remove.map((id) => (
              <p key={id} className="text-[11px] text-rose-400">{id}</p>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onCancel}
            className="flex-1 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]">
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm}
            className="flex-1 border border-[var(--color-border-accent)] bg-[var(--color-accent-15)] px-3 py-2 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-25)]">
            {t('mods.modsWillBeInstalled', { count: newMods.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
