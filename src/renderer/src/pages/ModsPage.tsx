import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Package,
  Search,
  FolderOpen,
  Plus,
  Trash2,
  ToggleLeft,
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
  Server,
  Volume2,
  Layout,
  Flag,
  Paintbrush,
  RectangleHorizontal,
  Cog
} from 'lucide-react'
import type { ModInfo, RepoMod, RepoCategory, RepoSortOrder } from '../../../shared/types'
import type { AvailableMod, BeamModMetadata, RegistrySearchResult, ResolutionResult, InstalledRegistryMod } from '../../../shared/registry-types'
import { useConfirmDialog } from '../hooks/useConfirmDialog'

type ModFilter = string
type ModsTab = 'installed' | 'browse' | 'registry'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const MOD_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'vehicle', label: 'Vehicles' },
  { value: 'terrain', label: 'Maps' },
  { value: 'skin', label: 'Skins' },
  { value: 'ui_app', label: 'UI Apps' },
  { value: 'sound', label: 'Sounds' },
  { value: 'scenario', label: 'Scenarios' },
  { value: 'license_plate', label: 'License Plates' },
  { value: 'automation', label: 'Automation' },
  { value: 'other', label: 'Other' }
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
      return <Package size={13} className="text-slate-400" />
    default:
      return <HelpCircle size={13} className="text-slate-500" />
  }
}

export function ModsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ModsTab>('installed')
  const [registryUpdates, setRegistryUpdates] = useState(0)
  const [deleteVersion, setDeleteVersion] = useState(0)

  useEffect(() => {
    window.api.registryGetUpdatesAvailable().then((updates) => {
      setRegistryUpdates(updates.length)
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full rounded-lg border border-white/6 overflow-hidden">
      {/* Top-level tab bar */}
      <div className="shrink-0 border-b border-white/6 px-4 pt-4 pb-0">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-semibold text-white">Mods</h1>
          <div className="flex gap-2 -mb-px">
            <button
              onClick={() => setActiveTab('installed')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'installed'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Package size={13} /> Installed
              </span>
            </button>
            <button
              onClick={() => setActiveTab('browse')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'browse'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Globe size={13} /> Browse
              </span>
            </button>
            <button
              onClick={() => setActiveTab('registry')}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === 'registry'
                  ? 'border-[var(--color-accent)] text-[var(--color-accent-text)]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Database size={13} /> Registry
                {registryUpdates > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-[var(--color-accent)] text-white rounded-full leading-none">
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
  const [previewCache, setPreviewCache] = useState<Record<string, string | null>>({})
  const [registryInstalled, setRegistryInstalled] = useState<Record<string, InstalledRegistryMod>>({})
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()

  const fetchMods = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.getMods()
      if (result.success && result.data) {
        setMods(result.data)
      } else {
        setError(result.error || 'Failed to load mods')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMods()
    window.api.registryGetInstalled().then(setRegistryInstalled).catch(() => {})
  }, [])

  // Fetch preview image when a mod is selected
  useEffect(() => {
    if (!selectedMod) return
    const key = selectedMod.filePath
    if (key in previewCache) return // already fetched or fetching
    setPreviewCache((prev) => ({ ...prev, [key]: null }))
    window.api.getModPreview(selectedMod.filePath).then((result) => {
      if (result.success && result.data) {
        setPreviewCache((prev) => ({ ...prev, [key]: result.data! }))
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

    // Sort: enabled first, then alphabetically by title/filename
    result = [...result].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
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
    setActionPending(mod.key)
    const newState = !mod.enabled
    const result = await window.api.toggleMod(mod.key, newState)
    if (result.success) {
      setMods((prev) =>
        prev.map((m) => (m.key === mod.key ? { ...m, enabled: newState } : m))
      )
      if (selectedMod?.key === mod.key) {
        setSelectedMod({ ...selectedMod, enabled: newState })
      }
    }
    setActionPending(null)
  }

  const handleDelete = async (mod: ModInfo): Promise<void> => {
    // Check if other mods depend on this one
    try {
      const reverseDeps = await window.api.registryCheckReverseDeps([mod.key])
      if (reverseDeps.length > 0) {
        const depList = reverseDeps.join(', ')
        const ok = await confirm({
          title: 'Dependency Warning',
          message: `The following mods depend on "${mod.title || mod.fileName}":\n${depList}\n\nDelete anyway?`,
          confirmLabel: 'Delete Anyway',
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
          title: 'Mod Deployed on Servers',
          message: `"${mod.title || mod.fileName}" is deployed on ${servers.length} server(s): ${serverList}\n\nThis will uninstall the mod and remove it from all servers.`,
          confirmLabel: 'Uninstall & Remove',
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
    if (result.success) {
      fetchMods()
    }
  }

  const handleOpenFolder = (): void => {
    window.api.openModsFolder()
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-white/6 px-5 pt-2 pb-3 space-y-3">
        {/* Action row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!loading && (
              <span className="text-xs text-slate-400">
                {summary.total} mod{summary.total !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchMods}
              className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/10"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleOpenFolder}
              className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/10"
            >
              <FolderOpen size={13} />
              Open folder
            </button>
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
            >
              <Plus size={13} />
              Install mod
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <Package size={11} /> Total mods
            </div>
            <div className="text-lg font-bold text-white">{summary.total}</div>
          </div>
          <div className="border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <ToggleRight size={11} /> Enabled
            </div>
            <div className="text-lg font-bold text-white">{summary.enabled}</div>
          </div>
          <div className="border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <HardDrive size={11} /> Disk usage
            </div>
            <div className="text-lg font-bold text-white">{formatBytes(summary.totalSize)}</div>
          </div>
          <div className="border border-white/8 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-slate-400 mb-1">
              <MapPin size={11} /> Maps / Vehicles
            </div>
            <div className="text-lg font-bold text-white">
              {summary.terrain} / {summary.vehicle}
            </div>
          </div>
        </div>

        {/* Search + filter tabs */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mods..."
              className="w-full bg-white/5 border border-white/10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }}
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-white/5 border border-white/10 px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
          >
            {MOD_TYPE_FILTERS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#1a1a1c] text-white">
                {o.label}
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
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Loading mods...
          </div>
        ) : filteredMods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Package size={40} strokeWidth={1} />
            <p className="text-sm">
              {mods.length === 0 ? 'No mods installed' : 'No mods match your search'}
            </p>
            {mods.length === 0 && (
              <button
                onClick={handleInstall}
                className="mt-2 inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
              >
                <Plus size={13} />
                Install your first mod
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mod list */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-[#111113] border-b border-white/6">
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium">Mod</th>
                    <th className="text-left px-4 py-2.5 font-medium">Type</th>
                    <th className="text-right px-4 py-2.5 font-medium">Size</th>
                    <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMods.map((mod) => (
                    <tr
                      key={mod.key}
                      onClick={() => setSelectedMod(selectedMod?.key === mod.key ? null : mod)}
                      className={`border-b border-white/4 cursor-pointer transition ${
                        selectedMod?.key === mod.key
                          ? 'bg-[var(--color-accent-8)]'
                          : 'hover:bg-white/3'
                      }`}
                    >
                      {/* Toggle */}
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggle(mod)
                          }}
                          disabled={actionPending === mod.key || mod.location === 'multiplayer'}
                          className="text-slate-300 transition hover:text-white disabled:opacity-40"
                          title={mod.enabled ? 'Disable mod' : 'Enable mod'}
                        >
                          {mod.enabled ? (
                            <ToggleRight size={20} className="text-[var(--color-accent)]" />
                          ) : (
                            <ToggleLeft size={20} />
                          )}
                        </button>
                      </td>

                      {/* Mod name */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-white truncate max-w-[300px]">
                          {mod.title || mod.fileName}
                        </div>
                        {mod.title && (
                          <div className="text-[11px] text-slate-500 truncate max-w-[300px]">
                            {mod.fileName}
                          </div>
                        )}
                        {mod.author && (
                          <div className="text-[11px] text-slate-500">by {mod.author}</div>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                          {modTypeIcon(mod.modType)}
                          {mod.modType || 'unknown'}
                        </div>
                      </td>

                      {/* Size */}
                      <td className="px-4 py-3 text-right text-xs text-slate-400">
                        {formatBytes(mod.sizeBytes)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        {mod.location !== 'multiplayer' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(mod)
                            }}
                            disabled={actionPending === mod.key}
                            className="text-slate-500 transition hover:text-rose-400 disabled:opacity-40"
                            title="Delete mod"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detail panel */}
            {selectedMod && (
              <div className="w-[340px] shrink-0 border-l border-white/6 overflow-y-auto p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {selectedRegistryEntry?.metadata.name || selectedMod.title || selectedMod.fileName}
                  </h2>
                  {(selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine) && (
                    <p className="text-xs text-slate-400 mt-1">
                      {selectedRegistryEntry?.metadata.abstract || selectedMod.tagLine}
                    </p>
                  )}
                </div>

                {/* Preview image */}
                {previewCache[selectedMod.filePath] && (
                  <img
                    src={previewCache[selectedMod.filePath]!}
                    alt={selectedMod.title || selectedMod.fileName}
                    className="w-full object-cover border border-white/6"
                  />
                )}

                {/* Registry tags */}
                {selectedRegistryEntry?.metadata.tags && selectedRegistryEntry.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedRegistryEntry.metadata.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center border border-white/8 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Description */}
                {selectedRegistryEntry?.metadata.description && (
                  <div className="text-xs text-slate-300 leading-relaxed border-t border-white/6 pt-3">
                    {selectedRegistryEntry.metadata.description}
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">File</span>
                    <span className="text-slate-300 truncate ml-4 max-w-[180px]">{selectedMod.fileName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Type</span>
                    <span className="text-slate-300 inline-flex items-center gap-1">
                      {modTypeIcon(selectedMod.modType)}
                      {selectedRegistryEntry?.metadata.mod_type || selectedMod.modType}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Size</span>
                    <span className="text-slate-300">{formatBytes(selectedMod.sizeBytes)}</span>
                  </div>
                  {(selectedRegistryEntry?.metadata.author || selectedMod.author) && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Author</span>
                      <span className="text-slate-300">
                        {Array.isArray(selectedRegistryEntry?.metadata.author)
                          ? selectedRegistryEntry!.metadata.author.join(', ')
                          : selectedRegistryEntry?.metadata.author || selectedMod.author}
                      </span>
                    </div>
                  )}
                  {(selectedRegistryEntry?.metadata.version || selectedMod.version) && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Version</span>
                      <span className="text-slate-300">
                        {selectedRegistryEntry?.metadata.version || selectedMod.version}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.license && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">License</span>
                      <span className="text-slate-300">
                        {Array.isArray(selectedRegistryEntry.metadata.license)
                          ? selectedRegistryEntry.metadata.license.join(', ')
                          : selectedRegistryEntry.metadata.license}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry?.metadata.release_status && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Release</span>
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
                      <span className="text-slate-500">Released</span>
                      <span className="text-slate-300">
                        {new Date(selectedRegistryEntry.metadata.release_date).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Source</span>
                      <span className="text-slate-300 capitalize">{selectedRegistryEntry.install_source}</span>
                    </div>
                  )}
                  {selectedRegistryEntry && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Installed</span>
                      <span className="text-slate-300">
                        {new Date(selectedRegistryEntry.install_time).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Location</span>
                    <span className="text-slate-300">{selectedMod.location}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <span className={selectedMod.enabled ? 'text-[var(--color-accent)]' : 'text-slate-500'}>
                      {selectedMod.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Modified</span>
                    <span className="text-slate-300">
                      {new Date(selectedMod.modifiedDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* External links */}
                {selectedRegistryEntry?.metadata.resources && (
                  <div className="border-t border-white/6 pt-3 space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Links</span>
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
                  <div className="border-t border-white/6 pt-3 space-y-1.5">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Dependencies</span>
                    {selectedRegistryEntry.metadata.depends.map((dep) => {
                      const depName = typeof dep === 'string' ? dep : dep.name
                      return (
                        <div key={depName} className="text-xs text-slate-300 flex items-center gap-1">
                          <Package size={10} className="text-slate-500" /> {depName}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Actions */}
                {selectedMod.location !== 'multiplayer' && (
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => handleToggle(selectedMod)}
                      disabled={actionPending === selectedMod.key}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 border px-3 py-2 text-xs font-medium transition ${
                        selectedMod.enabled
                          ? 'border-slate-500/30 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20'
                          : 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)]'
                      }`}
                    >
                      {selectedMod.enabled ? (
                        <>
                          <ToggleLeft size={13} /> Disable
                        </>
                      ) : (
                        <>
                          <ToggleRight size={13} /> Enable
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleDelete(selectedMod)}
                      disabled={actionPending === selectedMod.key}
                      className="inline-flex items-center justify-center gap-1.5 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {confirmDialogEl}
    </>
  )
}

/* ═══════════════════════════════════════════
   Browse Mods View (BeamNG.com Repository)
   ═══════════════════════════════════════════ */

const SORT_OPTIONS: { value: RepoSortOrder; label: string }[] = [
  { value: 'download_count', label: 'Most Downloaded' },
  { value: 'rating_weighted', label: 'Best Rated' },
  { value: 'last_update', label: 'Recently Updated' },
  { value: 'resource_date', label: 'Newest' },
  { value: 'title', label: 'Alphabetical' }
]

function StarRating({ rating }: { rating: number }): React.JSX.Element {
  const stars: React.ReactNode[] = []
  for (let i = 1; i <= 5; i++) {
    const fill = Math.min(1, Math.max(0, rating - (i - 1)))
    stars.push(
      <Star
        key={i}
        size={11}
        className={fill >= 0.5 ? 'text-[var(--color-accent)] fill-[var(--color-accent)]' : 'text-slate-600'}
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
  const [thumbCache, setThumbCache] = useState<Record<string, string>>({})
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
    const missing = urls.filter((u) => !thumbCache[u])
    if (missing.length === 0) return
    window.api.getRepoThumbnails(missing).then((result) => {
      setThumbCache((prev) => ({ ...prev, ...result }))
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
        setError(result.error || 'Failed to load mods')
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
        setDownloadError(result.error || 'Download failed')
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
      <div className="shrink-0 border-b border-white/6 px-5 pt-2 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search beamng.com mods..."
              className="w-full bg-white/5 border border-white/10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }}
            />
          </div>
          <button
            onClick={handleSearch}
            className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)]"
          >
            <Search size={13} /> Search
          </button>
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-slate-300 transition hover:bg-white/10"
            >
              Clear
            </button>
          )}

          {/* BeamNG.com login */}
          <div className="ml-auto flex items-center gap-2">
            {beamngLoggedIn ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <User size={12} /> Logged in
                </span>
                <button
                  onClick={handleBeamngLogout}
                  className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white"
                  title="Log out of BeamNG.com"
                >
                  <LogOut size={12} />
                </button>
              </>
            ) : (
              <button
                onClick={handleBeamngLogin}
                disabled={loginLoading}
                className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2.5 text-xs font-medium text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-20)] disabled:opacity-50"
                title="Log in to BeamNG.com to download mods"
              >
                {loginLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <LogIn size={12} />
                )}
                BeamNG Login
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
              className="bg-white/5 border border-white/10 px-4 py-2.5 text-xs text-white outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id} className="bg-[#1a1a1c] text-white">
                  {cat.label}
                </option>
              ))}
            </select>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => handleSortChange(e.target.value as RepoSortOrder)}
              className="bg-white/5 border border-white/10 px-4 py-2.5 text-xs text-white outline-none focus:border-[var(--color-accent-50)] appearance-none cursor-pointer"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#1a1a1c] text-white">
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              onClick={fetchMods}
              className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-slate-300 transition hover:bg-white/10"
              title="Refresh"
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
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading mods...
          </div>
        ) : mods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Globe size={40} strokeWidth={1} />
            <p className="text-sm">
              {searchQuery ? 'No mods found for your search' : 'No mods found'}
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
                      className={`border bg-white/3 transition cursor-pointer group ${
                        selectedMod?.resourceId === mod.resourceId
                          ? 'border-[var(--color-accent-40)] bg-[var(--color-accent-5)]'
                          : 'border-white/6 hover:border-white/15 hover:bg-white/5'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-black/30 overflow-hidden">
                        {thumbCache[mod.thumbnailUrl] ? (
                          <img
                            src={thumbCache[mod.thumbnailUrl]}
                            alt={mod.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600">
                            {mod.thumbnailUrl ? (
                              <Loader2 size={20} className="animate-spin text-slate-500" />
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
                        <h3 className="text-sm font-medium text-white truncate">{mod.title}</h3>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 truncate">
                            by {mod.author}
                          </span>
                          <span className="text-[11px] text-slate-500">{mod.version}</span>
                        </div>
                        {mod.tagLine && (
                          <p className="text-[11px] text-slate-500 truncate">{mod.tagLine}</p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2">
                            <StarRating rating={mod.rating} />
                            <span className="text-[10px] text-slate-500">({mod.ratingCount})</span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Download size={10} />
                            {formatCount(mod.downloads)}
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-600">{mod.category}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detail panel */}
              {selectedMod && (
                <div className="w-[320px] shrink-0 border-l border-white/6 overflow-y-auto p-5 space-y-4">
                  {/* Thumbnail */}
                  {thumbCache[selectedMod.thumbnailUrl] && (
                    <div className="aspect-video bg-black/30 overflow-hidden">
                      <img
                        src={thumbCache[selectedMod.thumbnailUrl]}
                        alt={selectedMod.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div>
                    <h2 className="text-base font-semibold text-white">{selectedMod.title}</h2>
                    {selectedMod.prefix && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-accent-20)] text-[var(--color-accent-text)] border border-[var(--color-border-accent)]">
                        {selectedMod.prefix}
                      </span>
                    )}
                    {selectedMod.tagLine && (
                      <p className="text-xs text-slate-400 mt-2">{selectedMod.tagLine}</p>
                    )}
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Author</span>
                      <span className="text-slate-300">{selectedMod.author}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Version</span>
                      <span className="text-slate-300">{selectedMod.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Category</span>
                      <span className="text-slate-300">{selectedMod.category}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Rating</span>
                      <span className="inline-flex items-center gap-1.5">
                        <StarRating rating={selectedMod.rating} />
                        <span className="text-slate-400">
                          {selectedMod.rating.toFixed(1)} ({selectedMod.ratingCount})
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Downloads</span>
                      <span className="text-slate-300">{selectedMod.downloads.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Subscriptions</span>
                      <span className="text-slate-300">
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
                          : 'Starting...'}
                      </>
                    ) : isModInstalled(selectedMod) ? (
                      <>
                        <CheckCircle size={13} /> Installed
                      </>
                    ) : (
                      <>
                        <Download size={13} /> Install mod
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => window.api.openModPage(selectedMod.pageUrl)}
                    className="w-full inline-flex items-center justify-center gap-1.5 border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                  >
                    <ExternalLink size={13} /> View on beamng.com
                  </button>
                  {downloadError && downloading === null && (
                    <p className="text-[11px] text-rose-400">{downloadError}</p>
                  )}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="shrink-0 border-t border-white/6 px-5 py-3 flex items-center justify-between">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={13} /> Previous
                </button>
                <span className="text-xs text-slate-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={13} />
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

  // Subscribe to download progress events
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
      if (!result.success) setInstallError(result.error || 'Install failed')
      await fetchInstalled(); await fetchUpdates()
    } catch (err) { setInstallError(String(err)) } finally { setInstalling(null); setDownloadProgress(null) }
  }

  return (
    <>
      {/* Header */}
      <div className="shrink-0 border-b border-white/6 px-5 pt-2 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{mods.length > 0 ? `${mods.length} mods` : 'Registry'}</span>
            {updates.length > 0 && (
              <button onClick={() => setShowUpdates(!showUpdates)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[var(--color-accent-15)] text-[var(--color-accent-text)] border border-[var(--color-accent-20)] hover:bg-[var(--color-accent-25)]">
                <ArrowUpCircle size={12} /> {updates.length} update{updates.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
          <button onClick={handleRefreshIndex} disabled={indexUpdating}
            className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-300 hover:bg-white/10">
            <RefreshCw size={13} className={indexUpdating ? 'animate-spin' : ''} />
            {indexUpdating ? 'Updating...' : 'Refresh'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" style={{ left: 14 }} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search registry..." className="w-full bg-white/5 border border-white/10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-[var(--color-accent-50)]"
              style={{ paddingLeft: 42 }} />
          </div>
          <select value={modType} onChange={(e) => setModType(e.target.value)}
            className="bg-white/5 border border-white/10 px-4 py-2.5 text-xs text-slate-300 outline-none focus:border-[var(--color-accent-50)]">
            {MOD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span>Downloading {installing}...</span>
            <span>{Math.round(downloadProgress.received / 1024)}KB / {Math.round(downloadProgress.total / 1024)}KB</span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
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
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading registry...
          </div>
        ) : mods.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Database size={40} strokeWidth={1} />
            <p className="text-sm">{searchQuery ? 'No mods match your search' : 'Registry empty — try refreshing'}</p>
            <button onClick={handleRefreshIndex}
              className="mt-2 inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-4 py-2 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)]">
              <RefreshCw size={13} /> Refresh Index
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
                      className={`text-left border p-4 transition space-y-2 ${selectedMod?.identifier === mod.identifier ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-8)]' : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-white truncate">{latest.name}</span>
                            {latest.x_verified && <BadgeCheck size={12} className="text-blue-400 shrink-0" title="Registry Verified" />}
                            {isInst && <CheckCircle size={12} className="text-emerald-400 shrink-0" />}
                          </div>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">{authors}</p>
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0">v{latest.version}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2">{latest.abstract}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        {latest.mod_type && <span className="px-1.5 py-0.5 border border-white/8 bg-white/5">{latest.mod_type}</span>}
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
        <div className="shrink-0 border-t border-white/6 px-5 py-3 flex items-center justify-between">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30">
            <ChevronLeft size={13} /> Previous
          </button>
          <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30">
            Next <ChevronRight size={13} />
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

  return (
    <div className="w-[340px] shrink-0 border-l border-white/6 overflow-y-auto p-5 space-y-4">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold text-white">{latest.name}</h2>
          {latest.x_verified && <BadgeCheck size={14} className="text-blue-400 shrink-0" title="Registry Verified" />}
        </div>
        <p className="text-xs text-slate-400 mt-1">{latest.abstract}</p>
      </div>

      {latest.thumbnail && (
        <img src={latest.thumbnail} alt={latest.name} className="w-full object-cover border border-white/6" />
      )}

      <div className="space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Identifier</span><span className="text-slate-300 font-mono text-[11px]">{mod.identifier}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Version</span><span className="text-slate-300">{latest.version}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Author</span><span className="text-slate-300 truncate ml-4 max-w-[180px]">{authors}</span></div>
        {latest.mod_type && <div className="flex justify-between"><span className="text-slate-500">Type</span><span className="text-slate-300">{latest.mod_type}</span></div>}
        {latest.license && <div className="flex justify-between"><span className="text-slate-500">License</span><span className="text-slate-300">{Array.isArray(latest.license) ? latest.license.join(', ') : latest.license}</span></div>}
        {latest.release_date && <div className="flex justify-between"><span className="text-slate-500">Released</span><span className="text-slate-300">{latest.release_date}</span></div>}
        {latest.release_status && <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="text-slate-300">{latest.release_status}</span></div>}
        {latest.beamng_version && <div className="flex justify-between"><span className="text-slate-500">Game ver</span><span className="text-slate-300">{latest.beamng_version}</span></div>}
        {latest.multiplayer_scope && latest.multiplayer_scope !== 'client' && (
          <div className="flex justify-between">
            <span className="text-slate-500">Scope</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${latest.multiplayer_scope === 'both' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'}`}>
              {latest.multiplayer_scope === 'both' ? 'Client + Server Plugin' : 'Server Plugin'}
            </span>
          </div>
        )}
      </div>

      {latest.description && (
        <div className="border-t border-white/6 pt-3">
          <p className="text-[11px] text-slate-400 whitespace-pre-line">{latest.description}</p>
        </div>
      )}

      {deps.length > 0 && (
        <div className="border-t border-white/6 pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Dependencies</h3>
          <div className="space-y-1">
            {deps.map((dep, i) => {
              if ('any_of' in dep) return <span key={i} className="text-[11px] text-slate-400">One of: {dep.any_of.map((d) => d.identifier).join(', ')}</span>
              return <span key={i} className="block text-[11px] text-slate-400">{dep.identifier}{dep.version ? ` = ${dep.version}` : ''}</span>
            })}
          </div>
        </div>
      )}

      {latest.supports && latest.supports.length > 0 && (
        <div className="border-t border-white/6 pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Enhances</h3>
          <div className="space-y-1">
            {latest.supports.map((sup, i) => {
              if ('any_of' in sup) return <span key={i} className="text-[11px] text-emerald-400">Any of: {sup.any_of.map((d) => d.identifier).join(', ')}</span>
              return <span key={i} className="block text-[11px] text-emerald-400">{sup.identifier}</span>
            })}
          </div>
        </div>
      )}

      {latest.resources && (
        <div className="border-t border-white/6 pt-3 space-y-1">
          {latest.resources.homepage && <a href={latest.resources.homepage} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />Homepage</a>}
          {latest.resources.repository && <a href={latest.resources.repository} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />Source</a>}
          {latest.resources.beamng_resource && <a href={latest.resources.beamng_resource} className="block text-[11px] text-[var(--color-accent)] hover:underline truncate"><ExternalLink size={10} className="inline mr-1" />BeamNG.com</a>}
        </div>
      )}

      {mod.versions.length > 1 && (
        <div className="border-t border-white/6 pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Versions</h3>
          <div className="space-y-1">
            {mod.versions.slice(0, 5).map((v) => (
              <div key={v.version} className="text-[11px] text-slate-400 flex justify-between">
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
            <><Loader2 size={13} className="animate-spin" /> Installing...</>
          ) : isInst ? (
            <><CheckCircle size={13} /> Installed</>
          ) : (
            <><Download size={13} /> Install</>
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
  return (
    <div className="mx-4 mt-3 border border-[var(--color-accent-20)] bg-[var(--color-accent-5)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[var(--color-accent-text)] flex items-center gap-1.5">
          <ArrowUpCircle size={14} /> Updates Available
        </h3>
        <button onClick={() => onInstall(updates.map((u) => u.identifier))} disabled={installing !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent-25)] disabled:opacity-40">
          {installing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Update All
        </button>
      </div>
      <div className="space-y-2">
        {updates.map((u) => (
          <div key={u.identifier} className="flex items-center justify-between text-xs">
            <div>
              <span className="text-white font-medium">{u.mod.name}</span>
              <span className="text-slate-500 ml-2">{u.installed} → {u.latest}</span>
            </div>
            <button onClick={() => onInstall([u.identifier])} disabled={installing === u.identifier}
              className="text-[11px] text-[var(--color-accent-text)] hover:text-[var(--color-accent-text-muted)] disabled:opacity-40">
              {installing === u.identifier ? <Loader2 size={11} className="animate-spin" /> : 'Update'}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a1e] border border-white/10 w-[420px] max-h-[80vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Info size={16} className="text-[var(--color-accent)]" /> Confirm Installation
        </h2>
        <p className="text-xs text-slate-400">
          The following {newMods.length} mod{newMods.length !== 1 ? 's' : ''} will be installed:
        </p>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {newMods.map((m) => (
            <div key={m.identifier} className="flex items-center gap-2 text-xs text-slate-300">
              <Package size={11} className="text-slate-500 shrink-0" />
              <span className="truncate">{m.name}</span>
              <span className="text-slate-500 ml-auto shrink-0">v{m.version}</span>
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
            <p className="text-[11px] text-rose-300 mb-1">The following mods will be removed:</p>
            {resolution.to_remove.map((id) => (
              <p key={id} className="text-[11px] text-rose-400">{id}</p>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onCancel}
            className="flex-1 border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 border border-[var(--color-border-accent)] bg-[var(--color-accent-15)] px-3 py-2 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-25)]">
            Install {newMods.length} mod{newMods.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
