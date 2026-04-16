import { useState, useMemo } from 'react'
import { Search, ImagePlus, Flame, Star, Flag, Hash, Shapes, Zap, Heart } from 'lucide-react'

export interface DecalAsset {
  id: string
  name: string
  category: string
  svg: string // SVG markup or data URL
}

// Built-in decal library — SVG inline assets (public domain designs)
const BUILTIN_DECALS: DecalAsset[] = [
  // Racing Stripes
  { id: 'stripe-center', name: 'Center Stripe', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><rect x="85" y="0" width="30" height="200" fill="currentColor"/></svg>' },
  { id: 'stripe-dual', name: 'Dual Stripes', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><rect x="70" y="0" width="15" height="200" fill="currentColor"/><rect x="115" y="0" width="15" height="200" fill="currentColor"/></svg>' },
  { id: 'stripe-triple', name: 'Triple Stripes', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><rect x="60" y="0" width="10" height="200" fill="currentColor"/><rect x="95" y="0" width="10" height="200" fill="currentColor"/><rect x="130" y="0" width="10" height="200" fill="currentColor"/></svg>' },
  { id: 'stripe-side', name: 'Side Stripe', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><rect x="0" y="90" width="200" height="20" fill="currentColor"/></svg>' },
  { id: 'stripe-diagonal', name: 'Diagonal Stripe', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><polygon points="0,160 0,200 200,40 200,0" fill="currentColor"/></svg>' },
  { id: 'stripe-chevron', name: 'Chevron', category: 'stripes', svg: '<svg viewBox="0 0 200 200"><polygon points="100,20 180,100 100,180 20,100" fill="none" stroke="currentColor" stroke-width="12"/></svg>' },

  // Flames
  { id: 'flame-basic', name: 'Flame', category: 'flames', svg: '<svg viewBox="0 0 200 200"><path d="M100 20 C120 60, 160 80, 140 140 C130 170, 100 180, 100 180 C100 180, 70 170, 60 140 C40 80, 80 60, 100 20Z" fill="currentColor"/></svg>' },
  { id: 'flame-tribal', name: 'Tribal Flame', category: 'flames', svg: '<svg viewBox="0 0 200 200"><path d="M20 180 C40 140, 30 100, 60 80 C50 120, 70 100, 80 60 C70 100, 100 80, 100 40 C100 80, 130 100, 120 60 C130 100, 150 120, 140 80 C170 100, 160 140, 180 180Z" fill="currentColor"/></svg>' },
  { id: 'flame-side', name: 'Side Flames', category: 'flames', svg: '<svg viewBox="0 0 200 200"><path d="M0 140 C30 130, 40 100, 60 110 C70 80, 90 90, 100 70 C110 90, 120 80, 130 100 C140 80, 160 90, 160 110 C180 90, 200 120, 200 140Z" fill="currentColor"/></svg>' },

  // Geometric
  { id: 'geo-star5', name: '5-Point Star', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="100,10 127,80 200,80 140,125 160,200 100,155 40,200 60,125 0,80 73,80" fill="currentColor"/></svg>' },
  { id: 'geo-star4', name: '4-Point Star', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="100,10 120,80 190,100 120,120 100,190 80,120 10,100 80,80" fill="currentColor"/></svg>' },
  { id: 'geo-diamond', name: 'Diamond', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="100,10 190,100 100,190 10,100" fill="currentColor"/></svg>' },
  { id: 'geo-hexagon', name: 'Hexagon', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="100,10 180,50 180,150 100,190 20,150 20,50" fill="currentColor"/></svg>' },
  { id: 'geo-arrow', name: 'Arrow', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="100,10 180,100 140,100 140,190 60,190 60,100 20,100" fill="currentColor"/></svg>' },
  { id: 'geo-bolt', name: 'Lightning Bolt', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><polygon points="120,10 40,110 95,110 80,190 160,90 105,90" fill="currentColor"/></svg>' },
  { id: 'geo-circle-outline', name: 'Circle Outline', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" stroke-width="12"/></svg>' },
  { id: 'geo-cross', name: 'Cross', category: 'geometric', svg: '<svg viewBox="0 0 200 200"><rect x="75" y="20" width="50" height="160" fill="currentColor"/><rect x="20" y="75" width="160" height="50" fill="currentColor"/></svg>' },

  // Racing
  { id: 'race-checkered', name: 'Checkered Flag', category: 'racing', svg: '<svg viewBox="0 0 200 200"><defs><pattern id="ck" patternUnits="userSpaceOnUse" width="40" height="40"><rect width="20" height="20" fill="currentColor"/><rect x="20" y="20" width="20" height="20" fill="currentColor"/></pattern></defs><rect width="200" height="200" fill="url(#ck)"/></svg>' },
  { id: 'race-roundel', name: 'Racing Roundel', category: 'racing', svg: '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="90" fill="currentColor"/><circle cx="100" cy="100" r="70" fill="white"/><circle cx="100" cy="100" r="50" fill="currentColor"/></svg>' },
  { id: 'race-laurel', name: 'Laurel Wreath', category: 'racing', svg: '<svg viewBox="0 0 200 200"><path d="M100 180 C60 160, 30 130, 25 90 C20 60, 30 30, 50 20" fill="none" stroke="currentColor" stroke-width="8"/><path d="M100 180 C140 160, 170 130, 175 90 C180 60, 170 30, 150 20" fill="none" stroke="currentColor" stroke-width="8"/></svg>' },

  // Numbers
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `num-${i}`,
    name: `Number ${i}`,
    category: 'numbers',
    svg: `<svg viewBox="0 0 200 200"><text x="100" y="155" text-anchor="middle" font-size="160" font-family="Arial Black, Impact, sans-serif" font-weight="900" fill="currentColor">${i}</text></svg>`
  })),

  // Symbols
  { id: 'sym-skull', name: 'Skull', category: 'symbols', svg: '<svg viewBox="0 0 200 200"><circle cx="100" cy="80" r="60" fill="currentColor"/><circle cx="75" cy="70" r="15" fill="white"/><circle cx="125" cy="70" r="15" fill="white"/><polygon points="100,85 90,105 110,105" fill="white"/><rect x="75" y="140" width="10" height="20" rx="2" fill="currentColor"/><rect x="95" y="140" width="10" height="20" rx="2" fill="currentColor"/><rect x="115" y="140" width="10" height="20" rx="2" fill="currentColor"/></svg>' },
  { id: 'sym-heart', name: 'Heart', category: 'symbols', svg: '<svg viewBox="0 0 200 200"><path d="M100 180 C50 130, 10 100, 10 60 C10 30, 35 10, 55 10 C75 10, 95 25, 100 50 C105 25, 125 10, 145 10 C165 10, 190 30, 190 60 C190 100, 150 130, 100 180Z" fill="currentColor"/></svg>' },
  { id: 'sym-wings', name: 'Wings', category: 'symbols', svg: '<svg viewBox="0 0 200 200"><path d="M100 100 C80 80, 40 60, 10 70 C30 80, 50 100, 30 110 C50 105, 80 110, 100 120Z" fill="currentColor"/><path d="M100 100 C120 80, 160 60, 190 70 C170 80, 150 100, 170 110 C150 105, 120 110, 100 120Z" fill="currentColor"/></svg>' },
  { id: 'sym-wrench', name: 'Wrench', category: 'symbols', svg: '<svg viewBox="0 0 200 200"><path d="M60 30 C40 30, 20 50, 20 70 C20 85, 30 95, 40 100 L120 180 C130 190, 150 190, 160 180 C170 170, 170 150, 160 140 L80 60 C85 50, 80 35, 70 30Z" fill="currentColor"/></svg>' },
  { id: 'sym-piston', name: 'Piston', category: 'symbols', svg: '<svg viewBox="0 0 200 200"><rect x="60" y="100" width="80" height="80" rx="5" fill="currentColor"/><rect x="70" y="60" width="60" height="50" rx="3" fill="currentColor"/><rect x="85" y="30" width="30" height="40" rx="2" fill="currentColor"/></svg>' },
]

const CATEGORIES = [
  { id: 'all', label: 'All', icon: Shapes },
  { id: 'stripes', label: 'Stripes', icon: Flag },
  { id: 'flames', label: 'Flames', icon: Flame },
  { id: 'geometric', label: 'Shapes', icon: Star },
  { id: 'racing', label: 'Racing', icon: Zap },
  { id: 'numbers', label: 'Numbers', icon: Hash },
  { id: 'symbols', label: 'Symbols', icon: Heart },
]

interface DecalLibraryProps {
  onAddDecal: (svg: string, name: string) => void
  onImportImage: () => void
}

export function DecalLibrary({ onAddDecal, onImportImage }: DecalLibraryProps): React.JSX.Element {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let decals = BUILTIN_DECALS
    if (category !== 'all') decals = decals.filter((d) => d.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      decals = decals.filter((d) => d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q))
    }
    return decals
  }, [category, search])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Decals</span>
        <button
          onClick={onImportImage}
          className="p-1 rounded hover:bg-[var(--color-surface-active)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          title="Import Custom Image"
        >
          <ImagePlus size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-1.5 border-b border-[var(--color-border)]">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1 text-xs rounded bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-[var(--color-border)]">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-1.5 py-0.5 text-[10px] rounded flex items-center gap-0.5 transition-colors ${
                category === cat.id
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-active)]'
              }`}
            >
              <Icon size={10} />
              {cat.label}
            </button>
          )
        })}
      </div>

      {/* Decal grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-3 gap-1.5">
          {filtered.map((decal) => (
            <button
              key={decal.id}
              onClick={() => onAddDecal(decal.svg, decal.name)}
              className="group flex flex-col items-center gap-1 p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-accent)]/10 hover:border-[var(--color-accent)]/30 transition-all cursor-pointer"
              title={decal.name}
            >
              <div
                className="w-full aspect-square flex items-center justify-center text-[var(--color-text-secondary)] group-hover:text-[var(--color-accent)]"
                dangerouslySetInnerHTML={{ __html: decal.svg }}
              />
              <span className="text-[9px] text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)] truncate w-full text-center">
                {decal.name}
              </span>
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="flex items-center justify-center py-6 text-[var(--color-text-dim)] text-xs">
            No decals found
          </div>
        )}
      </div>
    </div>
  )
}
