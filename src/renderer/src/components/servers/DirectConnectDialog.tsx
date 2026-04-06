import { useState, useEffect, useCallback } from 'react'
import { X, Play, Star, Trash2, Clock } from 'lucide-react'
import { useServerStore } from '../../stores/useServerStore'

interface SavedServer {
  address: string
  label: string
  favorite: boolean
  lastUsed: number
}

interface Props {
  open: boolean
  joining: boolean
  onClose: () => void
  onConnect: (ip: string, port: string) => void
}

const STORAGE_KEY = 'directConnectServers'

function loadSaved(): SavedServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToDisk(servers: SavedServer[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
}

export function DirectConnectDialog({ open, joining, onClose, onConnect }: Props): React.JSX.Element | null {
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [saved, setSaved] = useState<SavedServer[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSaved(loadSaved())
      setError(null)
    }
  }, [open])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  if (!open) return null

  const parseAddress = (addr: string): { ip: string; port: number } | null => {
    const trimmed = addr.trim()
    const colonIdx = trimmed.lastIndexOf(':')
    if (colonIdx < 1) return null
    const ip = trimmed.substring(0, colonIdx)
    const port = parseInt(trimmed.substring(colonIdx + 1), 10)
    if (!port || port < 1 || port > 65535) return null
    return { ip, port }
  }

  const handleConnect = (addr?: string): void => {
    const target = addr || address
    const parsed = parseAddress(target)
    if (!parsed) {
      setError('Enter a valid address like 127.0.0.1:30814')
      return
    }
    setError(null)

    // Save to history
    const existing = saved.filter((s) => s.address !== target)
    const entry: SavedServer = {
      address: target,
      label: label || addr ? saved.find((s) => s.address === target)?.label || '' : label,
      favorite: saved.find((s) => s.address === target)?.favorite || false,
      lastUsed: Date.now()
    }
    const updated = [entry, ...existing]
    setSaved(updated)
    saveToDisk(updated)

    onConnect(parsed.ip, String(parsed.port))
  }

  const handleSave = (): void => {
    const parsed = parseAddress(address)
    if (!parsed) {
      setError('Enter a valid address to save')
      return
    }
    setError(null)
    const trimmed = address.trim()
    const existing = saved.filter((s) => s.address !== trimmed)
    const entry: SavedServer = {
      address: trimmed,
      label: label || '',
      favorite: true,
      lastUsed: Date.now()
    }
    const updated = [entry, ...existing]
    setSaved(updated)
    saveToDisk(updated)
    setAddress('')
    setLabel('')

    // Sync with server store favorites
    const { favorites, toggleFavorite } = useServerStore.getState()
    if (!favorites.has(trimmed)) {
      toggleFavorite(trimmed)
    }
  }

  const toggleSavedFavorite = (addr: string): void => {
    const updated = saved.map((s) =>
      s.address === addr ? { ...s, favorite: !s.favorite } : s
    )
    setSaved(updated)
    saveToDisk(updated)

    // Sync with server store favorites
    useServerStore.getState().toggleFavorite(addr)
  }

  const removeSaved = (addr: string): void => {
    const server = saved.find((s) => s.address === addr)
    const updated = saved.filter((s) => s.address !== addr)
    setSaved(updated)
    saveToDisk(updated)

    // If it was a favorite, remove from server store too
    if (server?.favorite) {
      const { favorites, toggleFavorite } = useServerStore.getState()
      if (favorites.has(addr)) {
        toggleFavorite(addr)
      }
    }
  }

  const favorites = saved.filter((s) => s.favorite)
  const recents = saved.filter((s) => !s.favorite).slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-[28px] border border-white/8 bg-[#1a1a1e]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <h2 className="text-sm font-semibold text-white">Direct Connect</h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/8 bg-white/5 p-2 text-slate-400 transition hover:text-white hover:bg-white/10"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 px-6 py-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Server Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
              placeholder="127.0.0.1:30814"
              autoFocus
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-[var(--color-accent-40)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
              Label <span className="normal-case font-normal opacity-60">(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Server"
              className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[var(--color-accent-40)]"
            />
          </div>

          {error && (
            <p className="px-1 text-[11px] text-rose-400">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => handleConnect()}
              disabled={joining || !address.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-white accent-shadow transition hover:opacity-95 disabled:opacity-40"
            >
              <Play size={14} fill="currentColor" />
              {joining ? 'Connecting...' : 'Connect'}
            </button>
            <button
              onClick={handleSave}
              disabled={!address.trim()}
              className="flex items-center gap-1.5 rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
              title="Save to favorites"
            >
              <Star size={14} />
              Save
            </button>
          </div>
        </div>

        {/* Saved servers */}
        {(favorites.length > 0 || recents.length > 0) && (
          <div className="border-t border-white/8">
            {favorites.length > 0 && (
              <div className="px-6 py-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                  Saved Servers
                </h3>
                <div className="space-y-0.5">
                  {favorites.map((s) => (
                    <SavedServerRow
                      key={s.address}
                      server={s}
                      joining={joining}
                      onConnect={() => handleConnect(s.address)}
                      onToggleFavorite={() => toggleSavedFavorite(s.address)}
                      onRemove={() => removeSaved(s.address)}
                    />
                  ))}
                </div>
              </div>
            )}

            {recents.length > 0 && (
              <div className="border-t border-white/8 px-6 py-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                  <Clock size={10} /> Recent
                </h3>
                <div className="space-y-0.5">
                  {recents.map((s) => (
                    <SavedServerRow
                      key={s.address}
                      server={s}
                      joining={joining}
                      onConnect={() => handleConnect(s.address)}
                      onToggleFavorite={() => toggleSavedFavorite(s.address)}
                      onRemove={() => removeSaved(s.address)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SavedServerRow({
  server,
  joining,
  onConnect,
  onToggleFavorite,
  onRemove
}: {
  server: SavedServer
  joining: boolean
  onConnect: () => void
  onToggleFavorite: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-white/5">
      <button
        onClick={onToggleFavorite}
        className={`flex-shrink-0 p-0.5 ${
          server.favorite
            ? 'text-yellow-300'
            : 'text-slate-500 hover:text-yellow-300/70'
        }`}
      >
        <Star size={12} fill={server.favorite ? 'currentColor' : 'none'} />
      </button>

      <button
        onClick={onConnect}
        disabled={joining}
        className="flex-1 min-w-0 text-left disabled:opacity-40"
      >
        <div className="flex items-center gap-2">
          {server.label && (
            <span className="truncate text-xs font-medium text-white">
              {server.label}
            </span>
          )}
          <span className="truncate font-mono text-[11px] text-slate-400">
            {server.address}
          </span>
        </div>
      </button>

      <button
        onClick={onRemove}
        className="flex-shrink-0 rounded p-1 text-slate-500 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}
