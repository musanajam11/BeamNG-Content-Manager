import { useState, useEffect, useMemo } from 'react'
import { Search, Car, Loader2, X } from 'lucide-react'

type VehicleListItem = {
  name: string; displayName: string; brand: string; type: string
  bodyStyle: string; country: string; source: 'stock' | 'mod'; configCount: number
}

interface VehicleSelectorProps {
  onSelect: (vehicleName: string, displayName: string) => void
  onCancel?: () => void
}

export function VehicleSelector({ onSelect, onCancel }: VehicleSelectorProps): React.JSX.Element {
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [previews, setPreviews] = useState<Record<string, string>>({})

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

  // Lazy-load previews
  useEffect(() => {
    if (vehicles.length === 0) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const batch = vehicles.filter((v) => !previews[v.name]).slice(0, 16)
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

  const brands = useMemo(() => {
    const set = new Set(vehicles.map((v) => v.brand).filter(Boolean))
    return Array.from(set).sort()
  }, [vehicles])

  const filtered = useMemo(() => {
    let list = vehicles
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
  }, [vehicles, filterBrand, searchQuery])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--color-text-secondary)]">
        <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
        <p className="text-sm">Loading vehicles…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <Car size={20} className="text-[var(--color-accent)]" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Select Vehicle for Livery</h2>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="p-1 rounded hover:bg-[var(--color-surface-active)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)]">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search vehicles…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <select
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="px-2 py-1.5 text-sm rounded bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          <option value="all">All Brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--color-text-muted)]">{filtered.length} vehicles</span>
      </div>

      {/* Vehicle Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
          {filtered.map((v) => (
            <button
              key={v.name}
              onClick={() => onSelect(v.name, v.displayName)}
              className="group flex flex-col items-center gap-1.5 p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-accent)]/10 hover:border-[var(--color-accent)]/30 transition-all cursor-pointer"
            >
              <div className="w-full aspect-[4/3] rounded bg-[var(--color-scrim-30)] overflow-hidden flex items-center justify-center">
                {previews[v.name] ? (
                  <img
                    src={previews[v.name]}
                    alt={v.displayName}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <Car size={24} className="text-[var(--color-text-dim)]" />
                )}
              </div>
              <div className="w-full text-center">
                <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">{v.displayName}</p>
                <p className="text-[10px] text-[var(--color-text-muted)] truncate">{v.brand}</p>
              </div>
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
            <Car size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No vehicles found</p>
          </div>
        )}
      </div>
    </div>
  )
}
