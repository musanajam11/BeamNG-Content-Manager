import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search, Car, Loader2, ChevronLeft, X, Save, Trash2,
  Edit3, Copy, Zap, Gauge, Weight, Fuel, Settings2, Info, Box
} from 'lucide-react'
import type { VehicleDetail, VehicleConfigInfo, VehicleConfigData, VehicleEditorData } from '../../../shared/types'
import { VehicleViewer, type PaintData } from '../components/VehicleViewer'

type VehicleListItem = {
  name: string; displayName: string; brand: string; type: string
  bodyStyle: string; country: string; source: 'stock' | 'mod'; configCount: number
}

type ViewMode = 'grid' | 'detail'
type FilterType = 'all' | 'Car' | 'Truck' | 'Utility'

// placeholder — filled in chunk 2
export function VehiclesPage(): React.JSX.Element {
  // ── State ──
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [previews, setPreviews] = useState<Record<string, string>>({})

  // Detail / config state
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null)
  const [vehicleDetail, setVehicleDetail] = useState<VehicleDetail | null>(null)
  const [configs, setConfigs] = useState<VehicleConfigInfo[]>([])
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null)
  const [configPreview, setConfigPreview] = useState<string | null>(null)
  const [configData, setConfigData] = useState<VehicleConfigData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Config management
  const [savingConfig, setSavingConfig] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [saveAsName, setSaveAsName] = useState('')
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Config editor
  const [editing, setEditing] = useState(false)
  const [editParts, setEditParts] = useState<Record<string, string>>({})
  const [editVars, setEditVars] = useState<Record<string, number>>({})
  const [editName, setEditName] = useState('')
  const [newPartKey, setNewPartKey] = useState('')
  const [newPartVal, setNewPartVal] = useState('')
  const [partsFilter, setPartsFilter] = useState('')
  const [show3D, setShow3D] = useState(false)
  const [editorData, setEditorData] = useState<VehicleEditorData | null>(null)

  // ── Load vehicles ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await window.api.listVehicles()
        if (!cancelled) setVehicles(list)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // ── Load previews lazily ──
  useEffect(() => {
    if (vehicles.length === 0) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const batch = vehicles.filter((v) => !previews[v.name]).slice(0, 12)
      for (const v of batch) {
        if (cancelled) return
        const img = await window.api.getVehiclePreview(v.name)
        if (!cancelled && img) {
          setPreviews((p) => ({ ...p, [v.name]: img }))
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [vehicles, previews])

  // ── Filtered + searched list ──
  const brands = useMemo(() => {
    const set = new Set(vehicles.map((v) => v.brand).filter(Boolean))
    return Array.from(set).sort()
  }, [vehicles])

  const filtered = useMemo(() => {
    let list = vehicles
    if (filterType !== 'all') list = list.filter((v) => v.type === filterType)
    if (filterBrand !== 'all') list = list.filter((v) => v.brand === filterBrand)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (v) =>
          v.displayName.toLowerCase().includes(q) ||
          v.brand.toLowerCase().includes(q) ||
          v.name.toLowerCase().includes(q)
      )
    }
    return list
  }, [vehicles, filterType, filterBrand, searchQuery])

  // ── Select vehicle → load detail ──
  const openVehicle = useCallback(async (name: string) => {
    setSelectedVehicle(name)
    setViewMode('detail')
    setDetailLoading(true)
    setSelectedConfig(null)
    setConfigPreview(null)
    setConfigData(null)
    setActionError(null)
    setEditing(false)

    // Ensure vehicle preview is loaded for fallback
    if (!previews[name]) {
      window.api.getVehiclePreview(name).then((img) => {
        if (img) setPreviews((p) => ({ ...p, [name]: img }))
      })
    }

    const [detail, cfgs] = await Promise.all([
      window.api.getVehicleDetail(name),
      window.api.getVehicleConfigs(name)
    ])
    setVehicleDetail(detail)
    setConfigs(cfgs)

    // Auto-select default config
    if (detail?.defaultConfig) {
      setSelectedConfig(detail.defaultConfig)
    } else if (cfgs.length > 0) {
      setSelectedConfig(cfgs[0].name)
    }
    setDetailLoading(false)
  }, [])

  // ── Load config preview when selected config changes ──
  useEffect(() => {
    if (!selectedVehicle || !selectedConfig) return
    let cancelled = false
    ;(async () => {
      const [preview, data] = await Promise.all([
        window.api.getVehicleConfigPreview(selectedVehicle, selectedConfig),
        window.api.getVehicleConfigData(selectedVehicle, selectedConfig)
      ])
      if (cancelled) return
      setConfigPreview(preview)

      // If config has no paints, resolve default paints from vehicle/config info + paint library
      if (data && (!data.paints || data.paints.length === 0)) {
        try {
          const defaults = await window.api.getVehicleDefaultPaints(selectedVehicle, selectedConfig)
          if (!cancelled && defaults && defaults.length > 0) {
            data.paints = defaults
          }
        } catch { /* use config as-is */ }
      }

      if (!cancelled) setConfigData(data)
    })()
    return () => { cancelled = true }
  }, [selectedVehicle, selectedConfig])

  const goBack = useCallback(() => {
    setViewMode('grid')
    setSelectedVehicle(null)
    setVehicleDetail(null)
    setConfigs([])
    setSelectedConfig(null)
    setConfigPreview(null)
    setConfigData(null)
    setActionError(null)
    setShow3D(false)
  }, [])

  // ── Config actions ──
  const handleDeleteConfig = useCallback(async (cfgName: string) => {
    if (!selectedVehicle) return
    setActionError(null)
    const res = await window.api.deleteVehicleConfig(selectedVehicle, cfgName)
    if (res.success) {
      const cfgs = await window.api.getVehicleConfigs(selectedVehicle)
      setConfigs(cfgs)
      if (selectedConfig === cfgName) {
        setSelectedConfig(cfgs[0]?.name || null)
      }
    } else {
      setActionError(res.error || 'Failed to delete')
    }
  }, [selectedVehicle, selectedConfig])

  const handleRename = useCallback(async (oldName: string) => {
    if (!selectedVehicle || !renameValue.trim()) return
    setActionError(null)
    const res = await window.api.renameVehicleConfig(selectedVehicle, oldName, renameValue.trim())
    if (res.success) {
      setRenaming(null)
      const cfgs = await window.api.getVehicleConfigs(selectedVehicle)
      setConfigs(cfgs)
      if (selectedConfig === oldName) setSelectedConfig(renameValue.trim())
    } else {
      setActionError(res.error || 'Failed to rename')
    }
  }, [selectedVehicle, renameValue, selectedConfig])

  const handleSaveAs = useCallback(async () => {
    if (!selectedVehicle || !configData || !saveAsName.trim()) return
    setSavingConfig(true)
    setActionError(null)
    const res = await window.api.saveVehicleConfig(selectedVehicle, saveAsName.trim(), configData)
    if (res.success) {
      setShowSaveAs(false)
      setSaveAsName('')
      const cfgs = await window.api.getVehicleConfigs(selectedVehicle)
      setConfigs(cfgs)
      setSelectedConfig(saveAsName.trim())
    } else {
      setActionError(res.error || 'Failed to save')
    }
    setSavingConfig(false)
  }, [selectedVehicle, configData, saveAsName])

  const handleDuplicate = useCallback(async (cfgName: string) => {
    if (!selectedVehicle || !configData) return
    const newName = `${cfgName} Copy`
    setSavingConfig(true)
    setActionError(null)
    const res = await window.api.saveVehicleConfig(selectedVehicle, newName, configData)
    if (res.success) {
      const cfgs = await window.api.getVehicleConfigs(selectedVehicle)
      setConfigs(cfgs)
      setSelectedConfig(newName)
    } else {
      setActionError(res.error || 'Failed to duplicate')
    }
    setSavingConfig(false)
  }, [selectedVehicle, configData])

  // ── Config editor ──
  const startEditing = useCallback((baseCfg: VehicleConfigData | null, name: string) => {
    setEditing(true)
    setEditParts(baseCfg?.parts ? { ...baseCfg.parts } : {})
    setEditVars(baseCfg?.vars ? { ...baseCfg.vars } : {})
    setEditName(name)
    setPartsFilter('')
    setNewPartKey('')
    setNewPartVal('')
    if (selectedVehicle) {
      window.api.getVehicleEditorData(selectedVehicle).then((d) => setEditorData(d as VehicleEditorData)).catch(() => {})
    }
  }, [selectedVehicle])

  const handleCreateNew = useCallback(() => {
    if (!configData) {
      // Create from scratch with empty parts
      startEditing({ format: 2, model: selectedVehicle || '', parts: {}, vars: {} }, 'New Config')
    } else {
      startEditing(configData, `${selectedConfig || 'Config'} Custom`)
    }
  }, [configData, selectedVehicle, selectedConfig, startEditing])

  const handleSaveEdited = useCallback(async () => {
    if (!selectedVehicle || !editName.trim()) return
    setSavingConfig(true)
    setActionError(null)
    const data: VehicleConfigData = {
      format: configData?.format || 2,
      model: configData?.model || selectedVehicle,
      parts: editParts,
      vars: editVars,
      paints: configData?.paints
    }
    const res = await window.api.saveVehicleConfig(selectedVehicle, editName.trim(), data)
    if (res.success) {
      setEditing(false)
      const cfgs = await window.api.getVehicleConfigs(selectedVehicle)
      setConfigs(cfgs)
      setSelectedConfig(editName.trim())
    } else {
      setActionError(res.error || 'Failed to save')
    }
    setSavingConfig(false)
  }, [selectedVehicle, editName, editParts, editVars, configData])

  // ── RENDER ──
  return <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">{viewMode === 'grid' ? renderGrid() : (editing ? renderEditor() : renderDetail())}</div>

  // ── GRID VIEW (will be defined in chunk 2) ──
  function renderGrid(): React.JSX.Element {
    return (
      <>
        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <Car size={18} className="text-[var(--color-accent)]" />
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Vehicles</h1>
          <span className="text-xs text-[var(--color-text-muted)]">
            {filtered.length} of {vehicles.length}
          </span>
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              placeholder="Search vehicles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-4 py-2.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none w-56"
              style={{ paddingLeft: 42 }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)] mr-1">Type:</span>
          {(['all', 'Car', 'Truck', 'Utility'] as FilterType[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-4 py-2 text-xs transition-colors ${
                filterType === t
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
          <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
          <span className="text-xs text-[var(--color-text-muted)] mr-1">Brand:</span>
          <select
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            className="px-4 py-2 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] focus:outline-none"
          >
            <option value="all">All Brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">Scanning vehicles...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <Car size={36} strokeWidth={1} />
              <p className="text-sm mt-2">No vehicles found</p>
            </div>
          ) : (
            (() => {
              const stockVehicles = filtered.filter((v) => v.source !== 'mod')
              const modVehicles = filtered.filter((v) => v.source === 'mod')

              const renderCard = (v: VehicleListItem): React.JSX.Element => (
                <button
                  key={v.name}
                  onClick={() => openVehicle(v.name)}
                  className="group flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors cursor-pointer text-left"
                >
                  <div className="relative w-full aspect-[4/3] bg-black/30 overflow-hidden">
                    {previews[v.name] ? (
                      <img src={previews[v.name]} alt={v.displayName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car size={28} className="text-[var(--color-text-dim)]" />
                      </div>
                    )}
                    {v.configCount > 0 && (
                      <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-[var(--color-text-secondary)]">
                        {v.configCount}
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent)]">
                      {v.displayName}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                      {v.brand}{v.bodyStyle ? ` · ${v.bodyStyle}` : ''}
                    </p>
                  </div>
                </button>
              )

              return (
                <>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                    {stockVehicles.map(renderCard)}
                  </div>
                  {modVehicles.length > 0 && (
                    <>
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-[var(--color-border)]" />
                        <span className="text-xs font-medium text-[var(--color-accent)]">Mod Vehicles</span>
                        <div className="flex-1 h-px bg-[var(--color-border)]" />
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                        {modVehicles.map(renderCard)}
                      </div>
                    </>
                  )}
                </>
              )
            })()
          )}
        </div>
      </>
    )
  }

  // ── DETAIL VIEW (will be defined in chunk 3) ──
  function renderDetail(): React.JSX.Element {
    if (detailLoading || !vehicleDetail) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
        </div>
      )
    }

    const selCfg = configs.find((c) => c.name === selectedConfig)

    return (
      <>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <button onClick={goBack} className="p-1 hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {vehicleDetail.brand && <span className="text-[var(--color-text-muted)] mr-1">{vehicleDetail.brand}</span>}
              {vehicleDetail.name}
            </h1>
            <p className="text-[10px] text-[var(--color-text-muted)]">
              {vehicleDetail.type}{vehicleDetail.bodyStyle ? ` · ${vehicleDetail.bodyStyle}` : ''}
              {vehicleDetail.years ? ` · ${vehicleDetail.years.min}–${vehicleDetail.years.max}` : ''}
              {vehicleDetail.country ? ` · ${vehicleDetail.country}` : ''}
            </p>
          </div>
          <span className="text-xs text-[var(--color-text-muted)]">{configs.length} config{configs.length !== 1 ? 's' : ''}</span>
        </div>

        {actionError && (
          <div className="mx-4 mt-2 px-4 py-1.5 text-xs bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-[var(--color-error)] flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)}><X size={12} /></button>
          </div>
        )}

        {/* Content: 2-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: config list */}
          <div className="w-64 border-r border-[var(--color-border)] flex flex-col">
            <div className="p-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Configurations</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCreateNew}
                  className="px-1.5 py-0.5 text-[10px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
                  title="Create new configuration"
                >
                  + New
                </button>
                <button
                  onClick={() => { setShowSaveAs(true); setSaveAsName('') }}
                  className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                  title="Save current as new config"
                >
                  <Save size={13} />
                </button>
              </div>
            </div>

            {showSaveAs && (
              <div className="p-3 border-b border-[var(--color-border)] flex gap-1">
                <input
                  type="text"
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  placeholder="Config name..."
                  className="flex-1 px-2 py-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveAs()}
                  autoFocus
                />
                <button
                  onClick={handleSaveAs}
                  disabled={savingConfig || !saveAsName.trim()}
                  className="px-2 py-1 text-xs bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
                >
                  {savingConfig ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                <button onClick={() => setShowSaveAs(false)} className="px-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {configs.map((cfg) => (
                <div
                  key={cfg.name}
                  className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-l-2 transition-colors ${
                    selectedConfig === cfg.name
                      ? 'border-l-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                      : 'border-l-transparent hover:bg-[var(--color-surface-hover)]'
                  }`}
                  onClick={() => setSelectedConfig(cfg.name)}
                >
                  {renaming === cfg.name ? (
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(cfg.name); if (e.key === 'Escape') setRenaming(null) }}
                      onBlur={() => setRenaming(null)}
                      className="flex-1 px-1 py-0.5 text-xs bg-[var(--color-surface)] border border-[var(--color-accent)] text-[var(--color-text-primary)] focus:outline-none"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--color-text-primary)] truncate">{cfg.displayName}</p>
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        {cfg.source === 'user' ? 'Custom' : cfg.configType || 'Factory'}
                        {cfg.power ? ` · ${cfg.power} hp` : ''}
                      </p>
                    </div>
                  )}
                  {cfg.source === 'user' && renaming !== cfg.name && (
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button onClick={(e) => { e.stopPropagation(); setRenaming(cfg.name); setRenameValue(cfg.name) }} className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><Edit3 size={11} /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteConfig(cfg.name) }} className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)]"><Trash2 size={11} /></button>
                    </div>
                  )}
                  {cfg.source === 'stock' && renaming !== cfg.name && (
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(cfg.name) }} className="hidden group-hover:block p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]" title="Duplicate as custom config"><Copy size={11} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: config detail */}
          <div className="flex-1 flex flex-col overflow-y-auto">
            {selCfg ? renderConfigDetail(selCfg) : (
              <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
                <p className="text-xs">Select a configuration</p>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  function renderConfigDetail(cfg: VehicleConfigInfo): React.JSX.Element {
    return (
      <div className="p-4 space-y-4">
        {/* Preview / 3D toggle */}
        <div className="relative w-full aspect-[16/9] bg-black/30 overflow-hidden border border-[var(--color-border)]">
          {show3D && selectedVehicle ? (
            <VehicleViewer vehicleName={selectedVehicle} parts={configData?.parts} paints={configData?.paints as PaintData[] | undefined} className="w-full h-full" />
          ) : configPreview ? (
            <img src={configPreview} alt={cfg.displayName} className="w-full h-full object-cover" />
          ) : previews[selectedVehicle || ''] ? (
            <img src={previews[selectedVehicle || '']} alt={cfg.displayName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Car size={48} className="text-[var(--color-text-dim)]" />
            </div>
          )}
          {/* 3D toggle button */}
          <button
            onClick={() => setShow3D((v) => !v)}
            className={`absolute top-2 right-2 p-1.5 border text-xs z-20 ${
              show3D
                ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-black'
                : 'bg-black/60 border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]'
            }`}
            title={show3D ? 'Show preview image' : 'Show 3D model'}
          >
            <Box size={14} />
          </button>
        </div>

        {/* Config name + description */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{cfg.displayName}</h2>
            {cfg.description && <p className="text-xs text-[var(--color-text-muted)] mt-1">{cfg.description}</p>}
          </div>
          <button
            onClick={() => startEditing(configData, cfg.source === 'user' ? cfg.name : `${cfg.displayName} Custom`)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            <Edit3 size={12} />
            {cfg.source === 'user' ? 'Edit' : 'Edit as Copy'}
          </button>
        </div>

        {/* Stats grid */}
        {(cfg.power || cfg.torque || cfg.weight || cfg.drivetrain) && (
          <div className="grid grid-cols-2 gap-2">
            {cfg.power != null && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Zap size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Power</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.power} hp</p>
                </div>
              </div>
            )}
            {cfg.torque != null && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Settings2 size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Torque</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.torque} Nm</p>
                </div>
              </div>
            )}
            {cfg.weight != null && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Weight size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Weight</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.weight} kg</p>
                </div>
              </div>
            )}
            {cfg.drivetrain && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Gauge size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Drivetrain</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.drivetrain}</p>
                </div>
              </div>
            )}
            {cfg.transmission && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Settings2 size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Transmission</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.transmission}</p>
                </div>
              </div>
            )}
            {cfg.fuelType && (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <Fuel size={14} className="text-[var(--color-accent)]" />
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Fuel</p>
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{cfg.fuelType}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Performance stats */}
        {(cfg.topSpeed || cfg.zeroToSixty || cfg.value) && (
          <div className="flex flex-wrap gap-4 text-xs">
            {cfg.topSpeed != null && (
              <div>
                <span className="text-[var(--color-text-muted)]">Top Speed: </span>
                <span className="text-[var(--color-text-primary)] font-medium">{Math.round(cfg.topSpeed * 3.6)} km/h</span>
              </div>
            )}
            {cfg.zeroToSixty != null && (
              <div>
                <span className="text-[var(--color-text-muted)]">0-60 mph: </span>
                <span className="text-[var(--color-text-primary)] font-medium">{cfg.zeroToSixty}s</span>
              </div>
            )}
            {cfg.value != null && (
              <div>
                <span className="text-[var(--color-text-muted)]">Value: </span>
                <span className="text-[var(--color-text-primary)] font-medium">${cfg.value.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Parts list (from config data) */}
        {configData?.parts && Object.keys(configData.parts).length > 0 && (
          <details className="group">
            <summary className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)]">
              <Info size={12} />
              <span>Parts ({Object.keys(configData.parts).length})</span>
            </summary>
            <div className="mt-2 max-h-60 overflow-y-auto bg-[var(--color-surface)] border border-[var(--color-border)] p-2 space-y-0.5">
              {Object.entries(configData.parts)
                .filter(([, v]) => v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, val]) => (
                  <div key={key} className="flex justify-between text-[10px]">
                    <span className="text-[var(--color-text-muted)] truncate mr-2">{key}</span>
                    <span className="text-[var(--color-text-secondary)] truncate text-right">{val}</span>
                  </div>
                ))}
            </div>
          </details>
        )}
      </div>
    )
  }

  function renderEditor(): React.JSX.Element {
    const filteredParts = Object.entries(editParts)
      .filter(([k]) => !partsFilter || k.toLowerCase().includes(partsFilter.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))

    return (
      <>
        {/* Editor header */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <button onClick={() => setEditing(false)} className="p-1 hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
            <ChevronLeft size={18} />
          </button>
          <Settings2 size={16} className="text-[var(--color-accent)]" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[var(--color-text-muted)]">Editing Configuration</p>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full text-sm font-semibold bg-transparent text-[var(--color-text-primary)] border-b border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none py-0.5"
            />
          </div>
          <button
            onClick={handleSaveEdited}
            disabled={savingConfig || !editName.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {savingConfig ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>

        {actionError && (
          <div className="mx-4 mt-2 px-4 py-1.5 text-xs bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-[var(--color-error)] flex items-center justify-between">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)}><X size={12} /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Live 3D preview */}
          {selectedVehicle && (
            <div className="mx-4 mt-2 aspect-[16/9] border border-[var(--color-border)] overflow-hidden">
              <VehicleViewer vehicleName={selectedVehicle} parts={editParts} paints={configData?.paints as PaintData[] | undefined} className="w-full h-full" />
            </div>
          )}

          {/* Parts section */}
          <div className="border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Parts ({Object.keys(editParts).length})</span>
              <div className="relative">
                <Search size={12} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 10 }} />
                <input
                  type="text"
                  value={partsFilter}
                  onChange={(e) => setPartsFilter(e.target.value)}
                  placeholder="Filter parts..."
                  className="pr-3 py-1.5 text-[10px] w-40 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                  style={{ paddingLeft: 30 }}
                />
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto px-4 pb-2 space-y-1">
              {filteredParts.map(([key, val]) => {
                const slotInfo = editorData?.slots?.[key]
                return (
                  <div key={key} className="flex items-center gap-1.5 group">
                    <span className="text-[10px] text-[var(--color-text-muted)] w-48 truncate shrink-0" title={slotInfo?.description || key}>
                      {slotInfo?.description || key}
                    </span>
                    {slotInfo && slotInfo.options.length > 0 ? (
                      <select
                        value={val}
                        onChange={(e) => setEditParts((p) => ({ ...p, [key]: e.target.value }))}
                        className="flex-1 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none appearance-none cursor-pointer"
                      >
                        <option value="">— None —</option>
                        {slotInfo.options.map((opt) => (
                          <option key={opt.partName} value={opt.partName}>{opt.partName}</option>
                        ))}
                        {val && !slotInfo.options.some(o => o.partName === val) && (
                          <option value={val}>{val} (current)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => setEditParts((p) => ({ ...p, [key]: e.target.value }))}
                        className="flex-1 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                      />
                    )}
                    <button
                      onClick={() => setEditParts((p) => { const n = { ...p }; delete n[key]; return n })}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                    >
                      <X size={10} />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Add new part */}
            <div className="flex items-center gap-1.5 px-4 pb-2">
              {editorData && Object.keys(editorData.slots).length > 0 ? (
                <>
                  <select
                    value={newPartKey}
                    onChange={(e) => {
                      setNewPartKey(e.target.value)
                      setNewPartVal('')
                    }}
                    className="w-48 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none appearance-none cursor-pointer"
                  >
                    <option value="">Select slot…</option>
                    {Object.keys(editorData.slots)
                      .filter(s => !editParts[s])
                      .sort()
                      .map(s => (
                        <option key={s} value={s}>{editorData.slots[s].description || s}</option>
                      ))}
                  </select>
                  <select
                    value={newPartVal}
                    onChange={(e) => setNewPartVal(e.target.value)}
                    disabled={!newPartKey}
                    className="flex-1 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none appearance-none cursor-pointer disabled:opacity-50"
                  >
                    <option value="">Select part…</option>
                    {newPartKey && editorData.slots[newPartKey]?.options.map(o => (
                      <option key={o.partName} value={o.partName}>{o.partName}</option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={newPartKey}
                    onChange={(e) => setNewPartKey(e.target.value)}
                    placeholder="Part slot..."
                    className="w-48 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={newPartVal}
                    onChange={(e) => setNewPartVal(e.target.value)}
                    placeholder="Part value..."
                    className="flex-1 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </>
              )}
              <button
                onClick={() => {
                  if (newPartKey.trim()) {
                    setEditParts((p) => ({ ...p, [newPartKey.trim()]: newPartVal }))
                    setNewPartKey('')
                    setNewPartVal('')
                  }
                }}
                disabled={!newPartKey.trim()}
                className="px-2 py-0.5 text-[10px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Vars section */}
          <div className="px-4 py-2">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">Tuning Variables ({Object.keys(editVars).length})</span>
            <div className="mt-2 space-y-3">
              {(() => {
                const entries = Object.entries(editVars).sort(([a], [b]) => a.localeCompare(b))
                if (entries.length === 0) {
                  return <p className="text-[10px] text-[var(--color-text-dim)]">No tuning variables defined</p>
                }
                // Group by category
                const grouped: Record<string, [string, number][]> = {}
                for (const entry of entries) {
                  const meta = editorData?.variables?.[entry[0]]
                  const cat = meta?.category || 'Other'
                  if (!grouped[cat]) grouped[cat] = []
                  grouped[cat].push(entry)
                }
                return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, vars]) => (
                  <div key={category}>
                    <p className="text-[10px] font-medium text-[var(--color-accent)] mb-1">{category}</p>
                    <div className="space-y-1.5">
                      {vars.map(([key, val]) => {
                        const meta = editorData?.variables?.[key]
                        if (meta) {
                          const step = (meta.max - meta.min) / 200
                          return (
                            <div key={key} className="group">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] text-[var(--color-text-muted)] truncate" title={key}>{meta.title}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  <input
                                    type="number"
                                    value={val}
                                    onChange={(e) => {
                                      const n = parseFloat(e.target.value)
                                      if (!isNaN(n)) setEditVars((v) => ({ ...v, [key]: Math.min(meta.max, Math.max(meta.min, n)) }))
                                    }}
                                    min={meta.min}
                                    max={meta.max}
                                    step={step}
                                    className="w-20 px-1 py-0 text-[10px] text-right bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                                  />
                                  <span className="text-[9px] text-[var(--color-text-dim)] w-10 truncate" title={meta.unit}>{meta.unit}</span>
                                  <button
                                    onClick={() => setEditVars((v) => ({ ...v, [key]: meta.default }))}
                                    className="opacity-0 group-hover:opacity-100 text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                                    title="Reset to default"
                                  >↺</button>
                                </div>
                              </div>
                              <input
                                type="range"
                                min={meta.min}
                                max={meta.max}
                                step={step}
                                value={val}
                                onChange={(e) => setEditVars((v) => ({ ...v, [key]: parseFloat(e.target.value) }))}
                                className="w-full h-1 accent-[var(--color-accent)] cursor-pointer"
                              />
                            </div>
                          )
                        }
                        // Fallback: no metadata
                        return (
                          <div key={key} className="flex items-center gap-1.5 group">
                            <span className="text-[10px] text-[var(--color-text-muted)] w-48 truncate shrink-0" title={key}>{key}</span>
                            <input
                              type="number"
                              value={val}
                              onChange={(e) => setEditVars((v) => ({ ...v, [key]: parseFloat(e.target.value) || 0 }))}
                              className="w-24 px-1.5 py-0.5 text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                              step="any"
                            />
                            <button
                              onClick={() => setEditVars((v) => { const n = { ...v }; delete n[key]; return n })}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      </>
    )
  }
}
