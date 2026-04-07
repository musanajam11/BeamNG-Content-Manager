import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Map, Loader2, X, ChevronLeft, MapPin, User, Tag, Calendar, HardDrive, ExternalLink, Info, Ruler, Flag } from 'lucide-react'
import type { MapRichMetadata } from '../../../shared/types'

type MapListItem = { name: string; source: 'stock' | 'mod'; modZipPath?: string }
type ViewMode = 'grid' | 'detail'

function formatMapName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function MapsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [maps, setMaps] = useState<MapListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState<'all' | 'stock' | 'mod'>('all')
  const [previews, setPreviews] = useState<Record<string, string>>({})

  // Detail view
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selectedMap, setSelectedMap] = useState<MapListItem | null>(null)
  const [minimapData, setMinimapData] = useState<{ dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>(null)
  const [terrainBase, setTerrainBase] = useState<string | null>(null)
  const [detailPreview, setDetailPreview] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mapMetadata, setMapMetadata] = useState<MapRichMetadata | null>(null)

  // Load maps
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await window.api.listMaps()
        if (!cancelled) setMaps(list)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Load previews lazily in batches
  useEffect(() => {
    if (maps.length === 0) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const batch = maps.filter((m) => !previews[m.name]).slice(0, 12)
      for (const m of batch) {
        if (cancelled) return
        const img = await window.api.getMapPreview(`/levels/${m.name}/`, m.modZipPath)
        if (!cancelled && img) {
          setPreviews((p) => ({ ...p, [m.name]: img }))
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [maps, previews])

  // Filter + search
  const filtered = useMemo(() => {
    let list = maps
    if (filterSource !== 'all') list = list.filter((m) => m.source === filterSource)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((m) => formatMapName(m.name).toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    }
    return list
  }, [maps, filterSource, searchQuery])

  // Open detail
  const openMap = useCallback(async (map: MapListItem) => {
    setSelectedMap(map)
    setViewMode('detail')
    setDetailLoading(true)
    setMinimapData(null)
    setTerrainBase(null)
    setDetailPreview(null)
    setMapMetadata(null)

    const mapPath = `/levels/${map.name}/`

    // Load preview, minimap, terrain base, and metadata in parallel
    const [preview, minimap, tBase, metadata] = await Promise.all([
      window.api.getMapPreview(mapPath, map.modZipPath),
      window.api.getMapMinimap(mapPath),
      window.api.getMapTerrainBase(mapPath, map.modZipPath),
      window.api.getMapMetadata(map.name, map.modZipPath)
    ])
    setDetailPreview(preview)
    setMinimapData(minimap)
    setTerrainBase(tBase)
    setMapMetadata(metadata)
    setDetailLoading(false)
  }, [])

  const goBack = useCallback(() => {
    setViewMode('grid')
    setSelectedMap(null)
    setMinimapData(null)
    setTerrainBase(null)
    setDetailPreview(null)
    setMapMetadata(null)
  }, [])

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      {viewMode === 'grid' ? renderGrid() : renderDetail()}
    </div>
  )

  function renderGrid(): React.JSX.Element {
    return (
      <>
        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <Map size={18} className="text-[var(--color-accent)]" />
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('maps.title')}</h1>
          <span className="text-xs text-[var(--color-text-muted)]">
            {t('maps.filteredOf', { filtered: filtered.length, total: maps.length })}
          </span>
          <div className="flex-1" />
          <div className="relative">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" style={{ left: 14 }} />
            <input
              type="text"
              placeholder={t('maps.searchMaps')}
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
          <span className="text-xs text-[var(--color-text-muted)] mr-1">{t('maps.sourceLabel')}</span>
          {(['all', 'stock', 'mod'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterSource(s)}
              className={`px-4 py-2 text-xs transition-colors ${
                filterSource === s
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {s === 'all' ? t('common.all') : s === 'stock' ? t('maps.stockMaps') : t('maps.modMaps')}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">{t('maps.scanningMaps')}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
              <Map size={36} strokeWidth={1} />
              <p className="text-sm mt-2">{t('maps.noMapsFound')}</p>
            </div>
          ) : (
            (() => {
              const stockMaps = filtered.filter((m) => m.source === 'stock')
              const modMaps = filtered.filter((m) => m.source === 'mod')

              const renderCard = (m: MapListItem): React.JSX.Element => (
                <button
                  key={m.name}
                  onClick={() => openMap(m)}
                  className="group flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors cursor-pointer text-left"
                >
                  <div className="relative w-full aspect-[16/9] bg-black/30 overflow-hidden">
                    {previews[m.name] ? (
                      <img src={previews[m.name]} alt={formatMapName(m.name)} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Map size={28} className="text-[var(--color-text-dim)]" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent)]">
                      {formatMapName(m.name)}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] truncate">
                      {m.source === 'stock' ? t('maps.stockMaps') : t('maps.modMaps')}
                    </p>
                  </div>
                </button>
              )

              return (
                <>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                    {stockMaps.map(renderCard)}
                  </div>
                  {modMaps.length > 0 && (
                    <>
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-[var(--color-border)]" />
                        <span className="text-xs font-medium text-[var(--color-accent)]">{t('maps.modMapsDivider')}</span>
                        <div className="flex-1 h-px bg-[var(--color-border)]" />
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                        {modMaps.map(renderCard)}
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

  function renderDetail(): React.JSX.Element {
    if (detailLoading || !selectedMap) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
        </div>
      )
    }

    return (
      <>
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--color-border)]">
          <button
            onClick={goBack}
            className="p-1 hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <Map size={18} className="text-[var(--color-accent)]" />
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {mapMetadata?.title || formatMapName(selectedMap.name)}
          </h1>
          <span className={`px-2 py-0.5 text-[10px] ${
            selectedMap.source === 'stock'
              ? 'bg-blue-500/15 text-blue-400'
              : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          }`}>
            {selectedMap.source === 'stock' ? t('maps.stockMaps') : t('maps.modMaps')}
          </span>
          {mapMetadata?.registryId && (
            <span className="px-2 py-0.5 text-[10px] bg-green-500/15 text-green-400">Registry</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Left column: Preview + info */}
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('maps.preview')}</h2>
              <div className="aspect-[16/9] bg-black/30 border border-[var(--color-border)] overflow-hidden">
                {detailPreview ? (
                  <img src={detailPreview} alt={mapMetadata?.title || formatMapName(selectedMap.name)} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)]">
                    <Map size={48} strokeWidth={1} />
                  </div>
                )}
              </div>

              {/* Description */}
              {(mapMetadata?.description || mapMetadata?.registryAbstract || mapMetadata?.registryDescription) && (
                <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)]">
                  {mapMetadata.registryAbstract && (
                    <p className="text-xs text-[var(--color-text-primary)] font-medium mb-1">{mapMetadata.registryAbstract}</p>
                  )}
                  {(mapMetadata.description || mapMetadata.registryDescription) && (
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-line">
                      {mapMetadata.registryDescription || mapMetadata.description}
                    </p>
                  )}
                </div>
              )}

              {/* Map info */}
              <div className="flex flex-col gap-2 p-4 bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="flex items-center gap-2 text-xs">
                  <MapPin size={12} className="text-[var(--color-accent)]" />
                  <span className="text-[var(--color-text-muted)]">{t('maps.internalName')}</span>
                  <span className="text-[var(--color-text-secondary)] font-mono">{selectedMap.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Map size={12} className="text-[var(--color-accent)]" />
                  <span className="text-[var(--color-text-muted)]">{t('maps.sourceLabel')}</span>
                  <span className="text-[var(--color-text-secondary)]">{selectedMap.source === 'stock' ? t('maps.stockSource') : t('maps.modSource')}</span>
                </div>
                {(mapMetadata?.authors && mapMetadata.authors.length > 0) && (
                  <div className="flex items-center gap-2 text-xs">
                    <User size={12} className="text-[var(--color-accent)]" />
                    <span className="text-[var(--color-text-muted)]">{t('maps.authors')}</span>
                    <span className="text-[var(--color-text-secondary)]">{mapMetadata.authors.join(', ')}</span>
                  </div>
                )}
                {mapMetadata?.terrainSize && (
                  <div className="flex items-center gap-2 text-xs">
                    <Ruler size={12} className="text-[var(--color-accent)]" />
                    <span className="text-[var(--color-text-muted)]">{t('maps.terrainSize')}</span>
                    <span className="text-[var(--color-text-secondary)]">{mapMetadata.terrainSize}m &times; {mapMetadata.terrainSize}m</span>
                  </div>
                )}
                {mapMetadata?.spawnPointCount != null && mapMetadata.spawnPointCount > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <Flag size={12} className="text-[var(--color-accent)]" />
                    <span className="text-[var(--color-text-muted)]">{t('maps.spawnPoints')}</span>
                    <span className="text-[var(--color-text-secondary)]">{mapMetadata.spawnPointCount}</span>
                  </div>
                )}
                {mapMetadata?.fileSize != null && (
                  <div className="flex items-center gap-2 text-xs">
                    <HardDrive size={12} className="text-[var(--color-accent)]" />
                    <span className="text-[var(--color-text-muted)]">{t('maps.fileSize')}</span>
                    <span className="text-[var(--color-text-secondary)]">{formatFileSize(mapMetadata.fileSize)}</span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {mapMetadata?.registryTags && mapMetadata.registryTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 p-4 bg-[var(--color-surface)] border border-[var(--color-border)]">
                  <Tag size={12} className="text-[var(--color-accent)] mr-1" />
                  {mapMetadata.registryTags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-[10px] bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded-sm">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Right column: Minimap + registry metadata */}
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{t('maps.minimap')}</h2>
              <div className="aspect-square bg-black/30 border border-[var(--color-border)] overflow-hidden">
                {terrainBase ? (
                  <img src={terrainBase} alt="Terrain Base" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-text-muted)]">
                    <Map size={48} strokeWidth={1} />
                    <span className="ml-2 text-xs">{t('maps.noMinimap')}</span>
                  </div>
                )}
              </div>
              {minimapData?.worldBounds && (
                <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  <span className="font-medium text-[var(--color-text-secondary)]">World Bounds: </span>
                  {Math.round(minimapData.worldBounds.maxX - minimapData.worldBounds.minX)}m &times; {Math.round(minimapData.worldBounds.maxY - minimapData.worldBounds.minY)}m
                </div>
              )}

              {/* Mod Registry Metadata */}
              {mapMetadata?.registryId && (
                <div className="flex flex-col gap-3">
                  <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mt-2">{t('maps.modRegistry')}</h2>
                  <div className="flex flex-col gap-2 p-4 bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <div className="flex items-center gap-2 text-xs">
                      <Info size={12} className="text-[var(--color-accent)]" />
                      <span className="text-[var(--color-text-muted)]">{t('maps.identifier')}</span>
                      <span className="text-[var(--color-text-secondary)] font-mono">{mapMetadata.registryId}</span>
                    </div>
                    {mapMetadata.registryVersion && (
                      <div className="flex items-center gap-2 text-xs">
                        <Tag size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('common.version')}:</span>
                        <span className="text-[var(--color-text-secondary)]">{mapMetadata.registryVersion}</span>
                      </div>
                    )}
                    {mapMetadata.registryAuthor && (
                      <div className="flex items-center gap-2 text-xs">
                        <User size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('common.author')}:</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {Array.isArray(mapMetadata.registryAuthor) ? mapMetadata.registryAuthor.join(', ') : mapMetadata.registryAuthor}
                        </span>
                      </div>
                    )}
                    {mapMetadata.registryLicense && (
                      <div className="flex items-center gap-2 text-xs">
                        <Info size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('common.license')}:</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {Array.isArray(mapMetadata.registryLicense) ? mapMetadata.registryLicense.join(', ') : mapMetadata.registryLicense}
                        </span>
                      </div>
                    )}
                    {mapMetadata.registryReleaseStatus && (
                      <div className="flex items-center gap-2 text-xs">
                        <Info size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('common.status')}:</span>
                        <span className={`px-2 py-0.5 text-[10px] ${
                          mapMetadata.registryReleaseStatus === 'stable' ? 'bg-green-500/15 text-green-400' :
                          mapMetadata.registryReleaseStatus === 'testing' ? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-red-500/15 text-red-400'
                        }`}>
                          {mapMetadata.registryReleaseStatus}
                        </span>
                      </div>
                    )}
                    {mapMetadata.registryReleaseDate && (
                      <div className="flex items-center gap-2 text-xs">
                        <Calendar size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('maps.released')}</span>
                        <span className="text-[var(--color-text-secondary)]">{mapMetadata.registryReleaseDate}</span>
                      </div>
                    )}
                    {(mapMetadata.registryBeamngVersionMin || mapMetadata.registryBeamngVersionMax) && (
                      <div className="flex items-center gap-2 text-xs">
                        <Info size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('maps.beamngVersion')}</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {mapMetadata.registryBeamngVersionMin && `≥ ${mapMetadata.registryBeamngVersionMin}`}
                          {mapMetadata.registryBeamngVersionMin && mapMetadata.registryBeamngVersionMax && ' — '}
                          {mapMetadata.registryBeamngVersionMax && `≤ ${mapMetadata.registryBeamngVersionMax}`}
                        </span>
                      </div>
                    )}
                    {(mapMetadata.registryDownloadSize != null || mapMetadata.registryInstallSize != null) && (
                      <div className="flex items-center gap-2 text-xs">
                        <HardDrive size={12} className="text-[var(--color-accent)]" />
                        <span className="text-[var(--color-text-muted)]">{t('common.size')}:</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {mapMetadata.registryDownloadSize != null && `${formatFileSize(mapMetadata.registryDownloadSize)} download`}
                          {mapMetadata.registryDownloadSize != null && mapMetadata.registryInstallSize != null && ' / '}
                          {mapMetadata.registryInstallSize != null && `${formatFileSize(mapMetadata.registryInstallSize)} installed`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* External links */}
                  {mapMetadata.registryResources && Object.values(mapMetadata.registryResources).some(Boolean) && (
                    <div className="flex flex-wrap gap-2 p-4 bg-[var(--color-surface)] border border-[var(--color-border)]">
                      {mapMetadata.registryResources.homepage && (
                        <a href={mapMetadata.registryResources.homepage} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors">
                          <ExternalLink size={10} /> {t('maps.homepage')}
                        </a>
                      )}
                      {mapMetadata.registryResources.beamng_resource && (
                        <a href={mapMetadata.registryResources.beamng_resource} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors">
                          <ExternalLink size={10} /> {t('maps.beamngResource')}
                        </a>
                      )}
                      {mapMetadata.registryResources.beammp_forum && (
                        <a href={mapMetadata.registryResources.beammp_forum} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors">
                          <ExternalLink size={10} /> {t('maps.beammpForum')}
                        </a>
                      )}
                      {mapMetadata.registryResources.repository && (
                        <a href={mapMetadata.registryResources.repository} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors">
                          <ExternalLink size={10} /> {t('maps.repository')}
                        </a>
                      )}
                      {mapMetadata.registryResources.bugtracker && (
                        <a href={mapMetadata.registryResources.bugtracker} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--color-surface-hover)] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] transition-colors">
                          <ExternalLink size={10} /> {t('maps.bugTracker')}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }
}
