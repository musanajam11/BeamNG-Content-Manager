import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  Scan,
  SlidersHorizontal
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
import type { BmrFacets, BmrModListItem, BmrSearchOptions } from '../../../shared/bmr-types'
import {
  BmrAuthMenu,
  BmrFiltersPanel,
  bmrFiltersToQuery,
  EMPTY_FILTERS,
  InteractiveStarRating,
  useBmrAuth,
  type BmrFilterState,
} from '../components/bmr/BmrComponents'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useBoundedCache } from '../hooks/useBoundedCache'
import { useLazyThumbnails, useLazyThumb, type ThumbnailLoader } from '../hooks/useLazyThumbnails'
import { useTranslation } from 'react-i18next'
import { useModOrderStore } from '../stores/useModOrderStore'
import { useToastStore } from '../stores/useToastStore'
import { ToastContainer } from '../components/server-manager/ToastContainer'

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
      return <Package size={13} className="text-slate-300" />
    default:
      return <HelpCircle size={13} className="text-[var(--color-text-muted)]" />
  }
}

// Per-type tint for the card chip. Keeps the same hue family as `modTypeIcon`
// for visual consistency, but with a translucent background + tinted border.
function modTypeChipClasses(modType: string): string {
  switch (modType) {
    case 'terrain':
    case 'map':
      return 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
    case 'vehicle':
      return 'bg-sky-500/15 border-sky-400/40 text-sky-200'
    case 'sound':
      return 'bg-purple-500/15 border-purple-400/40 text-purple-200'
    case 'ui_app':
      return 'bg-cyan-500/15 border-cyan-400/40 text-cyan-200'
    case 'scenario':
      return 'bg-amber-500/15 border-amber-400/40 text-amber-200'
    case 'skin':
      return 'bg-pink-500/15 border-pink-400/40 text-pink-200'
    case 'license_plate':
      return 'bg-yellow-500/15 border-yellow-400/40 text-yellow-200'
    case 'automation':
      return 'bg-orange-500/15 border-orange-400/40 text-orange-200'
    case 'other':
      return 'bg-slate-500/20 border-slate-400/40 text-slate-200'
    default:
      return 'bg-[var(--color-base)]/70 border-[var(--color-border)] text-[var(--color-text-secondary)]'
  }
}

function modTypeLabel(modType: string): string {
  switch (modType) {
    case 'terrain': case 'map': return 'Map'
    case 'vehicle': return 'Vehicle'
    case 'sound': return 'Sound'
    case 'ui_app': return 'UI App'
    case 'scenario': return 'Scenario'
    case 'skin': return 'Skin'
    case 'license_plate': return 'Plate'
    case 'automation': return 'Automation'
    case 'other': return 'Other'
    default: return modType
  }
}

// Inline-SVG verified badge. Rendered as an SVG so the global
// `* { border-radius: 0 !important }` reset in main.css can't flatten its
// pill shape. Matches the reference image: solid blue pill with a white
// check inside a darker blue circle and bold "VERIFIED" text.
function VerifiedBadge({ height = 18 }: { height?: number }): React.JSX.Element {
  const w = height * (78 / 18)
  return (
    <svg
      viewBox="0 0 78 18"
      width={w}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Verified"
      role="img"
      className="shrink-0"
    >
      <rect x="0" y="0" width="78" height="18" rx="9" ry="9" fill="#1d76e3" />
      <circle cx="10" cy="9" r="6" fill="#0f56ad" />
      <path
        d="M7 9.2 L9.2 11.4 L13.2 7"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="20"
        y="13"
        fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        fontSize="10"
        fontWeight="800"
        letterSpacing="0.5"
        fill="#ffffff"
      >
        VERIFIED
      </text>
    </svg>
  )
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

      <ToastContainer />
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
  thumbLoader,
  thumbKey,
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
  thumbLoader: ThumbnailLoader
  thumbKey: string
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

  // Lazy-load the in-zip preview only when this row scrolls into view.
  const { ref: thumbRef, src: thumbSrc, visible, attempted: thumbAttempted } = useLazyThumb<HTMLDivElement>(thumbKey, thumbLoader)

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

      {/* Mod name + thumbnail + conflict indicator */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Lazy thumbnail (in-zip preview) */}
          <div
            ref={thumbRef}
            className="relative w-14 h-10 shrink-0 overflow-hidden bg-[var(--color-scrim-30)] border border-[var(--color-border)]"
          >
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--color-text-dim)]">
                {visible && !thumbAttempted ? <Loader2 size={12} className="animate-spin" /> : <Package size={14} strokeWidth={1.5} />}
              </div>
            )}
          </div>
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
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[11px] font-medium ${modTypeChipClasses(mod.modType)}`}>
          {modTypeIcon(mod.modType)}
          <span>{modTypeLabel(mod.modType) || t('mods.otherType')}</span>
        </span>
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
  const [repairingIndex, setRepairingIndex] = useState(false)
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
  // Per-row lazy thumbnail loader. The "url" key is opaque to the loader:
  //   • `http(s)://…` → fetched via the repo-thumbnail proxy (registry mods,
  //     hard-coded BeamMP logo, etc.).
  //   • Anything else → treated as a local mod filePath and resolved through
  //     `getModPreview` which extracts an in-zip preview image.
  // Bounded LRU keeps memory in check for huge mod libraries.
  const previewFetcher = useCallback(
    async (keys: string[]): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      const httpKeys = keys.filter((k) => /^https?:\/\//i.test(k))
      const fileKeys = keys.filter((k) => !/^https?:\/\//i.test(k))
      // Batch HTTP thumbnails through the existing repo-thumbnail proxy so
      // the main process can cache + decode them once.
      if (httpKeys.length > 0) {
        try {
          const result = await window.api.getRepoThumbnails(httpKeys)
          Object.assign(out, result)
        } catch {
          /* ignore: missing thumbnails fall back to icon */
        }
      }
      // Local files use the in-zip preview extractor.
      await Promise.all(
        fileKeys.map(async (p) => {
          try {
            const r = await window.api.getModPreview(p)
            if (r.success && r.data) out[p] = r.data
          } catch {
            /* ignore: missing preview is fine, fallback icon will render */
          }
        })
      )
      return out
    },
    []
  )
  const rowThumbLoader = useLazyThumbnails(previewFetcher, 60)
  const [registryInstalled, setRegistryInstalled] = useState<Record<string, InstalledRegistryMod>>({})
  const [scopeDialogMods, setScopeDialogMods] = useState<ModInfo[]>([])
  const [scopeDialogIndex, setScopeDialogIndex] = useState(0)
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)

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

  const shouldWarnOnSideloadEnable = useCallback((mod: ModInfo): boolean => {
    const type = mod.modType.trim().toLowerCase()
    return type !== 'ui_app' && type !== 'sound'
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
      // Refresh registry alongside the mod list so freshly-installed mods
      // (e.g. GTA Radio just downloaded via the registry browser) get their
      // thumbnail URL populated without needing a full page remount.
      try {
        const installed = await window.api.registryGetInstalled()
        setRegistryInstalled(installed)
      } catch { /* registry optional */ }
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
    const modBase = modFile.replace(/\.zip$/i, '')
    const modKey = mod.key.trim().toLowerCase()
    // Pass 1: exact filename match anywhere in installed_files.
    for (const entry of Object.values(registryInstalled)) {
      if (entry.installed_files.some((f) => {
        const fname = f.replace(/\\/g, '/').split('/').pop() || f
        return fname.toLowerCase() === modFile
      })) {
        return entry
      }
    }
    // Pass 2: identifier matches the mod key directly (mods/repo/<key>.zip).
    if (registryInstalled[mod.key]) return registryInstalled[mod.key]
    // Pass 3: identifier ↔ filename slug equivalence (e.g. "gta-radio" vs
    // "gta_radio.zip"). Normalize both sides by lowercasing and replacing
    // separator chars so the user gets a thumbnail even when the zip was
    // renamed during install.
    const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const wantBase = normalize(modBase)
    const wantKey = normalize(modKey)
    for (const [identifier, entry] of Object.entries(registryInstalled)) {
      const id = normalize(identifier)
      if (id === wantBase || id === wantKey) return entry
      // Also check installed_files basenames after normalization.
      if (entry.installed_files.some((f) => {
        const fname = f.replace(/\\/g, '/').split('/').pop() || f
        return normalize(fname.replace(/\.zip$/i, '')) === wantBase
      })) {
        return entry
      }
    }
    return undefined
  }, [registryInstalled])

  const selectedRegistryEntry = useMemo(() => {
    if (!selectedMod) return undefined
    return findRegistryEntry(selectedMod)
  }, [selectedMod, findRegistryEntry])

  // Resolve the best thumbnail source for a row. Priority:
  //   1. Hard-coded BeamMP.zip logo (special-cased so users see branding).
  //   2. Registry thumbnail URL when this mod is tracked by the registry.
  //   3. Local file path → in-zip preview.png/jpg via `getModPreview`.
  const resolveRowThumb = useCallback(
    (mod: ModInfo): string => {
      const fileLower = mod.fileName.toLowerCase()
      const keyLower = mod.key.trim().toLowerCase()
      if (keyLower === 'beammp' || fileLower === 'beammp.zip') {
        return 'https://beammp.com/assets/BeamMP_wht-CDWCyUA1.png'
      }
      const reg = findRegistryEntry(mod)
      if (reg?.metadata.thumbnail) return reg.metadata.thumbnail
      return mod.filePath
    },
    [findRegistryEntry]
  )

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
        if (newState && shouldWarnOnSideloadEnable(mod)) {
          addToast(t('mods.sideloadMultiplayerWarning'), 'info')
        }
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
        if (enabled && modsToUpdate.some(shouldWarnOnSideloadEnable)) {
          addToast(t('mods.sideloadMultiplayerWarning'), 'info')
        }
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

  const handleRepairIndex = async (): Promise<void> => {
    setRepairingIndex(true)
    setError(null)
    try {
      const result = await window.api.repairModIndex()
      if (!result.success) {
        setError(result.error || t('mods.failedToLoadMods'))
        return
      }
      await fetchMods()
    } catch (err) {
      setError(String(err))
    } finally {
      setRepairingIndex(false)
    }
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
              onClick={handleRepairIndex}
              disabled={repairingIndex}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-active)] disabled:opacity-50"
              title={t('mods.repairIndexTooltip')}
            >
              {repairingIndex ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />}
              {repairingIndex ? t('mods.repairingIndex') : t('mods.repairIndex')}
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
                          thumbLoader={rowThumbLoader}
                          thumbKey={resolveRowThumb(mod)}
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
              <div
                className="shrink-0 border-l border-[var(--color-border)] overflow-y-auto space-y-4"
                style={{ width: 340, padding: 12 }}
              >
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                      {selectedRegistryEntry?.metadata.name || selectedMod.title || selectedMod.fileName}
                    </h2>
                    {selectedRegistryEntry?.metadata.x_verified && <VerifiedBadge height={16} />}
                  </div>
                  {(selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine) && (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      {selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine}
                    </p>
                  )}
                </div>

                {/* Hero preview image */}
                {(() => {
                  const detailKey = resolveRowThumb(selectedMod)
                  const hero =
                    previewCache.get(selectedMod.filePath) ||
                    rowThumbLoader.get(detailKey)
                  if (hero) {
                    return (
                      <img
                        src={hero}
                        alt={selectedMod.title || selectedMod.fileName}
                        className="w-full object-cover border border-[var(--color-border)]"
                      />
                    )
                  }
                  return (
                    <div className="w-full aspect-video flex items-center justify-center bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-dim)]">
                      <Package size={32} strokeWidth={1.2} />
                    </div>
                  )
                })()}

                {/* Type / source chip row (registry-style) */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border ${modTypeChipClasses(selectedRegistryEntry?.metadata.mod_type || selectedMod.modType)}`}>
                    {modTypeIcon(selectedRegistryEntry?.metadata.mod_type || selectedMod.modType)}
                    <span>{modTypeLabel(selectedRegistryEntry?.metadata.mod_type || selectedMod.modType) || t('mods.otherType')}</span>
                  </span>
                  {selectedRegistryEntry?.metadata.license && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-indigo-400/40 bg-indigo-500/15 text-indigo-200">
                      <Shield size={11} />
                      <span>{Array.isArray(selectedRegistryEntry.metadata.license) ? selectedRegistryEntry.metadata.license[0] : selectedRegistryEntry.metadata.license}</span>
                    </span>
                  )}
                  {selectedRegistryEntry?.metadata.release_status && (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border ${
                      selectedRegistryEntry.metadata.release_status === 'stable'
                        ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                        : selectedRegistryEntry.metadata.release_status === 'testing'
                          ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                          : 'border-orange-400/40 bg-orange-500/15 text-orange-200'
                    }`}>
                      <span className="capitalize">{selectedRegistryEntry.metadata.release_status}</span>
                    </span>
                  )}
                </div>

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
                  <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border)] pt-3 whitespace-pre-line">
                    {selectedRegistryEntry.metadata.description}
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-3 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">{t('common.file')}</span>
                    <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0" title={selectedMod.fileName}>{selectedMod.fileName}</span>
                  </div>
                  {(selectedMod.modType === 'unknown' || selectedMod.modType === 'other') && !selectedRegistryEntry?.metadata.mod_type && (
                    <div className="flex justify-between gap-3 min-w-0 items-center">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('common.type')}</span>
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
                    </div>
                  )}
                  <div className="flex justify-between gap-3 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">{t('common.size')}</span>
                    <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{formatBytes(selectedMod.sizeBytes)}</span>
                  </div>
                  {(selectedRegistryEntry?.metadata.author || selectedMod.author) && (
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('common.author')}</span>
                      <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">
                        {Array.isArray(selectedRegistryEntry?.metadata.author)
                          ? selectedRegistryEntry!.metadata.author.join(', ')
                          : selectedRegistryEntry?.metadata.author || selectedMod.author}
                      </span>
                    </div>
                  )}
                  {(selectedRegistryEntry?.metadata.version || selectedMod.version) && (
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('common.version')}</span>
                      <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">
                        {selectedRegistryEntry?.metadata.version || selectedMod.version}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.release_date && (
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('mods.released')}</span>
                      <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">
                        {new Date(selectedRegistryEntry.metadata.release_date).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('common.source')}</span>
                      <span className="text-[var(--color-text-secondary)] capitalize truncate text-right min-w-0">{selectedRegistryEntry.install_source}</span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between gap-3 min-w-0">
                      <span className="text-[var(--color-text-muted)] shrink-0">{t('mods.installed')}</span>
                      <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">
                        {new Date(selectedRegistryEntry.install_time).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">{t('mods.location')}</span>
                    <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0" title={selectedMod.location}>{selectedMod.location}</span>
                  </div>
                  <div className="flex justify-between gap-3 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">{t('common.status')}</span>
                    <span className={`truncate text-right min-w-0 ${selectedMod.enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`}>
                      {selectedMod.enabled ? t('common.enabled') : t('common.disabled')}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">{t('mods.modified')}</span>
                    <span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">
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

/**
 * One Browse-tab card. Extracted so it can use `useLazyThumb` to fetch its
 * own thumbnail only when scrolled into view, and re-fetch transparently if
 * the LRU evicts it before the user scrolls back.
 */
function BrowseModCard({
  mod,
  selected,
  onClick,
  loader
}: {
  mod: RepoMod
  selected: boolean
  onClick: () => void
  loader: ThumbnailLoader
}): React.JSX.Element {
  const { t } = useTranslation()
  const { ref, src } = useLazyThumb<HTMLDivElement>(mod.thumbnailUrl, loader)
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`border bg-[var(--color-surface)] transition cursor-pointer group ${
        selected
          ? 'border-[var(--color-accent-40)] bg-[var(--color-accent-5)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-surface)]'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-[var(--color-scrim-30)] overflow-hidden">
        {src ? (
          <img src={src} alt={mod.title} className="w-full h-full object-cover" />
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
  )
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
  // Viewport-aware thumbnail loader. Cards request their own thumbnail when
  // they scroll into view, and re-request automatically if the LRU evicts
  // the entry while the user is scrolling further down.
  const thumbLoader = useLazyThumbnails(window.api.getRepoThumbnails, 120)
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

  // Thumbnails are now fetched lazily per-card via `useLazyThumb`. The old
  // bulk-fetch effect is gone: it pre-loaded everything in `mods` (memory
  // pressure) and could not recover when the LRU evicted entries during
  // long scrolls — scrolling back up left permanent spinners.

  // Fetch mods when params change. On page 1 we replace; on subsequent pages
  // we append, so the user gets infinite-scroll behavior over the same
  // server-paginated API. Memory stays bounded by `thumbCache` (LRU=120) and
  // by the fact that mods only accumulate as the user actively scrolls.
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
        const fetched = result.data.mods
        if (page === 1) {
          setMods(fetched)
        } else {
          // Dedup by resourceId in case the API returns overlapping items
          // between pages (defensive — the API shouldn't, but pages can shift
          // when sort/filter state on the server side changes mid-scroll).
          setMods((prev) => {
            const seen = new Set(prev.map((m) => m.resourceId))
            const merged = prev.slice()
            for (const m of fetched) {
              if (!seen.has(m.resourceId)) {
                seen.add(m.resourceId)
                merged.push(m)
              }
            }
            return merged
          })
        }
        setTotalPages(result.data.totalPages)
      } else {
        setError(result.error || t('mods.failedToLoadMods'))
        if (page === 1) setMods([])
      }
    } catch (err) {
      setError(String(err))
      if (page === 1) setMods([])
    } finally {
      setLoading(false)
    }
  }, [selectedCategory, sort, page, searchQuery])

  useEffect(() => {
    fetchMods()
  }, [fetchMods])

  // Infinite-scroll: when the user gets near the bottom of the grid, advance
  // to the next page (which will append). Mirrors ServerList.tsx so the two
  // surfaces feel consistent and share the same memory-saving philosophy
  // (only render what the user has actually requested).
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loading)
  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (distanceFromBottom < 600 && !loadingRef.current && page < totalPages) {
          setPage((p) => (p < totalPages ? p + 1 : p))
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [page, totalPages])

  // Reset scroll position when the underlying query changes (filter/search/sort).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectedCategory, sort, searchQuery])

  // Ensure the selected mod's thumbnail is requested for the detail panel,
  // even if its card has scrolled off-screen and been LRU-evicted.
  useEffect(() => {
    if (selectedMod?.thumbnailUrl) thumbLoader.request(selectedMod.thumbnailUrl)
  }, [selectedMod, thumbLoader])

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
        {loading && mods.length === 0 ? (
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
              <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto p-6">
                <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {mods.map((mod) => (
                    <BrowseModCard
                      key={mod.resourceId}
                      mod={mod}
                      selected={selectedMod?.resourceId === mod.resourceId}
                      loader={thumbLoader}
                      onClick={() =>
                        setSelectedMod(selectedMod?.resourceId === mod.resourceId ? null : mod)
                      }
                    />
                  ))}
                </div>
                {/* Infinite-scroll footer */}
                {page < totalPages ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-[var(--color-text-muted)]">
                    {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                    <span>{t('mods.loadingMore')}</span>
                  </div>
                ) : mods.length > 0 ? (
                  <div className="text-center py-4 text-[11px] text-[var(--color-text-dim)]">
                    {t('mods.endOfResults')}
                  </div>
                ) : null}
              </div>

              {/* Detail panel */}
              {selectedMod && (
                <div
                  className="shrink-0 border-l border-[var(--color-border)] overflow-y-auto space-y-4"
                  style={{ width: 320, padding: 12 }}
                >
                  {/* Thumbnail */}
                  {thumbLoader.get(selectedMod.thumbnailUrl) && (
                    <div className="aspect-video bg-[var(--color-scrim-30)] overflow-hidden">
                      <img
                        src={thumbLoader.get(selectedMod.thumbnailUrl)}
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

            {/* Pagination removed — superseded by infinite scroll above. */}
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

/**
 * One Registry-tab card. Extracted so it can lazy-load its thumbnail and
 * re-load it after LRU eviction when the user scrolls back into view.
 */
function RegistryModCard({
  mod,
  selected,
  isInstalled,
  onClick,
  loader
}: {
  mod: AvailableMod
  selected: boolean
  isInstalled: boolean
  onClick: () => void
  loader: ThumbnailLoader
}): React.JSX.Element | null {
  const latest = mod.versions[0]
  const thumbUrl = latest?.thumbnail
  const { ref, src: thumbSrc } = useLazyThumb<HTMLButtonElement>(thumbUrl, loader)
  if (!latest) return null
  const authors = Array.isArray(latest.author) ? latest.author.join(', ') : latest.author
  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`group relative text-left border overflow-hidden transition h-[148px] ${selected ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-8)]' : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border-hover)]'}`}
    >
      {thumbSrc && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-center bg-cover transition-[filter,opacity] duration-200 [filter:blur(3px)_saturate(0.55)_brightness(0.55)] opacity-45 group-hover:[filter:blur(3px)_saturate(1.4)_brightness(0.75)] group-hover:opacity-70"
            style={{ backgroundImage: `url(${thumbSrc})`, transform: 'scale(1.06)' }}
          />
          <div aria-hidden className="absolute inset-0 bg-[var(--color-surface)]/65 group-hover:bg-[var(--color-surface)]/40 transition-colors duration-200" />
        </>
      )}
      <div className="relative h-full p-4 space-y-2 flex flex-col [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-[var(--color-text-primary)] truncate">{latest.name}</span>
              {latest.x_verified && <VerifiedBadge height={14} />}
              {isInstalled && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
            </div>
            <p className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate mt-0.5">{authors}</p>
          </div>
          <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] shrink-0">v{latest.version}</span>
        </div>
        <p className="text-[12px] font-medium text-[var(--color-text-primary)] line-clamp-2">{latest.abstract}</p>
        <div className="mt-auto flex items-center gap-1.5 text-[11px] font-medium">
          {mod.rating && mod.rating.count > 0 && (
            <span className="inline-flex items-center gap-1">
              <StarRating rating={mod.rating.avg} />
              <span className="text-[10px] text-[var(--color-text-muted)]">({mod.rating.count})</span>
            </span>
          )}
          {latest.mod_type && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border ${modTypeChipClasses(latest.mod_type)}`}>
              {modTypeIcon(latest.mod_type)}
              <span>{modTypeLabel(latest.mod_type)}</span>
            </span>
          )}
          {latest.license && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-indigo-400/40 bg-indigo-500/15 text-indigo-200">
              <Shield size={11} />
              <span>{Array.isArray(latest.license) ? latest.license[0] : latest.license}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

function RegistryBrowseView({ onUpdatesChange, deleteVersion }: { onUpdatesChange: (n: number) => void; deleteVersion: number }): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [modType, setModType] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'rating' | 'author'>('name')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalMods, setTotalMods] = useState(0)
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
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [showRegistryHelp, setShowRegistryHelp] = useState(false)
  const [registryLogo, setRegistryLogo] = useState<string | null>(null)
  // BMR-driven extras: facet sidebar + per-mod "mine" rating cache. When BMR
  // is reachable these power the deep-search UI; when it's offline we fall
  // back to the legacy in-memory registrySearch and these stay empty/idle.
  const [facets, setFacets] = useState<BmrFacets | null>(null)
  const [filters, setFilters] = useState<BmrFilterState>(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [myRatings, setMyRatings] = useState<Record<string, number>>({})
  // Verified mods, fetched once per session and merged into the visible
  // list so they always appear at the top of the default browse view even
  // when name-sorted pagination would otherwise push them past the
  // currently-loaded slice.
  const [verifiedMods, setVerifiedMods] = useState<AvailableMod[]>([])
  const [bmrOffline, setBmrOffline] = useState(false)
  const [ratingBusy, setRatingBusy] = useState<string | null>(null)
  const { signedIn } = useBmrAuth()
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()
  // External thumbnail URLs from registry metadata are blocked by CSP if loaded
  // directly. Proxy through the main process which returns base64 data URLs.
  // Cards request their own thumbnail via `useLazyThumb` only when scrolled
  // into view, and re-request transparently if the LRU evicts the entry.
  const thumbLoader = useLazyThumbnails(window.api.getRepoThumbnails, 120)
  const { t } = useTranslation()
  useEffect(() => {
    const unsub = window.api.onRegistryDownloadProgress((progress) => {
      setDownloadProgress({ received: progress.received, total: progress.total })
    })
    return unsub
  }, [])

  // Lazy-fetch the registry repo logo via the existing thumbnail proxy so
  // CSP doesn't block raw.githubusercontent.com. Falls back to the lucide
  // Database icon if offline.
  useEffect(() => {
    const url = 'https://raw.githubusercontent.com/musanajam11/BeamNG-Mod-Registry/main/assets/logo.png'
    window.api.getRepoThumbnails([url])
      .then((res) => { if (res[url]) setRegistryLogo(res[url]) })
      .catch(() => { /* keep fallback */ })
  }, [])

  // Map UI sort dropdown → BMR sort param. The desktop "updated" sort lines
  // up with the registry's "recent" (best-effort version-string newness),
  // and "author" has no server-side equivalent so we fall back to name.
  const bmrSortParam = (s: typeof sortBy): BmrSearchOptions['sort'] => {
    switch (s) {
      case 'rating': return '-rating'
      case 'updated': return 'recent'
      case 'name':
      case 'author':
      default: return 'name'
    }
  }

  /** Synthesize an `AvailableMod` from a BMR list item so existing card +
   * detail components keep working without a parallel renderer rewrite. */
  const bmrToAvailable = (item: BmrModListItem): AvailableMod => {
    const meta: BeamModMetadata = {
      spec_version: 1,
      identifier: item.identifier,
      name: item.name,
      abstract: item.abstract,
      author: item.author ?? '',
      version: item.version,
      license: item.license ?? '',
      kind: (item.kind as BeamModMetadata['kind']) ?? 'package',
      mod_type: item.mod_type ?? undefined,
      tags: item.tags,
      thumbnail: item.thumbnail ?? undefined,
      download: item.download ?? undefined,
      multiplayer_scope: item.multiplayer_scope ?? undefined,
      release_status: (item.release_status as BeamModMetadata['release_status']) ?? undefined,
      resources: item.resources as BeamModMetadata['resources'],
      x_verified: item.verified,
    }
    const versions: BeamModMetadata[] = [meta]
    if (item.versions) {
      for (const v of item.versions) {
        if (v.version === meta.version) continue
        versions.push({ ...meta, version: v.version, release_date: v.release_date ?? undefined })
      }
    }
    return {
      identifier: item.identifier,
      versions,
      rating: { avg: item.rating.avg, count: item.rating.count },
    }
  }

  const fetchMods = useCallback(async (): Promise<void> => {
    setLoading(true); setError(null)
    try {
      // Try BMR first for full server-side faceted search + live ratings.
      const fq = bmrFiltersToQuery(filters)
      const bmrOpts: BmrSearchOptions = {
        q: searchQuery || undefined,
        type: modType || undefined,
        sort: bmrSortParam(sortBy),
        page,
        pageSize: 25,
        verified: fq.verified === 'true' || fq.verified === 'false' ? fq.verified : undefined,
        status: fq.status,
        kind: fq.kind,
        license: fq.license,
        multiplayer: fq.multiplayer,
        tags: fq.tags,
        tag_mode: fq.tag_mode === 'any' ? 'any' : fq.tag_mode === 'all' ? 'all' : undefined,
        author: fq.author,
        has: fq.has,
        min_rating: fq.min_rating ? Number(fq.min_rating) : undefined,
      }
      const bmrRes = await window.api.bmrSearchMods(bmrOpts)
      if (bmrRes.ok && bmrRes.data) {
        setBmrOffline(false)
        setFacets(bmrRes.data.facets)
        const items = bmrRes.data.items.map(bmrToAvailable)
        const newMine: Record<string, number> = {}
        for (const it of bmrRes.data.items) newMine[it.identifier] = it.rating.mine ?? 0
        if (page === 1) {
          setMods(items)
          setMyRatings(newMine)
        } else {
          setMods((prev) => {
            const seen = new Set(prev.map((m) => m.identifier))
            const merged = prev.slice()
            for (const m of items) {
              if (!seen.has(m.identifier)) { seen.add(m.identifier); merged.push(m) }
            }
            return merged
          })
          setMyRatings((prev) => ({ ...prev, ...newMine }))
        }
        const totalPgs = Math.max(1, Math.ceil(bmrRes.data.total / bmrRes.data.pageSize))
        setTotalPages(totalPgs)
        setTotalMods(bmrRes.data.total)
        return
      }
      // BMR unreachable — fall back to the cached on-disk index. Faceted
      // filters are dropped in this mode (only basic query/type/sort apply).
      setBmrOffline(true)
      setFacets(null)
      const result: RegistrySearchResult = await window.api.registrySearch({
        query: searchQuery || undefined, mod_type: modType || undefined, sort_by: sortBy, page, per_page: 25
      })
      if (page === 1) {
        setMods(result.mods)
      } else {
        setMods((prev) => {
          const seen = new Set(prev.map((m) => m.identifier))
          const merged = prev.slice()
          for (const m of result.mods) {
            if (!seen.has(m.identifier)) { seen.add(m.identifier); merged.push(m) }
          }
          return merged
        })
      }
      setTotalPages(result.total_pages)
      setTotalMods(result.total)
    } catch (err) { setError(String(err)); if (page === 1) setMods([]) } finally { setLoading(false) }
  }, [searchQuery, modType, sortBy, page, filters])

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
  useEffect(() => { setPage(1) }, [searchQuery, modType, sortBy, filters])

  // When the user signs in/out, refresh so the `mine` rating field is
  // accurate for the currently-rendered page.
  useEffect(() => { setPage(1); void fetchMods() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  // Submit / clear a rating. Optimistically updates myRatings and patches
  // the affected mod's aggregate so the card re-renders without a full
  // page refetch.
  const handleSetRating = useCallback(async (identifier: string, stars: number): Promise<void> => {
    if (!signedIn) return
    setRatingBusy(identifier)
    try {
      const res = stars === 0
        ? await window.api.bmrClearRating(identifier)
        : await window.api.bmrSetRating(identifier, stars)
      if (res.ok && res.data) {
        const r = res.data.rating
        setMyRatings((prev) => ({ ...prev, [identifier]: r.mine ?? 0 }))
        setMods((prev) => prev.map((m) =>
          m.identifier === identifier ? { ...m, rating: { avg: r.avg, count: r.count } } : m
        ))
        setSelectedMod((prev) =>
          prev && prev.identifier === identifier ? { ...prev, rating: { avg: r.avg, count: r.count } } : prev
        )
      }
    } finally {
      setRatingBusy(null)
    }
  }, [signedIn])

  // Infinite-scroll plumbing — see ServerList.tsx for the original pattern.
  // Only mounts what the user has scrolled into; further pages are fetched
  // and appended on demand. Memory is bounded by per_page (25) × pages
  // visited, plus the LRU-bounded thumbnail cache above.
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef(loading)
  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (distanceFromBottom < 600 && !loadingRef.current && page < totalPages) {
          setPage((p) => (p < totalPages ? p + 1 : p))
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [page, totalPages])

  // Reset scroll position when query/filter changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [searchQuery, modType])

  // Installed-mod registry entries cached so they can be pinned to page 1
  // even when they don't appear in the current page's search slice.
  const [installedEntries, setInstalledEntries] = useState<AvailableMod[]>([])
  useEffect(() => {
    let cancelled = false
    const ids = Object.keys(installed)
    if (ids.length === 0) { setInstalledEntries([]); return }
    Promise.all(ids.map((id) => window.api.registryGetMod(id).catch(() => null)))
      .then((results) => {
        if (cancelled) return
        setInstalledEntries(results.filter((m): m is AvailableMod => !!m))
      })
    return () => { cancelled = true }
  }, [installed])

  // Prefetch the full set of verified mods once BMR is reachable. We keep
  // them in a dedicated bucket and always merge them into the visible list
  // (respecting the active query/type/filters) so verified entries pin to
  // the top of the page regardless of name-sorted pagination.
  useEffect(() => {
    if (bmrOffline) { setVerifiedMods([]); return }
    let cancelled = false
    void (async () => {
      try {
        const res = await window.api.bmrSearchMods({
          verified: 'true', sort: 'name', page: 1, pageSize: 100,
        })
        if (cancelled || !res.ok || !res.data) return
        setVerifiedMods(res.data.items.map(bmrToAvailable))
      } catch { /* ignore — we'll just lose the pin until next attempt */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bmrOffline])

  // Display order: verified first (pinned), then installed, then everything
  // else. Verified mods are merged in from a dedicated prefetch so they
  // always surface at the top regardless of which page they live on under
  // the current filters/sort.
  const sortedMods = useMemo(() => {
    // Tier order:
    //   0 verified + installed   1 verified
    //   2 installed              3 everything else
    const tier = (m: AvailableMod): number => {
      const isInstalled = m.identifier in installed
      const isVerified = !!m.versions[0]?.x_verified
      if (isVerified && isInstalled) return 0
      if (isVerified) return 1
      if (isInstalled) return 2
      return 3
    }
    const showPinned = !searchQuery && !modType
    const bmrById = new Map<string, AvailableMod>()
    for (const m of mods) bmrById.set(m.identifier, m)
    // Apply the same query/type/filter narrowing the BMR search request
    // honours, so a verified mod that doesn't match the user's filters
    // stays hidden. Free-text query is checked against name/identifier
    // since we don't have the full BMR scoring locally.
    const q = searchQuery.trim().toLowerCase()
    const matchesActiveFilters = (m: AvailableMod): boolean => {
      const v = m.versions[0]
      if (!v) return false
      if (modType && v.mod_type !== modType) return false
      if (q) {
        const hay = `${v.name ?? ''} ${m.identifier} ${v.abstract ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // Filter sidebar: only enforce the simple equality facets we can
      // evaluate client-side. Tag/license/etc. checks are best-effort
      // since the underlying registry entry may be partial.
      if (filters.kind && v.kind && v.kind !== filters.kind) return false
      if (filters.multiplayer && v.multiplayer_scope && v.multiplayer_scope !== filters.multiplayer) return false
      if (filters.release_status && v.release_status && v.release_status !== filters.release_status) return false
      if (filters.verified === 'false' && v.x_verified) return false
      return true
    }
    const seen = new Set<string>()
    const merged: AvailableMod[] = []
    // 1) Verified pin — honour active filters so e.g. "verified=false"
    //    still hides them. BMR copy is preferred for live ratings.
    for (const v of verifiedMods) {
      const candidate = bmrById.get(v.identifier) ?? v
      if (!matchesActiveFilters(candidate)) continue
      if (seen.has(candidate.identifier)) continue
      seen.add(candidate.identifier); merged.push(candidate)
    }
    // 2) Installed pin (only when unfiltered, mirroring previous behaviour).
    if (showPinned) {
      for (const m of installedEntries) {
        if (seen.has(m.identifier)) continue
        seen.add(m.identifier)
        merged.push(bmrById.get(m.identifier) ?? m)
      }
    }
    // 3) Everything else from the active search response.
    for (const m of mods) {
      if (seen.has(m.identifier)) continue
      seen.add(m.identifier); merged.push(m)
    }
    return merged.sort((a, b) => tier(a) - tier(b))
  }, [mods, installed, installedEntries, verifiedMods, searchQuery, modType, filters])

  // Bulk thumbnail prefetch removed: cards now request their own thumbs
  // lazily via `useLazyThumb` when they enter the viewport. Make sure the
  // selected mod's thumb is requested for the detail panel even if its
  // card is far off-screen.
  useEffect(() => {
    const url = selectedMod?.versions[0]?.thumbnail
    if (url) thumbLoader.request(url)
  }, [selectedMod, thumbLoader])

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

  const handleUninstall = async (identifier: string): Promise<void> => {
    const entry = installed[identifier]
    if (!entry) return
    const name = entry.metadata?.name || identifier

    // Warn if other installed mods depend on this one
    let depBlock = ''
    try {
      const reverseDeps = await window.api.registryCheckReverseDeps([identifier])
      if (reverseDeps.length > 0) depBlock = `\n\n${t('mods.dependsOn')}\n${reverseDeps.join(', ')}`
    } catch { /* registry may not track — proceed */ }

    const ok = await confirm({
      title: t('mods.deleteMod'),
      message: `${name}${depBlock}`,
      confirmLabel: depBlock ? t('mods.deleteAnyway') : t('common.delete'),
      variant: depBlock ? 'warning' : 'danger'
    })
    if (!ok) return

    setUninstalling(identifier)
    try {
      // installed_files holds paths like "mods/Repo/foo.zip" relative to userDir.
      // The mods:delete handler matches by registry id OR by basename, so we
      // pass the registry identifier directly to trigger registry cleanup
      // alongside file removal.
      await window.api.deleteMod(identifier)
      // Also remove any lingering files by basename in case the identifier
      // didn't match a tracked mod entry (registry-only ghost entries).
      for (const f of entry.installed_files ?? []) {
        const fname = f.replace(/\\/g, '/').split('/').pop() ?? ''
        const key = fname.replace(/\.zip$/i, '')
        if (key && key !== identifier) {
          try { await window.api.deleteMod(key) } catch { /* best effort */ }
        }
      }
      await fetchInstalled(); await fetchUpdates()
      if (selectedMod?.identifier === identifier) setSelectedMod(null)
    } finally {
      setUninstalling(null)
    }
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--color-border)] px-5 pt-2 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-secondary)]">{totalMods > 0 ? t('mods.modCount', { count: totalMods }) : t('mods.registry')}</span>
            {updates.length > 0 && (
              <button onClick={() => setShowUpdates(!showUpdates)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[var(--color-accent-15)] text-[var(--color-accent-text)] border border-[var(--color-accent-20)] hover:bg-[var(--color-accent-25)]">
                <ArrowUpCircle size={12} /> {t('mods.updateCount', { count: updates.length })}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 relative">
            <div
              className="relative"
              onMouseEnter={() => setShowRegistryHelp(true)}
              onMouseLeave={() => setShowRegistryHelp(false)}
            >
              <button
                onClick={() => window.api.openModPage('https://bmr.musanet.xyz/')}
                title={t('mods.openRegistryWebsite')}
                className="inline-flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-active)] transition"
              >
                {registryLogo ? (
                  <img src={registryLogo} alt="" className="w-7 h-7 object-contain shrink-0" />
                ) : (
                  <Database size={26} />
                )}
                <span>{t('mods.registryWebsite')}</span>
                <ExternalLink size={14} className="opacity-70" />
              </button>
              {showRegistryHelp && (
                <div className="absolute right-0 top-full pt-2 z-50 w-80">
                  <div className="border border-[var(--color-border)] bg-[var(--color-base)] shadow-xl p-4 text-[11px] text-[var(--color-text-secondary)] space-y-2">
                    <div className="flex items-center gap-2">
                      {registryLogo ? (
                        <img src={registryLogo} alt="" className="w-8 h-8 object-contain" />
                      ) : (
                        <Database size={28} className="text-[var(--color-accent-text)]" />
                      )}
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                        {t('mods.aboutRegistry')}
                      </span>
                    </div>
                    <p className="leading-relaxed text-[var(--color-text-primary)]">{t('mods.registryHelpBody')}</p>
                    <button
                      onClick={() => {
                        window.api.openModPage('https://bmr.musanet.xyz/login')
                        setShowRegistryHelp(false)
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)] transition mt-2"
                    >
                      <ExternalLink size={11} /> {t('mods.signInToRegistry')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button onClick={handleRefreshIndex} disabled={indexUpdating}
              className="inline-flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]">
              <RefreshCw size={26} className={indexUpdating ? 'animate-spin' : ''} />
              {indexUpdating ? t('mods.updating') : t('common.refresh')}
            </button>
            <BmrAuthMenu />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('mods.searchRegistry')} className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] pr-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }} />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            disabled={bmrOffline}
            title={bmrOffline ? t('mods.bmrOfflineFilters') : t('mods.bmrFilters')}
            className={`inline-flex items-center gap-1.5 border px-3 py-2.5 text-xs transition ${
              showFilters && !bmrOffline
                ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-active)]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <SlidersHorizontal size={13} /> {t('mods.bmrFilters')}
          </button>
          <select value={modType} onChange={(e) => setModType(e.target.value)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-50)]">
            {MOD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] px-4 py-2.5 text-xs text-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent-50)]">
            <option value="name">{t('mods.sortName')}</option>
            <option value="rating">{t('mods.sortRating')}</option>
            <option value="updated">{t('mods.sortUpdated')}</option>
            <option value="author">{t('mods.sortAuthor')}</option>
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
        {showFilters && !bmrOffline && (
          <BmrFiltersPanel
            facets={facets}
            filters={filters}
            setFilters={setFilters}
            onClose={() => setShowFilters(false)}
          />
        )}
        {loading && mods.length === 0 ? (
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
            <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sortedMods.map((mod) => (
                  <RegistryModCard
                    key={mod.identifier}
                    mod={mod}
                    selected={selectedMod?.identifier === mod.identifier}
                    isInstalled={mod.identifier in installed}
                    loader={thumbLoader}
                    onClick={() =>
                      setSelectedMod(selectedMod?.identifier === mod.identifier ? null : mod)
                    }
                  />
                ))}
              </div>
              {/* Infinite-scroll footer */}
              {page < totalPages ? (
                <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-[var(--color-text-muted)]">
                  {loading ? <Loader2 size={12} className="animate-spin" /> : null}
                  <span>{t('mods.loadingMore')}</span>
                </div>
              ) : sortedMods.length > 0 ? (
                <div className="text-center py-4 text-[11px] text-[var(--color-text-dim)]">
                  {t('mods.endOfResults')}
                </div>
              ) : null}
            </div>
            {selectedMod && (
              <RegistryDetailPanel
                mod={selectedMod}
                installed={installed}
                installing={installing}
                uninstalling={uninstalling}
                onInstall={handleInstallClick}
                onUninstall={handleUninstall}
                thumbDataUrl={selectedMod.versions[0]?.thumbnail ? thumbLoader.get(selectedMod.versions[0].thumbnail) : undefined}
                myRating={myRatings[selectedMod.identifier] ?? 0}
                onRate={(stars) => handleSetRating(selectedMod.identifier, stars)}
                ratingBusy={ratingBusy === selectedMod.identifier}
                bmrAvailable={!bmrOffline}
              />
            )}
          </>
        )}
      </div>

      {/* Pagination removed — superseded by infinite scroll above. */}
      {confirmDialogEl}
    </>
  )
}

/* ── Registry Detail Panel ── */

function RegistryDetailPanel({
  mod, installed, installing, uninstalling, onInstall, onUninstall, thumbDataUrl,
  myRating = 0, onRate, ratingBusy = false, bmrAvailable = false,
}: {
  mod: AvailableMod
  installed: Record<string, InstalledRegistryMod>
  installing: string | null
  uninstalling: string | null
  onInstall: (id: string) => void
  onUninstall: (id: string) => void
  thumbDataUrl?: string
  /** Viewer's submitted star rating (0 if none). */
  myRating?: number
  /** Stars 0..5 (0 to clear). Omit when BMR isn't wired. */
  onRate?: (stars: number) => void
  ratingBusy?: boolean
  /** True when the BMR backend is reachable + auth-aware. */
  bmrAvailable?: boolean
}): React.JSX.Element {
  const latest = mod.versions[0]!
  const authors = Array.isArray(latest.author) ? latest.author.join(', ') : latest.author
  const isInst = mod.identifier in installed
  const isUninstalling = uninstalling === mod.identifier
  const deps = latest.depends ?? []
  const { t } = useTranslation()
  // Auth-gated rating widget. We can't usefully call useBmrAuth here in
  // the offline path (provider missing), so guard via bmrAvailable.
  const auth = useBmrAuth()

  return (
    <div
      className="shrink-0 border-l border-[var(--color-border)] overflow-y-auto space-y-4"
      style={{ width: 340, padding: 12 }}
    >
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{latest.name}</h2>
          {latest.x_verified && <VerifiedBadge height={16} />}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">{latest.abstract}</p>
      </div>

      {thumbDataUrl && (
        <img src={thumbDataUrl} alt={latest.name} className="w-full object-cover border border-[var(--color-border)]" />
      )}

      {/* Live BMR rating + interactive widget. Hidden when offline. */}
      {bmrAvailable && onRate && (
        <div className="border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-3 py-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
              {t('mods.bmrCommunityRating')}
            </span>
            {mod.rating && mod.rating.count > 0 ? (
              <span className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                ★ {mod.rating.avg.toFixed(2)} · {mod.rating.count}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--color-text-muted)]">{t('mods.bmrNoRatingsYet')}</span>
            )}
          </div>
          {auth.signedIn ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {myRating > 0 ? t('mods.bmrYourRating') : t('mods.bmrRateThis')}
              </span>
              <InteractiveStarRating value={myRating} onChange={onRate} busy={ratingBusy} />
            </div>
          ) : (
            <p className="text-[10px] text-[var(--color-text-muted)] italic pt-1">
              {t('mods.bmrSignInToRate')}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2 text-xs">
        <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('mods.identifier')}</span><span className="text-[var(--color-text-secondary)] font-mono text-[11px] truncate text-right min-w-0" title={mod.identifier}>{mod.identifier}</span></div>
        <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('common.version')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{latest.version}</span></div>
        <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('common.author')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0" title={authors}>{authors}</span></div>
        {latest.mod_type && <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('common.type')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{latest.mod_type}</span></div>}
        {latest.license && <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('common.license')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{Array.isArray(latest.license) ? latest.license.join(', ') : latest.license}</span></div>}
        {latest.release_date && <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('mods.released')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{latest.release_date}</span></div>}
        {latest.release_status && <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('common.status')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{latest.release_status}</span></div>}
        {latest.beamng_version && <div className="flex justify-between gap-3 min-w-0"><span className="text-[var(--color-text-muted)] shrink-0">{t('mods.gameVer')}</span><span className="text-[var(--color-text-secondary)] truncate text-right min-w-0">{latest.beamng_version}</span></div>}
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
          {latest.resources.homepage && <a href={latest.resources.homepage} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('mods.homepage')}</a>}
          {latest.resources.repository && <a href={latest.resources.repository} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('common.source')}</a>}
          {latest.resources.beamng_resource && <a href={latest.resources.beamng_resource} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />{t('mods.beamngCom')}</a>}
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
          onClick={() => {
            if (isInst) onUninstall(mod.identifier)
            else onInstall(mod.identifier)
          }}
          disabled={installing === mod.identifier || isUninstalling}
          className={`group w-full inline-flex items-center justify-center gap-1.5 border px-3 py-2.5 text-xs font-medium transition ${
            isUninstalling
              ? 'border-red-500/30 bg-red-500/10 text-red-300 cursor-wait'
              : isInst
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300'
                : installing === mod.identifier
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)]/60 cursor-wait'
                  : 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)]'
          }`}
        >
          {isUninstalling ? (
            <><Loader2 size={13} className="animate-spin" /> {t('common.delete')}</>
          ) : installing === mod.identifier ? (
            <><Loader2 size={13} className="animate-spin" /> {t('mods.installing')}</>
          ) : isInst ? (
            <>
              <CheckCircle size={13} className="group-hover:hidden" />
              <Trash2 size={13} className="hidden group-hover:inline" />
              <span className="group-hover:hidden">{t('mods.installed')}</span>
              <span className="hidden group-hover:inline">{t('common.delete')}</span>
            </>
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
