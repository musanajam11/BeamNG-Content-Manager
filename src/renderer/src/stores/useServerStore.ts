import { create } from 'zustand'
import type { ServerInfo } from '../../../shared/types'
import { prefetchFlags } from '../utils/flagCache'
import { parseServerTags } from '../utils/serverTags'

export type SortField = 'players' | 'name' | 'map' | 'location'
export type SortDir = 'asc' | 'desc'
export type FilterTab = 'all' | 'favorites' | 'official' | 'modded'
export type QuickFilter = 'hideEmpty' | 'hideFull' | 'officialOnly' | 'moddedOnly'

interface ServerState {
  servers: ServerInfo[]
  filteredServers: ServerInfo[]
  loading: boolean
  error: string | null
  searchQuery: string
  selectedServer: ServerInfo | null
  favorites: Set<string>
  sortField: SortField
  sortDir: SortDir
  filterTab: FilterTab
  quickFilters: Set<QuickFilter>
  regionFilter: string | null
  versionFilter: string | null
  tagFilters: Set<string>

  fetchServers: () => Promise<void>
  loadFavorites: () => Promise<void>
  toggleFavorite: (ident: string) => Promise<void>
  setSearchQuery: (query: string) => void
  selectServer: (server: ServerInfo | null) => void
  setSort: (field: SortField) => void
  setFilterTab: (tab: FilterTab) => void
  toggleQuickFilter: (filter: QuickFilter) => void
  setRegionFilter: (region: string | null) => void
  setVersionFilter: (version: string | null) => void
  toggleTagFilter: (tagLabel: string) => void
  clearTagFilters: () => void
}

// Module-scoped timer used by setSearchQuery to debounce the actual filter
// recompute (120 ms). Avoids re-running applyFilters on every keystroke.
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

function applyFilters(
  servers: ServerInfo[],
  query: string,
  tab: FilterTab,
  favorites: Set<string>,
  sortField: SortField,
  sortDir: SortDir,
  quickFilters: Set<QuickFilter>,
  regionFilter: string | null,
  versionFilter: string | null,
  tagFilters: Set<string>
): ServerInfo[] {
  let result = servers

  // Tab filter
  switch (tab) {
    case 'favorites': {
      const onlineKeys = new Set(result.map((s) => `${s.ip}:${s.port}`))
      result = result.filter((s) => favorites.has(`${s.ip}:${s.port}`))
      // Add offline placeholders for favorited servers not in the live list
      let savedMeta: Record<string, { sname?: string; map?: string; players?: string; maxplayers?: string; modstotal?: string }> = {}
      try {
        const raw = localStorage.getItem('directConnectServerMeta')
        if (raw) savedMeta = JSON.parse(raw)
      } catch { /* ignore */ }
      for (const key of favorites) {
        if (!onlineKeys.has(key)) {
          const [ip, port] = key.split(':')
          const meta = savedMeta[key]
          result.push({
            ident: key,
            sname: meta?.sname || key,
            ip,
            port: port || '30814',
            players: meta?.players || '0',
            maxplayers: meta?.maxplayers || '0',
            map: meta?.map || '',
            sdesc: 'Offline',
            version: '',
            cversion: '',
            tags: 'offline',
            owner: '',
            official: false,
            featured: false,
            partner: false,
            password: false,
            guests: false,
            location: '',
            modlist: '',
            modstotalsize: '0',
            modstotal: meta?.modstotal || '0',
            playerslist: ''
          })
        }
      }
      break
    }
    case 'official':
      result = result.filter((s) => s.official)
      break
    case 'modded':
      result = result.filter((s) => parseInt(s.modstotal, 10) > 0)
      break
  }

  // Quick filters
  if (quickFilters.has('hideEmpty')) {
    result = result.filter((s) => parseInt(s.players, 10) > 0)
  }
  if (quickFilters.has('hideFull')) {
    result = result.filter((s) => parseInt(s.players, 10) < parseInt(s.maxplayers, 10))
  }
  if (quickFilters.has('officialOnly')) {
    result = result.filter((s) => s.official)
  }
  if (quickFilters.has('moddedOnly')) {
    result = result.filter((s) => parseInt(s.modstotal, 10) > 0)
  }

  // Region filter (single-select, exact country-code match — "offline" tagged
  // favorites bypass this since they have no live region data)
  if (regionFilter) {
    result = result.filter((s) => s.tags === 'offline' || (s.location || '').toLowerCase() === regionFilter.toLowerCase())
  }

  // Version filter (single-select, exact match; "offline" favorites bypass)
  if (versionFilter) {
    result = result.filter((s) => s.tags === 'offline' || s.version === versionFilter)
  }

  // Tag filters (multi-select; server must carry ALL selected tag labels).
  // Compared against the canonical parsed label set from `parseServerTags`.
  if (tagFilters.size > 0) {
    result = result.filter((s) => {
      if (s.tags === 'offline') return false
      const labels = new Set(parseServerTags(s.tags).map((t) => t.label.toLowerCase()))
      for (const wanted of tagFilters) {
        if (!labels.has(wanted.toLowerCase())) return false
      }
      return true
    })
  }

  // Search filter
  if (query) {
    const lower = query.toLowerCase()
    // Strip BeamMP color/format codes (^0-^f, ^r, ^l, ^o, ^n, ^m, ^p) for matching
    const strip = (s: string): string => s.replace(/\^[0-9a-frlonmp]/gi, '')
    result = result.filter(
      (s) =>
        strip(s.sname).toLowerCase().includes(lower) ||
        s.map.toLowerCase().includes(lower) ||
        (s.sdesc && strip(s.sdesc).toLowerCase().includes(lower)) ||
        (s.owner && s.owner.toLowerCase().includes(lower)) ||
        (s.location && s.location.toLowerCase().includes(lower)) ||
        (s.version && s.version.toLowerCase().includes(lower)) ||
        (s.tags && s.tags.toLowerCase().includes(lower))
    )
  }

  // Sort
  result = [...result].sort((a, b) => {
    let cmp = 0
    switch (sortField) {
      case 'players':
        cmp = parseInt(b.players, 10) - parseInt(a.players, 10)
        break
      case 'name':
        cmp = a.sname.localeCompare(b.sname)
        break
      case 'map':
        cmp = a.map.localeCompare(b.map)
        break
      case 'location':
        cmp = (a.location || '').localeCompare(b.location || '')
        break
    }
    return sortDir === 'desc' ? -cmp : cmp
  })

  // Always pin favorites to top (within the current sort)
  if (tab !== 'favorites') {
    const favs = result.filter((s) => favorites.has(`${s.ip}:${s.port}`))
    const rest = result.filter((s) => !favorites.has(`${s.ip}:${s.port}`))
    result = [...favs, ...rest]
  }

  return result
}

export const useServerStore = create<ServerState>((set, get) => {
  const recompute = (): void => {
    const {
      servers, searchQuery, filterTab, favorites, sortField, sortDir,
      quickFilters, regionFilter, versionFilter, tagFilters
    } = get()
    set({
      filteredServers: applyFilters(
        servers, searchQuery, filterTab, favorites, sortField, sortDir,
        quickFilters, regionFilter, versionFilter, tagFilters
      )
    })
  }

  return {
    servers: [],
    filteredServers: [],
    loading: false,
    error: null,
    searchQuery: '',
    selectedServer: null,
    favorites: new Set<string>(),
    sortField: 'players',
    sortDir: 'asc',
    filterTab: 'all',
    quickFilters: new Set<QuickFilter>(),
    regionFilter: null,
    versionFilter: null,
    tagFilters: new Set<string>(),

    fetchServers: async () => {
      set({ loading: true, error: null })
      try {
        const result = await window.api.getServers()
        const servers = Array.isArray(result)
          ? result
          : (result as { success: boolean; data?: ServerInfo[]; error?: string }).data ?? []
        if (!Array.isArray(servers)) {
          throw new Error((result as { error?: string }).error || 'Invalid server response')
        }
        set({ servers, loading: false })
        recompute()
        // Prefetch flag images for all unique country codes
        const codes = [...new Set(servers.map((s) => s.location).filter(Boolean))]
        prefetchFlags(codes)
      } catch (err) {
        set({ error: (err as Error).message, loading: false })
      }
    },

    loadFavorites: async () => {
      try {
        const favs = await window.api.getFavorites()
        set({ favorites: new Set(favs) })
        recompute()
      } catch { /* ignore */ }
    },

    toggleFavorite: async (key: string) => {
      const { favorites } = get()
      const isFav = favorites.has(key)
      try {
        const newFavs = await window.api.setFavorite(key, !isFav)
        set({ favorites: new Set(newFavs) })
        recompute()

        // Sync with direct-connect localStorage
        try {
          const raw = localStorage.getItem('directConnectServers')
          if (raw) {
            const dcServers = JSON.parse(raw) as { address: string; label: string; favorite: boolean; lastUsed: number }[]
            const entry = dcServers.find((s) => s.address === key)
            if (entry) {
              entry.favorite = !isFav
              localStorage.setItem('directConnectServers', JSON.stringify(dcServers))
            }
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    },

    setSearchQuery: (query) => {
      set({ searchQuery: query })
      // Debounce the (relatively expensive) re-filter so fast typing doesn't
      // re-allocate `filteredServers` on every keystroke. The input itself stays
      // controlled, only the filtered list lags ~120ms.
      if (searchDebounceTimer != null) clearTimeout(searchDebounceTimer)
      searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null
        recompute()
      }, 120) as unknown as ReturnType<typeof setTimeout>
    },

    selectServer: (server) => set({ selectedServer: server }),

    setSort: (field) => {
      const { sortField, sortDir } = get()
      const newDir = field === sortField ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'
      set({ sortField: field, sortDir: newDir })
      recompute()
    },

    setFilterTab: (tab) => {
      set({ filterTab: tab })
      recompute()
    },

    toggleQuickFilter: (filter) => {
      const { quickFilters } = get()
      const next = new Set(quickFilters)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      set({ quickFilters: next })
      recompute()
    },

    setRegionFilter: (region) => {
      set({ regionFilter: region })
      recompute()
    },

    setVersionFilter: (version) => {
      set({ versionFilter: version })
      recompute()
    },

    toggleTagFilter: (tagLabel) => {
      const { tagFilters } = get()
      const next = new Set(tagFilters)
      const key = tagLabel.toLowerCase()
      if (next.has(key)) next.delete(key)
      else next.add(key)
      set({ tagFilters: next })
      recompute()
    },

    clearTagFilters: () => {
      set({ tagFilters: new Set<string>() })
      recompute()
    }
  }
})
